#!/usr/bin/env bun
/**
 * core.ts - Dead simple autonomous loops.
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
 *   - model: Single model (e.g., "gpt-5.2")
 *   - provider: Provider (e.g., "openai", "anthropic")
 *   - models: Limit cycling (e.g., "sonnet:high,haiku:low")
 *   - thinking: Starting level ("low" | "medium" | "high")
 *   - tools: Restrict tools (e.g., "read,grep,find,ls" for read-only)
 *   - timeout: Per-run timeout (e.g., "5m")
 */

import { $, spawn } from "bun";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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

  /** Internal: role for logging (set automatically) */
  role?: "worker" | "supervisor";
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

  /**
   * If true, the loop never exits just because the task file is "done".
   * When there are no remaining todos, your run(state) function should typically return generate().
   */
  continuous?: boolean;

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
      await runPi(prompt, { ...runOptions, role: "supervisor" });
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Time Parsing
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
// CLI Helpers
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
// Git Operations
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
  console.log("\n📦 Auto-committing...");
  await $`git add -A`.quiet();
  await $`git commit -m ${message}`.quiet();
}

async function push(): Promise<void> {
  console.log("🚀 Pushing to remote...");
  try {
    await $`git push origin HEAD`;
  } catch {
    console.log("⚠️  Push failed (non-fatal)");
  }
}

async function ensureCommit(fallbackMessage: string): Promise<boolean> {
  if (await hasRecentCommit()) {
    console.log("✅ Committed");
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

function readTextFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

function ensureFileExists(path: string, defaultContent = ""): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, defaultContent);
}

function getUncheckedTodos(content: string): string[] {
  const matches = content.matchAll(/^\s*[-*+]\s*\[ \]\s+(.*)$/gm);
  return Array.from(matches, (m) => m[1].trim());
}

// ─────────────────────────────────────────────────────────────
// Colors & Logging
// ─────────────────────────────────────────────────────────────

const colors = {
  read: Bun.color("limegreen", "ansi") ?? "",
  write: Bun.color("gold", "ansi") ?? "",
  edit: Bun.color("gold", "ansi") ?? "",
  bash: Bun.color("orangered", "ansi") ?? "",
  grep: Bun.color("cyan", "ansi") ?? "",
  find: Bun.color("cyan", "ansi") ?? "",
  ls: Bun.color("cyan", "ansi") ?? "",
  worker: Bun.color("dodgerblue", "ansi") ?? "",
  supervisor: Bun.color("mediumpurple", "ansi") ?? "",
  dim: Bun.color("gray", "ansi") ?? "",
  reset: "\x1b[0m",
};

const toolIcons: Record<string, string> = {
  read: "📖",
  write: "📝",
  edit: "✏️ ",
  bash: "🔧",
  grep: "🔍",
  find: "🔎",
  ls: "📂",
};

function getToolColor(tool: string): string {
  return colors[tool as keyof typeof colors] ?? colors.dim;
}

function logToolCall(tool: string, detail: string): void {
  const icon = toolIcons[tool] ?? "🔧";
  const color = getToolColor(tool);
  const label = tool.toUpperCase().padEnd(5);
  const truncated = detail.length > 60 ? detail.slice(0, 57) + "..." : detail;
  console.log(`  ${color}${icon} ${label}${colors.reset} ${colors.dim}${truncated}${colors.reset}`);
}

interface RunStats {
  tools: Map<string, number>;
  inputTokens: number;
  outputTokens: number;
}

function logRunSummary(stats: RunStats, role: "worker" | "supervisor"): void {
  const roleColor = role === "supervisor" ? colors.supervisor : colors.worker;
  const roleLabel = role.toUpperCase();

  const toolSummary = Array.from(stats.tools.entries())
    .map(([tool, count]) => `${tool}:${count}`)
    .join(" ") || "no tools";

  const tokens = stats.inputTokens + stats.outputTokens;
  const tokenStr = tokens > 0 ? `${(tokens / 1000).toFixed(1)}k tokens` : "";

  console.log(
    `  ${roleColor}[${roleLabel}]${colors.reset} ${colors.dim}${tokenStr}${tokenStr && toolSummary ? ", " : ""}${toolSummary}${colors.reset}`
  );
}

function extractToolDetail(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input !== "object" || input === null) return "";

  const obj = input as Record<string, unknown>;
  if (obj.path) return String(obj.path);
  if (obj.command) return String(obj.command);
  if (obj.pattern) return String(obj.pattern);
  return "";
}

function processEvent(event: unknown, stats: RunStats): void {
  if (typeof event !== "object" || event === null) return;

  const e = event as Record<string, unknown>;

  // tool_execution_start — pi's actual event when a tool starts running
  if (e.type === "tool_execution_start") {
    const name = String(e.toolName ?? "unknown");
    const args = e.args as Record<string, unknown> | undefined;

    stats.tools.set(name, (stats.tools.get(name) ?? 0) + 1);
    const detail = extractToolDetail(args);
    logToolCall(name, detail);
  }

  // message_end — extract usage stats
  if (e.type === "message_end") {
    const msg = e.message as Record<string, unknown> | undefined;
    const usage = msg?.usage as Record<string, number> | undefined;
    if (usage) {
      // pi uses "input" and "output", not "input_tokens"/"output_tokens"
      stats.inputTokens += usage.input ?? usage.input_tokens ?? usage.inputTokens ?? 0;
      stats.outputTokens += usage.output ?? usage.output_tokens ?? usage.outputTokens ?? 0;
    }
  }
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
// Process Helpers
// ─────────────────────────────────────────────────────────────

async function spawnWithTimeout(command: string[], timeoutMs: number): Promise<void> {
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

function resolveTimeoutMs(timeout?: number | string): number {
  return timeout ? parseTimeout(timeout) : DEFAULT_TIMEOUT_MS;
}

// ─────────────────────────────────────────────────────────────
// Pi Runner (exported for supervisor use)
// ─────────────────────────────────────────────────────────────

let _piPath: string | null = null;

async function getPiPath(): Promise<string> {
  if (_piPath) return _piPath;

  _piPath = (await $`which pi`.text()).trim();
  if (!_piPath) throw new Error("Could not find 'pi' in PATH");

  return _piPath;
}

function buildPiArgs(options?: RunOptions): string[] {
  const args: string[] = [];
  if (options?.model) args.push("--model", options.model);
  if (options?.provider) args.push("--provider", options.provider);
  if (options?.models) args.push("--models", options.models);
  if (options?.thinking) args.push("--thinking", options.thinking);
  if (options?.tools) args.push("--tools", options.tools);
  return args;
}

export async function runPi(prompt: string, options?: RunOptions): Promise<void> {
  const piPath = await getPiPath();
  const timeoutMs = resolveTimeoutMs(options?.timeout);
  const args = buildPiArgs(options);
  const role = options?.role ?? "worker";

  const roleColor = role === "supervisor" ? colors.supervisor : colors.worker;
  console.log(`${roleColor}[${role.toUpperCase()}]${colors.reset} Starting...\n`);

  const proc = spawn(
    [piPath, "--mode", "json", "-p", "--no-session", prompt, ...args],
    { stdout: "pipe", stderr: "inherit" }
  );

  const stats: RunStats = { tools: new Map(), inputTokens: 0, outputTokens: 0 };

  // Timeout handling
  const timeoutId = setTimeout(() => {
    console.log(`\n⏰ Timed out after ${timeoutMs / 1000}s`);
    proc.kill();
  }, timeoutMs);

  // Stream JSONL events
  let buffer = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const result = Bun.JSONL.parseChunk(buffer);

      for (const event of result.values) {
        processEvent(event, stats);
      }

      buffer = buffer.slice(result.read);
    }
  } finally {
    clearTimeout(timeoutId);
  }

  await proc.exited;

  console.log("");
  logRunSummary(stats, role);
}

/** Run an arbitrary command (for advanced supervisor use) */
export async function runCommand(
  command: string[],
  options?: { timeout?: number | string }
): Promise<void> {
  const timeoutMs = resolveTimeoutMs(options?.timeout);
  await spawnWithTimeout(command, timeoutMs);
}

// ─────────────────────────────────────────────────────────────
// The Main Loop
// ─────────────────────────────────────────────────────────────

type PiActionType = Extract<Action["_type"], "work" | "generate">;

async function runPiAction(
  type: PiActionType,
  action: Action,
  hasChanges: boolean,
  defaultTimeout: number | string,
  flags: CliFlags
): Promise<void> {
  const prompt = withResume(action._prompt!, hasChanges);

  const runOptions: RunOptions = {
    ...action._options,
    timeout: action._options?.timeout ?? defaultTimeout,
    role: "worker",
  };

  if (flags.dryRun) {
    exitDryRun(prompt, action._options);
  }

  await runPi(prompt, runOptions);

  if (type === "generate") {
    await ensureCommit("chore: generate tasks");
  } else {
    // "work"
    // Commit message includes iteration in caller (for consistency with previous behavior).
  }
}

function shouldRunSupervisor(config: LoopConfig, commits: number): boolean {
  return Boolean(config.supervisor && commits > 0 && commits % config.supervisor.every === 0);
}

export async function loop(config: LoopConfig): Promise<never> {
  // Validate
  if (!existsSync(".git")) {
    console.error("❌ Not a git repository");
    process.exit(1);
  }

  // Parse config defaults
  const pushEvery = config.pushEvery ?? 4;
  const maxIterations = config.maxIterations ?? 400;
  const continuous = config.continuous ?? false;

  // CLI flags
  const flags = parseCliFlags();

  // Ensure task file exists
  ensureFileExists(config.taskFile, "# Tasks\n\n");

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
    const taskFileContent = readTextFile(config.taskFile);
    const todos = getUncheckedTodos(taskFileContent);
    const uncommittedChanges = await hasUncommittedChanges();

    const state: State = {
      iteration,
      commits,
      hasTodos: todos.length > 0,
      nextTodo: todos[0] ?? null,
      todos,
      context: flags.context,
      hasUncommittedChanges: uncommittedChanges,
    };

    // Supervisor
    if (shouldRunSupervisor(config, commits)) {
      console.log("🔮 Running supervisor...");

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
        console.log(`\n✅ ${action._reason}`);
        process.exit(0);
      }

      case "generate": {
        console.log("🔍 Generating tasks...");

        await runPiAction("generate", action, uncommittedChanges, config.timeout, flags);

        // Guard: in continuous mode, prevent infinite generate→generate loops
        // if task generation fails to produce any unchecked todos.
        if (continuous) {
          const generatedTodos = getUncheckedTodos(readTextFile(config.taskFile));
          if (generatedTodos.length === 0) {
            console.log(
              `\n🛑 Continuous mode: task generation produced no unchecked todos in ${config.taskFile}`
            );
            console.log(
              "Expected markdown checkboxes like: - [ ] <task>. Stopping to avoid an infinite loop."
            );
            process.exit(1);
          }
        }

        console.log(`\n✅ Tasks written to ${config.taskFile}`);
        break;
      }

      case "work": {
        if (state.nextTodo) {
          console.log(`▶ Task: ${state.nextTodo}`);
        }

        await runPiAction("work", action, uncommittedChanges, config.timeout, flags);
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
    const updatedTodos = getUncheckedTodos(readTextFile(config.taskFile));
    if (!continuous && updatedTodos.length === 0 && action._type === "work") {
      console.log("\n✅ All tasks complete");
      process.exit(0);
    }

    if (flags.once) {
      console.log("\n(--once) Single iteration complete");
      process.exit(0);
    }
  }
}
