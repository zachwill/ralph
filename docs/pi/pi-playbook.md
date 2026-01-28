# Pi (pi-coding-agent) — Utilization Playbook (for an AI coding agent)

This is a self-contained “how to use pi effectively” guide distilled from the examples. It focuses on operational patterns, workflows, and configuration—*not* on writing new extensions. When a capability is provided by an example extension, treat it as a **ready-to-enable module** you can run with `pi -e <path>` or copy into `~/.pi/agent/extensions/` / `<repo>/.pi/extensions/`.

---

## 0) Mental model: what pi actually is

**pi = a stateful coding session runner** with:
- A **model registry** (providers/models + auth via API keys or OAuth).
- A **tool runtime** (read, write, edit, bash, grep/find/ls, etc.).
- A **session log** (messages + tool results + custom entries) that supports:
  - **branching/forking** at any past entry
  - **tree navigation** and labels/bookmarks
  - **compaction** (summarize old context when token budget grows)
- An optional **TUI** that supports **custom UI components**, overlays, widgets, dialogs, and editor integration.

Key leverage point: **everything important is an “event”** (input, tool_call, before_agent_start, turn_start/end, session_start/switch/fork/compact/shutdown, model_select, etc.). You can “use” those behaviors by enabling existing extensions that hook them.

---

## 1) Core operating modes (how to run pi)

### Interactive (normal)
Use this for real work: tools, UI dialogs, model switching, session tree.

### Non-interactive / automation / subagent mode
pi can run as a subprocess and emit structured events (JSON). The subagent example runs:

- `pi --mode json -p --no-session "Task: ..."`

Use this pattern when you want:
- **isolated context windows**
- deterministic capture of tool calls + results + final outputs
- parallel execution across multiple pi processes

---

## 2) Model & auth: pick models, login, switch providers

### Choosing models
- `/model` exists (example mentions selecting models after loading a provider extension).
- Model changes fire `model_select` (model-status extension shows it can be surfaced in UI).

### Auth patterns you should assume
- **API key via env var** (e.g. `CUSTOM_ANTHROPIC_API_KEY=... pi -e ...`)
- **OAuth via `/login <provider>`** (seen for anthropic OAuth, gitlab-duo, google-antigravity)

### Practical usage pattern
1. Start pi with provider extension(s) enabled:
   - `pi -e ./packages/coding-agent/examples/extensions/custom-provider-gitlab-duo`
2. Run `/login gitlab-duo` (or set `GITLAB_TOKEN=...`)
3. Run `/model` and select the desired model ID
4. Use thinking controls (see below)

**Operational takeaway:** pi treats “provider/model/auth” as runtime-switchable session state. Prefer switching models for phases (plan vs implement) rather than “one model forever”.

---

## 3) Thinking / reasoning controls (how to spend compute deliberately)

Many models in examples support `reasoning: true`. pi supports a “thinking level” concept:
- typical levels: `off | minimal | low | medium | high | xhigh` (preset example shows these)
- some providers implement “thinking budgets” under the hood

**Best practice:**
- Use **low/medium** for routine edits, refactors, quick Q&A.
- Use **high** only for:
  - multi-file architectural work
  - subtle bug hunts
  - concurrency / correctness / security-sensitive changes
- Use **off** for mechanical tasks (formatting, simple renames) to reduce latency/cost.

You can operationalize this via:
- **presets** (recommended; see §6)
- or explicit model/session config if embedding via SDK

---

## 4) Tools: treat tool access as a safety & workflow dial

### The important distinction
- **User shell commands** (`!...`) are “user_bash” flow.
- **Agent tool calls** (`bash` tool etc.) are “tool_call” flow.

You can gate them differently.

### Critical patterns from examples
1. **Tool allowlisting / read-only mode**  
   - Plan-mode extension restricts tools to read-only subset + allowlisted bash commands.
2. **Danger confirmation on tool calls**  
   - permission-gate extension prompts for confirmation for dangerous bash patterns.
3. **Path protection**  
   - protected-paths blocks write/edit to `.env`, `.git/`, `node_modules/`.
4. **Tool override for auditing**  
   - tool-override replaces built-in `read` with audited/blocked reads.

**Operational takeaway:** You can run pi with “sharp knives” *or* with guardrails, depending on task. Default to guardrails in unfamiliar repos.

---

## 5) Sessions, branching, and “state lives in the session log”

### Sessions are first-class
- You can create, resume, and fork sessions.
- The session history is stored as entries; extensions can append custom entries that naturally branch.

### High-leverage tactics
1. **Bookmark important moments**
   - bookmark extension uses labels so `/tree` becomes navigable.
2. **Name sessions**
   - session-name extension makes the session selector more usable.
3. **Protect session transitions**
   - confirm-destructive / dirty-repo-guard prevent losing work when switching/forking.
4. **Checkpoint code state per turn**
   - git-checkpoint stashes at each turn so when you fork you can restore the repo to that point.

**Operational takeaway:** For non-trivial work, treat every turn as a potential “restore point” and make forks cheap. This is how you safely explore alternatives.

---

## 6) Workflow presets (fast switching between “modes of work”)

The preset extension is a “mode switcher” that can set:
- provider + model
- thinking level
- active tools
- extra system prompt instructions

Config lives in:
- `~/.pi/agent/presets.json`
- `<repo>/.pi/presets.json` (overrides global)

Activation:
- CLI: `pi --preset plan`
- Command: `/preset` or `/preset implement`
- Shortcut: `Ctrl+Shift+U` cycles presets

**Operational default you should adopt:**
- **plan preset**: read/grep/find/ls + high thinking + strict “no edits”
- **implement preset**: read/bash/edit/write + medium/high thinking + tight scope rules

This gives you *repeatable phase boundaries* and prevents “accidental editing while still uncertain.”

---

## 7) Plan → execute loop with progress tracking (extremely effective)

Plan-mode extension implements a complete workflow:
- `/plan` toggles plan mode (read-only exploration).
- It extracts numbered steps under `Plan:` and tracks completion via `[DONE:n]` tags.
- It shows progress in the footer + a widget list during execution.

**Operational algorithm (use this verbatim):**
1. Enable plan mode (`/plan`).
2. Explore repo safely (read/grep/find/ls; bash is allowlisted).
3. Produce:
   - `Plan:` header
   - numbered steps
4. When prompted, choose **Execute the plan**.
5. During execution, after finishing step *n*, include `[DONE:n]` in your response.
6. Let the UI widget keep you honest about remaining steps.

**Why this matters:** it enforces separation of discovery vs mutation and prevents thrash.

---

## 8) Input acceleration: turn your prompt into a “smart prompt”

Two high-value patterns:

### Inline bash expansion in prompts
Inline-bash extension lets user write:
- `What's in !{pwd}?`
- `Status: !{git status --short}`

It expands before sending to the model. Use this to:
- embed “ground truth” into the prompt
- reduce back-and-forth tool calls
- speed up diagnosis (“here’s the output already”)

### Input transforms / lightweight commands
Input-transform extension shows:
- `?quick <q>` → transforms prompt to force brief answer
- `ping` or `time` → handled instantly without a model

**Operational takeaway:** Normalize recurring prompt patterns into transforms to reduce cognitive load and increase consistency.

---

## 9) Human-in-the-loop questioning: ask better questions, faster

Use structured questioning when requirements are ambiguous.

### Single question with options
- `question` tool shows options + “Type something.”

### Multi-question questionnaire
- `questionnaire` tool supports tabbed multi-question flows and returns structured answers.

### Q&A extraction from last assistant message
- qna extension extracts questions from your last response and loads them into the editor for the user to fill.

**Operational takeaway:** If blocked on preferences/requirements, do *not* guess—use questionnaire to collect answers in one shot.

---

## 10) Compaction & handoff: managing long-running work

### Compaction (token pressure management)
- trigger-compact extension auto-compacts after a threshold (e.g., 100k tokens) or via `/trigger-compact`.
- custom-compaction demonstrates “summarize everything, keep only summary” behavior.
- Compaction should be treated as a controlled event: you can add custom instructions.

**Operational rule:** If context is huge and you’re about to do risky changes, compact first so the model stays coherent.

### Handoff (clean thread split without lossy compaction)
handoff extension:
- summarizes relevant context for a new goal
- opens a new session and drops a generated “starter prompt” into the editor

Use handoff when:
- the task shifts substantially (new feature, new subsystem)
- the current thread is polluted with exploration
- you want a clean context boundary but keep key decisions

---

## 11) Safety & containment: pick the right guardrails for the repo

### OS-level sandboxing for bash
sandbox extension:
- enforces filesystem/network restrictions at OS level
- config merged from:
  - `~/.pi/agent/sandbox.json`
  - `<repo>/.pi/sandbox.json`

Use sandboxing when:
- running in untrusted repos
- you need to prevent credential leaks (`~/.ssh`, `~/.aws`, etc.)
- you want to restrict network egress

### Guardrails you should enable by default in “unknown” projects
- `sandbox` (OS-level)
- `permission-gate` (dangerous bash confirm)
- `protected-paths` (.env/.git/node_modules write protection)
- `dirty-repo-guard` (stop switching/forking with dirty git status)

---

## 12) Delegation via subagents (multi-process, isolated context)

subagent tool runs other pi processes as “agents” defined in markdown frontmatter:
- User agents: `~/.pi/agent/agents/*.md`
- Project agents: `<repo>/.pi/agents/*.md` (must be trusted; tool can prompt)

Modes:
- **single**: one agent does one task
- **parallel**: multiple tasks, concurrency-limited
- **chain**: sequential steps with `{previous}` placeholder to pass output forward

**Operational patterns:**
- Parallelize independent investigations (e.g., “search for usage”, “check tests”, “scan config”).
- Chain when you want staged refinement: gather facts → propose plan → produce patch notes.

**Trust rule:** Project-local agents are repo-controlled; always require confirmation unless the repo is trusted.

---

## 13) Remote work and interactive commands (two separate needs)

### Remote repo operations via SSH
ssh extension reroutes:
- read/write/edit/bash tools to a remote machine when `--ssh user@host[:/path]` is provided.

Use this when:
- the codebase is only on a remote box
- you need remote-only dependencies or environment

### Running truly interactive commands (vim, htop, git rebase -i)
interactive-shell extension intercepts user `!` commands and suspends TUI so the terminal can be used normally.
- `!vim file`
- `!i <command>` to force interactive

**Operational takeaway:** Don’t try to run interactive programs via the agent bash tool; route them through user command interception.

---

## 14) UI leverage: status lines, widgets, overlays, notifications

If UI exists (interactive mode), you can improve usability with:
- **status bar signals** (status-line, model-status, sandbox status)
- **widgets** placed above/below editor (widget-placement)
- **custom renderers** for messages/tools to make outputs readable (message-renderer, truncated-tool)
- **desktop notifications** when agent finishes (notify)
- **overlays** for temporary panels or high-frequency rendering (overlay tests, DOOM demo)

**Operational takeaway:** UI instrumentation is not cosmetic—use it to surface “what matters now” (mode, plan progress, sandbox status, model, token/cost).

---

## 15) “State in the session” pattern (branch-safe memory)

The todo extension shows the canonical approach:
- store state in tool result details or custom entries
- reconstruct state by scanning the current branch entries

**Operational takeaway:** If you need durable state, prefer “session entries” over external files—branching automatically stays consistent.

---

## 16) Practical “golden setup” (recommended baseline)

For serious coding in unfamiliar repos, run pi with a guardrailed + structured workflow stack:

- plan workflow + progress: `plan-mode`
- safe execution containment: `sandbox`, `permission-gate`, `protected-paths`
- session hygiene: `dirty-repo-guard`, `confirm-destructive`, `git-checkpoint`
- workflow accelerators: `preset`, `tools` (tool selector), `handoff`, `inline-bash`
- delegation: `subagent`
- observability: `model-status`, `status-line`, `notify`

Then:
1. Start in **plan preset**
2. Build and confirm plan
3. Switch to **implement preset**
4. Execute with checkpoints + guardrails
5. If thread diverges, use **handoff**
6. If context bloats, **compact** (manual or auto-trigger)

---

## 17) Quick reference: “When X, do Y”

- Need to explore safely → **plan mode** (read-only + allowlisted bash)
- Need user decisions → **questionnaire** (multi-question, one shot)
- Need to prevent accidents → **sandbox + permission gate + protected paths**
- Need to switch tasks cleanly → **handoff**
- Need to keep long sessions coherent → **compaction** (or custom compaction)
- Need parallel research → **subagent parallel**
- Need reproducible work phases → **presets**
- Need to embed environment facts into prompt → **inline bash expansion**
- Need to restore earlier code state → **fork + git checkpoint restore**
- Need remote execution → **ssh mode**
- Need interactive editor/TUI apps → **interactive-shell interception**

---

If you want, tell me your default environment (trusted repos vs unknown, local vs remote, preferred model/provider), and I can propose a minimal “starter bundle” (exact extensions + configs) optimized for your risk tolerance and speed.
