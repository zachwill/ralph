#!/usr/bin/env bun
/**
 * cleanup.ts — Goal-directed cleanup agent
 *
 * Works through .ralph/CLEANUP.md one task at a time.
 * REQUIRES --context to generate new tasks (no generic "find work" mode).
 */

import { runLoop, withResume, type LoopState } from "./core";

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const PROMPT_CLEANUP = (task: string) => `
You are working on a specific cleanup task.

Your task: ${task}

Constraints:
- Complete this single task
- Run verification (typecheck/build) and fix any errors
- Check off ONLY this item in .ralph/CLEANUP.md

When done:
- git add -A && git commit -m "cleanup: <brief description>"
- Exit
`.trim();

const promptGenerateTasks = (context: string) => `
- .ralph/CLEANUP.md has no actionable items
- Use the following cleanup goal as context:

<instructions>
${context}
</instructions>

TASK:
- Look through the codebase and add specific, actionable cleanup items to .ralph/CLEANUP.md
- Commit: git add -A && git commit -m "cleanup: identify tasks"
- Exit after committing. Don't do any coding yet.
`.trim();

// ─────────────────────────────────────────────────────────────
// Agent Definition
// ─────────────────────────────────────────────────────────────

runLoop({
  name: "cleanup",
  taskFile: ".ralph/CLEANUP.md",
  timeout: "10m",
  pushEvery: 4,

  decide(state: LoopState) {
    const { hasTodos, hasUncommittedChanges, context, nextTodo } = state;

    // Has work to do
    if (hasTodos && nextTodo) {
      return {
        type: "work",
        prompt: withResume(PROMPT_CLEANUP(nextTodo), hasUncommittedChanges),
      };
    }

    // No todos — need context to generate tasks
    if (!context) {
      return {
        type: "halt",
        reason: "No tasks remain and no --context provided. Use --context/-c to specify cleanup goals.",
      };
    }

    // Generate tasks from context
    return {
      type: "generate",
      prompt: withResume(promptGenerateTasks(context), hasUncommittedChanges),
    };
  },
});
