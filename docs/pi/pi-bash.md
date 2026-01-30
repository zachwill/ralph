# Pi utilization playbook (for a Bash “coding agent” wrapper)

This is a self-contained operational guide for using **`pi`** effectively (mostly **non-interactively**, from **Bash scripts**) with controlled auth, tool access, and Markdown outputs.

---

## 1) Mental model: what `pi` is doing

- `pi` runs an LLM “agent session” with:
  - a **model** (provider + model id),
  - a **system prompt** (base prompt + optional appended instructions),
  - a **toolset** (read/bash/edit/write/etc.),
  - optional **extensions** that can intercept events, add tools/commands, enforce safety, add UI widgets, etc.
- The agent’s *power* comes from tools:
  - **read**: inspect files
  - **bash**: run shell commands (including discovery like `ls`, `find`, `rg`)
  - **edit/write**: modify files
  - questionnaire/question: ask user interactively (not usable in pure non-interactive pipelines)

For automation, you want:
- **stateless runs** (`--no-session`)
- **machine-readable output** (`--mode json`)
- **strict tool allowlists** (`--tools ...`)
- **predictable Markdown-only final output** (prompting)

---

## 2) Where `pi` reads configuration from (practical)

By default, `pi` discovers config/resources from two places:

### Global agent dir (default)
- `~/.pi/agent/auth.json` (API keys / OAuth credentials)
- `~/.pi/agent/models.json` (custom models)
- `~/.pi/agent/settings.json` (settings like extensions, compaction, etc.)
- `~/.pi/agent/extensions/` (extensions)
- `~/.pi/agent/skills/` (skill prompt snippets)
- `~/.pi/agent/prompts/` (prompt templates)
- `~/.pi/agent/agents/` (subagents, if using that pattern)

### Project-local overrides
- `<repo>/.pi/...` (extensions, prompts, agents, presets, sandbox config, etc.)
- `AGENTS.md` files discovered up the directory tree (context files)

**Key operational takeaway:** your current working directory (`cwd`) matters for discovery. Your `$HOME` matters for global config.

---

## 3) Running `pi` non-interactively (the reliable pattern)

The subagent example shows a working, parseable invocation:

- `--mode json` : emits **JSON-lines events**
- `-p` : take the prompt from CLI args (no interactive editor)
- `--no-session` : do not create/restore session files
- `--model ...` : choose model
- `--tools ...` : restrict tool access
- `--append-system-prompt <file.md>` : append instructions to system prompt

### Canonical CLI skeleton

```bash
pi --mode json -p --no-session \
  --model "anthropic/claude-sonnet-4-5" \
  --tools "read,bash" \
  --append-system-prompt "/path/to/instructions.md" \
  "Your task prompt here"
```

Notes:
- In examples, `--model` is passed a single string. In practice it may accept `provider/model` or a model id depending on your setup. Prefer `provider/model` if your install supports it.
- `--tools` is a comma-separated list.

---

## 4) Using a custom auth file from Bash (without modifying pi)

You said your agents “should read from custom auth file”. The cleanest **Bash-only** trick is:

### Strategy A: Override `HOME` for the `pi` process

Because default auth storage is `~/.pi/agent/auth.json`, you can run `pi` with a temporary HOME that contains your desired auth file:

```bash
tmp_home="$(mktemp -d)"
mkdir -p "$tmp_home/.pi/agent"
cp "/path/to/custom-auth.json" "$tmp_home/.pi/agent/auth.json"

HOME="$tmp_home" pi ...   # pi will read auth.json from this HOME

rm -rf "$tmp_home"
```

**This is the simplest reliable approach** if you want per-run auth isolation.

### Strategy B: Use the SDK (only if CLI can’t be bent enough)

The SDK supports `AuthStorage("/custom/path/auth.json")`, but that requires a Node entrypoint. If you truly need that, you can still keep a “self-contained Bash script” by embedding a Node snippet, but Strategy A is usually enough.

---

## 5) Parsing JSON mode output (turn it into Markdown)

In JSON mode, `pi` emits newline-delimited JSON events. The subagent extension consumes:
- `message_end` events that include a full `message`
- `tool_result_end` events that include tool results

### Extract the *final assistant text* (robust enough for automation)

Recommended approach: capture JSONL to a temp file, then parse.

```bash
jsonl="$(mktemp)"
pi --mode json -p --no-session ... "prompt" >"$jsonl"

# Get the last assistant message_end text blocks, concatenated
final_markdown="$(
  jq -s -r '
    [ .[] | select(.type=="message_end" and .message.role=="assistant") | .message ][-1]
    | .content
    | map(select(.type=="text") | .text)
    | join("\n")
  ' "$jsonl"
)"

printf "%s
" "$final_markdown"
rm -f "$jsonl"
```

### Detect errors / aborts

Also pull stop reason and error message:

```bash
jq -s -r '
  [ .[] | select(.type=="message_end" and .message.role=="assistant") | .message ][-1]
  | { stopReason, errorMessage, usage }
' "$jsonl"
```

Treat these as failures:
- `stopReason == "error"` or `"aborted"`
- missing final assistant message
- process exit code non-zero

---

## 6) A battle-tested Bash “agent script” template

This template:
- uses a custom auth file via HOME override
- restricts tools
- forces Markdown output
- writes to an output file (or stdout)

```bash
#!/usr/bin/env bash
set -euo pipefail

AUTH_FILE="${AUTH_FILE:-./auth.json}"          # your custom auth
CWD="${CWD:-$PWD}"
OUT_FILE="${OUT_FILE:-}"                      # if empty -> stdout
MODEL="${MODEL:-anthropic/claude-sonnet-4-5}"
TOOLS="${TOOLS:-read,bash}"                 # add edit/write if you want modifications

TASK="${1:-}"
if [[ -z "$TASK" ]]; then
  echo "Usage: $0 '<task prompt>'" >&2
  exit 2
fi

tmp_home="$(mktemp -d)"
jsonl="$(mktemp)"
sys="$(mktemp)"

cleanup() { rm -rf "$tmp_home" "$jsonl" "$sys"; }
trap cleanup EXIT

mkdir -p "$tmp_home/.pi/agent"
cp "$AUTH_FILE" "$tmp_home/.pi/agent/auth.json"

cat >"$sys" <<'MD'
You are running in non-interactive automation mode.

Hard requirements:
- Use available tools when helpful, but keep tool output summaries short.
- Produce a final answer in pure Markdown.
- The final Markdown must be self-contained and include:
  - Summary
  - Key findings (bullet list)
  - Evidence (commands run + relevant snippets)
  - Files inspected
  - Recommendations / next steps

Do NOT include any preamble outside Markdown.
MD

HOME="$tmp_home" \
  (cd "$CWD" && \
    pi --mode json -p --no-session \
      --model "$MODEL" \
      --tools "$TOOLS" \
      --append-system-prompt "$sys" \
      "$TASK") >"$jsonl"

final_md="$(
  jq -s -r '
    [ .[] | select(.type=="message_end" and .message.role=="assistant") | .message ][-1]
    | .content
    | map(select(.type=="text") | .text)
    | join("\n")
  ' "$jsonl"
)"

if [[ -z "${final_md// }" ]]; then
  echo "ERROR: empty assistant output" >&2
  jq -s '.[-1]' "$jsonl" >&2 || true
  exit 1
fi

if [[ -n "$OUT_FILE" ]]; then
  printf "%s
" "$final_md" >"$OUT_FILE"
else
  printf "%s
" "$final_md"
fi
```

---

## 7) Tool discipline for good automation results

Even without custom extensions, you can get “elite” reliability by forcing the agent into a consistent tool workflow:

### Recommended tool sets
- Read-only analysis:
  - `read,bash`
- Implementation:
  - `read,bash,edit,write`

### Prompt pattern that yields stable reports
In your task prompt, include:

- **Goal** (“produce a Markdown report about X”)
- **Scope** (“only inspect ./src and ./docs”)
- **Constraints**:
  - “Prefer `rg` discovery (via bash), then `read` the exact files.”
  - “Summarize tool outputs; don’t paste huge logs.”
  - “If output is too long, create a short summary and list commands to reproduce.”

---

## 8) Use extensions as *capabilities toggles* (optional, but powerful)

You said you’re not focused on creating extensions; still, you can *use* existing ones by running `pi -e /path/to/extension`.

High-leverage ones from the examples:

### Safety / containment
- **Sandboxed bash**: `examples/extensions/sandbox/index.ts`
  - Adds OS-level sandboxing for agent bash calls.
  - Supports config via:
    - `~/.pi/agent/sandbox.json`
    - `<repo>/.pi/sandbox.json`
  - Run:
    ```bash
    pi -e ./packages/coding-agent/examples/extensions/sandbox/index.ts ...
    ```
  - Disable via `--no-sandbox` (flag registered by that extension).

- **Permission gate** (confirm dangerous bash): `permission-gate.ts`
- **Protected paths** (block edit/write to .env/.git/node_modules): `protected-paths.ts`
- **Dirty repo guard** (don’t switch/fork with uncommitted changes): `dirty-repo-guard.ts`

### Workflow helpers
- **Plan mode** (`plan-mode/`): restrict tools to read-only exploration and enforce safe bash allowlist
- **Handoff** (`handoff.ts`): generate a fresh prompt for a new session instead of lossy compaction
- **Summarize** (`summarize.ts`): produce a structured conversation summary

### Externalization / orchestration
- **SSH tool delegation** (`ssh.ts`): run read/write/edit/bash on remote machine

For non-interactive scripts, extensions that depend on UI prompts are less useful unless they default to “block” safely (many do).

---

## 9) Subagents without building anything fancy

You can spawn multiple isolated `pi` runs exactly like the subagent tool does:

- Use `--mode json -p --no-session`
- Optionally pass `--tools` and `--append-system-prompt`
- Run multiple processes in parallel (cap concurrency yourself)

This gives you:
- isolated context windows per subtask
- easy fan-out/fan-in in Bash

---

## 10) Practical “golden rules” for Bash-driven `pi`

1. **Always use `--no-session`** for deterministic one-shot agents (unless you explicitly want conversation state).
2. **Always restrict tools** (`--tools ...`) to avoid accidental edits.
3. **Use HOME override** to bind `pi` to a specific auth.json without touching the user’s real config.
4. **Capture JSONL** and parse the final assistant message deterministically.
5. **Force Markdown-only final output** via appended system prompt (file), not just in the task prompt.
6. **Keep tool outputs small**: tell the agent to summarize command results and only quote the relevant lines.
7. **Treat non-`stop` stopReasons as failure** and surface `errorMessage`.

---

If you tell me which providers/models you actually use (Anthropic/OpenAI/GitLab Duo/etc.) and whether your `--model` expects `provider/model` or just `model-id`, I can refine the template to your exact CLI behavior and add a strict error/usage accounting block (tokens + cost) in the generated Markdown.
