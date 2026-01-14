# Ralph

Autonomous coding loops powered by `pi` (the Pi Coding Agent).

## Quick Start

```bash
# Run the general worker
bun agents/ralph.ts

# Single iteration
bun agents/ralph.ts --once

# Preview prompt without running
bun agents/ralph.ts --dry-run

# Guide task generation
bun agents/ralph.ts -c "Add error handling to the API layer"
```

## The Agents

| Agent | Task File | Behavior |
|-------|-----------|----------|
| `ralph.ts` | `.ralph/TODO.md` | General worker. Finds work when empty. |
| `refactor.ts` | `.ralph/REFACTOR.md` | Refactors one file at a time. Exits after generating tasks for review. |
| `cleanup.ts` | `.ralph/CLEANUP.md` | Goal-directed cleanup. Requires `--context` to generate tasks. |

## How It Works

1. **Check state** — Resume if uncommitted changes exist
2. **Pick task** — Read next unchecked item from task file
3. **Run pi** — Execute with timeout protection
4. **Commit** — Auto-commit if agent forgets
5. **Push** — Every N commits (default: 4)
6. **Loop** — Until tasks complete or max iterations reached

## Building Your Own Agent

All agents use `runLoop()` from `core.ts`:

```typescript
#!/usr/bin/env bun
import { runLoop, runPi, withResume, type LoopState } from "./core";

const PROMPT_WORK = `
- Look at .ralph/TODO.md for the current task list
- Pick a task and do it
- Check off the item and commit
- Exit
`.trim();

runLoop({
  name: "my-agent",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",              // "30s", "5m", "1h", or number (seconds)
  pushEvery: 4,               // Push every N commits
  maxIterations: 400,         // Safety limit
  supervisorEvery: 12,        // Optional: run supervisor every N commits

  decide(state: LoopState) {
    if (state.hasTodos) {
      return { type: "work", prompt: withResume(PROMPT_WORK, state.hasUncommittedChanges) };
    }
    return { type: "halt", reason: "No tasks remain" };
  },

  // Optional: supervisor runs every N commits (can do anything)
  async supervisor(state) {
    await runPi("Review recent work...", { 
      timeout: "3m",
      args: ["--model", "claude-opus-4-5"] 
    });
  },
});
```

### Actions

Your `decide()` function returns one of:

```typescript
{ type: "work", prompt: "..." }      // Do work, continue loop
{ type: "generate", prompt: "..." }  // Generate tasks, exit for review
{ type: "halt", reason: "..." }      // Stop entirely
```

### State

```typescript
interface LoopState {
  iteration: number;
  commitsSinceStart: number;
  hasUncommittedChanges: boolean;
  hasTodos: boolean;
  nextTodo: string | null;
  taskFileContent: string;
  context: string | null;       // from --context/-c
  isFirstIteration: boolean;
}
```

## CLI Flags

All agents support:

| Flag | Description |
|------|-------------|
| `--once` | Run single iteration then exit |
| `--dry-run` | Print prompt without running |
| `-c, --context` | Context for task generation |

## Requirements

- `pi` in PATH
- Git repository
- Bun runtime

## Examples

```bash
# General work
bun agents/ralph.ts
bun agents/ralph.ts -c "Focus on test coverage"

# Refactoring
bun agents/refactor.ts
bun agents/refactor.ts -c "Clean up the data layer"

# Cleanup with specific goal
bun agents/cleanup.ts -c "Remove all TODO comments"
bun agents/cleanup.ts -c "Standardize error handling"

# Supervised agent (every 12 commits)
bun agents/examples/ralph-with-supervisor.ts
```

See `AGENTS.md` for detailed architecture docs.
