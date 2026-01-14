#!/usr/bin/env bun
/**
 * Example: ralph with a supervisor that runs every 12 commits.
 *
 * The supervisor can run anything — a different prompt, a different model,
 * or even a completely different script.
 */

import {
  runLoop,
  runPi,
  runCommand,
  withResume,
  type LoopState,
} from "../core";

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
// Supervisor Prompt (runs with a different model)
// ─────────────────────────────────────────────────────────────

const SUPERVISOR_PROMPT = `
You are a supervisor reviewing recent work. Run:

  git log -n 12 --oneline

Review the recent commits and the current state of the codebase.

Your job:
1. Check if work is going in a productive direction
2. Look for any issues, bugs, or regressions
3. Update .ralph/TODO.md if priorities should change
4. If everything looks good, just note it and exit

If you make changes:
- git add -A && git commit -m "supervisor: <what you adjusted>"
- Exit
`.trim();

// ─────────────────────────────────────────────────────────────
// Agent Definition
// ─────────────────────────────────────────────────────────────

runLoop({
  name: "ralph-supervised",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",
  pushEvery: 4,
  supervisorEvery: 12,

  decide(state: LoopState) {
    const { hasTodos, hasUncommittedChanges, context } = state;

    if (hasTodos) {
      return {
        type: "work",
        prompt: withResume(PROMPT_WORK, hasUncommittedChanges),
      };
    }

    const generatePrompt = context
      ? promptFindWorkWithContext(context)
      : PROMPT_FIND_WORK;

    return {
      type: "generate",
      prompt: withResume(generatePrompt, hasUncommittedChanges),
    };
  },

  // Supervisor runs every 12 commits
  async supervisor(state: LoopState) {
    console.log(`📊 Supervisor check after ${state.commitsSinceStart} commits`);

    // Example 1: Run pi with a different model
    await runPi(SUPERVISOR_PROMPT, {
      timeout: "3m",
      args: ["--model", "claude-sonnet-4-20250514"],
    });

    // Example 2: Or run a completely different script
    // await runCommand(["bun", "agents/supervisor-script.ts"], { timeout: "2m" });

    // Example 3: Or run any shell command
    // await runCommand(["./scripts/check-quality.sh"]);
  },
});
