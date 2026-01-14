# Agent Architectures

This project explores different patterns for autonomous coding loops.

## Loop Patterns

### 1. General Worker (`agents/ralph.ts`)
The most flexible pattern. It can both perform tasks and *identify* them. If `.ralph/TODO.md` is empty, it switches to "Find Work" mode to populate the task list.

### 2. Specialized Refactorer (`agents/refactor.ts`)
Focuses on a specific type of transformation. It uses a dedicated `.ralph/REFACTOR.md` to avoid interfering with general development tasks.

### 3. Goal-Directed Cleaner (`agents/cleanup.ts`)
General-purpose cleanup. Instead of hardcoding rules, it reads `.ralph/CLEANUP_CONTEXT.md` to understand the goal (e.g., "Refactor all context providers to use useReducer"). If `.ralph/CLEANUP.md` is empty, it populates it with tasks derived from the context and the codebase.

## Shared Infrastructure

All agents in this repository share common traits:
- **Resumability**: They detect uncommitted changes and prompt the LLM to finish what it started.
- **Timeout Protection**: Agents are killed if they run for too long to prevent infinite loops or excessive token usage.
- **Auto-Committing**: Ensures that progress is saved even if the LLM forgets to commit.
- **Remote Sync**: `ralph.ts` includes logic to periodically push changes to GitHub.
