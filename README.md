# Ralph

Autonomous coding loops that leverage the `pi` tool to perform iterative development tasks.

## Overview

Ralph and its siblings are wrapper scripts around `pi` (the Pi Coding Agent) that automate the "read-code-write-commit" loop. They are designed to work against a `TODO.md` file, picking tasks, executing them, and committing changes automatically.

## The Agents

- **agents/ralph.ts**: The general-purpose worker. It looks for tasks in `.ralph/TODO.md` and keeps working until the list is empty.
- **agents/refactor.ts**: A specialized refactor agent. It executes tasks from `.ralph/REFACTOR.md`. If the file has no actionable items, it can generate a fresh task list (optionally guided by `--context`) and then exits so you can review.
- **agents/cleanup.ts**: A specialized cleanup agent. It executes tasks from `.ralph/CLEANUP.md`. If the file has no actionable items, it can generate a fresh task list from `--context` and then exits so you can review.

## How it Works

Each agent follows a similar execution pattern:

1. **Check for existing work**: If there are uncommitted changes, it resumes the previous task.
2. **Task Selection**: It reads the next unchecked item from its designated task file (supports `- [ ]`, `* [ ]`, and `+ [ ]`).
3. **Agent Execution**: It spawns `pi` with a specific prompt and task description.
4. **Git Integration**: After `pi` finishes, the agent verifies if a commit was made. If changes exist but weren't committed, it auto-commits them.
5. **Iteration**: It loops back to step 1 until no tasks remain or it's manually stopped.

### Dry Run

All agents support `--dry-run`, which prints the exact prompt that would be sent to `pi` and exits without running `pi`, committing, or pushing.

## Usage

```bash
# Start the general worker
bun agents/ralph.ts

# Run a single iteration
bun agents/ralph.ts --once

# Preview what would be sent to pi (no side effects)
bun agents/ralph.ts --dry-run

# Guide TODO generation when TODO.md is empty
bun agents/ralph.ts --context "Tighten up the auth flow; focus on tests and types"

# Run the refactor loop
bun agents/refactor.ts

# Refactor: seed tasks when REFACTOR.md is empty
bun agents/refactor.ts --context "Refactor the API layer; smaller modules, clearer naming"

# Preview what refactor would be sent to pi
bun agents/refactor.ts --dry-run

# Run the cleanup loop
bun agents/cleanup.ts

# Cleanup: use inline context to generate tasks
bun agents/cleanup.ts --context "Remove legacy router paths; new URLs only"
```

## Requirements

- `pi` CLI tool installed in PATH.
- A git repository.
- `bun` runtime.
