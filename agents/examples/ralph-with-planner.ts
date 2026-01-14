#!/usr/bin/env bun
/**
 * Example: ralph that uses a different model to generate tasks.
 *
 * Uses claude-opus-4-5 (or any smarter model) for planning/task generation,
 * and the default model for execution.
 */

import { runLoop, withResume, type LoopState } from "../core";

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const PROMPT_WORK = `
- Look at .ralph/TODO.md for the current task list
- Pick a logical chunk of work and do it
- Update .ralph/TODO.md to reflect what you've done (check off completed items)
- Commit: git add -A && git commit -m "<what you did>"
- Exit after committing
`.trim();

const PROMPT_FIND_WORK = `
- .ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
- Look through the codebase and add useful work items to .ralph/TODO.md
- Commit: git add -A && git commit -m "<what you added>"
- Exit after committing. Don't do any coding yet.
`.trim();

const promptFindWorkWithContext = (context: string) => `
- .ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
- Use the following goal as context for what tasks to add:

<instructions>
${context}
</instructions>

TASK:
- Look through the codebase and add useful work items to .ralph/TODO.md
- Commit: git add -A && git commit -m "<what you added>"
- Exit after committing. Don't do any coding yet.
`.trim();

// ─────────────────────────────────────────────────────────────
// Agent Definition
// ─────────────────────────────────────────────────────────────

runLoop({
  name: "ralph-planner",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",
  pushEvery: 4,

  decide(state: LoopState) {
    const { hasTodos, hasUncommittedChanges, context } = state;

    // Has work to do — use default model
    if (hasTodos) {
      return {
        type: "work",
        prompt: withResume(PROMPT_WORK, hasUncommittedChanges),
      };
    }

    // No todos — use smarter model for planning
    const generatePrompt = context
      ? promptFindWorkWithContext(context)
      : PROMPT_FIND_WORK;

    return {
      type: "generate",
      prompt: withResume(generatePrompt, hasUncommittedChanges),
      options: {
        args: ["--model", "claude-opus-4-5"],  // Use opus for task generation
        timeout: "10m",           // Give it more time to think
      },
    };
  },
});
