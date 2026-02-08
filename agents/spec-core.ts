#!/usr/bin/env bun
/**
 * spec-core.ts - Directory-based spec system for multi-model workflows.
 *
 * This module provides an alternative to the file-based task system.
 * Instead of using a single `.ralph/XYZ.md` file, it uses a directory
 * `.ralph/XYZ/` containing numbered markdown spec files.
 *
 * Workflow:
 *   1. A "researcher" model (e.g., Opus) researches a problem and creates
 *      a numbered spec file (e.g., `001-add-validation.md`) with detailed
 *      instructions for implementation.
 *
 *   2. A "worker" model (e.g., GPT-5.2) picks up an available spec file,
 *      marks it as WIP, implements it, and deletes the file when done.
 *
 *   3. Git history preserves the spec files, so there's no need to keep
 *      crossed-out tasks cluttering the directory.
 *
 * Usage:
 *   import { specLoop, research, implement, specHalt } from "./spec-core";
 *
 *   specLoop({
 *     name: "my-spec-loop",
 *     specDir: ".ralph/SPECS",
 *     timeout: "5m",
 *     run(state) {
 *       if (state.hasAvailableSpecs) return implement(`...`);
 *       return research(`...`);
 *     },
 *   });
 */

import { $ } from "bun";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runPi, type RunOptions } from "./core";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Marker added to top of file when a worker is implementing it */
export const WIP_MARKER = "<!-- WIP: IN PROGRESS -->";

/** Pattern to match WIP marker at the start of file content */
const WIP_PATTERN = /^<!--\s*WIP:\s*IN PROGRESS\s*-->/;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface SpecAction {
  _type: "research" | "implement" | "halt";
  _prompt?: string;
  _reason?: string;
  _options?: RunOptions;
}

export interface SpecSupervisorConfig {
  every: number;
  run: (state: SpecState) => Promise<void>;
}

export interface SpecLoopConfig {
  /** Name for banner/logs */
  name: string;

  /** Path to the spec directory (e.g., ".ralph/SPECS") */
  specDir: string;

  /**
   * Timeout per run.
   * Accepts: number (seconds), or string like "30s", "5m", "1h"
   */
  timeout: number | string;

  /** Push to remote every N commits (default: 4) */
  pushEvery?: number;

  /** Max iterations before forced exit (default: 400) */
  maxIterations?: number;

  /**
   * If true, the loop never exits just because the spec directory is empty.
   * When there are no specs, your run(state) function should return research().
   */
  continuous?: boolean;

  /** Optional supervisor */
  supervisor?: SpecSupervisorConfig;

  /**
   * The main decision function.
   * Return research(), implement(), or specHalt().
   */
  run: (state: SpecState) => SpecAction;
}

/** A spec file with metadata */
export interface SpecFile {
  /** Full path to the file */
  path: string;

  /** Just the filename (e.g., "001-add-validation.md") */
  name: string;

  /** The numeric prefix (e.g., 1) */
  number: number;

  /** Whether the file is marked as WIP */
  isWIP: boolean;

  /** The file contents (without WIP marker if present) */
  content: string;

  /** Raw file contents (includes WIP marker if present; use for displaying the exact file) */
  rawContent: string;
}

/** State passed to your run() function */
export interface SpecState {
  /** Current iteration (1-indexed) */
  iteration: number;

  /** Total commits since loop started */
  commits: number;

  /** All spec files in the directory */
  specs: SpecFile[];

  /** Spec files that are not WIP (available for implementation) */
  availableSpecs: SpecFile[];

  /** Whether there are any specs available for implementation */
  hasAvailableSpecs: boolean;

  /** The next available spec (first non-WIP file, sorted by number) */
  nextSpec: SpecFile | null;

  /** Context from --context/-c flag (if provided) */
  context: string | null;

  /** Whether there are uncommitted changes (rarely needed) */
  hasUncommittedChanges: boolean;

  /** The spec directory path */
  specDir: string;
}

// ─────────────────────────────────────────────────────────────
// Action Creators
// ─────────────────────────────────────────────────────────────

/** Research a problem and create a spec file, then continue looping */
export function research(prompt: string, options?: RunOptions): SpecAction {
  return { _type: "research", _prompt: prompt.trim(), _options: options };
}

/** Implement a spec file, then continue looping */
export function implement(prompt: string, options?: RunOptions): SpecAction {
  return { _type: "implement", _prompt: prompt.trim(), _options: options };
}

/** Stop the spec loop entirely */
export function specHalt(reason: string): SpecAction {
  return { _type: "halt", _reason: reason };
}

// ─────────────────────────────────────────────────────────────
// Spec Directory Helpers
// ─────────────────────────────────────────────────────────────

/** Ensure the spec directory exists */
export async function ensureSpecDir(specDir: string): Promise<void> {
  try {
    await mkdir(specDir, { recursive: true });
  } catch {
    // Directory may already exist
  }
}

/** Parse a spec filename to extract its number */
function parseSpecNumber(filename: string): number | null {
  const match = filename.match(/^(\d+)-/);
  return match ? parseInt(match[1], 10) : null;
}

/** Get the next available spec number in the directory */
export async function getNextSpecNumber(specDir: string): Promise<number> {
  try {
    const files = await readdir(specDir);
    const numbers = files
      .map(parseSpecNumber)
      .filter((n): n is number => n !== null);

    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  } catch {
    return 1;
  }
}

/** Format a spec number with leading zeros (e.g., 001, 012, 123) */
export function formatSpecNumber(n: number): string {
  return n.toString().padStart(3, "0");
}

/** Create a spec filename from a number and description */
export function createSpecFilename(number: number, description: string): string {
  // Sanitize description for filename
  const sanitized = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return `${formatSpecNumber(number)}-${sanitized || "spec"}.md`;
}

/** Read a spec file and parse its metadata */
async function readSpecFile(specDir: string, filename: string): Promise<SpecFile | null> {
  const path = join(specDir, filename);

  // Only process .md files
  if (!filename.endsWith(".md")) return null;

  const number = parseSpecNumber(filename);
  if (number === null) return null;

  try {
    const rawContent = await Bun.file(path).text();
    const isWIP = WIP_PATTERN.test(rawContent);
    const content = isWIP ? rawContent.replace(WIP_PATTERN, "").trim() : rawContent;

    return {
      path,
      name: filename,
      number,
      isWIP,
      content,
      rawContent,
    };
  } catch {
    return null;
  }
}

/** List all spec files in the directory */
export async function listSpecs(specDir: string): Promise<SpecFile[]> {
  try {
    const files = await readdir(specDir);
    const specs: SpecFile[] = [];

    for (const file of files) {
      const spec = await readSpecFile(specDir, file);
      if (spec) specs.push(spec);
    }

    // Sort by number
    return specs.sort((a, b) => a.number - b.number);
  } catch {
    return [];
  }
}

/** Mark a spec file as WIP by prepending the marker */
export async function markSpecAsWIP(specPath: string): Promise<void> {
  const content = await Bun.file(specPath).text();

  // Don't double-mark
  if (WIP_PATTERN.test(content)) return;

  const newContent = `${WIP_MARKER}\n\n${content}`;
  await Bun.write(specPath, newContent);
}

/** Remove the WIP marker from a spec file */
export async function unmarkSpecAsWIP(specPath: string): Promise<void> {
  const content = await Bun.file(specPath).text();

  if (!WIP_PATTERN.test(content)) return;

  const newContent = content.replace(WIP_PATTERN, "").trim();
  await Bun.write(specPath, newContent + "\n");
}

/** Delete a spec file (after implementation is complete) */
export async function deleteSpec(specPath: string): Promise<void> {
  try {
    await rm(specPath);
  } catch {
    // File may already be deleted
  }
}

/** Create a new spec file in the directory */
export async function createSpec(
  specDir: string,
  description: string,
  content: string
): Promise<string> {
  await ensureSpecDir(specDir);

  const number = await getNextSpecNumber(specDir);
  const filename = createSpecFilename(number, description);
  const path = join(specDir, filename);

  await Bun.write(path, content);
  return path;
}

// ─────────────────────────────────────────────────────────────
// Time Parsing (copied from core.ts for self-containment)
// ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300_000;

function parseTimeout(value: number | string): number {
  if (typeof value === "number") return value * 1000;

  const match = value.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/i);
  if (!match) {
    throw new Error(
      `Invalid timeout: "${value}". Use "30s", "5m", "1h", or number (seconds)`
    );
  }

  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
  };

  const multiplier = multipliers[unit];
  if (!multiplier) throw new Error(`Unknown time unit: ${unit}`);

  return num * multiplier;
}

// ─────────────────────────────────────────────────────────────
// CLI Helpers (copied from core.ts)
// ─────────────────────────────────────────────────────────────

type CliFlags = {
  once: boolean;
  dryRun: boolean;
  context: string | null;
};

function hasFlag(flag: string, argv = Bun.argv): boolean {
  return argv.includes(flag);
}

function getArgValue(flag: string, aliases: string[] = [], argv = Bun.argv): string | null {
  for (const f of [flag, ...aliases]) {
    const idx = argv.indexOf(f);
    if (idx === -1) continue;
    const next = argv[idx + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
}

function parseCliFlags(argv = Bun.argv): CliFlags {
  return {
    once: hasFlag("--once", argv),
    dryRun: hasFlag("--dry-run", argv),
    context: getArgValue("--context", ["-c"], argv),
  };
}

function exitDryRun(prompt: string, options?: RunOptions): never {
  console.log("\n(dry-run) Prompt:\n");
  console.log(prompt);
  if (options?.model) {
    console.log(`\nModel: ${options.model}`);
  }
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// Git Operations (copied from core.ts)
// ─────────────────────────────────────────────────────────────

async function hasUncommittedChanges(): Promise<boolean> {
  return (await $`git status --porcelain`.text()).trim().length > 0;
}

async function hasRecentCommit(withinMs = 15_000): Promise<boolean> {
  try {
    const ts = parseInt(await $`git log -1 --format=%ct`.text()) * 1000;
    return Date.now() - ts < withinMs;
  } catch {
    return false;
  }
}

async function getCommitCount(): Promise<number> {
  try {
    return parseInt(await $`git rev-list --count HEAD`.text()) || 0;
  } catch {
    return 0;
  }
}

async function autoCommit(message: string): Promise<void> {
  console.log("\n[Auto-commit]");
  await $`git add -A`.quiet();
  await $`git commit -m ${message}`.quiet();
}

async function push(): Promise<void> {
  console.log("[Push]");
  try {
    await $`git push origin HEAD`;
  } catch {
    console.log("Push failed (non-fatal)");
  }
}

async function ensureCommit(fallbackMessage: string): Promise<boolean> {
  if (await hasRecentCommit()) {
    console.log("Committed");
    return true;
  }

  if (await hasUncommittedChanges()) {
    await autoCommit(fallbackMessage);
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
// Colors & Logging (copied from core.ts)
// ─────────────────────────────────────────────────────────────

const colors = {
  spec: Bun.color("cyan", "ansi") ?? "",
  research: Bun.color("magenta", "ansi") ?? "",
  implement: Bun.color("limegreen", "ansi") ?? "",
  dim: Bun.color("lightslategray", "ansi") ?? "",
  reset: "\x1b[0m",
};

// ─────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────

const timestamp = () => new Date().toLocaleString();

function printBanner(name: string): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`${name.toUpperCase()} (spec-based)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function printIteration(n: number, max: number): void {
  console.log(`\n┌─ Iteration ${n}/${max} - ${timestamp()}`);
  console.log("└──────────────────────────────────────\n");
}

// ─────────────────────────────────────────────────────────────
// Resume Logic
// ─────────────────────────────────────────────────────────────

const RESUME_SUFFIX = `

---
NOTE: There are uncommitted changes from a previous run.
Run "git diff" to see the current state.
Finish the in-progress work and commit.
`.trim();

function withResume(prompt: string, include: boolean): string {
  return include ? `${prompt}\n\n${RESUME_SUFFIX}` : prompt;
}

// ─────────────────────────────────────────────────────────────
// Prompt Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Build a research prompt that instructs the model to create a spec file.
 * Uses the "copy/paste for your future self" framing that works well with Opus.
 */
export function buildResearchPrompt(
  specDir: string,
  basePrompt: string,
  context?: string | null
): string {
  const contextBlock = context
    ? `\n\nAdditional context:\n<context>\n${context}\n</context>\n`
    : "";

  return `
${basePrompt}
${contextBlock}

IMPORTANT: Your context window is full. I'm going to start you over fresh with a new model.
Create a detailed copy/paste for your future self to execute on what you've compiled.

Save your findings as a markdown file in ${specDir}/ using this format:

1. First, determine the next available number by checking existing files in ${specDir}/
2. Create a file named: <number>-<brief-description>.md (e.g., 001-add-validation.md)
3. The file should contain EVERYTHING your future self needs to implement this:
   - Clear problem statement
   - Specific files to modify
   - Exact code changes or patterns to follow
   - Any gotchas or edge cases
   - Verification steps

Example structure:
\`\`\`markdown
# <Title>

## Problem
<What needs to be done and why>

## Implementation
<Detailed step-by-step instructions>

## Files to Modify
- \`path/to/file1.ts\` - <what to change>
- \`path/to/file2.ts\` - <what to change>

## Verification
<How to verify the implementation is correct>
\`\`\`

After creating the spec file:
- git add -A && git commit -m "spec: <brief description>"
- Exit
`.trim();
}

/**
 * Build an implementation prompt for working on a spec file.
 */
export function buildImplementPrompt(
  spec: SpecFile,
  specDir: string
): string {
  return `
You are implementing a spec from a previous research session.

SPEC FILE: ${spec.path}

<spec>
${spec.content}
</spec>

WORKFLOW:
1. First, mark the spec as WIP by prepending "<!-- WIP: IN PROGRESS -->" to the file
2. Implement everything described in the spec
3. Verify your changes work (run tests, typecheck, etc.)
4. When FULLY complete, DELETE the spec file (git will preserve history)

IMPORTANT:
- The spec file contains detailed instructions from a previous session
- Follow them precisely
- If something is unclear, make a reasonable decision and document it
- Delete the spec file only when FULLY complete

When done:
- git add -A && git commit -m "<what you implemented>"
- Exit
`.trim();
}

// ─────────────────────────────────────────────────────────────
// The Spec Loop
// ─────────────────────────────────────────────────────────────

type SpecActionType = Extract<SpecAction["_type"], "research" | "implement">;

async function runSpecAction(
  type: SpecActionType,
  action: SpecAction,
  state: SpecState,
  hasChanges: boolean,
  defaultTimeout: number | string,
  flags: CliFlags
): Promise<void> {
  let prompt = action._prompt!;

  // For implement actions, prepend the spec file info
  if (type === "implement" && state.nextSpec) {
    // Mark as WIP before starting
    await markSpecAsWIP(state.nextSpec.path);
    await $`git add ${state.nextSpec.path}`.quiet();
  }

  prompt = withResume(prompt, hasChanges);

  const runOptions: RunOptions = {
    ...action._options,
    timeout: action._options?.timeout ?? defaultTimeout,
    role: "worker",
  };

  if (flags.dryRun) {
    exitDryRun(prompt, action._options);
  }

  await runPi(prompt, runOptions);
}

function shouldRunSupervisor(config: SpecLoopConfig, commits: number): boolean {
  return Boolean(
    config.supervisor && commits > 0 && commits % config.supervisor.every === 0
  );
}

export async function specLoop(config: SpecLoopConfig): Promise<never> {
  // Validate (use shell to check .git since Bun.file() only works for files)
  const isGitRepo = await $`test -d .git`.nothrow().quiet();
  if (isGitRepo.exitCode !== 0) {
    console.error("Error: Not a git repository");
    process.exit(1);
  }

  // Parse config defaults
  const pushEvery = config.pushEvery ?? 4;
  const maxIterations = config.maxIterations ?? 400;
  const continuous = config.continuous ?? false;

  // CLI flags
  const flags = parseCliFlags();

  // Ensure spec directory exists
  await ensureSpecDir(config.specDir);

  printBanner(config.name);

  let iteration = 0;
  let commits = 0;
  const startCommitCount = await getCommitCount();

  while (true) {
    iteration++;

    if (iteration > maxIterations) {
      console.log(`\n[Stop] Max iterations (${maxIterations}) reached`);
      process.exit(0);
    }

    printIteration(iteration, maxIterations);

    // Build state
    const specs = await listSpecs(config.specDir);
    const availableSpecs = specs.filter((s) => !s.isWIP);
    const uncommittedChanges = await hasUncommittedChanges();

    const state: SpecState = {
      iteration,
      commits,
      specs,
      availableSpecs,
      hasAvailableSpecs: availableSpecs.length > 0,
      nextSpec: availableSpecs[0] ?? null,
      context: flags.context,
      hasUncommittedChanges: uncommittedChanges,
      specDir: config.specDir,
    };

    // Log spec status
    const wipCount = specs.filter((s) => s.isWIP).length;
    const availCount = availableSpecs.length;
    console.log(
      `${colors.spec}[Specs]${colors.reset} ${colors.dim}${availCount} available, ${wipCount} WIP${colors.reset}`
    );

    // Supervisor
    if (shouldRunSupervisor(config, commits)) {
      console.log("[Supervisor]");

      if (flags.dryRun) {
        console.log("(dry-run) Would run supervisor");
        process.exit(0);
      }

      await config.supervisor!.run(state);
      await ensureCommit("chore: supervisor");

      const currentCount = await getCommitCount();
      commits = currentCount - startCommitCount;
      continue;
    }

    // Get action from user's run function
    const action = config.run(state);

    switch (action._type) {
      case "halt": {
        console.log(`\n[Done] ${action._reason}`);
        process.exit(0);
      }

      case "research": {
        console.log(`${colors.research}[Research]${colors.reset} Creating new spec...`);

        await runSpecAction(
          "research",
          action,
          state,
          uncommittedChanges,
          config.timeout,
          flags
        );

        await ensureCommit("spec: add new spec");

        // Guard: in continuous mode, prevent infinite research loops
        if (continuous) {
          const newSpecs = await listSpecs(config.specDir);
          const newAvailable = newSpecs.filter((s) => !s.isWIP);
          if (newAvailable.length === 0) {
            console.log(
              `\n[Stop] Continuous mode: research produced no new spec files in ${config.specDir}`
            );
            console.log("Stopping to avoid an infinite loop.");
            process.exit(1);
          }
        }

        console.log(`\n[Research] Spec created in ${config.specDir}`);
        break;
      }

      case "implement": {
        if (state.nextSpec) {
          console.log(
            `${colors.implement}[Implement]${colors.reset} ${state.nextSpec.name}`
          );
        } else {
          console.log(`${colors.implement}[Implement]${colors.reset} No spec available`);
        }

        await runSpecAction(
          "implement",
          action,
          state,
          uncommittedChanges,
          config.timeout,
          flags
        );

        await ensureCommit(`chore: implement spec (iteration ${iteration})`);
        break;
      }
    }

    // Update commit count
    const currentCount = await getCommitCount();
    commits = currentCount - startCommitCount;

    // Push periodically
    if (commits > 0 && commits % pushEvery === 0) {
      await push();
    }

    // Check if done (no more specs and not continuous)
    const updatedSpecs = await listSpecs(config.specDir);
    const updatedAvailable = updatedSpecs.filter((s) => !s.isWIP);

    if (
      !continuous &&
      updatedAvailable.length === 0 &&
      updatedSpecs.filter((s) => s.isWIP).length === 0 &&
      action._type === "implement"
    ) {
      console.log("\n[Done] All specs implemented");
      process.exit(0);
    }

    if (flags.once) {
      console.log("\n(--once) Single iteration complete");
      process.exit(0);
    }
  }
}
