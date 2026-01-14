# Ralph

Autonomous coding loops powered by `pi`.

## Quick Start

```bash
bun agents/ralph.ts                    # Work through todos
bun agents/ralph.ts -c "Add tests"     # Guide task generation
bun agents/ralph.ts --once             # Single iteration
bun agents/ralph.ts --dry-run          # Preview prompt
```

## Writing a Loop

```typescript
#!/usr/bin/env bun
import { loop, work, generate, halt } from "./core";

loop({
  name: "my-loop",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",

  run(state) {
    if (state.hasTodos) {
      return work(`
        - Look at .ralph/TODO.md
        - Do the next task
        - Check it off and commit
        - Exit
      `);
    }

    return generate(`
      - Add useful tasks to .ralph/TODO.md
      - Commit and exit
    `);
  },
});
```

That's it. The framework handles:
- Resume logic (uncommitted changes)
- Auto-commit if agent forgets
- Push every 4 commits
- Max 400 iterations safety limit
- Timeout protection

## Actions

| Action | What it does |
|--------|--------------|
| `work(prompt)` | Do work, continue looping |
| `generate(prompt)` | Generate tasks, exit for review |
| `halt(reason)` | Stop immediately |

## State

```typescript
state.hasTodos        // boolean
state.nextTodo        // string | null
state.todos           // string[]
state.context         // from --context/-c
state.iteration       // current loop iteration
state.commits         // commits this session
```

## RunOptions

Pass options to `work()`, `generate()`, or `supervisor()`:

```typescript
interface RunOptions {
  model?: string;      // Single model (e.g., "gpt-4o-mini")
  provider?: string;   // Provider (e.g., "openai", "anthropic")
  models?: string;     // Limit model cycling (e.g., "sonnet:high,haiku:low")
  thinking?: "low" | "medium" | "high";  // Starting thinking level
  tools?: string;      // Restrict tools (e.g., "read,grep,find,ls")
  timeout?: number | string;  // Per-run timeout
}
```

Examples:

```typescript
// Different model for planning
return generate(`...`, { 
  model: "claude-opus-4-5",
  thinking: "high",
  timeout: "10m" 
});

// Limit model cycling
return work(`...`, { models: "claude-sonnet,gpt-4o" });

// Read-only mode
return generate(`Review code...`, { tools: "read,grep,find,ls" });
```

## Supervisor

Run a check every N commits:

```typescript
import { loop, work, generate, runPi } from "./core";

loop({
  name: "supervised",
  taskFile: ".ralph/TODO.md",
  timeout: "5m",

  supervisor: {
    every: 12,
    async run(state) {
      await runPi(`Review recent commits...`, { 
        model: "claude-opus-4-5",
        thinking: "high"
      });
    },
  },

  run(state) {
    // ...
  },
});
```

Or use the simple helper (accepts all RunOptions):

```typescript
import { loop, supervisor } from "./core";

loop({
  // Full options
  supervisor: supervisor(`Review work...`, { 
    every: 12, 
    model: "claude-opus-4-5",
    thinking: "high"
  }),

  // Or read-only supervisor
  supervisor: supervisor(`Audit code...`, { 
    every: 6, 
    tools: "read,grep,find,ls"
  }),

  // ...
});
```

## Included Agents

| Agent | Task File | Behavior |
|-------|-----------|----------|
| `ralph.ts` | `.ralph/TODO.md` | General worker |
| `refactor.ts` | `.ralph/REFACTOR.md` | One file at a time |
| `cleanup.ts` | `.ralph/CLEANUP.md` | Requires `--context` |

## Requirements

- `pi` in PATH
- Git repository
- Bun runtime
