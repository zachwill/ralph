#!/usr/bin/env bun
import { 
  PI_PATH, 
  timestamp, 
  hasUncommittedChanges, 
  recentCommit, 
  getCommitCount, 
  runAgent, 
  push 
} from "./internal";

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const ONCE = Bun.argv.includes("--once");
const TIMEOUT_MS = parseInt(Bun.env.WORKER_TIMEOUT || "3000") * 100;
const PUSH_EVERY = 4;
const TODO_FILE = ".ralph/TODO.md";

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const PROMPT_WITH_TODOS = `
- Look at .ralph/TODO.md for the current task list
- Pick a logical chunk of work and do it
- Update .ralph/TODO.md to reflect what you've done
- Commit your changes: git add -A && git commit -m "<what you did>"
- Exit after committing
`.trim();

const PROMPT_FIND_WORK = `
- .ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
- Look through the codebase and add useful work items to .ralph/TODO.md.
- Commit: git add -A && git commit -m "<what you added>"
- Exit after committing. Don't do any coding yet.
`.trim();

const PROMPT_RESUME = `
NOTE: There are uncommitted changes from a previous execution.
Run "git diff" and "git log --oneline -5" to see the state of the work, complete any unfinished logic, and commit.
`.trim();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const hasTodos = () =>
  existsSync(TODO_FILE) && /\[ \]/.test(readFileSync(TODO_FILE, "utf-8"));

// ─────────────────────────────────────────────────────────────
// Git Operations
// ─────────────────────────────────────────────────────────────

async function syncWithRemote(): Promise<boolean> {
  const { $ } = await import("bun");
  console.log("📡 Syncing with remote...");
  await $`git fetch origin`.quiet();

  const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
  if (branch !== "main") {
    await $`git checkout main`.quiet();
  }

  const { exitCode, stderr } = await $`git pull --rebase origin main`.quiet().nothrow();
  if (exitCode !== 0 && stderr.toString().includes("conflict")) {
    console.error("❌ Rebase conflict. Please resolve manually.");
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Agent Runner
// ─────────────────────────────────────────────────────────────

async function handleResume(): Promise<boolean> {
  if (!(await hasUncommittedChanges())) return false;

  console.log("🕵️  Uncommitted changes detected. Resuming prior work...");
  const base = hasTodos() ? PROMPT_WITH_TODOS : PROMPT_FIND_WORK;
  await runAgent(`${base}\n\n${PROMPT_RESUME}`, TIMEOUT_MS);
  return true;
}

// ─────────────────────────────────────────────────────────────
// Main Loop
// ─────────────────────────────────────────────────────────────

if (!PI_PATH) {
  console.error("❌ Could not find 'pi' in PATH");
  Bun.exit(1);
}

if (!existsSync(".git")) {
  console.error("❌ Not a git repository");
  Bun.exit(1);
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("RALPH — Autonomous Worker Loop");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const { $ } = await import("bun");
let iteration = 0;
let lastPushAt = await getCommitCount();

while (true) {
  iteration++;
  console.log(`\n┌─ Iteration #${iteration} — ${timestamp()}`);
  console.log("└──────────────────────────────────────\n");

  // Check for leftover work from previous run
  if (iteration === 1 && (await handleResume())) {
    // Resume handled it
  } else {
    await runAgent(hasTodos() ? PROMPT_WITH_TODOS : PROMPT_FIND_WORK, TIMEOUT_MS);
  }

  // Check what happened
  if (await recentCommit()) {
    console.log("\n✅ Agent committed successfully");
  } else if (await hasUncommittedChanges()) {
    console.log("\n📦 Uncommitted changes — auto-committing...");
    await $`git add -A`.quiet();
    await $`git commit -m ${"chore: finalize iteration " + iteration}`.quiet();
  }

  // Push periodically
  const currentCount = await getCommitCount();
  if (currentCount - lastPushAt >= PUSH_EVERY) {
    await push();
    lastPushAt = currentCount;
  }

  if (ONCE) Bun.exit(0);
}
