# Ralph

Autonomous coding loops that leverage the `pi` tool to perform iterative development tasks.

## Overview

Ralph and its siblings are wrapper scripts around `pi` (the Pi Coding Agent) that automate the "read-code-write-commit" loop. They are designed to work against a `TODO.md` file, picking tasks, executing them, and committing changes automatically.

## The Agents

- **agents/ralph.ts**: The general-purpose worker. It looks for tasks in `.ralph/TODO.md` and keeps working until the list is empty.
- **agents/refactor.ts**: A specialized agent for large-scale refactors. It reads tasks from `.ralph/REFACTOR.md` and focuses on component extraction and JSX cleanup.
- **agents/cleanup.ts**: A task-oriented cleaner. It reads a high-level goal from `.ralph/CLEANUP_CONTEXT.md`, identifies specific tasks to populate `.ralph/CLEANUP.md`, and then executes them sequentially.

## How it Works

Each agent follows a similar execution pattern:

1. **Check for existing work**: If there are uncommitted changes, it resumes the previous task.
2. **Task Selection**: It reads the next unchecked item from its designated task file (e.g., `.ralph/TODO.md`).
3. **Agent Execution**: It spawns `pi` with a specific prompt and task description.
4. **Git Integration**: After `pi` finishes, the agent verifies if a commit was made. If changes exist but weren't committed, it auto-commits them.
5. **Iteration**: It loops back to step 1 until no tasks remain or it's manually stopped.

## Usage

```bash
# Start the general worker
./agents/ralph.ts

# Run a single iteration
./agents/ralph.ts --once

# Run the refactor loop
./agents/refactor.ts
```

## Requirements

- `pi` CLI tool installed in PATH.
- A git repository.
- `bun` runtime.
