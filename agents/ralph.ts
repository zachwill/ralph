#!/usr/bin/env bun
import { loop, work, generate } from "./core";

loop({
  name: "ralph",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",

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

    const contextBlock = state.context
      ? `Use this goal as context:\n\n<instructions>\n${state.context}\n</instructions>\n\n`
      : "";

    return generate(`
      .ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
      ${contextBlock}
      - Look through the codebase and add useful work items to .ralph/TODO.md
      - Commit: git add -A && git commit -m "<what you added>"
      - Exit after committing. Don't do any coding yet.
    `);
  },
});
