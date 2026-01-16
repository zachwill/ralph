#!/usr/bin/env bun
import { generate, loop, work } from "./core";

function formatContextBlock(context: string | null): string {
  if (!context) return "";

  return `Use this goal as context:\n\n<instructions>\n${context}\n</instructions>\n\n`;
}

function buildRefactorWorkPrompt(): string {
  return `
        Refactor ONE file from .ralph/REFACTOR.md (the first unchecked item).

        1. Pick the first unchecked item
        2. Refactor that file (keep behavior stable; no feature work)
        3. Improve readability: extract helpers, reduce nesting, clarify naming
        4. Verify changes work (typecheck, build, etc.)
        5. Check off ONLY that item in .ralph/REFACTOR.md

        When done:
        - git add -A && git commit -m "refactor: <scope>"
        - Exit
      `;
}

function buildSeedRefactorTasksPrompt(context: string | null): string {
  const contextBlock = formatContextBlock(context);

  return `
      .ralph/REFACTOR.md has no actionable items. Wipe it clean and start fresh.
      ${contextBlock}
      - Look through the codebase and identify files that need refactoring
      - Focus on: readability, structure, dead code removal
      - Format each item as: - [ ] \`path/to/file.ts\`
      - Commit: git add -A && git commit -m "chore: seed refactor tasks"
      - Exit after committing. Don't do any refactoring yet.
    `;
}

loop({
  name: "refactor",
  taskFile: ".ralph/REFACTOR.md",
  timeout: "5m",

  run(state) {
    if (state.hasTodos) return work(buildRefactorWorkPrompt());

    return generate(buildSeedRefactorTasksPrompt(state.context));
  },
});
