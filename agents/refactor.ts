#!/usr/bin/env bun
import { existsSync } from "fs";
import {
  hasFlag,
  getArgValue,
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

const providedContext = getArgValue("--context", "-c");

// Pattern: checkbox followed by backtick-wrapped path
const REFACTOR_PATTERN = /`[^`]+`/;

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const PROMPT_REFACTOR = `
Your task is to refactor ONE file listed in .ralph/REFACTOR.md (the next unchecked item). You must complete all steps before committing:

1. Read .ralph/REFACTOR.md and pick the first unchecked item in the TODO list
2. Refactor that file (keep behavior stable; avoid feature work)
3. Improve readability: extract in-file helpers/subcomponents, reduce nesting, clarify naming
4. Verify changes (bun import, typecheck, or minimal smoke)
5. Check off ONLY that item in .ralph/REFACTOR.md

Only after ALL the above work is done:
- Commit: git add -A && git commit -m "refactor: <scope of change>"
- Then exit

DO NOT commit until the refactor is complete and working.
`.trim();

const PROMPT_FIND_REFACTOR_WORK = `
- .ralph/REFACTOR.md has no actionable items. Wipe it clean and start fresh.
- Look through the codebase and add useful refactor work items to .ralph/REFACTOR.md.
- Focus on refactors (readability, structure, dead code removal), not on any specific previous-project theme.
- Format each item as a checkbox followed by a backtick-wrapped file path, e.g.:
  - [ ] \`src/components/Foo.tsx\`
- Commit: git add -A && git commit -m "chore: seed refactor tasks"
- Exit after committing. Don't do any refactoring yet.
`.trim();

const promptFindRefactorWorkWithContext = (context: string) => `
- .ralph/REFACTOR.md has no actionable items. Wipe it clean and start fresh.
- Use the following goal as context for what refactor tasks to add (treat it like instructions from the user):

<instructions>
${context}
</instructions>

TASK:
- Look through the codebase and add useful refactor work items to .ralph/REFACTOR.md.
- Format each item as a checkbox followed by a backtick-wrapped file path, e.g.:
  - [ ] \`src/components/Foo.tsx\`
- Commit: git add -A && git commit -m "chore: seed refactor tasks"
- Exit after committing. Don't do any refactoring yet.
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

  printBanner("REFACTOR — Autonomous Worker Loop");

  let iteration = 0;

  while (true) {
    iteration++;
    printIteration(iteration);

    const hasTasks = hasUncheckedTodos(REFACTOR_FILE, REFACTOR_PATTERN);
    const hasChanges = await hasUncommittedChanges();

    // Build prompt
    let prompt: string;
    if (hasChanges) {
      console.log("🕵️  Uncommitted changes detected. Resuming prior work...");
      const base = hasTasks
        ? PROMPT_REFACTOR
        : providedContext
          ? promptFindRefactorWorkWithContext(providedContext)
          : PROMPT_FIND_REFACTOR_WORK;
      prompt = `${base}\n\n${PROMPT_RESUME}`;
    } else if (hasTasks) {
      prompt = PROMPT_REFACTOR;
    } else if (providedContext) {
      prompt = promptFindRefactorWorkWithContext(providedContext);
    } else {
      prompt = PROMPT_FIND_REFACTOR_WORK;
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
