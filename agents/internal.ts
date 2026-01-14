import { $, spawn } from "bun";
import { existsSync, readFileSync } from "fs";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

export const PI_PATH = (await $`which pi`.text()).trim();

// ─────────────────────────────────────────────────────────────
// CLI Helpers
// ─────────────────────────────────────────────────────────────

export const hasFlag = (flag: string) => Bun.argv.includes(flag);

export const getArgValue = (flag: string, ...aliases: string[]): string | null => {
  for (const f of [flag, ...aliases]) {
    const idx = Bun.argv.indexOf(f);
    if (idx === -1) continue;
    const next = Bun.argv[idx + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// Time & Formatting
// ─────────────────────────────────────────────────────────────

export const timestamp = () => new Date().toLocaleString();

export function printBanner(title: string): void {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(title);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

export function printIteration(n: number): void {
  console.log(`\n┌─ Iteration #${n} — ${timestamp()}`);
  console.log("└──────────────────────────────────────\n");
}

// ─────────────────────────────────────────────────────────────
// Git Operations
// ─────────────────────────────────────────────────────────────

export const hasUncommittedChanges = async () =>
  (await $`git status --porcelain`.text()).trim().length > 0;

export const recentCommit = async (withinMs = 15_000) => {
  try {
    const ts = parseInt(await $`git log -1 --format=%ct`.text()) * 1000;
    return Date.now() - ts < withinMs;
  } catch {
    return false;
  }
};

export const getCommitCount = async () => {
  try {
    return parseInt(await $`git rev-list --count HEAD`.text()) || 0;
  } catch {
    return 0;
  }
};

export async function autoCommit(message: string): Promise<void> {
  console.log("\n📦 Uncommitted changes — auto-committing...");
  await $`git add -A`.quiet();
  await $`git commit -m ${message}`.quiet();
}

export async function push(): Promise<void> {
  console.log("🚀 Pushing to GitHub...");
  await $`git push origin main`;
}

/**
 * Handles post-agent commit logic. Returns true if a commit happened.
 */
export async function ensureCommit(fallbackMessage: string): Promise<boolean> {
  if (await recentCommit()) {
    console.log("\n✅ Agent committed successfully");
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

export const ensureDir = async (path: string) => {
  await $`mkdir -p ${path}`.quiet();
};

export const readFile = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf-8") : "";

/**
 * Check if a markdown file has unchecked todos: `- [ ]`
 * Optionally require a pattern after the checkbox (e.g., backtick-wrapped paths).
 */
export function hasUncheckedTodos(path: string, pattern?: RegExp): boolean {
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf-8");
  const basePattern = /^(?:\s*[-*+])\s*\[ \]/m;
  if (!pattern) return basePattern.test(content);
  // Combine: checkbox followed by pattern
  const combined = new RegExp(`^(?:\\s*[-*+])\\s*\\[ \\]\\s*${pattern.source}`, "m");
  return combined.test(content);
}

/**
 * Extract the text of the first unchecked todo item.
 */
export function getNextTodo(path: string): string | null {
  const content = readFile(path);
  const match = content.match(/^\s*(?:-|\*|\+)\s*\[ \]\s+(.*)$/m);
  return match ? match[1].trim() : null;
}

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

export const PROMPT_RESUME = `
NOTE: There are uncommitted changes from a previous execution.
Run "git diff" to understand the state of work.
Finish/repair the in-progress work and commit.
`.trim();

// ─────────────────────────────────────────────────────────────
// Agent Runner
// ─────────────────────────────────────────────────────────────

export function assertPrerequisites(): void {
  if (!PI_PATH) {
    console.error("❌ Could not find 'pi' in PATH");
    process.exit(1);
  }
  if (!existsSync(".git")) {
    console.error("❌ Not a git repository");
    process.exit(1);
  }
}

export async function runAgent(prompt: string, timeoutMs: number): Promise<void> {
  const proc = spawn([PI_PATH, "-p", prompt], {
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

export function dryRun(prompt: string): never {
  console.log("\n(dry-run) Would run prompt:\n");
  console.log(prompt);
  process.exit(0);
}
