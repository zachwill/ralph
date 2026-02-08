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

## Directory-Based Tasks (taskDir)

Instead of a single markdown file with checkboxes, you can use a **directory** where each task is a separate numbered `.md` file. This is ideal for spec-based workflows where one model researches and writes detailed specs, and another model implements them.

```typescript
loop({
  name: "my-loop",
  taskDir: ".ralph/SPECS",   // use taskDir instead of taskFile
  timeout: "10m",

  run(state) {
    if (state.hasTodos) {
      // state.nextTodo = full file content
      // state.nextTodoFile = path to the file (e.g., ".ralph/SPECS/001-add-auth.md")
      // state.todos = list of available filenames
      return work(`Implement this spec:\n${state.nextTodo}`);
    }
    return generate(`Create numbered spec files in .ralph/SPECS/`);
  },
});
```

### How it works

1. **Generate** creates numbered files: `001-description.md`, `002-description.md`, etc.
2. **Work** picks the next available (non-WIP) file
3. The framework marks the file `<!-- WIP -->` while it's being worked on
4. The framework **removes the file** when work is complete (git history preserves it)

### WIP safety

When multiple loops run concurrently against the same `taskDir`, the `<!-- WIP -->` tag at the top of a file prevents other loops from picking it up. Only non-WIP files are shown in `state.todos`.

### State in directory mode

| Field | File mode | Directory mode |
|-------|-----------|----------------|
| `hasTodos` | Has unchecked checkboxes | Has available (non-WIP) files |
| `nextTodo` | Checkbox text | Full file content |
| `nextTodoFile` | `null` | Path to next file |
| `todos` | Checkbox texts | Available filenames |

Example:
- `agents/examples/ralph-with-specs.ts`

## Included Agents

| Agent | Task File | Behavior |
|-------|-----------|----------|
| `ralph.ts` | `.ralph/TODO.md` | General worker |
| `refactor.ts` | `.ralph/REFACTOR.md` | One file at a time |
| `cleanup.ts` | `.ralph/CLEANUP.md` | Requires `--context` |

## Requirements

- Git repository
- Bun runtime
- pi auth configured (e.g. `~/.pi/agent/auth.json` or provider API key env vars)
