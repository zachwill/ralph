# Tasks

- [ ] Fix `push()` to push the current branch/upstream (not hard-coded `origin main`), and make failures clearly actionable
- [ ] Add `LoopConfig` option + CLI flag to disable pushing (e.g. `push: false` / `--no-push`)
- [ ] Make `ensureFile()` write default content when the task file exists but is empty (so new checkouts don’t start with a 0-byte `.ralph/*.md`)
- [ ] Treat non-zero exit codes from `pi`/`runCommand()` as errors (fail fast with a helpful message)
- [ ] Improve `--dry-run` output to print all RunOptions (provider/models/thinking/tools/timeout), not just `model`
- [ ] Add a way to set default RunOptions at the loop level (e.g. `defaults: RunOptions`) that are merged into `work()`/`generate()`/supervisor runs
- [ ] Add a test harness for `agents/core.ts` (mock `runPi`, mock git commands) and cover: todo parsing, ensureCommit, continuous-mode guard
- [ ] Add docs + example for read-only agents using `tools: "read,grep,find,ls"`
- [ ] Make `getUncheckedTodos()` more flexible (support leading indentation + ordered lists; ensure it ignores code blocks)
- [ ] Add support for multiple task sections in a single file (e.g. only read under `## Tasks`)
- [ ] Add a `--task`/`--task-file` CLI override so a loop can be pointed at a different backlog without editing code
- [ ] Add `LoopConfig.onIteration`/`onAction` hooks for logging/metrics (opt-in) without editing core loop code
- [ ] Add a GitHub Actions workflow to run formatting/typecheck/tests on PRs (Bun)
- [ ] Document common failure modes (no `pi` in PATH, no git remote, push rejected, etc.) and how to recover
- [ ] Add an example agent that uses `continuous: true` + a supervisor together (regenerate backlog + periodic review)
