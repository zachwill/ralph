# Pi Coding Agent: Elite Usage Guide

This document provides comprehensive knowledge for effectively utilizing the pi coding agent SDK and extension system.

---

## Core Architecture

Pi is structured around:
1. **Sessions** - Conversation state with persistence and branching
2. **Tools** - Capabilities the agent can invoke (read, write, bash, etc.)
3. **Extensions** - Plugins that intercept events and extend functionality
4. **Resources** - System prompts, skills, context files, templates

---

## SDK Quick Reference

### Session Creation

```typescript
import { createAgentSession, SessionManager } from "@mariozechner/pi-coding-agent";

// Minimal - uses all defaults
const { session } = await createAgentSession();

// Full control
const { session } = await createAgentSession({
  cwd: "/path/to/project",
  model: myModel,
  thinkingLevel: "medium", // off | minimal | low | medium | high | xhigh
  tools: [...],
  sessionManager: SessionManager.inMemory(),
  resourceLoader: myLoader,
  authStorage: myAuth,
  modelRegistry: myRegistry,
  settingsManager: mySettings,
});
```

### Session Management

```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent";

// No persistence (testing)
SessionManager.inMemory()

// New persistent session
SessionManager.create(cwd)

// Resume most recent
SessionManager.continueRecent(cwd)

// Open specific session
SessionManager.open(sessionPath)

// List all sessions
const sessions = await SessionManager.list(cwd);
```

### Model Selection

```typescript
import { getModel } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

// Get built-in model
const model = getModel("anthropic", "claude-sonnet-4-5");

// Find model via registry (includes custom models.json)
const authStorage = new AuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
const customModel = modelRegistry.find("provider", "model-id");

// Get models with valid API keys
const available = await modelRegistry.getAvailable();

// Runtime API key override (not persisted)
authStorage.setRuntimeApiKey("anthropic", "sk-...");
```

### Tools

```typescript
import {
  codingTools,      // read, write, edit, bash
  readOnlyTools,    // read, bash, grep, find, ls
  readTool, bashTool, grepTool, editTool, writeTool,
  createReadTool, createBashTool, // Factory for custom cwd
} from "@mariozechner/pi-coding-agent";

// Built-in set
tools: codingTools

// Custom selection
tools: [readTool, bashTool, grepTool]

// IMPORTANT: With custom cwd, use factory functions
const cwd = "/custom/path";
tools: [createReadTool(cwd), createBashTool(cwd)]
```

### Resource Customization

```typescript
import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

const loader = new DefaultResourceLoader({
  // Replace system prompt entirely
  systemPromptOverride: () => "You are a pirate assistant.",
  
  // Append to default prompt
  appendSystemPromptOverride: (base) => [...base, "Be concise."],
  
  // Filter/add skills
  skillsOverride: (current) => ({
    skills: current.skills.filter(s => s.name.includes("browser")),
    diagnostics: current.diagnostics,
  }),
  
  // Add prompt templates
  promptsOverride: (current) => ({
    prompts: [...current.prompts, myTemplate],
    diagnostics: current.diagnostics,
  }),
  
  // Modify AGENTS.md files
  agentsFilesOverride: (current) => ({
    agentsFiles: [...current.agentsFiles, { path: "...", content: "..." }],
  }),
  
  // Additional extensions
  additionalExtensionPaths: ["./my-extension.ts"],
  extensionFactories: [(pi) => { /* inline extension */ }],
});

await loader.reload();
```

### Settings

```typescript
import { SettingsManager } from "@mariozechner/pi-coding-agent";

// From disk
const settings = SettingsManager.create();

// In-memory (testing)
const settings = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 5 },
});

// Apply runtime overrides
settings.applyOverrides({ compaction: { enabled: false } });
```

---

## Extension System

### Extension Structure

```typescript
// ~/.pi/agent/extensions/my-extension.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Register hooks, tools, commands, etc.
}
```

### Event Hooks

| Event | When | Can Return |
|-------|------|------------|
| `session_start` | Session begins | - |
| `session_shutdown` | Cleanup before exit | - |
| `session_switch` | Session changed | - |
| `session_fork` | Branch created | - |
| `session_tree` | Tree navigation | - |
| `session_before_switch` | Before switch | `{ cancel: true }` |
| `session_before_fork` | Before fork | `{ cancel: true }` |
| `session_before_compact` | Before compaction | `{ compaction: {...} }` |
| `before_agent_start` | Before agent runs | `{ systemPrompt, message }` |
| `agent_start` | Agent begins | - |
| `agent_end` | Agent completes | - |
| `turn_start` | Turn begins | - |
| `turn_end` | Turn completes | - |
| `tool_call` | Before tool executes | `{ block: true, reason }` |
| `tool_result` | After tool completes | - |
| `input` | User input received | `{ action: "transform", text }` or `{ action: "handled" }` |
| `user_bash` | User ! command | `{ operations, result }` |
| `model_select` | Model changed | - |
| `context` | Before sending to LLM | `{ messages: [...] }` |

### Hook Examples

```typescript
// Modify system prompt
pi.on("before_agent_start", async (event) => {
  if (someCondition) {
    return {
      systemPrompt: event.systemPrompt + "\nAdditional instructions...",
    };
  }
});

// Block dangerous commands
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && /rm -rf/.test(event.input.command)) {
    return { block: true, reason: "Destructive command blocked" };
  }
});

// Transform user input
pi.on("input", async (event, ctx) => {
  if (event.text.startsWith("?quick ")) {
    return { 
      action: "transform", 
      text: `Respond briefly: ${event.text.slice(7)}` 
    };
  }
  return { action: "continue" };
});

// Custom compaction
pi.on("session_before_compact", async (event, ctx) => {
  const summary = await generateSummary(event.preparation);
  return {
    compaction: {
      summary,
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
    }
  };
});
```

### Registering Tools

```typescript
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "Description for LLM",
  parameters: Type.Object({
    input: Type.String({ description: "Input parameter" }),
    count: Type.Optional(Type.Number()),
  }),
  
  async execute(toolCallId, params, onUpdate, ctx, signal) {
    // Stream progress
    onUpdate?.({
      content: [{ type: "text", text: "Processing..." }],
      details: { step: 1 },
    });
    
    // Check for abort
    if (signal?.aborted) throw new Error("Aborted");
    
    // Return result
    return {
      content: [{ type: "text", text: `Result: ${params.input}` }],
      details: { processed: true },
    };
  },
  
  // Custom rendering (optional)
  renderCall(args, theme) {
    return new Text(theme.fg("accent", `my_tool ${args.input}`), 0, 0);
  },
  
  renderResult(result, { expanded }, theme) {
    const details = result.details;
    return new Text(theme.fg("success", "✓ Done"), 0, 0);
  },
});
```

### Registering Commands

```typescript
pi.registerCommand("mycommand", {
  description: "Does something useful",
  handler: async (args, ctx) => {
    // args is the string after /mycommand
    if (!ctx.hasUI) {
      ctx.ui.notify("Requires interactive mode", "error");
      return;
    }
    
    const confirmed = await ctx.ui.confirm("Title", "Message");
    if (confirmed) {
      ctx.ui.notify("Confirmed!", "info");
    }
  },
});
```

### Registering Shortcuts

```typescript
import { Key } from "@mariozechner/pi-tui";

pi.registerShortcut(Key.ctrlAlt("p"), {
  description: "Toggle plan mode",
  handler: async (ctx) => {
    // Handle shortcut
  },
});
```

### Registering Custom Message Renderers

```typescript
pi.registerMessageRenderer("my-custom-type", (message, { expanded }, theme) => {
  const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", message.content), 0, 0));
  return box;
});

// Send custom message
pi.sendMessage({
  customType: "my-custom-type",
  content: "Custom content",
  display: true,
  details: { extra: "data" },
}, { triggerTurn: false });
```

### Registering CLI Flags

```typescript
pi.registerFlag("my-flag", {
  description: "Description for help",
  type: "string", // or "boolean"
  default: "default-value",
});

// Access flag value
const value = pi.getFlag("my-flag");
```

---

## Context API Reference

### Core Context

```typescript
ctx.cwd          // Working directory
ctx.hasUI        // Interactive mode?
ctx.model        // Current model
ctx.sessionManager // Session operations
ctx.modelRegistry  // Model resolution
```

### State Methods

```typescript
ctx.isIdle()                  // Agent not running?
ctx.newSession(options)       // Create new session
ctx.shutdown()                // Exit cleanly
ctx.compact(options)          // Trigger compaction
ctx.getContextUsage()         // { tokens, cost, ... }
```

### UI Methods

```typescript
// Notifications
ctx.ui.notify(message, "info" | "warning" | "error")

// Dialogs
const ok = await ctx.ui.confirm("Title", "Message", { timeout: 5000 })
const choice = await ctx.ui.select("Title", ["A", "B", "C"], { timeout: 10000 })
const text = await ctx.ui.editor("Title", "initial content")

// Custom components
const result = await ctx.ui.custom((tui, theme, kb, done) => {
  return {
    render(width) { return ["line 1", "line 2"]; },
    handleInput(data) { if (matchesKey(data, "escape")) done(null); },
    invalidate() {},
    dispose() {},
  };
}, {
  overlay: true,
  overlayOptions: { anchor: "center", width: "50%", maxHeight: 20 },
});

// Persistent UI elements
ctx.ui.setStatus("key", theme.fg("accent", "Status text"))
ctx.ui.setWidget("key", ["line 1", "line 2"], { placement: "belowEditor" })
ctx.ui.setTheme("dark" | "light")
ctx.ui.setHeader(factory)
ctx.ui.setFooter(factory)
ctx.ui.setEditorComponent(factory)
ctx.ui.setEditorText("prefilled text")
```

---

## Extension API Methods

### Tool Control

```typescript
pi.setActiveTools(["read", "bash"])  // Enable only these
pi.getActiveTools()                   // Get enabled tool names
pi.getAllTools()                      // Get all tool definitions
```

### Model Control

```typescript
pi.setModel(model)               // Change model
pi.setThinkingLevel("high")      // off|minimal|low|medium|high|xhigh
```

### State Persistence

```typescript
// Save data to session (survives branches correctly)
pi.appendEntry("my-type", { key: "value" })

// Read from session
const entries = ctx.sessionManager.getEntries();
const myEntries = entries.filter(e => e.customType === "my-type");

// Bookmarks
pi.setLabel(entryId, "checkpoint-1")
const label = ctx.sessionManager.getLabel(entryId)

// Session naming
pi.setSessionName("Feature implementation")
const name = pi.getSessionName()
```

### Messaging

```typescript
// Custom message (extension-controlled display)
pi.sendMessage({
  customType: "notification",
  content: "Something happened",
  display: true,
}, { triggerTurn: false })

// User message (appears in conversation)
pi.sendUserMessage("Do something")
pi.sendUserMessage("Steer now", { deliverAs: "steer" })     // Interrupts
pi.sendUserMessage("Later", { deliverAs: "followUp" })      // Queued
```

### Utilities

```typescript
// Run commands
const { stdout, stderr, code } = await pi.exec("git", ["status"])

// Inter-extension events
pi.events.on("my:event", (data) => { ... })
pi.events.emit("my:event", { key: "value" })
```

---

## Key Extension Patterns

### 1. Plan Mode (Read-Only Exploration)

```typescript
const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];

pi.on("tool_call", async (event) => {
  if (planModeEnabled && event.toolName === "bash") {
    if (!isSafeCommand(event.input.command)) {
      return { block: true, reason: "Destructive command blocked in plan mode" };
    }
  }
});

pi.on("before_agent_start", async () => {
  if (planModeEnabled) {
    return {
      message: {
        customType: "plan-mode-context",
        content: "[PLAN MODE] Read-only exploration...",
        display: false,
      },
    };
  }
});
```

### 2. Permission Gates

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && /sudo|rm -rf/.test(event.input.command)) {
    if (!ctx.hasUI) {
      return { block: true, reason: "Dangerous command blocked (no UI)" };
    }
    const ok = await ctx.ui.confirm("Allow dangerous command?", event.input.command);
    if (!ok) return { block: true, reason: "User denied" };
  }
});
```

### 3. Preset Configurations

```typescript
interface Preset {
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  tools?: string[];
  instructions?: string;
}

async function applyPreset(name: string, preset: Preset, ctx) {
  if (preset.provider && preset.model) {
    const model = ctx.modelRegistry.find(preset.provider, preset.model);
    if (model) await pi.setModel(model);
  }
  if (preset.thinkingLevel) pi.setThinkingLevel(preset.thinkingLevel);
  if (preset.tools) pi.setActiveTools(preset.tools);
}

pi.on("before_agent_start", async (event) => {
  if (activePreset?.instructions) {
    return { systemPrompt: event.systemPrompt + "\n
" + activePreset.instructions };
  }
});
```

### 4. Session State Reconstruction

```typescript
// State survives branches when stored in tool results
pi.on("session_start", (_, ctx) => reconstructState(ctx));
pi.on("session_fork", (_, ctx) => reconstructState(ctx));
pi.on("session_tree", (_, ctx) => reconstructState(ctx));

function reconstructState(ctx) {
  state = initialState();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.toolName === "my_tool") {
      applyStateChange(entry.message.details);
    }
  }
}
```

### 5. Custom Overlays with Real-Time Updates

```typescript
await ctx.ui.custom((tui, theme, kb, done) => {
  const interval = setInterval(() => {
    frame++;
    tui.requestRender();
  }, 1000/30); // 30 FPS
  
  return {
    render(width) { return renderFrame(frame, width, theme); },
    handleInput(data) {
      if (matchesKey(data, "escape")) {
        clearInterval(interval);
        done(null);
      }
    },
    dispose() { clearInterval(interval); },
    invalidate() {},
  };
}, { overlay: true, overlayOptions: { anchor: "center", width: 60 } });
```

### 6. Tool Output Truncation

```typescript
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";

const truncation = truncateHead(output, {
  maxLines: DEFAULT_MAX_LINES,  // 2000
  maxBytes: DEFAULT_MAX_BYTES,  // 50KB
});

if (truncation.truncated) {
  // Save full output to temp file
  const tempFile = saveTempFile(output);
  resultText += `
[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines. Full: ${tempFile}]`;
}
```

### 7. SSH Remote Execution

```typescript
function createRemoteOps(remote: string, remoteCwd: string): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout }) => {
      return new Promise((resolve, reject) => {
        const child = spawn("ssh", [remote, `cd ${remoteCwd} && ${command}`]);
        child.stdout.on("data", onData);
        child.on("close", (code) => resolve({ exitCode: code }));
      });
    },
  };
}

pi.registerTool({
  ...createBashTool(localCwd),
  execute(id, params, onUpdate, ctx, signal) {
    const ops = remoteEnabled 
      ? createRemoteOps(remote, remoteCwd)
      : undefined;
    return createBashTool(localCwd, { operations: ops }).execute(...);
  },
});
```

### 8. Subagent Delegation

```typescript
async function runSubagent(agent: AgentConfig, task: string): Promise<Result> {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) args.push("--model", agent.model);
  if (agent.tools) args.push("--tools", agent.tools.join(","));
  
  const proc = spawn("pi", [...args, task]);
  
  for await (const line of readLines(proc.stdout)) {
    const event = JSON.parse(line);
    if (event.type === "message_end") {
      messages.push(event.message);
    }
  }
  
  return { messages, usage };
}
```

---

## UI Components

### Built-in Components

```typescript
import { Text, Container, Markdown, Box, Spacer, SelectList } from "@mariozechner/pi-tui";

// Text with styling
new Text(theme.fg("accent", theme.bold("Title")), 0, 0)

// Container for layout
const container = new Container();
container.addChild(new Text("Line 1", 0, 0));
container.addChild(new Spacer(1));
container.addChild(new Text("Line 2", 0, 0));

// Markdown rendering
new Markdown(content, paddingLeft, paddingRight, getMarkdownTheme())

// Selection list
const list = new SelectList(items, visibleCount, theme, onSelect, onCancel);
```

### Key Matching

```typescript
import { matchesKey, isKeyRelease, Key, parseKey } from "@mariozechner/pi-tui";

if (matchesKey(data, Key.escape)) { ... }
if (matchesKey(data, Key.enter)) { ... }
if (matchesKey(data, Key.ctrlAlt("p"))) { ... }
if (matchesKey(data, "a")) { ... }
if (matchesKey(data, Key.shift("a"))) { ... }

// For games/real-time: detect key release
if (isKeyRelease(data)) { ... }
```

### Text Utilities

```typescript
import { visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";

const width = visibleWidth(ansiColoredText);
const truncated = truncateToWidth(text, maxWidth, "...");
```

---

## File Discovery Locations

| Type | Locations |
|------|-----------|
| Extensions | `~/.pi/agent/extensions/`, `<cwd>/.pi/extensions/` |
| Skills | `~/.pi/agent/skills/`, `<cwd>/.pi/skills/` |
| Prompts | `~/.pi/agent/prompts/`, `<cwd>/.pi/prompts/` |
| Context | `AGENTS.md` walking up from cwd |
| Auth | `~/.pi/agent/auth.json` |
| Models | `~/.pi/agent/models.json` |
| Settings | `~/.pi/agent/settings.json`, `<cwd>/.pi/settings.json` |
| Sessions | `~/.pi/agent/sessions/<cwd-hash>/` |

---

## Best Practices

1. **Tools must truncate output** - Use `truncateHead`/`truncateTail` with 50KB/2000 line limits
2. **Use factory functions with custom cwd** - `createReadTool(cwd)` not `readTool`
3. **Store state in tool results** - Survives branches correctly
4. **Check `ctx.hasUI`** - Gracefully handle non-interactive mode
5. **Use `signal` for cancellation** - Check `signal?.aborted` in long operations
6. **Provide custom renderers** - Better UX for complex tool results
7. **Document truncation in descriptions** - LLM knows output may be incomplete
8. **Use `onUpdate` for streaming** - Show progress during long operations
