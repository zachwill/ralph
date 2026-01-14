#!/usr/bin/env bun
/**
 * core.ts — The only file you need to build an agent loop.
 *
 * Design principles:
 * 1. Agents run in a loop until they signal HALT (exit 1) or CONTINUE (exit 0)
 * 2. Markdown file for task tracking is first-class
 * 3. Push every N commits (configurable, always on)
 * 4. Optional supervisor function every M commits (can run anything)
 * 5. Resume logic is built-in (uncommitted changes)
 * 6. All the footguns are handled internally
 */

import { $, spawn } from "bun";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Agent returns CONTINUE (0) to keep looping, HALT (1) to stop entirely */
export const CONTINUE = 0;
export const HALT = 1;
export type ExitCode = typeof CONTINUE | typeof HALT;

/** Options for pi execution */
export interface PiOptions {
  timeout?: number | string;
  args?: string[]; // e.g., ["--model", "claude-opus-4-5"]
}

/** What the agent should do this iteration */
export type AgentAction =
  | { type: "work"; prompt: string; options?: PiOptions }
  | { type: "generate"; prompt: string; options?: PiOptions } // generate tasks, then exit for review
  | { type: "halt"; reason: string };

/** Your agent definition */
export interface AgentConfig {
  /** Name for banner/logs */
  name: string;

  /** Path to the markdown task file (e.g., ".ralph/TODO.md") */
  taskFile: string;

  /**
   * Timeout per agent run.
   * Accepts: number (seconds), or string like "30s", "5m", "1h"
   */
  timeout: number | string;

  /** Push to remote every N commits (default: 4) */
  pushEvery?: number;

  /** Max iterations before forced exit (default: 400) */
  maxIterations?: number;

  /** Run supervisor every N commits (optional) */
  supervisorEvery?: number;

  /**
   * Decide what to do this iteration.
   * You get the current state, you return an action.
   */
  decide: (state: LoopState) => AgentAction;

  /**
   * Optional: supervisor function.
   * Called when supervisorEvery triggers.
   * Can run anything — use runPi() helper for pi commands, or spawn your own process.
   */
  supervisor?: (state: LoopState) => Promise<void>;
}

/** State passed to your decide() function */
export interface LoopState {
  /** Current iteration (1-indexed) */
  iteration: number;

  /** Total commits since loop started */
  commitsSinceStart: number;

  /** Whether there are uncommitted changes (resume scenario) */
  hasUncommittedChanges: boolean;

  /** Whether the task file has unchecked todos */
  hasTodos: boolean;

  /** The text of the next unchecked todo (if any) */
  nextTodo: string | null;

  /** Full content of the task file */
  taskFileContent: string;

  /** Context from --context/-c flag (if provided) */
  context: string | null;

  /** Whether this is the first iteration */
  isFirstIteration: boolean;
}

// ─────────────────────────────────────────────────────────────
// Time Parsing
// ─────────────────────────────────────────────────────────────

/**
 * Parse timeout value to milliseconds.
 * Accepts: number (seconds), or string like "30s", "5m", "1h"
 */
function parseTimeout(value: number | string): number {
  if (typeof value === "number") {
    return value * 1000; // number = seconds
  }

  const match = value.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/i);
  if (!match) {
    throw new Error(
      `Invalid timeout format: "${value}". Use number (seconds) or string like "30s", "5m", "1h"`
    );
  }

  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "s":
      return num * 1000;
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

// ─────────────────────────────────────────────────────────────
// CLI Helpers
// ─────────────────────────────────────────────────────────────

const hasFlag = (flag: string) => Bun.argv.includes(flag);

const getArgValue = (flag: string, ...aliases: string[]): string | null => {
  for (const f of [flag, ...aliases]) {
    const idx = Bun.argv.indexOf(f);
    if (idx === -1) continue;
    const next = Bun.argv[idx + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// Git Operations
// ─────────────────────────────────────────────────────────────

const hasUncommittedChanges = async () =>
  (await $`git status --porcelain`.text()).trim().length > 0;

const recentCommit = async (withinMs = 15_000) => {
  try {
    const ts = parseInt(await $`git log -1 --format=%ct`.text()) * 1000;
    return Date.now() - ts < withinMs;
  } catch {
    return false;
  }
};

const getCommitCount = async () => {
  try {
    return parseInt(await $`git rev-list --count HEAD`.text()) || 0;
  } catch {
    return 0;
  }
};

async function autoCommit(message: string): Promise<void> {
  console.log("\n📦 Auto-committing uncommitted changes...");
  await $`git add -A`.quiet();
  await $`git commit -m ${message}`.quiet();
}

async function push(): Promise<void> {
  console.log("🚀 Pushing to remote...");
  try {
    await $`git push origin main`;
  } catch (e) {
    console.log("⚠️  Push failed (non-fatal):", e);
  }
}

async function ensureCommit(fallbackMessage: string): Promise<boolean> {
  if (await recentCommit()) {
    console.log("✅ Agent committed successfully");
    return true;
  }
  if (await hasUncommittedChanges()) {
    await autoCommit(fallbackMessage);
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// File Helpers
// ─────────────────────────────────────────────────────────────

const readFile = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf-8") : "";

const ensureFile = (path: string, defaultContent = "") => {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, defaultContent);
  }
};

const hasUncheckedTodos = (content: string) =>
  /^[\s]*[-*+]\s*\[ \]/m.test(content);

const getNextTodo = (content: string): string | null => {
  const match = content.match(/^\s*[-*+]\s*\[ \]\s+(.*)$/m);
  return match ? match[1].trim() : null;
};

// ─────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────

const timestamp = () => new Date().toLocaleString();

function printBanner(name: string): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`${name.toUpperCase()} — Agent Loop`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function printIteration(n: number, max: number): void {
  console.log(`\n┌─ Iteration #${n}/${max} — ${timestamp()}`);
  console.log("└──────────────────────────────────────\n");
}

// ─────────────────────────────────────────────────────────────
// Agent Runner (exported for use in supervisor functions)
// ─────────────────────────────────────────────────────────────

let _piPath: string | null = null;

async function getPiPath(): Promise<string> {
  if (!_piPath) {
    _piPath = (await $`which pi`.text()).trim();
    if (!_piPath) {
      throw new Error("Could not find 'pi' in PATH");
    }
  }
  return _piPath;
}

/**
 * Run pi with a prompt. Exported so supervisor functions can use it.
 */
export async function runPi(
  prompt: string,
  options?: {
    timeout?: number | string;
    args?: string[]; // additional args like "--model", "claude-opus-4-5"
  }
): Promise<void> {
  const piPath = await getPiPath();
  const timeoutMs = options?.timeout ? parseTimeout(options.timeout) : 300_000;
  const extraArgs = options?.args ?? [];

  const proc = spawn([piPath, "-p", prompt, ...extraArgs], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const timeout = setTimeout(() => {
    console.log(`\n⏰ Timed out after ${timeoutMs / 1000}s`);
    proc.kill();
  }, timeoutMs);

  await proc.exited;
  clearTimeout(timeout);
}

/**
 * Run an arbitrary command. Exported so supervisor functions can use it.
 */
export async function runCommand(
  command: string[],
  options?: { timeout?: number | string }
): Promise<void> {
  const timeoutMs = options?.timeout ? parseTimeout(options.timeout) : 300_000;

  const proc = spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
  });

  const timeout = setTimeout(() => {
    console.log(`\n⏰ Timed out after ${timeoutMs / 1000}s`);
    proc.kill();
  }, timeoutMs);

  await proc.exited;
  clearTimeout(timeout);
}

// ─────────────────────────────────────────────────────────────
// The Main Loop
// ─────────────────────────────────────────────────────────────

export async function runLoop(config: AgentConfig): Promise<never> {
  // Validate
  if (!existsSync(".git")) {
    console.error("❌ Not a git repository");
    process.exit(1);
  }

  // Parse timeout
  const timeoutMs = parseTimeout(config.timeout);

  // CLI flags (handled internally)
  const once = hasFlag("--once");
  const dryRun = hasFlag("--dry-run");
  const context = getArgValue("--context", "-c");

  // Defaults
  const pushEvery = config.pushEvery ?? 4;
  const maxIterations = config.maxIterations ?? 400;

  // Ensure task file exists
  ensureFile(config.taskFile, "# Tasks\n\n");

  printBanner(config.name);

  let iteration = 0;
  let commitsSinceStart = 0;
  const startCommitCount = await getCommitCount();

  while (true) {
    iteration++;

    // Check max iterations
    if (iteration > maxIterations) {
      console.log(`\n🛑 Reached max iterations (${maxIterations}). Exiting.`);
      process.exit(0);
    }

    printIteration(iteration, maxIterations);

    // Build current state
    const taskFileContent = readFile(config.taskFile);
    const state: LoopState = {
      iteration,
      commitsSinceStart,
      hasUncommittedChanges: await hasUncommittedChanges(),
      hasTodos: hasUncheckedTodos(taskFileContent),
      nextTodo: getNextTodo(taskFileContent),
      taskFileContent,
      context,
      isFirstIteration: iteration === 1,
    };

    // Check if supervisor should run
    if (
      config.supervisorEvery &&
      config.supervisor &&
      commitsSinceStart > 0 &&
      commitsSinceStart % config.supervisorEvery === 0
    ) {
      console.log("🔮 Running supervisor...");

      if (dryRun) {
        console.log("\n(dry-run) Would run supervisor function");
        process.exit(0);
      }

      await config.supervisor(state);
      await ensureCommit("chore: supervisor");

      // Update commit count after supervisor
      const currentCount = await getCommitCount();
      commitsSinceStart = currentCount - startCommitCount;
      continue;
    }

    // Get the action from user's decide function
    const action = config.decide(state);

    // Handle the action
    switch (action.type) {
      case "halt":
        console.log(`\n✅ ${action.reason}`);
        process.exit(0);

      case "generate": {
        console.log("🔍 Generating tasks...");
        if (dryRun) {
          console.log("\n(dry-run) Would run prompt:\n");
          console.log(action.prompt);
          if (action.options?.args?.length) {
            console.log(`\nWith args: ${action.options.args.join(" ")}`);
          }
          process.exit(0);
        }
        await runPi(action.prompt, {
          timeout: action.options?.timeout ?? timeoutMs,
          args: action.options?.args,
        });
        await ensureCommit("chore: generate tasks");
        console.log(
          `\n✅ Tasks written to ${config.taskFile} — exiting for review`
        );
        process.exit(0);
      }

      case "work": {
        if (state.nextTodo) {
          console.log(`▶ Task: ${state.nextTodo}`);
        }
        if (dryRun) {
          console.log("\n(dry-run) Would run prompt:\n");
          console.log(action.prompt);
          if (action.options?.args?.length) {
            console.log(`\nWith args: ${action.options.args.join(" ")}`);
          }
          process.exit(0);
        }
        await runPi(action.prompt, {
          timeout: action.options?.timeout ?? timeoutMs,
          args: action.options?.args,
        });
        await ensureCommit(`chore: iteration ${iteration}`);
        break;
      }
    }

    // Track commits
    const currentCount = await getCommitCount();
    commitsSinceStart = currentCount - startCommitCount;

    // Push periodically
    if (commitsSinceStart > 0 && commitsSinceStart % pushEvery === 0) {
      await push();
    }

    // Check if we should exit after work (no more todos)
    const updatedContent = readFile(config.taskFile);
    if (!hasUncheckedTodos(updatedContent) && action.type === "work") {
      console.log("\n✅ All tasks complete");
      process.exit(0);
    }

    if (once) {
      console.log("\n(--once) Exiting after single iteration");
      process.exit(0);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Prompt Helpers (commonly needed patterns)
// ─────────────────────────────────────────────────────────────

/** Standard suffix to append when there are uncommitted changes */
export const RESUME_SUFFIX = `
NOTE: There are uncommitted changes from a previous execution.
Run "git diff" to understand the state of work.
Finish/repair the in-progress work and commit.
`.trim();

/** Wrap a base prompt with resume logic if needed */
export const withResume = (prompt: string, hasChanges: boolean) =>
  hasChanges ? `${prompt}\n\n${RESUME_SUFFIX}` : prompt;

/** Build a prompt that includes task file context */
export const withTaskFile = (taskFile: string, instructions: string) =>
  `
Your task file is: ${taskFile}
Use this file to track what needs to be done.
You can see recent work via: git log -n 5 --oneline

${instructions}

After completing work:
- Update ${taskFile} to reflect what you've done
- git add -A && git commit -m "<brief description>"
- Exit
`.trim();
