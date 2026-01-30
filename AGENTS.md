# Agent Architectures

This project provides a simple framework for autonomous coding loops.

## Core API

```typescript
import { loop, work, generate, halt, supervisor, runPi, runCommand } from "./core";
```

### loop()

The main function. Runs until done.

```typescript
loop({
  name: "my-loop",              // For logs
  taskFile: ".ralph/TODO.md",   // Task tracking
  timeout: "5m",                // Per-run timeout
  pushEvery: 4,                 // Push every N commits (default: 4)
  maxIterations: 400,           // Safety limit (default: 400)
  continuous: false,            // If true, never stop just because the task file is "done"
  supervisor: { ... },          // Optional

  run(state) {
    // Return work(), generate(), or halt()
  },
});
```

### Actions

```typescript
// Do work, continue looping
work(prompt, options?)

// Generate tasks, then exit for review
generate(prompt, options?)

// Stop the loop
halt(reason)
```

### RunOptions

All options are optional:

```typescript
interface RunOptions {
  model?: string;      // Single model (e.g., "gpt-4o-mini")
  provider?: string;   // Provider (e.g., "openai", "anthropic")
  models?: string;     // Limit model cycling (e.g., "sonnet:high,haiku:low")
  thinking?: "low" | "medium" | "high";  // Starting thinking level
  tools?: string;      // Restrict tools (e.g., "read" or "read,bash,edit,write")
  timeout?: number | string;  // Per-run timeout
}
```

Examples:

```typescript
// Use a specific provider + model
work(`...`, { provider: "openai", model: "gpt-4o" })

// Limit model cycling with thinking levels
work(`...`, { models: "sonnet:high,haiku:low" })

// Read-only mode (no file modifications)
generate(`Review the code...`, { tools: "read" })

// High thinking for complex tasks
work(`...`, { thinking: "high", timeout: "10m" })
```

### State

```typescript
interface State {
  iteration: number;
  commits: number;
  hasTodos: boolean;
  nextTodo: string | null;
  todos: string[];
  context: string | null;
  hasUncommittedChanges: boolean;
}
```

### Supervisor

Two ways to define a supervisor:

```typescript
// Full control
supervisor: {
  every: 12,
  async run(state) {
    await runPi(`...`, { model: "claude-opus-4-5", thinking: "high" });
    // or
    await runCommand(["bun", "scripts/review.ts"]);
  },
}

// Simple (just a prompt + RunOptions)
supervisor: supervisor(`Review work...`, { 
  every: 12, 
  model: "claude-opus-4-5",
  thinking: "high"
})

// Read-only supervisor (can't modify files)
supervisor: supervisor(`Audit the codebase...`, { 
  every: 6, 
  tools: "read"
})
```

### Helpers

```typescript
// Run pi with RunOptions
await runPi(prompt, { 
  model?: string,
  provider?: string,
  models?: string,
  thinking?: "low" | "medium" | "high",
  tools?: string,
  timeout?: string 
})

// Run any command
await runCommand(["bun", "script.ts"], { timeout?: string })
```

## Built-in Behaviors

## Dependency management

- Use **Bun** only (`bun install`, `bun add`, `bun remove`).
- Do **not** use `npm`, `yarn`, or `pnpm`.

1. **Resume** — Uncommitted changes? Framework appends resume instructions.
2. **Auto-commit** — Agent forgot to commit? We do it.
3. **Push every N** — Default 4 commits.
4. **Max iterations** — Default 400, prevents runaway loops.
5. **Timeout** — Kills stuck agents.
6. **Task file** — Auto-created if missing.
7. **Continuous mode** — If enabled, the loop won’t exit just because all tasks are complete. (Guard: if a generate step produces 0 unchecked todos, the loop exits to avoid an infinite generate→generate spin.)

## Timeout Format

```typescript
timeout: 300      // seconds
timeout: "30s"
timeout: "5m"
timeout: "1h"
```

## CLI Flags

All loops support:

| Flag | Description |
|------|-------------|
| `--once` | Single iteration |
| `--dry-run` | Print prompt, don't run |
| `-c, --context` | Context for task generation |

## Agents

### ralph.ts

General purpose. Works through `.ralph/TODO.md`. Finds work when empty.

```bash
bun agents/ralph.ts
bun agents/ralph.ts -c "Focus on tests"
```

### refactor.ts

Refactors one file at a time from `.ralph/REFACTOR.md`.

```bash
bun agents/refactor.ts
bun agents/refactor.ts -c "Clean up the API layer"
```

### cleanup.ts

Goal-directed cleanup. Requires `--context` to generate tasks.

```bash
bun agents/cleanup.ts -c "Remove TODO comments"
```

## Examples

See `agents/examples/` for:

- `ralph-with-planner.ts` — Different model for task generation
- `ralph-with-supervisor.ts` — Full supervisor with custom logic
- `ralph-with-simple-supervisor.ts` — Supervisor from just a prompt
- `ralph-continuous.ts` — Continuous mode (regenerate tasks and keep going)
