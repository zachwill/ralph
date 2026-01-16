#!/usr/bin/env bun
/**
 * Example: ralph that uses a smarter model for task generation.
 */
import { generate, loop, work } from "../core";

const LOOP_NAME = "ralph-planner";
const TASK_FILE = ".ralph/TODO.md";
const DEFAULT_TIMEOUT = "5m";

// Use opus for planning, give it more time.
const PLANNER_MODEL = "claude-opus-4-5";
const PLANNER_TIMEOUT = "10m";

const WORK_PROMPT = `
- Look at .ralph/TODO.md for the current task list
- Pick a logical chunk of work and do it
- Update .ralph/TODO.md (check off completed items)
- Commit: git add -A && git commit -m "<what you did>"
- Exit after committing
`;

function buildContextBlock(context: string | null): string {
  if (!context) return "";

  return `Use this goal as context:\n\n<instructions>\n${context}\n</instructions>\n\n`;
}

function buildGeneratePrompt(contextBlock: string): string {
  return `
.ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
${contextBlock}- Look through the codebase and add useful work items to .ralph/TODO.md
- Commit: git add -A && git commit -m "<what you added>"
- Exit after committing. Don't do any coding yet.
`;
}

loop({
  name: LOOP_NAME,
  taskFile: TASK_FILE,
  timeout: DEFAULT_TIMEOUT,

  run(state) {
    if (state.hasTodos) return work(WORK_PROMPT);

    const prompt = buildGeneratePrompt(buildContextBlock(state.context));
    return generate(prompt, { model: PLANNER_MODEL, timeout: PLANNER_TIMEOUT });
  },
});
