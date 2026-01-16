#!/usr/bin/env bun
/**
 * Example: ralph with a supervisor that reviews work every 12 commits.
 */
import { generate, loop, runPi, work, type State } from "../core";

const LOOP_NAME = "ralph-supervised";
const TASK_FILE = ".ralph/TODO.md";
const TIMEOUT = "5m" as const;

const SUPERVISOR_EVERY = 12;
const SUPERVISOR_RUN_OPTIONS = { model: "claude-opus-4-5", timeout: "5m" } as const;

function buildSupervisorPrompt(): string {
  return `
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
      `;
}

function buildWorkPrompt(): string {
  return `
        - Look at .ralph/TODO.md for the current task list
        - Pick a logical chunk of work and do it
        - Update .ralph/TODO.md (check off completed items)
        - Commit: git add -A && git commit -m "<what you did>"
        - Exit after committing
      `;
}

function buildContextBlock(context: string | null): string {
  if (!context) return "";

  return `Use this goal as context:\n\n<instructions>\n${context}\n</instructions>\n\n`;
}

function buildGeneratePrompt(context: string | null): string {
  const contextBlock = buildContextBlock(context);

  return `
      .ralph/TODO.md has no actionable items. Wipe it clean and start fresh.
      ${contextBlock}
      - Look through the codebase and add useful work items to .ralph/TODO.md
      - Commit: git add -A && git commit -m "<what you added>"
      - Exit after committing. Don't do any coding yet.
    `;
}

async function runSupervisorReview(state: State): Promise<void> {
  console.log(`📊 Reviewing after ${state.commits} commits`);
  await runPi(buildSupervisorPrompt(), SUPERVISOR_RUN_OPTIONS);
}

function decideNextAction(state: State) {
  if (state.hasTodos) return work(buildWorkPrompt());
  return generate(buildGeneratePrompt(state.context));
}

loop({
  name: LOOP_NAME,
  taskFile: TASK_FILE,
  timeout: TIMEOUT,

  supervisor: {
    every: SUPERVISOR_EVERY,
    run: runSupervisorReview,
  },

  run: decideNextAction,
});
