# Running Multiple Agent Loops in Parallel

## The Problem

Each agent loop needs exclusive access to the git working directory. If you run two loops in the same checkout:

- Both edit files simultaneously
- Auto-commit logic conflicts
- `git status` becomes unpredictable
- Merges get messy

**One checkout = one agent loop.**

## The Solution: Multiple Checkouts

Use separate clones for each concurrent activity. This is simpler than git worktrees and avoids tooling headaches (node_modules, IDE support, diff viewers).

### Setup

```bash
# From your main checkout, create activity-specific clones
cd ~/code

# Shared clone (saves disk space — uses hardlinks to main repo's objects)
git clone --shared my-project my-project-ralph
git clone --shared my-project my-project-refactor
git clone --shared my-project my-project-cleanup

# Or reference clone (even safer — doesn't modify original)
git clone --reference my-project git@github.com:org/my-project.git my-project-feature
```

### Naming Convention

Name checkouts by their agent/activity:

```
my-project/           → main checkout (manual work, coordination)
my-project-ralph/     → runs ralph.ts (general work)
my-project-refactor/  → runs refactor.ts (file-by-file refactoring)
my-project-cleanup/   → runs cleanup.ts (goal-directed cleanup)
```

### Branch Strategy

Each checkout works on its own branch:

```bash
cd ~/code/my-project-ralph
git checkout -b ralph/feature-batch-1
bun agents/ralph.ts

# Meanwhile, in another terminal:
cd ~/code/my-project-refactor
git checkout -b refactor/api-cleanup
bun agents/refactor.ts
```

Merge back to main when a body of work is complete:

```bash
cd ~/code/my-project
git fetch origin
git merge origin/ralph/feature-batch-1
git merge origin/refactor/api-cleanup
```

## Quick Reference

| Task | Command |
|------|---------|
| Create new checkout | `git clone --shared . ../my-project-<agent>` |
| Start agent work | `cd ../my-project-<agent> && git checkout -b <branch> && bun agents/<agent>.ts` |
| Check what's running | `ls ~/code/my-project-*` |
| Merge finished work | `git fetch origin && git merge origin/<branch>` |
| Clean up checkout | `rm -rf ../my-project-<agent>` (objects stay in main repo) |

## Why Not Worktrees?

Git worktrees (`git worktree add`) seem ideal but have practical issues:

- **node_modules** — each worktree needs its own, or you get path resolution bugs
- **Tooling** — many editors/diff tools don't handle worktrees well
- **Forgetting** — easy to lose track of which worktrees exist (`git worktree list` helps, but still)
- **Switching UX** — promoting a worktree to "main" is awkward

Multiple checkouts are dumber but more predictable. The disk space cost is minimal with `--shared`.

## Tips

**Know where you are**: The task file (`.ralph/TODO.md`, `.ralph/REFACTOR.md`) tells you what agent owns this checkout. If you're ever confused, check which task file has content.

**One activity per checkout**: Don't run `ralph.ts` in the refactor checkout. Keep the mapping clean.

**Pull before starting**: Agent loops assume they're ahead of origin. Pull main before branching.

```bash
cd ~/code/my-project-ralph
git pull origin main
git checkout -b ralph/next-batch
bun agents/ralph.ts
```

**Disk space check**: With `--shared`, object storage is deduplicated. But if you're worried:

```bash
# See what's using space
du -sh ~/code/my-project-*
```
