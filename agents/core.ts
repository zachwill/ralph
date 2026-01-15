#!/usr/bin/env bun
/**
 * core.ts — Dead simple autonomous loops.
 *
 * Usage:
 *   import { loop, work, generate, halt, supervisor } from "./core";
 *
 *   loop({
 *     name: "my-loop",
 *     taskFile: ".ralph/TODO.md",
 *     timeout: "5m",
 *     run(state) {
 *       if (state.hasTodos) return work(`...`);
 *       return generate(`...`);
 *     },
 *   });
 *
 * RunOptions (for work, generate, supervisor):
 *   - model: Single model (e.g., "gpt-4o-mini")
 *   - provider: Provider (e.g., "openai", "anthropic")
 *   - models: Limit cycling (e.g., "sonnet:high,haiku:low")
 *   - thinking: Starting level ("low" | "medium" | "high")
 *   - tools: Restrict tools (e.g., "read,grep,find,ls" for read-only)
 *   - timeout: Per-run timeout (e.g., "5m")
 */

import { $, spawn } from "bun";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface RunOptions {
  /** Single model to use (e.g., "gpt-4o-mini") */
  model?: string;

  /** Provider to use (e.g., "openai", "anthropic") */
  provider?: string;

  /**
   * Limit model cycling to specific models.
   * Examples:
   *   - "claude-sonnet,claude-haiku,gpt-4o"
   *   - "github-copilot/*"
   *   - "sonnet:high,haiku:low" (with thinking levels)
   */
  models?: string;

  /** Starting thinking level: "low", "medium", or "high" */
  thinking?: "low" | "medium" | "high";

  /**
   * Restrict available tools (comma-separated).
   * Example: "read,grep,find,ls" for read-only mode
   */
  tools?: string;

  /** Timeout per run (seconds or string like "5m") */
  timeout?: number | string;
}

export interface Action {
  _type: "work" | "generate" | "halt";
  _prompt?: string;
  _reason?: string;
  _options?: RunOptions;
}

export interface SupervisorConfig {
  every: number;
  run: (state: State) => Promise<void>;
}

export interface LoopConfig {
  /** Name for banner/logs */
  name: string;

  /** Path to the markdown task file (e.g., ".ralph/TODO.md") */
  taskFile: string;

  /**
   * Timeout per run.
   * Accepts: number (seconds), or string like "30s", "5m", "1h"
   */
  timeout: number | string;

  /** Push to remote every N commits (default: 4) */
  pushEvery?: number;

  /** Max iterations before forced exit (default: 400) */
  maxIterations?: number;

  /** Optional supervisor */
  supervisor?: SupervisorConfig;

  /**
   * The main decision function.
   * Return work(), generate(), or halt().
   */
  run: (state: State) => Action;
}

/** State passed to your run() function */
export interface State {
  /** Current iteration (1-indexed) */
  iteration: number;

  /** Total commits since loop started */
  commits: number;

  /** Whether the task file has unchecked todos */
  hasTodos: boolean;

  /** The text of the next unchecked todo (if any) */
  nextTodo: string | null;

  /** All unchecked todos */
  todos: string[];

  /** Context from --context/-c flag (if provided) */
  context: string | null;

  /** Whether there are uncommitted changes (rarely needed) */
  hasUncommittedChanges: boolean;
}

// ─────────────────────────────────────────────────────────────
// Action Creators
// ─────────────────────────────────────────────────────────────

/** Do work, then continue looping */
export function work(prompt: string, options?: RunOptions): Action {
  return { _type: "work", _prompt: prompt.trim(), _options: options };
}

/** Generate tasks, then exit for review */
export function generate(prompt: string, options?: RunOptions): Action {
  return { _type: "generate", _prompt: prompt.trim(), _options: options };
}

/** Stop the loop entirely */
export function halt(reason: string): Action {
  return { _type: "halt", _reason: reason };
}

/** Create a supervisor config from just a prompt */
export function supervisor(
  prompt: string,
  options: { every: number } & RunOptions
): SupervisorConfig {
  const { every, ...runOptions } = options;
  return {
    every,
    async run() {
      await runPi(prompt, runOptions);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Time Parsing
// ─────────────────────────────────────────────────────────────

function parseTimeout(value: number | string): number {
  if (typeof value === "number") return value * 1000;

  const match = value.match(/^(\d+(?:\.\d+)?)\s*(s|m|h)$/i);
  if (!match) {
    throw new Error(`Invalid timeout: "${value}". Use "30s", "5m", "1h", or number (seconds)`);
  }

  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "s": return num * 1000;
    case "m": return num * 60 * 1000;
    case "h": return num * 60 * 60 * 1000;
    default: throw new Error(`Unknown time unit: ${unit}`);
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

const getUncommittedChanges = async () =>
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
  console.log("\n📦 Auto-committing...");
  await $`git add -A`.quiet();
  await $`git commit -m ${message}`.quiet();
}

async function push(): Promise<void> {
  console.log("🚀 Pushing to remote...");
  try {
    await $`git push origin HEAD`;
  } catch (e) {
    console.log("⚠️  Push failed (non-fatal)");
  }
}

async function ensureCommit(fallbackMessage: string): Promise<boolean> {
  if (await recentCommit()) {
    console.log("✅ Committed");
    return true;
  }
  if (await getUncommittedChanges()) {
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

function getUncheckedTodos(content: string): string[] {
  const matches = content.matchAll(/^\s*[-*+]\s*\[ \]\s+(.*)$/gm);
  return Array.from(matches, (m) => m[1].trim());
}

// ─────────────────────────────────────────────────────────────
// Display
// ─────────────────────────────────────────────────────────────

const timestamp = () => new Date().toLocaleString();

function printBanner(name: string): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`${name.toUpperCase()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function printIteration(n: number, max: number): void {
  console.log(`\n┌─ Iteration ${n}/${max} — ${timestamp()}`);
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

function withResume(prompt: string, hasChanges: boolean): string {
  return hasChanges ? `${prompt}\n\n${RESUME_SUFFIX}` : prompt;
}

// ─────────────────────────────────────────────────────────────
// Pi Runner (exported for supervisor use)
// ─────────────────────────────────────────────────────────────

let _piPath: string | null = null;

async function getPiPath(): Promise<string> {
  if (!_piPath) {
    _piPath = (await $`which pi`.text()).trim();
    if (!_piPath) throw new Error("Could not find 'pi' in PATH");
  }
  return _piPath;
}

export async function runPi(
  prompt: string,
  options?: RunOptions
): Promise<void> {
  const piPath = await getPiPath();
  const timeoutMs = options?.timeout ? parseTimeout(options.timeout) : 300_000;

  // Build args from options
  const args: string[] = [];

  if (options?.model) {
    args.push("--model", options.model);
  }
  if (options?.provider) {
    args.push("--provider", options.provider);
  }
  if (options?.models) {
    args.push("--models", options.models);
  }
  if (options?.thinking) {
    args.push("--thinking", options.thinking);
  }
  if (options?.tools) {
    args.push("--tools", options.tools);
  }

  const proc = spawn([piPath, "-p", prompt, ...args], {
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

/** Run an arbitrary command (for advanced supervisor use) */
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

export async function loop(config: LoopConfig): Promise<never> {
  // Validate
  if (!existsSync(".git")) {
    console.error("❌ Not a git repository");
    process.exit(1);
  }

  // Parse config
  const defaultTimeoutMs = parseTimeout(config.timeout);
  const pushEvery = config.pushEvery ?? 4;
  const maxIterations = config.maxIterations ?? 400;

  // CLI flags
  const once = hasFlag("--once");
  const dryRun = hasFlag("--dry-run");
  const context = getArgValue("--context", "-c");

  // Ensure task file exists
  ensureFile(config.taskFile, "# Tasks\n\n");

  printBanner(config.name);

  let iteration = 0;
  let commits = 0;
  const startCommitCount = await getCommitCount();

  while (true) {
    iteration++;

    if (iteration > maxIterations) {
      console.log(`\n🛑 Max iterations (${maxIterations}) reached`);
      process.exit(0);
    }

    printIteration(iteration, maxIterations);

    // Build state
    const taskFileContent = readFile(config.taskFile);
    const todos = getUncheckedTodos(taskFileContent);
    const hasUncommittedChanges = await getUncommittedChanges();

    const state: State = {
      iteration,
      commits,
      hasTodos: todos.length > 0,
      nextTodo: todos[0] ?? null,
      todos,
      context,
      hasUncommittedChanges,
    };

    // Check if supervisor should run
    if (config.supervisor && commits > 0 && commits % config.supervisor.every === 0) {
      console.log("🔮 Running supervisor...");

      if (dryRun) {
        console.log("(dry-run) Would run supervisor");
        process.exit(0);
      }

      await config.supervisor.run(state);
      await ensureCommit("chore: supervisor");

      const currentCount = await getCommitCount();
      commits = currentCount - startCommitCount;
      continue;
    }

    // Get action from user's run function
    const action = config.run(state);

    // Handle action
    switch (action._type) {
      case "halt": {
        console.log(`\n✅ ${action._reason}`);
        process.exit(0);
      }

      case "generate": {
        console.log("🔍 Generating tasks...");
        const prompt = withResume(action._prompt!, hasUncommittedChanges);
        const timeoutMs = action._options?.timeout
          ? parseTimeout(action._options.timeout)
          : defaultTimeoutMs;

        if (dryRun) {
          console.log("\n(dry-run) Prompt:\n");
          console.log(prompt);
          if (action._options?.model) {
            console.log(`\nModel: ${action._options.model}`);
          }
          process.exit(0);
        }

        await runPi(prompt, { model: action._options?.model, timeout: timeoutMs });
        await ensureCommit("chore: generate tasks");
        console.log(`\n✅ Tasks written to ${config.taskFile}`);
        break;
      }

      case "work": {
        if (state.nextTodo) {
          console.log(`▶ Task: ${state.nextTodo}`);
        }

        const prompt = withResume(action._prompt!, hasUncommittedChanges);
        const timeoutMs = action._options?.timeout
          ? parseTimeout(action._options.timeout)
          : defaultTimeoutMs;

        if (dryRun) {
          console.log("\n(dry-run) Prompt:\n");
          console.log(prompt);
          if (action._options?.model) {
            console.log(`\nModel: ${action._options.model}`);
          }
          process.exit(0);
        }

        await runPi(prompt, { model: action._options?.model, timeout: timeoutMs });
        await ensureCommit(`chore: iteration ${iteration}`);
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

    // Check if done
    const updatedTodos = getUncheckedTodos(readFile(config.taskFile));
    if (updatedTodos.length === 0 && action._type === "work") {
      console.log("\n✅ All tasks complete");
      process.exit(0);
    }

    if (once) {
      console.log("\n(--once) Single iteration complete");
      process.exit(0);
    }
  }
}
