# Configuration

## Authentication

Pi supports multiple authentication methods for API keys.

### Default Auth (from ~/.pi/agent/auth.json)

```typescript
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

const authStorage = new AuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
```

### Custom Auth File Location

```typescript
const authStorage = new AuthStorage("/custom/path/auth.json");
const modelRegistry = new ModelRegistry(authStorage, "/custom/path/models.json");
```

### Runtime API Key Override (not persisted)

```typescript
const authStorage = new AuthStorage();

// Override at runtime from env vars
if (process.env.ANTHROPIC_API_KEY) {
  authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY);
}
if (process.env.OPENAI_API_KEY) {
  authStorage.setRuntimeApiKey("openai", process.env.OPENAI_API_KEY);
}
```

### Auth File Format

`~/.pi/agent/auth.json`:
```json
{
  "anthropic": "sk-ant-...",
  "openai": "sk-...",
  "google": "..."
}
```

### Environment Variables

These environment variables are also supported:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`

---

## Model Selection

### Get Specific Model

```typescript
import { getModel } from "@mariozechner/pi-ai";

const opus = getModel("anthropic", "claude-opus-4-5");
const sonnet = getModel("anthropic", "claude-sonnet-4-5");
const gpt4 = getModel("openai", "gpt-4.1");
```

### Find Available Models

```typescript
const modelRegistry = new ModelRegistry(authStorage);
const available = await modelRegistry.getAvailable();

// Use first available
const { session } = await createAgentSession({
  model: available[0],
  authStorage,
  modelRegistry,
});
```

### With Thinking Level

```typescript
const { session } = await createAgentSession({
  model: getModel("anthropic", "claude-sonnet-4-5"),
  thinkingLevel: "medium",  // off, minimal, low, medium, high
});
```

### Thinking Level Guidelines

| Level | Use Case |
|-------|----------|
| `off` | Mechanical tasks (formatting, renames) |
| `minimal` | Simple edits, straightforward tasks |
| `low` | Routine edits, refactors |
| `medium` | Complex refactors, debugging |
| `high` | Multi-file architecture, subtle bugs, security analysis |

---

## Settings

### In-Memory Settings — Recommended for Scripts

```typescript
import { SettingsManager } from "@mariozechner/pi-coding-agent";

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000 },
});

const { session } = await createAgentSession({
  settingsManager,
  sessionManager: SessionManager.inMemory(),
});
```

### Load from Disk with Overrides

```typescript
const settingsManager = SettingsManager.create();
settingsManager.applyOverrides({
  compaction: { enabled: false },
});
```

### Available Settings

#### Compaction

Controls automatic conversation compaction to manage context window:

```typescript
{
  compaction: {
    enabled: boolean,
    // Additional compaction options...
  }
}
```

#### Retry

Controls automatic retry on transient failures:

```typescript
{
  retry: {
    enabled: boolean,
    maxRetries: number,
    baseDelayMs: number,
  }
}
```

---

## CLI Reference

While the SDK is the primary focus, pi can also run as a CLI.

### Interactive Mode

```bash
pi                           # Start in current directory
pi -e ./my-extension.ts      # With extension
pi --preset plan             # With preset
```

### Non-Interactive / Automation

```bash
pi --mode json -p --no-session "Task: analyze this repo"
```

Use this for:
- Isolated context windows
- Deterministic capture of tool calls + results
- Parallel execution across multiple pi processes

### Key Flags

| Flag | Description |
|------|-------------|
| `--mode json` | JSON output (for automation) |
| `-p` | Non-interactive (pipe mode) |
| `--no-session` | Don't persist session |
| `-e <path>` | Load extension |
| `--preset <name>` | Use preset configuration |
| `--model <id>` | Select model |
| `--tools <list>` | Comma-separated tool list |

### Examples

```bash
# Run a one-off task
pi -p --no-session "List all TypeScript files in this project"

# JSON output for scripting
pi --mode json -p --no-session "Analyze package.json" | jq '.messages'

# With specific model
pi --model claude-sonnet-4-5 -p "Review this code"

# With extension
pi -e ./tools/my-custom-tool.ts "Use my_tool to process data"
```

---

## File Locations

| Type | Location |
|------|----------|
| Auth | `~/.pi/agent/auth.json` |
| Models | `~/.pi/agent/models.json` |
| Global Settings | `~/.pi/agent/settings.json` |
| Project Settings | `<cwd>/.pi/settings.json` |
| Sessions | `~/.pi/agent/sessions/<cwd-hash>/` |
| Extensions | `~/.pi/agent/extensions/`, `<cwd>/.pi/extensions/` |
| Skills | `~/.pi/agent/skills/`, `<cwd>/.pi/skills/` |
| Prompts | `~/.pi/agent/prompts/`, `<cwd>/.pi/prompts/` |
| Context | `AGENTS.md` walking up from cwd |

Project settings override global settings.
