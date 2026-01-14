#!/usr/bin/env bun
/**
 * refactor.ts — Focused refactoring agent
 *
 * Works through .ralph/REFACTOR.md one file at a time.
 * When empty: generates refactor tasks (optionally guided by --context), then exits for review.
 */

import { runLoop, withResume, type LoopState } from "./core";

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

const PROMPT_REFACTOR = `
Your task is to refactor ONE file listed in .ralph/REFACTOR.md (the next unchecked item).

1. Read .ralph/REFACTOR.md and pick the first unchecked item
2. Refactor that file (keep behavior stable; no feature work)
3. Improve readability: extract helpers, reduce nesting, clarify naming
4. Verify changes work (typecheck, build, etc.)
5. Check off ONLY that item in .ralph/REFACTOR.md

When done:
- git add -A && git commit -m "refactor: <scope>"
- Exit
`.trim();

const PROMPT_FIND_WORK = `
- .ralph/REFACTOR.md has no actionable items. Wipe it clean and start fresh.
- Look through the codebase and identify files that need refactoring
- Focus on: readability, structure, dead code removal
- Format each item as: - [ ] \`path/to/file.ts\`
- Commit: git add -A && git commit -m "chore: seed refactor tasks"
- Exit after committing. Don't do any refactoring yet.
`.trim();

const promptFindWorkWithContext = (context: string) => `
- .ralph/REFACTOR.md has no actionable items. Wipe it clean and start fresh.
- Use the following goal as context:

<instructions>
${context}
</instructions>

TASK:
- Look through the codebase and identify files that need refactoring
- Format each item as: - [ ] \`path/to/file.ts\`
- Commit: git add -A && git commit -m "chore: seed refactor tasks"
- Exit after committing. Don't do any refactoring yet.
`.trim();

// ─────────────────────────────────────────────────────────────
// Agent Definition
// ─────────────────────────────────────────────────────────────

runLoop({
  name: "refactor",
  taskFile: ".ralph/REFACTOR.md",
  timeout: "5m",
  pushEvery: 4,

  decide(state: LoopState) {
    const { hasTodos, hasUncommittedChanges, context } = state;

    // Has work to do
    if (hasTodos) {
      return {
        type: "work",
        prompt: withResume(PROMPT_REFACTOR, hasUncommittedChanges),
      };
    }

    // No todos — generate new tasks, then exit for review
    const generatePrompt = context
      ? promptFindWorkWithContext(context)
      : PROMPT_FIND_WORK;

    return {
      type: "generate",
      prompt: withResume(generatePrompt, hasUncommittedChanges),
    };
  },
});
