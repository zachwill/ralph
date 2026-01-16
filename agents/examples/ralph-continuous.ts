#!/usr/bin/env bun
/**
 * Example: a continuous loop.
 *
 * - Works through .ralph/TODO.md
 * - When the todo list is empty, it generates a fresh backlog
 * - Unlike the default behavior, it does NOT exit after completing the last task
 */
import { generate, loop, work } from "../core";
import type { State } from "../core";

const LOOP_NAME = "ralph-continuous";
const TASK_FILE = ".ralph/TODO.md";
const TIMEOUT = "5m";

function formatContextBlock(context: State["context"]): string {
  if (!context) return "";

  return `Use this goal as context:\n\n<instructions>\n${context}\n</instructions>\n\n`;
}

function buildWorkerPrompt(nextTodo: State["nextTodo"]): string {
  return `
- Look at .ralph/TODO.md for the current task list
- Do ONLY the next unchecked task: ${nextTodo}
- Update .ralph/TODO.md (check off the completed item)
- Commit: git add -A && git commit -m "<what you did>"
- Exit after committing
`;
}

function buildPlannerPrompt(context: State["context"]): string {
  const contextBlock = formatContextBlock(context);

  return `
.ralph/TODO.md has no unchecked tasks.

${contextBlock}- Generate a fresh, prioritized task list (~10–20 items)
- Use markdown checkboxes: - [ ] <task>
- Commit: git add -A && git commit -m "chore: generate tasks"
- Exit after committing
`;
}

loop({
  name: LOOP_NAME,
  taskFile: TASK_FILE,
  timeout: TIMEOUT,
  continuous: true,

  run(state) {
    return state.hasTodos
      ? work(buildWorkerPrompt(state.nextTodo))
      : generate(buildPlannerPrompt(state.context));
  },
});
