#!/usr/bin/env bun
/**
 * spec-worker.ts - A two-phase agent using the spec-based system.
 *
 * This agent demonstrates the directory-based spec workflow:
 *
 *   1. Research Phase (Opus): When no specs exist, Opus researches the
 *      codebase and creates detailed spec files with "copy/paste for
 *      your future self" instructions.
 *
 *   2. Implementation Phase (GPT-5.2 or other): When specs exist, a
 *      worker model picks up the next available spec, marks it WIP,
 *      implements it, and deletes the file when done.
 *
 * Usage:
 *   bun agents/spec-worker.ts                     # Run the loop
 *   bun agents/spec-worker.ts -c "Add tests"      # Guide spec generation
 *   bun agents/spec-worker.ts --once              # Single iteration
 *   bun agents/spec-worker.ts --dry-run           # Preview prompt
 */

import {
  specLoop,
  research,
  implement,
  specHalt,
  buildResearchPrompt,
  buildImplementPrompt,
  type SpecState,
} from "./spec-core";

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const LOOP_NAME = "spec-worker";
const SPEC_DIR = ".ralph/SPECS";
const DEFAULT_TIMEOUT = "5m";

// Research phase: Use Opus for deep research
const RESEARCH_MODEL = "claude-opus-4-5";
const RESEARCH_TIMEOUT = "10m";
const RESEARCH_THINKING = "high" as const;

// Implementation phase: Use GPT-5.2 for implementation (or any fast worker)
const WORKER_MODEL = "gpt-5.2";
const WORKER_TIMEOUT = "5m";

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────

function buildResearchBasePrompt(context: string | null): string {
  const contextBlock = context
    ? `\nFocus on: ${context}\n`
    : "";

  return `
You are a senior architect researching the codebase to identify the next piece of work.
${contextBlock}

Your job is to:
1. Explore the codebase thoroughly
2. Identify a specific, well-scoped task that needs to be done
3. Research it deeply - understand all the files involved, patterns to follow, edge cases
4. Create a detailed spec that another model can implement without needing your context
`.trim();
}

function buildWorkPrompt(spec: SpecState["nextSpec"], specDir: string): string {
  if (!spec) {
    return `No spec files available in ${specDir}. This shouldn't happen.`;
  }

  return buildImplementPrompt(spec, specDir);
}

// ─────────────────────────────────────────────────────────────
// Main Loop
// ─────────────────────────────────────────────────────────────

specLoop({
  name: LOOP_NAME,
  specDir: SPEC_DIR,
  timeout: DEFAULT_TIMEOUT,

  run(state) {
    // If we have specs available, implement them
    if (state.hasAvailableSpecs) {
      return implement(buildWorkPrompt(state.nextSpec, state.specDir), {
        model: WORKER_MODEL,
        timeout: WORKER_TIMEOUT,
      });
    }

    // If there are WIP specs, wait for them to complete
    const wipSpecs = state.specs.filter((s) => s.isWIP);
    if (wipSpecs.length > 0) {
      console.log(`[Wait] ${wipSpecs.length} spec(s) in progress, skipping...`);
      // In a real multi-agent scenario, we'd wait. For now, halt.
      return specHalt(`${wipSpecs.length} spec(s) still in progress`);
    }

    // No specs at all - time to research and create one
    if (!state.context) {
      // Without context, we can still look for work in the codebase
      console.log("[Research] Looking for work in the codebase...");
    }

    const basePrompt = buildResearchBasePrompt(state.context);
    const fullPrompt = buildResearchPrompt(state.specDir, basePrompt, state.context);

    return research(fullPrompt, {
      model: RESEARCH_MODEL,
      timeout: RESEARCH_TIMEOUT,
      thinking: RESEARCH_THINKING,
    });
  },
});
