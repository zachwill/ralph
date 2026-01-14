#!/usr/bin/env bun
import { existsSync } from "fs";
import {
  hasFlag,
  getArgValue,
  printBanner,
  printIteration,
  hasUncommittedChanges,
  ensureCommit,
  ensureDir,
  getNextTodo,
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
const WRITE_CONTEXT = hasFlag("--write-context");
const TIMEOUT_MS = parseInt(Bun.env.WORKER_TIMEOUT || "600") * 1000;
const TODO_FILE = ".ralph/CLEANUP.md";
const CONTEXT_FILE = ".ralph/CLEANUP_CONTEXT.md";

const providedContext = getArgValue("--context", "-c");

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const SYSTEM_RULES = `
You are working in a preproduction codebase on a specific cleanup task.
`.trim();

const TASK_CONSTRAINTS = `
Constraints:
- Read .ralph/CLEANUP_CONTEXT.md for specific rules and goals.
- After completing the task, check off ONLY that single checkbox in .ralph/CLEANUP.md.
- Run quick local verification (typecheck/build sanity) and fix any errors you introduced.

When done:
- git add -A
- git commit -m "cleanup: <brief description>"
- Then exit.
`.trim();

const PROMPT_FIND_WORK = `
- .ralph/CLEANUP.md has no actionable items.
- Read .ralph/CLEANUP_CONTEXT.md to understand the cleanup goal.
- Look through the codebase and add specific, actionable work items to .ralph/CLEANUP.md.
- Commit: git add -A && git commit -m "cleanup: identify tasks"
- Exit after committing. Don't do any coding yet.
`.trim();

const promptFindWorkWithContext = (context: string) => `
- .ralph/CLEANUP.md has no actionable items.
- Use the following cleanup goal as the context (treat it like the contents of .ralph/CLEANUP_CONTEXT.md):

${context}

- Look through the codebase and add specific, actionable work items to .ralph/CLEANUP.md.
- Commit: git add -A && git commit -m "cleanup: identify tasks"
- Exit after committing. Don't do any coding yet.
`.trim();

const buildTaskPrompt = (task: string) =>
  `${SYSTEM_RULES}\n\nYour task: ${task}\n\n${TASK_CONSTRAINTS}`;

const buildResumePrompt = () =>
  `${SYSTEM_RULES}\n\n${PROMPT_RESUME}\n\n${TASK_CONSTRAINTS}`;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function writeContextFile(context: string): Promise<void> {
  await ensureDir(".ralph");
  await Bun.write(CONTEXT_FILE, context.endsWith("\n") ? context : context + "\n");
}

// ─────────────────────────────────────────────────────────────
// Main Loop
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  assertPrerequisites();
  printBanner("CLEANUP — Autonomous Refactor Loop");

  let iteration = 0;

  while (true) {
    iteration++;
    printIteration(iteration);

    const nextTask = getNextTodo(TODO_FILE);
    const hasChanges = await hasUncommittedChanges();

    // No tasks and no uncommitted work — need to find/generate tasks
    if (!nextTask && !hasChanges) {
      // Option 1: Context provided via CLI, write it to disk
      if (providedContext && WRITE_CONTEXT) {
        console.log(`📝 Writing ${CONTEXT_FILE} from --context...`);
        await writeContextFile(providedContext);
        console.log("🔍 Generating tasks based on provided context...");
        if (DRY_RUN) dryRun(PROMPT_FIND_WORK);
        await runAgent(PROMPT_FIND_WORK, TIMEOUT_MS);
        await ensureCommit("cleanup: identify tasks");
        console.log("✅ Cleanup tasks written; exiting (review .ralph/CLEANUP.md). ");
        break;
      }

      // Option 2: Context provided inline (don't persist)
      if (providedContext) {
        console.log("🔍 Generating tasks based on provided context (not writing to disk)...");
        const prompt = promptFindWorkWithContext(providedContext);
        if (DRY_RUN) dryRun(prompt);
        await runAgent(prompt, TIMEOUT_MS);
        await ensureCommit("cleanup: identify tasks");
        console.log("✅ Cleanup tasks written; exiting (review .ralph/CLEANUP.md). ");
        break;
      }

      // Option 3: Context file exists on disk
      if (existsSync(CONTEXT_FILE)) {
        console.log("🔍 Generating tasks based on context...");
        if (DRY_RUN) dryRun(PROMPT_FIND_WORK);
        await runAgent(PROMPT_FIND_WORK, TIMEOUT_MS);
        await ensureCommit("cleanup: identify tasks");
        console.log("✅ Cleanup tasks written; exiting (review .ralph/CLEANUP.md). ");
        break;
      }

      // No context at all — nothing to do
      console.log("✅ No unchecked tasks remain and no context provided; exiting.");
      break;
    }

    // Build the prompt for this iteration
    let prompt: string;
    if (hasChanges) {
      console.log("🕵️  Uncommitted changes detected. Resuming...");
      prompt = buildResumePrompt();
    } else {
      console.log(`▶ Task: ${nextTask}`);
      prompt = buildTaskPrompt(nextTask!);
    }

    if (DRY_RUN) dryRun(prompt);

    await runAgent(prompt, TIMEOUT_MS);
    await ensureCommit(`cleanup: finalize iteration ${iteration}`);

    if (ONCE) break;
  }
}

if (import.meta.main) {
  await main();
}
