# Agent Architectures

This project explores different patterns for autonomous coding loops.

## Loop Patterns

### 1. General Worker (`agents/ralph.ts`)
The most flexible pattern. It can both perform tasks and *identify* them. If `.ralph/TODO.md` is empty, it switches to "Find Work" mode to populate the task list.

- Supports `--context/-c` to guide "Find Work" mode (only used when TODO.md is empty).
- Supports `--dry-run` to print the exact would-run `pi` prompt with no side effects.

### 2. Specialized Refactorer (`agents/refactor.ts`)
Focused refactor loop driven by `.ralph/REFACTOR.md`. Unlike `ralph.ts`, it’s meant for steering: when the task list is empty, it can generate a new list (optionally guided by `--context/-c`) and then exits so you can review/edit.

- Supports `--context/-c` to guide task generation (only used when REFACTOR.md is empty).
- Supports `--dry-run` to print the exact would-run `pi` prompt with no side effects.

### 3. Goal-Directed Cleaner (`agents/cleanup.ts`)
Focused cleanup loop driven by `.ralph/CLEANUP.md`. When the task list is empty, it requires `--context/-c` to generate a fresh set of cleanup tasks, then exits so you can review/edit.

- Supports `--context/-c` to guide task generation (only used when CLEANUP.md is empty).
- Supports `--dry-run` to print the exact would-run `pi` prompt with no side effects.

## Shared Infrastructure

All agents in this repository share common traits:
- **Resumability**: They detect uncommitted changes and prompt the LLM to finish what it started.
- **Timeout Protection**: Agents are killed if they run for too long to prevent infinite loops or excessive token usage.
- **Auto-Committing**: Ensures that progress is saved even if the LLM forgets to commit.
- **Remote Sync**: `ralph.ts` includes logic to periodically push changes to GitHub.
