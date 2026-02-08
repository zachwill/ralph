#!/usr/bin/env bun
/**
 * Example: Continuous spec-based loop with supervisor.
 *
 * This shows the full power of the spec-based system:
 *
 * 1. Research Phase: Opus researches problems and creates detailed specs
 * 2. Implementation Phase: A worker model implements specs one by one
 * 3. Supervisor: Periodically reviews progress and adjusts the spec queue
 * 4. Continuous Mode: Keeps generating new specs when the queue is empty
 */

import {
  specLoop,
  research,
  implement,
  buildResearchPrompt,
  buildImplementPrompt,
  listSpecs,
  type SpecState,
} from "../spec-core";
import { runPi, type RunOptions } from "../core";

const LOOP_NAME = "spec-continuous";
const SPEC_DIR = ".ralph/SPECS";
const DEFAULT_TIMEOUT = "5m";

// Models
const RESEARCH_MODEL = "claude-opus-4-5";
const WORKER_MODEL = "gpt-5.2";
const SUPERVISOR_MODEL = "claude-opus-4-5";

// ─────────────────────────────────────────────────────────────
// Supervisor
// ─────────────────────────────────────────────────────────────

async function runSupervisor(state: SpecState): Promise<void> {
  const specs = await listSpecs(state.specDir);
  const specList = specs.map((s) => `- ${s.name} (${s.isWIP ? "WIP" : "available"})`).join("\n");

  const prompt = `
You are the Spec Supervisor. Review the current state of the spec queue.

CURRENT SPECS:
${specList || "(empty)"}

SPEC DIRECTORY: ${state.specDir}

Your responsibilities:

1. REVIEW: Check if any specs are stale or blocked
2. PRIORITIZE: Reorder specs if needed (rename files with new numbers)
3. CLEAN UP: Delete specs that are no longer relevant
4. UNBLOCK: If a spec is WIP but seems abandoned, remove the WIP marker

After any changes:
- git add -A && git commit -m "supervisor: <what you did>"
- Exit
  `.trim();

  await runPi(prompt, {
    model: SUPERVISOR_MODEL,
    thinking: "medium",
    timeout: "10m",
  });
}

// ─────────────────────────────────────────────────────────────
// Main Loop
// ─────────────────────────────────────────────────────────────

specLoop({
  name: LOOP_NAME,
  specDir: SPEC_DIR,
  timeout: DEFAULT_TIMEOUT,
  continuous: true,

  supervisor: {
    every: 6,
    run: runSupervisor,
  },

  run(state) {
    if (state.hasAvailableSpecs && state.nextSpec) {
      return implement(buildImplementPrompt(state.nextSpec, state.specDir), {
        model: WORKER_MODEL,
        timeout: DEFAULT_TIMEOUT,
      });
    }

    // Research new work
    const basePrompt = `
You are a senior architect. Explore the codebase and identify the next
important piece of work. Create a detailed spec that can be implemented
by a different model without your context.

${state.context ? `Focus: ${state.context}` : "Look for TODO comments, incomplete features, or technical debt."}
    `.trim();

    return research(buildResearchPrompt(state.specDir, basePrompt, state.context), {
      model: RESEARCH_MODEL,
      thinking: "high",
      timeout: "10m",
    });
  },
});
