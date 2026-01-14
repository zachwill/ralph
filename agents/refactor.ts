#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import { 
  PI_PATH, 
  timestamp, 
  hasUncommittedChanges, 
  recentCommit, 
  runAgent 
} from "./internal";

const ONCE = Bun.argv.includes("--once");
const DRY_RUN = Bun.argv.includes("--dry-run");
const TIMEOUT_MS = parseInt(Bun.env.WORKER_TIMEOUT || "300") * 1000;
const REFACTOR_FILE = ".ralph/REFACTOR.md";

const PROMPT_WITH_REFACTOR = `
Your task is to refactor ONE TSX file listed in .ralph/REFACTOR.md (the next unchecked item). You must complete all steps before committing:

1. Read .ralph/REFACTOR.md and pick the first unchecked item in the TODO list
2. Refactor that file by extracting in-file subcomponents (keep behavior + styling stable)
3. Reduce JSX nesting and improve readability (no feature work)
4. Verify your changes (bun import, typecheck, or minimal smoke)
5. Check off ONLY that item in .ralph/REFACTOR.md

Only after ALL the above work is done:
- Commit: git add -A && git commit -m "refactor: <scope of file>"
- Then exit

DO NOT commit until the refactor is complete and working.
`.trim();

const PROMPT_RESUME = `
NOTE: There are uncommitted changes from a previous execution.
Run "git diff" and "git status" to understand the state of work.
Complete any unfinished logic and commit. If it looks complete, just commit what's there.
`.trim();

function hasRefactorTodos(): boolean {
  if (!existsSync(REFACTOR_FILE)) return false;
  const contents = readFileSync(REFACTOR_FILE, "utf-8");
  return /- \[ \] `[^`]+`/.test(contents);
}

async function handleResume(): Promise<boolean> {
  if (!(await hasUncommittedChanges())) return false;

  console.log("🕵️  Uncommitted changes detected. Resuming prior work...");
  await runAgent(`${PROMPT_WITH_REFACTOR}\n\n${PROMPT_RESUME}`, TIMEOUT_MS);
  return true;
}

if (!PI_PATH) {
  console.error("❌ Could not find 'pi' in PATH");
  process.exit(1);
}

if (!existsSync(".git")) {
  console.error("❌ Not a git repository");
  process.exit(1);
}

if (!existsSync(REFACTOR_FILE)) {
  console.log(`ℹ️  ${REFACTOR_FILE} not found; exiting.`);
  process.exit(0);
}

if (!hasRefactorTodos()) {
  console.log("✅ No unchecked refactor tasks found in REFACTOR.md; exiting.");
  process.exit(0);
}

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("REFACTOR — Autonomous Worker Loop");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

const { $ } = await import("bun");
let iteration = 0;

while (true) {
  iteration++;
  console.log(`\n┌─ Iteration #${iteration} — ${timestamp()}`);
  console.log("└──────────────────────────────────────\n");

  if (!(await handleResume())) {
    await runAgent(PROMPT_WITH_REFACTOR, TIMEOUT_MS);
  }

  if (DRY_RUN) {
    console.log("\n(dry-run) Stopping after one iteration.");
    process.exit(0);
  }

  if (await recentCommit()) {
    console.log("\n✅ Agent committed successfully");
  } else if (await hasUncommittedChanges()) {
    console.log("\n📦 Uncommitted changes — auto-committing...");
    await $`git add -A`.quiet();
    await $`git commit -m ${"refactor: finalize"}`.quiet();
  }

  if (!hasRefactorTodos()) {
    console.log("\n✅ No unchecked refactor tasks remain; exiting.");
    process.exit(0);
  }

  if (ONCE) process.exit(0);
}
