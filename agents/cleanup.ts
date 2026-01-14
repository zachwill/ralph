#!/usr/bin/env bun
import { loop, work, generate, halt } from "./core";

loop({
  name: "cleanup",
  taskFile: ".ralph/CLEANUP.md",
  timeout: "10m",

  run(state) {
    if (state.hasTodos) {
      return work(`
        Your task: ${state.nextTodo}

        - Complete this single cleanup task
        - Run verification (typecheck/build) and fix any errors
        - Check off ONLY this item in .ralph/CLEANUP.md

        When done:
        - git add -A && git commit -m "cleanup: <brief description>"
        - Exit
      `);
    }

    if (!state.context) {
      return halt("No tasks and no --context provided. Use -c to specify cleanup goals.");
    }

    return generate(`
      .ralph/CLEANUP.md has no actionable items.

      Use this cleanup goal:

      <instructions>
      ${state.context}
      </instructions>

      - Look through the codebase and add specific cleanup items to .ralph/CLEANUP.md
      - Commit: git add -A && git commit -m "cleanup: identify tasks"
      - Exit after committing. Don't do any coding yet.
    `);
  },
});
