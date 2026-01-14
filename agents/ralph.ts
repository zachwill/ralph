#!/usr/bin/env bun
import {
  hasFlag,
  getArgValue,
  printBanner,
  printIteration,
  hasUncommittedChanges,
  getCommitCount,
  ensureCommit,
  push,
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
const TIMEOUT_MS = parseInt(Bun.env.WORKER_TIMEOUT || "3000") * 100;
const PUSH_EVERY = 4;
const TODO_FILE = ".ralph/TODO.md";

const providedContext = getArgValue("--context", "-c");

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

const promptFindWorkWithContext = (context: string) => `
- .ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
- Use the following goal as context for what tasks to add (treat it like instructions from the user):

<instructions>
${context}
</instructions>

TASK:
- Look through the codebase and add useful work items to .ralph/TODO.md.
- Commit: git add -A && git commit -m "<what you added>"
- Exit after committing. Don't do any coding yet.
`.trim();

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
// Main Loop
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertPrerequisites();
  printBanner("RALPH — Autonomous Worker Loop");

  let iteration = 0;
  let lastPushAt = await getCommitCount();

  while (true) {
    iteration++;
    printIteration(iteration);

    const hasTodos = hasUncheckedTodos(TODO_FILE);
    const hasChanges = await hasUncommittedChanges();

    // Build the prompt
    let prompt: string;
    if (hasChanges && iteration === 1) {
      console.log("🕵️  Uncommitted changes detected. Resuming prior work...");
      const base = hasTodos ? PROMPT_WITH_TODOS : PROMPT_FIND_WORK;
      prompt = `${base}\n\n${PROMPT_RESUME}`;
    } else if (hasTodos) {
      prompt = PROMPT_WITH_TODOS;
    } else if (providedContext) {
      prompt = promptFindWorkWithContext(providedContext);
    } else {
      prompt = PROMPT_FIND_WORK;
    }

    if (DRY_RUN) dryRun(prompt);

    await runAgent(prompt, TIMEOUT_MS);
    await ensureCommit(`chore: finalize iteration ${iteration}`);

    // Push periodically
    const currentCount = await getCommitCount();
    if (currentCount - lastPushAt >= PUSH_EVERY) {
      await push();
      lastPushAt = currentCount;
    }

    if (ONCE) process.exit(0);
  }
}

if (import.meta.main) {
  await main();
}
