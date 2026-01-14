#!/usr/bin/env bun
/**
 * Example: ralph with a simple supervisor (just a prompt, no custom logic).
 */
import { loop, work, generate, supervisor } from "../core";

loop({
  name: "ralph-simple-supervisor",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",

  // Simple supervisor: just a prompt that runs every 12 commits
  supervisor: supervisor(`
    You are a supervisor reviewing recent work.

    Run: git log -n 12 --oneline

    Your job:
    1. Check if work is going in a productive direction
    2. Look for any issues or regressions
    3. Update .ralph/TODO.md if priorities should change

    If you make changes:
    - git add -A && git commit -m "supervisor: <adjustment>"
    - Exit
  `, { every: 12, model: "claude-opus-4-5" }),

  run(state) {
    if (state.hasTodos) {
      return work(`
        - Look at .ralph/TODO.md for the current task list
        - Pick a logical chunk of work and do it
        - Update .ralph/TODO.md (check off completed items)
        - Commit: git add -A && git commit -m "<what you did>"
        - Exit after committing
      `);
    }

    return generate(`
      .ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
      - Look through the codebase and add useful work items to .ralph/TODO.md
      - Commit: git add -A && git commit -m "<what you added>"
      - Exit after committing. Don't do any coding yet.
    `);
  },
});
