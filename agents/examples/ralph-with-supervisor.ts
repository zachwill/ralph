#!/usr/bin/env bun
/**
 * Example: ralph with a supervisor that reviews work every 12 commits.
 */
import { loop, work, generate, runPi } from "../core";

loop({
  name: "ralph-supervised",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",

  supervisor: {
    every: 12,
    async run(state) {
      console.log(`📊 Reviewing after ${state.commits} commits`);

      await runPi(`
        You are a supervisor reviewing recent work.

        Run: git log -n 12 --oneline

        Your job:
        1. Check if work is going in a productive direction
        2. Look for any issues, bugs, or regressions
        3. Update .ralph/TODO.md if priorities should change
        4. If everything looks good, just note it and exit

        If you make changes:
        - git add -A && git commit -m "supervisor: <adjustment>"
        - Exit
      `, { model: "claude-opus-4-5", timeout: "5m" });
    },
  },

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
