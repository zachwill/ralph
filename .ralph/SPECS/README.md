# Specs Directory

This directory contains spec files for the spec-based workflow system.

## How it works

1. **Research Phase**: A research model (e.g., Opus) explores the codebase and creates numbered spec files here (e.g., `001-add-validation.md`).

2. **Implementation Phase**: A worker model picks up the next available spec, marks it as WIP by prepending `<!-- WIP: IN PROGRESS -->`, implements it, and deletes the file when complete.

3. **Git History**: Deleted spec files are preserved in git history, so there's no need to keep crossed-out tasks.

## File Format

Spec files should be named: `<number>-<brief-description>.md`

Example: `001-add-validation.md`, `002-fix-auth-flow.md`

## WIP Marker

When a spec is being worked on, it will have this marker at the top:

```markdown
<!-- WIP: IN PROGRESS -->
```

This prevents multiple workers from picking up the same spec.
