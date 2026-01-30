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
 *   - thinking: Starting level (off|minimal|low|medium|high|xhigh)
 *   - tools: Restrict tools (e.g., "read" for strict read-only)
 *   - timeout: Per-run timeout (e.g., "5m")
 */

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type AgentSessionEvent,
  type Tool,
} from "@mariozechner/pi-coding-agent";

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

  /** Starting thinking level: off|minimal|low|medium|high|xhigh */
  thinking?: ThinkingLevel;

  /**
   * Restrict available tools (comma-separated).
   * Example: "read" for strict read-only mode
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
// File Helpers
// ─────────────────────────────────────────────────────────────

async function readTextFile(path: string): Promise<string> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : "";
}

async function ensureFileExists(path: string, defaultContent = ""): Promise<void> {
  const file = Bun.file(path);
  if (await file.exists()) return;
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, defaultContent);
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
  write: Bun.color("orangered", "ansi") ?? "",
  edit: Bun.color("gold", "ansi") ?? "",
  bash: Bun.color("dodgerblue", "ansi") ?? "",
  worker: Bun.color("mediumspringgreen", "ansi") ?? "",
  supervisor: Bun.color("darkorchid", "ansi") ?? "",
  dim: Bun.color("lightslategray", "ansi") ?? "",
  reset: "\x1b[0m",
};

const toolIcons: Record<string, string> = {
  read: ">",
  write: ">",
  edit: ">",
  bash: ">",
};

function getToolColor(tool: string): string {
  return colors[tool as keyof typeof colors] ?? colors.dim;
}

function logToolCall(tool: string, detail: string): void {
  const icon = toolIcons[tool] ?? ">";
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

function processEvent(event: AgentSessionEvent, stats: RunStats): void {
  // tool_execution_start — pi's event when a tool starts running
  if (event.type === "tool_execution_start") {
    const name = event.toolName;

    stats.tools.set(name, (stats.tools.get(name) ?? 0) + 1);
    const detail = extractToolDetail(event.args);
    logToolCall(name, detail);
    return;
  }

  // message_end — extract usage stats from assistant messages
  if (event.type === "message_end" && event.message.role === "assistant") {
    const msg = event.message as AssistantMessage;
    stats.inputTokens += msg.usage?.input ?? 0;
    stats.outputTokens += msg.usage?.output ?? 0;
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
// Timeout Helper
// ─────────────────────────────────────────────────────────────

function resolveTimeoutMs(timeout?: number | string): number {
  return timeout ? parseTimeout(timeout) : DEFAULT_TIMEOUT_MS;
}

// ─────────────────────────────────────────────────────────────
// Pi Runner (exported for supervisor use)
// ─────────────────────────────────────────────────────────────

type ScopedModelSpec = { model: Model<any>; thinkingLevel: ThinkingLevel };

type ResolvedRunModel = {
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  scopedModels?: ScopedModelSpec[];
};

function parseCsvList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildToolsForRun(cwd: string, toolsCsv?: string): Tool[] | undefined {
  if (!toolsCsv) return undefined;

  const requested = parseCsvList(toolsCsv);
  if (requested.length === 0) return undefined;

  const toolFactories: Record<string, (cwd: string) => Tool> = {
    read: createReadTool,
    bash: createBashTool,
    edit: createEditTool,
    write: createWriteTool,
  };

  const tools: Tool[] = [];
  for (const name of requested) {
    const factory = toolFactories[name];
    if (!factory) {
      console.log(`${colors.dim}Unknown tool: "${name}" (ignored)${colors.reset}`);
      continue;
    }
    tools.push(factory(cwd));
  }

  return tools.length > 0 ? tools : undefined;
}

function resolveModelString(
  modelRegistry: ModelRegistry,
  model: string,
  provider?: string
): Model<any> | undefined {
  // Support passing provider/model as a single string.
  if (model.includes("/")) {
    const [p, ...rest] = model.split("/");
    return modelRegistry.find(p, rest.join("/"));
  }

  if (provider) return modelRegistry.find(provider, model);

  // Best-effort fallback (exact id/name, then partial id/name).
  const all = modelRegistry.getAll();
  const exactId = all.find((m) => m.id === model);
  if (exactId) return exactId;

  const exactName = all.find((m) => m.name === model);
  if (exactName) return exactName;

  const needle = model.toLowerCase();
  return all.find((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle));
}

function parseModelToken(
  token: string,
  fallbackProvider: string | undefined,
  fallbackThinking: ThinkingLevel | undefined
): { provider?: string; modelId: string; thinkingLevel: ThinkingLevel } {
  const [modelPartRaw, thinkingRaw] = token.split(":").map((s) => s.trim());
  const thinkingLevel = (thinkingRaw as ThinkingLevel) || fallbackThinking || "off";

  if (modelPartRaw.includes("/")) {
    const [provider, ...rest] = modelPartRaw.split("/");
    return { provider, modelId: rest.join("/"), thinkingLevel };
  }

  return { provider: fallbackProvider, modelId: modelPartRaw, thinkingLevel };
}

async function resolveRunModel(options: RunOptions | undefined, modelRegistry: ModelRegistry): Promise<ResolvedRunModel> {
  const provider = options?.provider;
  const thinkingLevel = options?.thinking;

  if (options?.model) {
    const resolved = resolveModelString(modelRegistry, options.model, provider);
    if (!resolved) {
      throw new Error(
        `Unknown model: ${provider ? `${provider}/` : ""}${options.model}. ` +
          `Try provider/model (e.g. "anthropic/claude-sonnet-4-5") or pass { provider, model }.`
      );
    }
    return { model: resolved, thinkingLevel };
  }

  if (options?.models) {
    const specs = parseCsvList(options.models);
    const scopedModels: ScopedModelSpec[] = [];

    for (const spec of specs) {
      const parsed = parseModelToken(spec, provider, thinkingLevel);
      const resolved = resolveModelString(modelRegistry, parsed.modelId, parsed.provider);
      if (!resolved) {
        throw new Error(`Unknown model in models list: "${spec}"`);
      }
      scopedModels.push({ model: resolved, thinkingLevel: parsed.thinkingLevel });
    }

    // Pick the first model with auth configured.
    for (const spec of scopedModels) {
      const key = await modelRegistry.getApiKey(spec.model);
      if (key) return { model: spec.model, thinkingLevel: spec.thinkingLevel, scopedModels };
    }

    // No auth found; still return the first model so pi can surface a useful auth error.
    if (scopedModels.length > 0) {
      return { model: scopedModels[0].model, thinkingLevel: scopedModels[0].thinkingLevel, scopedModels };
    }
  }

  // If only provider is given, pick the first available model for that provider.
  if (provider) {
    const available = modelRegistry.getAvailable();
    const candidate = available.find((m) => m.provider === provider);
    if (candidate) return { model: candidate, thinkingLevel };
  }

  // Let pi resolve defaults from settings and available models.
  return { thinkingLevel };
}

function getLastAssistantMessage(messages: unknown[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string };
    if (m?.role === "assistant") return messages[i] as AssistantMessage;
  }
  return undefined;
}

export async function runPi(prompt: string, options?: RunOptions): Promise<void> {
  const cwd = process.cwd();
  const timeoutMs = resolveTimeoutMs(options?.timeout);
  const role = options?.role ?? "worker";

  const roleColor = role === "supervisor" ? colors.supervisor : colors.worker;
  console.log(`${roleColor}[${role.toUpperCase()}]${colors.reset} Starting...\n`);

  // Use the SDK directly (no subprocess JSONL parsing).
  const authStorage = new AuthStorage();
  const modelRegistry = new ModelRegistry(authStorage);

  // Resource loader discovers AGENTS.md files and injects them into system prompt
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
  });
  await resourceLoader.reload();

  const resolvedModel = await resolveRunModel(options, modelRegistry);
  const tools = buildToolsForRun(cwd, options?.tools);

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    tools,
    model: resolvedModel.model,
    thinkingLevel: resolvedModel.thinkingLevel,
    scopedModels: resolvedModel.scopedModels,
  });

  if (modelFallbackMessage) {
    console.log(`${colors.dim}${modelFallbackMessage}${colors.reset}\n`);
  }

  if (!session.model) {
    session.dispose();
    throw new Error(modelFallbackMessage ?? "No model available (check pi auth/settings)");
  }

  const stats: RunStats = { tools: new Map(), inputTokens: 0, outputTokens: 0 };
  const unsubscribe = session.subscribe((event) => processEvent(event, stats));

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    console.log(`\n[Timeout] ${timeoutMs / 1000}s`);
    session.abort().catch(() => {});
  }, timeoutMs);

  let runError: unknown;

  try {
    await session.prompt(prompt);
  } catch (err) {
    runError = err;
  } finally {
    clearTimeout(timeoutId);
    unsubscribe();
  }

  const lastAssistant = getLastAssistantMessage(session.state.messages as unknown[]);
  const stopReason = lastAssistant?.stopReason;

  session.dispose();

  console.log("");
  logRunSummary(stats, role);

  if (timedOut) {
    throw new Error(`Timed out after ${timeoutMs / 1000}s`);
  }

  if (stopReason === "error") {
    throw new Error(lastAssistant?.errorMessage ?? "pi: model error");
  }

  if (stopReason === "aborted") {
    throw new Error("pi: aborted");
  }

  if (runError) {
    throw runError;
  }
}

/** Run an arbitrary command (for advanced supervisor use) */
export async function runCommand(
  command: string[],
  options?: { timeout?: number | string }
): Promise<void> {
  const timeoutMs = resolveTimeoutMs(options?.timeout);
  const cmd = command.map((c) => $.escape(c)).join(" ");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`\n[Timeout] ${timeoutMs / 1000}s`);
    controller.abort();
  }, timeoutMs);

  try {
    await $`${{ raw: cmd }}`.nothrow();
  } finally {
    clearTimeout(timeoutId);
  }
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

  // Ensure task file exists
  await ensureFileExists(config.taskFile, "# Tasks\n\n");

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
    const taskFileContent = await readTextFile(config.taskFile);
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

      case "generate": {
        console.log("[Generate]");

        await runPiAction("generate", action, uncommittedChanges, config.timeout, flags);

        // Guard: in continuous mode, prevent infinite generate→generate loops
        // if task generation fails to produce any unchecked todos.
        if (continuous) {
          const generatedTodos = getUncheckedTodos(await readTextFile(config.taskFile));
          if (generatedTodos.length === 0) {
            console.log(
              `\n[Stop] Continuous mode: task generation produced no unchecked todos in ${config.taskFile}`
            );
            console.log(
              "Expected markdown checkboxes like: - [ ] <task>. Stopping to avoid an infinite loop."
            );
            process.exit(1);
          }
        }

        console.log(`\n[Done] Tasks written to ${config.taskFile}`);
        break;
      }

      case "work": {
        if (state.nextTodo) {
          console.log(`> Task: ${state.nextTodo}`);
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
    const updatedTodos = getUncheckedTodos(await readTextFile(config.taskFile));
    if (!continuous && updatedTodos.length === 0 && action._type === "work") {
      console.log("\n[Done] All tasks complete");
      process.exit(0);
    }

    if (flags.once) {
      console.log("\n(--once) Single iteration complete");
      process.exit(0);
    }
  }
}
