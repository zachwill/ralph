#!/usr/bin/env bun
import { loop, work, generate, supervisor } from "./core";

const useGeminiCli = process.argv.includes("--gemini");
const usePro = process.argv.includes("--pro");
const useClaude = process.argv.includes("--claude");

const geminiFlash = useGeminiCli ? "gemini-3-flash-preview" : "gemini-3-flash";
const geminiPro = useGeminiCli ? "gemini-3-pro-preview" : "gemini-3-pro-high";
const defaultProvider = useGeminiCli ? "google-gemini-cli" : "google-antigravity";

// Defaults: Worker uses Flash, Supervisor/Generator uses a stronger model
let workerModel = geminiFlash;
let workerProvider = defaultProvider;
let supervisorModel = "claude-opus-4-5-thinking";
let supervisorProvider = "google-antigravity";

if (usePro) {
  // --pro makes everything Gemini 3 Pro
  workerModel = geminiPro;
  workerProvider = defaultProvider;
  supervisorModel = geminiPro;
  supervisorProvider = defaultProvider;
}

if (useClaude) {
  // --claude makes everything Claude Opus
  workerModel = "claude-opus-4-5-thinking";
  workerProvider = "google-antigravity";
  supervisorModel = "claude-opus-4-5-thinking";
  supervisorProvider = "google-antigravity";
}

loop({
  name: "roadmap",
  taskFile: ".ralph/ROADMAP.md",
  timeout: "10m",
  pushEvery: 2,
  maxIterations: 200,
  continuous: true,

  supervisor: supervisor(
    `
    You are the Roadmap Supervisor. Your goal is to ensure the project evolves 
    according to the architectural vision defined in the project's documentation.

    Every few commits, you must review progress:

    1) RE-SYNC: Read the master 'ROADMAP.md' and 'DESIGN.md' (if they exist) 
       to understand the long-term goals and architectural patterns.

    2) AUDIT: Read '.ralph/ROADMAP.md' to see the current active tasks.

    3) VERIFY: Check the actual state of the codebase (e.g., 'src/', 'lib/').
       - Are new features following the design patterns?
       - Are we actually cleaning up technical debt or just adding to it?
       - Are dependencies being respected?

    4) STEER: Update '.ralph/ROADMAP.md' based on your audit.
       - Break down large, vague tasks into concrete, actionable steps.
       - Re-prioritize if you discover a missing foundation or a better path.
       - Add refactoring tasks for files that became bloated during implementation.

    Concrete task example: 
    "Refactor 'src/components/List.tsx' to extract 'ListItem' into its own file (lines 50-120)"
    
    Vague task (AVOID): 
    "Make the list better"

    If you update the task list, commit the changes with a descriptive message.
    `,
    { every: 4, model: supervisorModel, thinking: "medium", provider: supervisorProvider }
  ),

  run(state) {
    if (state.hasTodos) {
      return work(
        `
        You are a Senior Engineer implementing the project roadmap.
        
        Current Task: ${state.nextTodo}

        PHILOSOPHY:
        - **Evolve, don't rebuild.** Leverage existing utilities and components.
        - **Clean as you go.** If you see minor technical debt in the file you're 
          touching, fix it. If it's major, add a task to '.ralph/ROADMAP.md'.
        - **Verify.** Ensure your changes don't break existing functionality.

        WORKFLOW:
        1. Explore: Read relevant files to understand the current implementation.
        2. Execute: Make surgical, focused changes.
        3. Document: If you find gaps or follow-up work, add them to the task list.
        4. Complete: Check off ONLY the current task when fully done.

        Commit your work with a concise, meaningful message:
        "roadmap: <what you did>"
        `,
        { model: workerModel, thinking: "medium", provider: workerProvider }
      );
    }

    const contextBlock = state.context
      ? `Additional focus for this generation:\n\n<context>\n${state.context}\n</context>\n\n`
      : "";

    return generate(
      `
      The active task list '.ralph/ROADMAP.md' is empty. 
      You need to generate the next batch of work.

      ${contextBlock}

      PROCESS:
      1. ANALYZE: Read 'ROADMAP.md' (the master plan) and 'DESIGN.md' (the rules).
      2. SCAN: Check the repository structure ('ls -R src/') and key files.
      3. MAP: Identify the next logical milestone in the master plan that 
         hasn't been fully implemented yet.
      4. DECOMPOSE: Break that milestone into 5-10 specific, actionable tasks.

      TASK CRITERIA:
      - File-path specific where possible.
      - Atomic (one task = one commit-sized chunk of work).
      - Verifiable (it should be clear when it's "done").

      OUTPUT:
      Rewrite '.ralph/ROADMAP.md' with the new tasks categorized by milestone.

      Commit the new backlog:
      "roadmap: generate next milestone tasks"
      `,
      { model: supervisorModel, thinking: "medium", provider: supervisorProvider }
    );
  },
});

