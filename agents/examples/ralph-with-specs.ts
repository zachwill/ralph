#!/usr/bin/env bun
/**
 * Example: ralph using directory-based specs.
 *
 * Instead of a single TODO.md with checkboxes, tasks are individual
 * numbered markdown files in .ralph/SPECS/. Each file is a self-contained
 * spec that a worker implements, then the file is removed on completion.
 *
 * Workflow:
 * 1. Research agent creates numbered spec files in .ralph/SPECS/
 * 2. Worker picks up the next available spec (state.nextTodo = file content)
 * 3. Framework marks the file <!-- WIP --> during work
 * 4. Framework removes the file when work is complete
 *
 * Usage:
 *   bun agents/examples/ralph-with-specs.ts
 *   bun agents/examples/ralph-with-specs.ts -c "Focus on auth layer"
 */
import { generate, loop, work } from "../core";
import type { State } from "../core";

const LOOP_NAME = "ralph-specs";
const TASK_DIR = ".ralph/SPECS";
const TIMEOUT = "10m";

function buildWorkPrompt(state: State): string {
  return `
You are implementing a spec. The spec file is: ${state.nextTodoFile}

Here is the full spec to implement:

<spec>
${state.nextTodo}
</spec>

WORKFLOW:
1. Read and understand the spec completely
2. Implement everything described in the spec
3. Verify your changes work (typecheck, build, etc.)
4. Commit: git add -A && git commit -m "<what you did>"
5. Exit after committing
`;
}

function buildGeneratePrompt(context: string | null): string {
  const contextBlock = context
    ? `\nFocus area:\n<instructions>\n${context}\n</instructions>\n\n`
    : "";

  return `
The specs directory ${TASK_DIR}/ is empty. Research the codebase and create specs.
${contextBlock}
Your context window is full. I'm going to start you over fresh.
Give me a copy/paste for your future self to execute on what you've compiled.

For EACH piece of work you identify, create a separate markdown file:
- ${TASK_DIR}/001-<short-description>.md
- ${TASK_DIR}/002-<short-description>.md
- etc.

Each file should be a self-contained implementation plan:
- What to change and why
- Specific files and line ranges to modify
- Expected behavior after changes
- Any edge cases to handle

Write as if handing off to a fresh agent with no prior context.
Be specific enough that someone can execute without asking questions.

Commit: git add -A && git commit -m "chore: generate specs"
Exit after committing. Don't do any coding yet.
`;
}

loop({
  name: LOOP_NAME,
  taskDir: TASK_DIR,
  timeout: TIMEOUT,

  run(state) {
    if (state.hasTodos) return work(buildWorkPrompt(state));
    return generate(buildGeneratePrompt(state.context));
  },
});
