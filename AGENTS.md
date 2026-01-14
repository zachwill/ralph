# Agent Architectures

This project explores different patterns for autonomous coding loops.

## Core Architecture (`agents/core.ts`)

All agents use `runLoop()` from `core.ts`. You define:

```typescript
import { runLoop, runPi, runCommand, withResume, type LoopState } from "./core";

runLoop({
  name: "my-agent",           // For banner/logs
  taskFile: ".ralph/TODO.md", // Where tasks live
  timeout: "5m",              // Per-run timeout: number (seconds) or "30s", "5m", "1h"
  pushEvery: 4,               // Push every N commits (default: 4)
  maxIterations: 400,         // Safety limit (default: 400)
  supervisorEvery: 12,        // Optional: run supervisor every N commits

  decide(state: LoopState) {
    // Return one of:
    // - { type: "work", prompt: "..." }      → do work, continue loop
    // - { type: "generate", prompt: "..." }  → generate tasks, then exit for review
    // - { type: "halt", reason: "..." }      → stop the loop entirely
  },

  // Optional: supervisor function (can run anything)
  async supervisor(state: LoopState) {
    // Run pi with different options
    await runPi("Review the work...", { timeout: "3m", args: ["--model", "o3"] });

    // Or run a completely different command
    await runCommand(["bun", "agents/supervisor.ts"]);
  },
});
```

### LoopState

Your `decide()` function receives:

```typescript
interface LoopState {
  iteration: number;           // Current loop iteration (1-indexed)
  commitsSinceStart: number;   // Commits made this session
  hasUncommittedChanges: boolean;
  hasTodos: boolean;           // Any unchecked items in taskFile?
  nextTodo: string | null;     // Text of next unchecked todo
  taskFileContent: string;     // Full content of taskFile
  context: string | null;      // From --context/-c flag
  isFirstIteration: boolean;
}
```

### Timeout Format

```typescript
timeout: 300          // 300 seconds
timeout: "30s"        // 30 seconds
timeout: "5m"         // 5 minutes
timeout: "1h"         // 1 hour
```

### Exit Semantics

- **`{ type: "work" }`** — Do work, loop continues
- **`{ type: "generate" }`** — Generate tasks, then exit so user can review
- **`{ type: "halt" }`** — Stop entirely with a reason

### Built-in Behaviors

- **Auto-commit**: If agent forgets to commit, we commit for them
- **Resume detection**: Uncommitted changes trigger resume logic
- **Push every N commits**: Always on, configurable via `pushEvery`
- **Max iterations**: Safety limit (default 400) prevents runaway loops
- **Timeout protection**: Kills runaway agents
- **Task file auto-creation**: Created if missing

## Supervisor Pattern

The `supervisor` function runs every N commits and can do anything:

```typescript
runLoop({
  // ...
  supervisorEvery: 12,

  async supervisor(state) {
    // Option 1: Different prompt with different model
    await runPi("Review recent work...", {
      timeout: "3m",
      args: ["--model", "o3"],
    });

    // Option 2: Run a different script entirely
    await runCommand(["bun", "agents/code-review.ts"]);

    // Option 3: Any shell command
    await runCommand(["./scripts/run-tests.sh"]);
  },
});
```

See `agents/examples/ralph-with-supervisor.ts` for a full example.

## Agents

### 1. General Worker (`agents/ralph.ts`)

Works through `.ralph/TODO.md`. When empty, finds new work.

```bash
bun agents/ralph.ts              # Work through todos or find work
bun agents/ralph.ts -c "add X"   # Guide task generation with context
bun agents/ralph.ts --once       # Single iteration
bun agents/ralph.ts --dry-run    # Print prompt without running
```

### 2. Refactorer (`agents/refactor.ts`)

Focused on refactoring one file at a time from `.ralph/REFACTOR.md`.

```bash
bun agents/refactor.ts
bun agents/refactor.ts -c "focus on the API layer"
```

### 3. Cleanup (`agents/cleanup.ts`)

Goal-directed cleanup. **Requires** `--context` to generate new tasks.

```bash
bun agents/cleanup.ts -c "remove all console.logs"
bun agents/cleanup.ts -c "standardize error handling"
```

## Creating New Agents

1. Import from `core.ts`
2. Define your prompts
3. Call `runLoop()` with your config

```typescript
#!/usr/bin/env bun
import { runLoop, withResume, type LoopState } from "./core";

const PROMPT_WORK = `...`;
const PROMPT_GENERATE = (ctx: string) => `...`;

runLoop({
  name: "my-agent",
  taskFile: ".ralph/MY_TASKS.md",
  timeout: "5m",
  pushEvery: 4,

  decide(state: LoopState) {
    if (state.hasTodos) {
      return { type: "work", prompt: withResume(PROMPT_WORK, state.hasUncommittedChanges) };
    }
    if (!state.context) {
      return { type: "halt", reason: "Need --context to generate tasks" };
    }
    return { type: "generate", prompt: PROMPT_GENERATE(state.context) };
  },
});
```

## Exported Helpers

```typescript
import {
  runLoop,          // Main loop runner
  runPi,            // Run pi with prompt + options
  runCommand,       // Run any command
  withResume,       // Append resume instructions if uncommitted changes
  RESUME_SUFFIX,    // Raw resume text
  withTaskFile,     // Build prompt with task file context
  CONTINUE,         // Exit code 0
  HALT,             // Exit code 1
} from "./core";
```
