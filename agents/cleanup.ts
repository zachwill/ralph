#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import {
  PI_PATH,
  timestamp,
  hasUncommittedChanges,
  recentCommit,
  runAgent,
} from "./internal";

/**
 * ROUTER CLEANUP
 *
 * Drives the repo through TODO.md refactors.
 * Enforces: NEW URLS ONLY (no redirects/aliases).
 */

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const ONCE = Bun.argv.includes("--once");
const DRY_RUN = Bun.argv.includes("--dry-run");
const TIMEOUT_MS = parseInt(Bun.env.WORKER_TIMEOUT || "600") * 1000;
const TODO_FILE = ".ralph/CLEANUP.md";
const CONTEXT_FILE = ".ralph/CLEANUP_CONTEXT.md";

const getArgValue = (flag: string) => {
  const idx = Bun.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = Bun.argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
};

const providedContext = getArgValue("--context") || getArgValue("-c");
const shouldWriteContext = Bun.argv.includes("--write-context");

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const PROMPT_FIND_WORK = `
- .ralph/CLEANUP.md has no actionable items.
- Read .ralph/CLEANUP_CONTEXT.md to understand the cleanup goal.
- Look through the codebase and add specific, actionable work items to .ralph/CLEANUP.md.
- Commit: git add -A && git commit -m "cleanup: identify tasks"
- Exit after committing. Don't do any coding yet.
`.trim();

const PROMPT_FIND_WORK_WITH_INLINE_CONTEXT = (context: string) => `
- .ralph/CLEANUP.md has no actionable items.
- Use the following cleanup goal as the context (treat it like the contents of .ralph/CLEANUP_CONTEXT.md):

${context}

- Look through the codebase and add specific, actionable work items to .ralph/CLEANUP.md.
- Commit: git add -A && git commit -m "cleanup: identify tasks"
- Exit after committing. Don't do any coding yet.
`.trim();

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

const PROMPT_RESUME = `
NOTE: There are uncommitted changes from a previous execution.
Run "git diff" to understand the state of work.
Finish/repair the in-progress work and commit.
`.trim();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const readTodo = () => (existsSync(TODO_FILE) ? readFileSync(TODO_FILE, "utf-8") : "");

const ensureDir = async (path: string) => {
  const { $ } = await import("bun");
  await $`mkdir -p ${path}`.quiet();
};

const writeContextFile = async (context: string) => {
  await ensureDir(".ralph");
  await Bun.write(CONTEXT_FILE, context.endsWith("\n") ? context : context + "\n");
};

const getNextTodo = (content: string) => {
  const match = content.match(/^\s*(?:-|\*|\+)\s*\[ \]\s+(.*)$/m);
  return match ? match[1].trim() : null;
};

async function main(): Promise<void> {
  // Main Loop
  if (!PI_PATH) {
    console.error("❌ Could not find 'pi' in PATH");
    process.exit(1);
  }

  if (!existsSync(".git")) {
    console.error("❌ Not a git repository");
    process.exit(1);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("ROUTER CLEANUP — Autonomous Refactor Loop");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const { $ } = await import("bun");
  let iteration = 0;

  while (true) {
    iteration++;
    console.log(`\n┌─ Iteration #${iteration} — ${timestamp()}`);
    console.log("└──────────────────────────────────────\n");

    const todoContent = readTodo();
    const nextTask = getNextTodo(todoContent);

    if (!nextTask && !(await hasUncommittedChanges())) {
      if (providedContext) {
        if (shouldWriteContext) {
          console.log(`📝 Writing ${CONTEXT_FILE} from --context...`);
          await writeContextFile(providedContext);
          console.log("🔍 Generating tasks based on provided context...");
          if (DRY_RUN) {
            console.log("\n(dry-run) Would run prompt:\n");
            console.log(PROMPT_FIND_WORK);
            break;
          }
          await runAgent(PROMPT_FIND_WORK, TIMEOUT_MS);
        } else {
          console.log(
            "🔍 Generating tasks based on provided context (not writing to disk)...",
          );
          if (DRY_RUN) {
            console.log("\n(dry-run) Would run prompt:\n");
            console.log(PROMPT_FIND_WORK_WITH_INLINE_CONTEXT(providedContext));
            break;
          }
          await runAgent(PROMPT_FIND_WORK_WITH_INLINE_CONTEXT(providedContext), TIMEOUT_MS);
        }
        continue;
      }

      if (existsSync(CONTEXT_FILE)) {
        console.log("🔍 Generating tasks based on context...");
        if (DRY_RUN) {
          console.log("\n(dry-run) Would run prompt:\n");
          console.log(PROMPT_FIND_WORK);
          break;
        }
        await runAgent(PROMPT_FIND_WORK, TIMEOUT_MS);
        continue;
      }

      console.log("✅ No unchecked tasks remain and no context provided; exiting.");
      break;
    }

    const prompt = (await hasUncommittedChanges())
      ? `${SYSTEM_RULES}\n\n${PROMPT_RESUME}\n\n${TASK_CONSTRAINTS}`
      : `${SYSTEM_RULES}\n\nYour task: ${nextTask}\n\n${TASK_CONSTRAINTS}`;

    if (DRY_RUN) {
      console.log("\n(dry-run) Would run prompt:\n");
      console.log(prompt);
      break;
    }

    if (await hasUncommittedChanges()) {
      console.log("🕵️  Uncommitted changes detected. Resuming...");
    } else {
      console.log(`▶ Task: ${nextTask}`);
    }

    await runAgent(prompt, TIMEOUT_MS);

    // Verification
    if (await recentCommit()) {
      console.log("✅ Agent committed successfully.");
    } else if (await hasUncommittedChanges()) {
      console.log("⚠️ Uncommitted changes remain. Auto-committing...");
      await $`git add -A`.quiet();
      await $`git commit -m ${"cleanup: finalize iteration " + iteration}`.quiet();
    }

    if (ONCE) break;
  }
}

if (import.meta.main) {
  await main();
}
