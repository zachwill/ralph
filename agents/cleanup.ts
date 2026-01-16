#!/usr/bin/env bun
import { generate, halt, loop, work } from "./core";

const LOOP_NAME = "cleanup";
const TASK_FILE = ".ralph/CLEANUP.md";
const TIMEOUT = "10m";

function buildWorkPrompt(task: string | null): string {
  return `
    Your task: ${task}

    - Complete this single cleanup task
    - Run verification (typecheck/build) and fix any errors
    - Check off ONLY this item in ${TASK_FILE}

    When done:
    - git add -A && git commit -m "cleanup: <brief description>"
    - Exit
  `;
}

function buildGeneratePrompt(goal: string): string {
  return `
    ${TASK_FILE} has no actionable items.

    Use this cleanup goal:

    <instructions>
    ${goal}
    </instructions>

    - Look through the codebase and add specific cleanup items to ${TASK_FILE}
    - Commit: git add -A && git commit -m "cleanup: identify tasks"
    - Exit after committing. Don't do any coding yet.
  `;
}

loop({
  name: LOOP_NAME,
  taskFile: TASK_FILE,
  timeout: TIMEOUT,

  run(state) {
    if (state.hasTodos) {
      return work(buildWorkPrompt(state.nextTodo));
    }

    if (!state.context) {
      return halt(
        "No tasks and no --context provided. Use -c to specify cleanup goals."
      );
    }

    return generate(buildGeneratePrompt(state.context));
  },
});
