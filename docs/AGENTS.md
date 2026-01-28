## Mental model for pi

pi is an event-driven “agent session runner” that sits in the middle of four things:

1. **A model** (provider + model id + thinking level)
2. **A session log** (persistent, branchable conversation + tool results + custom entries)
3. **A tool runtime** (read/write/edit/bash/grep/find/ls + extension tools)
4. **An extension/runtime + resources layer** (hooks that can modify or block behavior, plus loaded prompts/skills/context)

Think of it less like “a chatbot” and more like a state machine that repeatedly:

**builds context → asks model → executes tools → records everything → repeats.**

---

## The core loop (one “turn”)

A single user prompt roughly flows like:

1. **Input ingestion**
   - User types text (and maybe images).
   - Extensions get an input event first and can:
     - transform the input (`?quick ...`)
     - fully handle it without an LLM (like `ping`)
     - pass it through unchanged

2. **Context assembly**
   - pi assembles:
     - system prompt (base + appended instructions + `AGENTS.md` context + skill snippets + templates)
     - conversation messages from the current session branch
     - active tool list (not necessarily all registered tools)
   - Extensions can intercept:
     - `before_agent_start` (modify system prompt, inject hidden context messages, etc.)
     - `context` (filter/modify messages before they go to the model)

3. **Model execution (streaming)**
   - The model streams out:
     - text deltas
     - (optional) thinking deltas
     - tool call start/deltas
     - done/error

4. **Tool calls**
   - When the model wants to use a tool, pi emits `tool_call`.
   - Extensions can:
     - block the call (permission gates, plan-mode, protected paths)
     - swap in different bash “operations” (remote SSH, sandboxed exec, audited reads)
   - Tool runs, streams progress updates (`onUpdate`), then returns a result.
   - pi records the tool result into the session and emits `tool_result`.

5. **Turn completion**
   - `turn_end` fires.
   - Session state now includes the assistant response + tool traces, which can later be compacted, forked, replayed, or used to reconstruct extension state.

That same machinery powers both interactive TUI usage and automation runs.

---

## “Sessions” are the backbone (not the model)

A pi session is effectively a journal / event log:

- user messages
- assistant messages
- tool calls + results
- custom entries appended by extensions

Because it’s a log, pi can provide:

- forking / branching at any entry (alternate futures)
- tree navigation (often with labels/bookmarks)
- compaction (summarize old context to fit token budgets)

A key design pattern in pi is: **“state lives in the session”**:

- If an extension needs durable state, it should append custom entries and reconstruct state by scanning the current branch.
- This makes state automatically branch-correct (forks carry the right derived state).

---

## Tools are “capabilities” and “risk surface”

Tools are what make pi an agent rather than a chat interface. The important concept is:

- Tools are **registered** (available to pi),
- but only some are **active** (exposed to the model right now).

Most practical workflows are built around dynamically changing the active toolset:

- read-only exploration: `read`, `bash`, `grep`, `find`, `ls`
- implementation: add `edit`, `write`
- heavy safety: keep `bash` but enforce allowlists / sandbox / confirmations

Also: user `!bash` commands and model bash tool calls are distinct flows (`user_bash` vs `tool_call`), which enables different safety policies.

---

## Extensions are “middleware for everything”

Extensions are best understood as middleware + plugins:

- They hook named lifecycle events (`session_start`, `before_agent_start`, `tool_call`, `context`, etc.).
- They can register:
  - tools
  - commands (`/preset`, `/plan`)
  - shortcuts
  - message renderers
  - CLI flags
  - even providers/models (custom providers)

So “pi the product” is more like: **a minimal agent kernel + a set of composable behaviors you can enable/disable.**

Many “features” are actually extensions:

- plan mode + progress tracking
- presets (mode switching of model/tools/thinking + prompt additions)
- permission gates / protected paths / dirty repo guard
- git checkpointing
- SSH remote execution
- interactive-shell interception
- compaction triggers / custom compaction / handoff session creation
- UI widgets/status lines/notifications

---

## Resource discovery: pi builds its personality from files

pi’s behavior is partly “code” (extensions) and partly “loaded text configuration” (resources). It discovers resources from:

- global agent dir: `~/.pi/agent/...`
- project-local: `<cwd>/.pi/...`
- contextual repo guidance: `AGENTS.md` discovered walking up from cwd

So **cwd matters**: it determines what skills/prompts/extensions/context get loaded.

---

## Two ways to use pi: interactive vs automation

### Interactive (TUI)

- You get UI dialogs, overlays, widgets, status bars.
- Extensions can add UI affordances and shortcuts.
- Great for long sessions, branching, checkpoints, and human-in-the-loop approvals.

### Non-interactive / “subagent” style

- Run as a subprocess with:
  - `--mode json` (JSONL event stream)
  - `-p` (prompt from CLI args)
  - `--no-session` (stateless, deterministic)
  - `--tools ...` (strict allowlist)
- You parse the final assistant message from JSONL (plus tool traces).
- This is how you parallelize work and create “agents” without embedding SDK code.

---

## Models: runtime-switchable + “thinking level” is a control knob

pi treats “model selection” and “thinking level” as part of session runtime state:

- You can switch models (model registry + auth storage + providers).
- You can adjust reasoning intensity (off..xhigh) as a phase tool:
  - plan with high thinking + read-only tools
  - implement with medium thinking + write tools
  - mechanical edits with thinking off

Presets formalize this into repeatable “modes of work”.

---

## What I’d say pi is, in one sentence

pi is an event-driven agent kernel that runs a persisted, branchable session log, builds prompts from discoverable resources, delegates work through an active toolset, and lets you reshape the whole lifecycle via extensions—usable both as an interactive TUI and as a non-interactive JSON-emitting subprocess.
