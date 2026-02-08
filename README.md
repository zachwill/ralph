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
  continuous: false, // optional: don't exit just because the task file is done

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
- Optional continuous mode (don’t exit just because the task file is done)

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
  tools?: string;      // Restrict tools (e.g., "read" or "read,bash,edit,write")
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
return generate(`Review code...`, { tools: "read" });
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
    tools: "read"
  }),

  // ...
});
```

## Continuous mode

If you want a loop that keeps going even after it finishes the current todo list, set:

```ts
continuous: true
```

Behavior:
- When the last unchecked task is completed, the loop will *not* exit; your `run(state)` function can return `generate()` to create the next backlog.
- Guardrail: in `continuous` mode, if a `generate()` run produces **zero** unchecked todos, the loop exits with an error to avoid an infinite generate→generate spin.

Example:
- `agents/examples/ralph-continuous.ts`

## Included Agents

| Agent | Task File/Dir | Behavior |
|-------|---------------|----------|
| `ralph.ts` | `.ralph/TODO.md` | General worker |
| `refactor.ts` | `.ralph/REFACTOR.md` | One file at a time |
| `cleanup.ts` | `.ralph/CLEANUP.md` | Requires `--context` |
| `spec-worker.ts` | `.ralph/SPECS/` | Directory-based specs (see below) |

## Spec-Based Workflow (Directory Mode)

For multi-model workflows, use the spec-based system which stores tasks as individual files in a directory:

```bash
bun agents/spec-worker.ts              # Run the spec loop
bun agents/spec-worker.ts -c "Focus"   # Guide research
bun agents/spec-worker.ts --dry-run    # Preview prompt
```

### How it works

1. **Research Phase**: A research model (e.g., Opus) explores the codebase and creates numbered spec files (e.g., `001-add-validation.md`)
2. **Implementation Phase**: A worker model picks up the next available spec, marks it WIP, implements it, and deletes it when done
3. **Git History**: Deleted specs are preserved in git history

### Why use this?

- **Model handoff**: Use Opus for deep research, GPT-5.2 for implementation
- **"Copy/paste for future self"**: The framing that gets the best output from Opus
- **WIP markers**: Prevent multiple workers from grabbing the same spec
- **Clean directory**: No crossed-out tasks cluttering your view

### Writing a Spec Loop

```typescript
import { specLoop, research, implement, specHalt } from "./spec-core";

specLoop({
  name: "my-spec-loop",
  specDir: ".ralph/SPECS",
  timeout: "5m",

  run(state) {
    if (state.hasAvailableSpecs) {
      return implement(buildPrompt(state.nextSpec), {
        model: "gpt-5.2",
      });
    }

    return research(`Explore and create a spec...`, {
      model: "claude-opus-4-5",
      thinking: "high",
    });
  },
});
```

### Spec State

```typescript
state.specs              // All spec files
state.availableSpecs     // Non-WIP specs
state.hasAvailableSpecs  // boolean
state.nextSpec           // Next available spec file
state.specDir            // The spec directory path
```

### Spec File Format

Spec files should be named: `<number>-<description>.md` (e.g., `001-add-validation.md`)

When a spec is being worked on, it has a WIP marker at the top:

```markdown
<!-- WIP: IN PROGRESS -->
```

## Requirements

- Git repository
- Bun runtime
- pi auth configured (e.g. `~/.pi/agent/auth.json` or provider API key env vars)
