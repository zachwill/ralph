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

## Different Model for Planning

```typescript
return generate(`...`, { 
  model: "claude-opus-4-5",
  timeout: "10m" 
});
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
        model: "claude-opus-4-5" 
      });
    },
  },

  run(state) {
    // ...
  },
});
```

Or use the simple helper:

```typescript
import { loop, supervisor } from "./core";

loop({
  supervisor: supervisor(`Review work...`, { 
    every: 12, 
    model: "claude-opus-4-5" 
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
