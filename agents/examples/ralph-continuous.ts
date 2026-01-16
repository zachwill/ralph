#!/usr/bin/env bun
/**
 * Example: a continuous loop.
 *
 * - Works through .ralph/TODO.md
 * - When the todo list is empty, it generates a fresh backlog
 * - Unlike the default behavior, it does NOT exit after completing the last task
 */
import { loop, work, generate } from "../core";

loop({
  name: "ralph-continuous",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",
  continuous: true,

  run(state) {
    if (state.hasTodos) {
      return work(`
        - Look at .ralph/TODO.md for the current task list
        - Do ONLY the next unchecked task: ${state.nextTodo}
        - Update .ralph/TODO.md (check off the completed item)
        - Commit: git add -A && git commit -m "<what you did>"
        - Exit after committing
      `);
    }

    const contextBlock = state.context
      ? `Use this goal as context:\n\n<instructions>\n${state.context}\n</instructions>\n\n`
      : "";

    return generate(`
      .ralph/TODO.md has no unchecked tasks.

      ${contextBlock}
      - Generate a fresh, prioritized task list (~10–20 items)
      - Use markdown checkboxes: - [ ] <task>
      - Commit: git add -A && git commit -m "chore: generate tasks"
      - Exit after committing
    `);
  },
});
