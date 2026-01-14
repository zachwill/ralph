#!/usr/bin/env bun
import { existsSync } from "fs";
import {
  hasFlag,
  printBanner,
  printIteration,
  hasUncommittedChanges,
  ensureCommit,
  hasUncheckedTodos,
  assertPrerequisites,
  runAgent,
  dryRun,
  PROMPT_RESUME,
} from "./internal";

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const ONCE = hasFlag("--once");
const DRY_RUN = hasFlag("--dry-run");
const TIMEOUT_MS = parseInt(Bun.env.WORKER_TIMEOUT || "300") * 1000;
const REFACTOR_FILE = ".ralph/REFACTOR.md";

// Pattern: checkbox followed by backtick-wrapped path
const REFACTOR_PATTERN = /`[^`]+`/;

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const PROMPT_REFACTOR = `
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

// ─────────────────────────────────────────────────────────────
// Main Loop
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertPrerequisites();

  if (!existsSync(REFACTOR_FILE)) {
    console.log(`ℹ️  ${REFACTOR_FILE} not found; exiting.`);
    process.exit(0);
  }

  if (!hasUncheckedTodos(REFACTOR_FILE, REFACTOR_PATTERN)) {
    console.log("✅ No unchecked refactor tasks found in REFACTOR.md; exiting.");
    process.exit(0);
  }

  printBanner("REFACTOR — Autonomous Worker Loop");

  let iteration = 0;

  while (true) {
    iteration++;
    printIteration(iteration);

    const hasChanges = await hasUncommittedChanges();

    // Build prompt
    let prompt: string;
    if (hasChanges) {
      console.log("🕵️  Uncommitted changes detected. Resuming prior work...");
      prompt = `${PROMPT_REFACTOR}\n\n${PROMPT_RESUME}`;
    } else {
      prompt = PROMPT_REFACTOR;
    }

    if (DRY_RUN) dryRun(prompt);

    await runAgent(prompt, TIMEOUT_MS);
    await ensureCommit("refactor: finalize");

    // Check if we're done
    if (!hasUncheckedTodos(REFACTOR_FILE, REFACTOR_PATTERN)) {
      console.log("\n✅ No unchecked refactor tasks remain; exiting.");
      process.exit(0);
    }

    if (ONCE) process.exit(0);
  }
}

if (import.meta.main) {
  await main();
}
