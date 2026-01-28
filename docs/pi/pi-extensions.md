# Pi Extension & SDK Reference

## Overview

Pi is a coding agent with a powerful extension system. Extensions can intercept events, register tools/commands, modify behavior, and create custom UIs. This document provides everything needed to create extensions and use the SDK programmatically.

---

## Extension Structure

Every extension is a TypeScript file exporting a default function:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Extension code here
}
```

Extensions are loaded from:
- `~/.pi/agent/extensions/` (global)
- `<cwd>/.pi/extensions/` (project-local)
- Paths in `settings.json` "extensions" array
- CLI: `pi -e ./path/to/extension.ts`

---

## Extension API Reference

### Registering Tools

```typescript
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "my_tool",
  label: "My Tool",
  description: "Tool description for the LLM",
  parameters: Type.Object({
    input: Type.String({ description: "Input parameter" }),
    count: Type.Optional(Type.Number({ description: "Optional count" })),
  }),
  
  async execute(toolCallId, params, onUpdate, ctx, signal) {
    // params is typed based on parameters schema
    const { input, count } = params;
    
    // Stream progress updates
    onUpdate?.({
      content: [{ type: "text", text: "Processing..." }],
      details: { progress: 50 },
    });
    
    // Check for abort
    if (signal?.aborted) throw new Error("Aborted");
    
    return {
      content: [
        { type: "text", text: `Result: ${input}` },
        // Can also include images:
        // { type: "image", data: base64Data, mimeType: "image/png" },
      ],
      details: { processed: true }, // Metadata for rendering
      isError: false,
    };
  },
  
  // Optional: Custom rendering of tool call (before/during execution)
  renderCall(args, theme) {
    const text = theme.fg("toolTitle", theme.bold("my_tool ")) + 
                 theme.fg("accent", args.input);
    return new Text(text, 0, 0);
  },
  
  // Optional: Custom rendering of tool result
  renderResult(result, { expanded, isPartial }, theme) {
    if (isPartial) return new Text(theme.fg("warning", "Processing..."), 0, 0);
    const details = result.details;
    return new Text(theme.fg("success", "Done"), 0, 0);
  },
});
```

### Registering Commands

```typescript
pi.registerCommand("mycommand", {
  description: "Does something useful",
  handler: async (args, ctx) => {
    // args = everything after /mycommand
    if (!args.trim()) {
      ctx.ui.notify("Usage: /mycommand <arg>", "warning");
      return;
    }
    
    // Do something
    ctx.ui.notify(`Executed with: ${args}`, "info");
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

// Available Key modifiers:
// Key.ctrl("x"), Key.alt("x"), Key.shift("x")
// Key.ctrlAlt("x"), Key.ctrlShift("x"), Key.altShift("x")
// Key.ctrlAltShift("x")
```

### Registering CLI Flags

```typescript
pi.registerFlag("my-flag", {
  description: "Description shown in help",
  type: "string", // or "boolean" or "number"
  default: "default-value",
});

// Later, retrieve the flag value:
pi.on("session_start", async (_event, ctx) => {
  const value = pi.getFlag("my-flag");
});
```

### Tool Management

```typescript
// Get all registered tools
const allTools = pi.getAllTools();

// Get currently active tools
const activeTools = pi.getActiveTools();

// Set active tools (by name)
pi.setActiveTools(["read", "bash", "grep"]);
```

### Sending Messages

```typescript
// Send custom message (displayed in conversation)
pi.sendMessage({
  customType: "my-message-type",
  content: "Message text",
  display: true, // Show in UI
  details: { ... }, // Optional metadata
}, {
  triggerTurn: false, // Don't trigger LLM response
});

// Send user message (as if typed by user)
pi.sendUserMessage("Do something");

// With options for streaming state:
pi.sendUserMessage("Steer the conversation", { deliverAs: "steer" }); // Interrupts
pi.sendUserMessage("Follow up", { deliverAs: "followUp" }); // Queued
```

### Session Data

```typescript
// Append custom entry to session (persisted, survives branches correctly)
pi.appendEntry("my-data-type", { key: "value" });

// Label an entry (appears in /tree navigation)
pi.setLabel(entryId, "my-bookmark");
pi.setLabel(entryId, undefined); // Remove label

// Session name
pi.setSessionName("Feature Implementation");
const name = pi.getSessionName();
```

### Model Control

```typescript
// Set model
const success = await pi.setModel(model);

// Set thinking level
pi.setThinkingLevel("high"); // "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
```

### Custom Message Rendering

```typescript
pi.registerMessageRenderer("my-message-type", (message, { expanded }, theme) => {
  const details = message.details;
  const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", message.content), 0, 0));
  return box;
});
```

### Execute Shell Commands

```typescript
const { stdout, stderr, code } = await pi.exec("git", ["status", "--porcelain"], {
  timeout: 30000, // Optional timeout in ms
});
```

### Inter-Extension Events

```typescript
// Listen for events from other extensions
pi.events.on("custom:event-name", (data) => {
  const { message } = data;
});

// Emit events for other extensions
pi.events.emit("custom:event-name", { message: "Hello" });
```

---

## Event Hooks

### Session Events

```typescript
// Session initialized
pi.on("session_start", async (event, ctx) => {
  // event: { sessionFile?: string }
});

// Session ending
pi.on("session_shutdown", async (event, ctx) => {
  // Cleanup resources
});

// Session changed (new or resume)
pi.on("session_switch", async (event, ctx) => {
  // event: { reason: "new" | "resume", sessionId: string }
});

// Before session switch (can cancel)
pi.on("session_before_switch", async (event, ctx) => {
  // event: { reason: "new" | "resume" }
  if (shouldCancel) {
    return { cancel: true };
  }
});

// Session forked
pi.on("session_fork", async (event, ctx) => {
  // event: { fromEntryId: string, newSessionId: string }
});

// Before fork (can cancel)
pi.on("session_before_fork", async (event, ctx) => {
  // event: { entryId: string }
  return { cancel: true }; // To cancel
});

// Before compaction (can customize)
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, signal } = event;
  // Return custom compaction:
  return {
    compaction: {
      summary: "Custom summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
    },
  };
});

// Tree navigation
pi.on("session_tree", async (event, ctx) => {
  // Rebuild state from ctx.sessionManager.getBranch()
});
```

### Agent Events

```typescript
// Before agent starts (can modify system prompt)
pi.on("before_agent_start", async (event) => {
  // event: { systemPrompt: string, messages: Message[], tools: Tool[] }
  return {
    systemPrompt: event.systemPrompt + "

Additional instructions...",
    // Can also return: message: { customType, content, display }
  };
});

// Agent started
pi.on("agent_start", async (event, ctx) => {
  // event: { messages: Message[] }
});

// Agent finished
pi.on("agent_end", async (event, ctx) => {
  // event: { messages: Message[], stopReason: string }
});

// Turn started
pi.on("turn_start", async (event, ctx) => {
  // event: { turnIndex: number }
});

// Turn ended
pi.on("turn_end", async (event, ctx) => {
  // event: { turnIndex: number, message: AssistantMessage }
});
```

### Tool Events

```typescript
// Tool being called (can block)
pi.on("tool_call", async (event, ctx) => {
  // event: { toolName: string, toolCallId: string, input: object }
  
  if (shouldBlock) {
    return { block: true, reason: "Blocked because..." };
  }
  // Return undefined to allow
});

// Tool finished
pi.on("tool_result", async (event, ctx) => {
  // event: { toolName: string, toolCallId: string, result: ToolResult }
});
```

### Input Events

```typescript
// User input (can transform or handle)
pi.on("input", async (event, ctx) => {
  // event: { text: string, images: ImageContent[], source: "user" | "extension" }
  
  // Transform input
  if (event.text.startsWith("?quick ")) {
    return { 
      action: "transform", 
      text: `Be brief: ${event.text.slice(7)}`,
      images: event.images,
    };
  }
  
  // Handle completely (no LLM)
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }
  
  // Let it through
  return { action: "continue" };
});

// User bash command (! prefix)
pi.on("user_bash", async (event, ctx) => {
  // event: { command: string }
  
  // Provide custom operations
  return { operations: customBashOperations };
  
  // Or return result directly
  return { 
    result: { 
      output: "Custom output", 
      exitCode: 0, 
      cancelled: false, 
      truncated: false 
    } 
  };
});
```

### Context Events

```typescript
// Before context sent to model (can filter messages)
pi.on("context", async (event) => {
  // event: { messages: Message[] }
  return {
    messages: event.messages.filter(m => /* filter logic */),
  };
});
```

### Model Events

```typescript
pi.on("model_select", async (event, ctx) => {
  // event: { model: Model, previousModel?: Model, source: "command" | "cycle" | "restore" }
  ctx.ui.setStatus("model", `🤖 ${event.model.id}`);
});
```

---

## Extension Context (ctx)

### UI Methods

```typescript
// Notifications
ctx.ui.notify("Message", "info"); // "info" | "warning" | "error" | "success"

// Confirm dialog
const confirmed = await ctx.ui.confirm("Title", "Description", {
  timeout: 5000, // Auto-cancel after 5s
  signal: abortController.signal, // External abort
});

// Select dialog
const choice = await ctx.ui.select("Choose one", ["Option A", "Option B", "Option C"], {
  timeout: 10000,
});

// Editor dialog
const text = await ctx.ui.editor("Edit prompt", "Initial text");

// Custom component
const result = await ctx.ui.custom<ResultType>(
  (tui, theme, keybindings, done) => {
    return {
      render(width: number): string[] { return ["Line 1", "Line 2"]; },
      invalidate(): void { /* cache invalidation */ },
      handleInput(data: string): void { 
        if (matchesKey(data, Key.escape)) done(null);
      },
      dispose(): void { /* cleanup */ },
    };
  },
  {
    overlay: true, // Render as floating overlay
    overlayOptions: {
      anchor: "center", // Position anchor
      width: 50, // Fixed width or "50%"
      maxHeight: 20,
      margin: { top: 1, right: 2 },
      visible: (termWidth) => termWidth >= 100, // Responsive
    },
  }
);
```

### Status Bar

```typescript
ctx.ui.setStatus("my-status", ctx.ui.theme.fg("accent", "🔒 Active"));
ctx.ui.setStatus("my-status", undefined); // Remove
```

### Widgets

```typescript
// Above editor (default)
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"]);

// Below editor
ctx.ui.setWidget("my-widget", ["Line 1"], { placement: "belowEditor" });

// Remove
ctx.ui.setWidget("my-widget", undefined);
```

### Custom Header/Footer

```typescript
ctx.ui.setHeader((tui, theme) => ({
  render(width: number): string[] {
    return ["Custom header line"];
  },
  invalidate(): void {},
}));

ctx.ui.setFooter((tui, theme, footerData) => {
  const unsub = footerData.onBranchChange(() => tui.requestRender());
  return {
    dispose: unsub,
    invalidate(): void {},
    render(width: number): string[] {
      const branch = footerData.getGitBranch();
      return [theme.fg("dim", `Branch: ${branch || "none"}`)];
    },
  };
});

// Restore defaults
ctx.ui.setHeader(undefined);
ctx.ui.setFooter(undefined);
```

### Custom Editor Component

```typescript
import { CustomEditor } from "@mariozechner/pi-coding-agent";

class MyEditor extends CustomEditor {
  handleInput(data: string): void {
    // Custom input handling
    super.handleInput(data); // Call parent
  }
  
  render(width: number): string[] {
    return super.render(width).map(line => /* modify */);
  }
}

ctx.ui.setEditorComponent((tui, theme, kb) => new MyEditor(tui, theme, kb));
```

### Session Management

```typescript
// Create new session
const { cancelled } = await ctx.newSession({
  parentSession: ctx.sessionManager.getSessionFile(), // For handoff tracking
});

// Session data
const entries = ctx.sessionManager.getEntries();
const branch = ctx.sessionManager.getBranch();
const leaf = ctx.sessionManager.getLeafEntry();
const label = ctx.sessionManager.getLabel(entryId);
```

### Model & Registry

```typescript
const currentModel = ctx.model;
const apiKey = await ctx.modelRegistry.getApiKey(model);
const available = await ctx.modelRegistry.getAvailable();
const model = ctx.modelRegistry.find("provider", "model-id");
```

### State & Control

```typescript
ctx.cwd; // Working directory
ctx.hasUI; // Has interactive UI
ctx.isIdle(); // Agent is not processing

// Request graceful shutdown
ctx.shutdown();

// Trigger compaction
ctx.compact({
  customInstructions: "Focus on...",
  onComplete: () => { },
  onError: (err) => { },
});

// Get token usage
const usage = ctx.getContextUsage();
// { tokens: number, limit: number, percent: number }
```

### Theme

```typescript
const theme = ctx.ui.theme;

// Foreground colors
theme.fg("accent", "text");
theme.fg("error", "text");
theme.fg("warning", "text");
theme.fg("success", "text");
theme.fg("dim", "text");
theme.fg("muted", "text");
theme.fg("text", "text");
theme.fg("border", "text");
theme.fg("toolTitle", "text");
theme.fg("toolOutput", "text");

// Background colors
theme.bg("selectedBg", "text");
theme.bg("customMessageBg", "text");

// Styles
theme.bold("text");
theme.italic("text");
theme.strikethrough("text");
```

---

## Custom UI Components

### Basic Component Interface

```typescript
interface Component {
  render(width: number): string[];
  invalidate(): void;
  handleInput?(data: string): void;
  dispose?(): void;
  wantsKeyRelease?: boolean; // For games/smooth movement
  focused?: boolean; // Focusable interface
}
```

### Key Matching

```typescript
import { matchesKey, Key, isKeyRelease, parseKey } from "@mariozechner/pi-tui";

function handleInput(data: string) {
  if (matchesKey(data, Key.escape)) { /* Escape pressed */ }
  if (matchesKey(data, Key.enter)) { /* Enter pressed */ }
  if (matchesKey(data, Key.ctrl("c"))) { /* Ctrl+C */ }
  if (matchesKey(data, Key.up)) { /* Arrow up */ }
  if (matchesKey(data, Key.down)) { /* Arrow down */ }
  if (matchesKey(data, Key.left)) { /* Arrow left */ }
  if (matchesKey(data, Key.right)) { /* Arrow right */ }
  if (matchesKey(data, Key.tab)) { /* Tab */ }
  if (matchesKey(data, Key.shift("tab"))) { /* Shift+Tab */ }
  if (matchesKey(data, Key.space)) { /* Space */ }
  if (matchesKey(data, Key.backspace)) { /* Backspace */ }
  
  // For games with smooth movement (wantsKeyRelease = true)
  if (isKeyRelease(data)) { /* Key was released */ }
  
  // Parse key for inspection
  const key = parseKey(data); // "ctrl+c", "escape", etc.
}
```

### Built-in UI Components

```typescript
import { 
  Text, Container, Box, Spacer, Markdown,
  Editor, SelectList, SettingsList,
  truncateToWidth, visibleWidth, CURSOR_MARKER,
} from "@mariozechner/pi-tui";

import { 
  BorderedLoader, DynamicBorder, getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";

// Text component
new Text("Styled text", paddingLeft, paddingTop);

// Container (vertical stack)
const container = new Container();
container.addChild(new Text("Line 1", 0, 0));
container.addChild(new Spacer(1));
container.addChild(new Text("Line 2", 0, 0));

// Markdown rendering
const mdTheme = getMarkdownTheme();
new Markdown("# Heading\n
- Item", paddingLeft, paddingTop, mdTheme);

// Dynamic border (themed)
new DynamicBorder((str) => theme.fg("accent", str));

// Bordered loader with abort support
const loader = new BorderedLoader(tui, theme, "Loading...");
loader.onAbort = () => done(null);
// loader.signal for passing to fetch/complete calls

// SelectList for menus
const items = [
  { value: "a", label: "Option A", description: "Description" },
  { value: "b", label: "Option B" },
];
const selectList = new SelectList(items, maxVisibleItems, themeOptions, (item) => { }, () => { });
selectList.onSelect = (item) => done(item.value);
selectList.onCancel = () => done(null);

// Truncation utilities
const truncated = truncateToWidth("Long text...", maxWidth, "...", pad);
const width = visibleWidth("text with \x1b[32mANSI\x1b[0m codes");

// Cursor marker for IME support in custom editors
const line = `before${CURSOR_MARKER}\x1b[7m \x1b[27mafter`;
```

### Overlay Options

```typescript
{
  overlay: true,
  overlayOptions: {
    // Anchor position
    anchor: "center" | "top-left" | "top-center" | "top-right" |
            "left-center" | "right-center" |
            "bottom-left" | "bottom-center" | "bottom-right",
    
    // Size
    width: 50 | "50%",
    minWidth: 30,
    maxHeight: 20 | "50%",
    
    // Positioning
    margin: 2 | { top: 1, right: 2, bottom: 1, left: 2 },
    offsetX: 10,
    offsetY: -3,
    row: "50%", // Percentage-based
    col: "50%",
    
    // Visibility
    visible: (termWidth) => termWidth >= 100, // Responsive
  },
  
  // Access overlay handle for programmatic control
  onHandle: (handle) => {
    handle.setHidden(true); // Hide overlay
    handle.setHidden(false); // Show overlay
  },
}
```

---

## Registering Custom Providers

```typescript
pi.registerProvider("my-provider", {
  baseUrl: "https://api.example.com",
  apiKey: "MY_API_KEY_ENV_VAR", // Environment variable name
  api: "my-provider-api",
  
  models: [
    {
      id: "my-model-1",
      name: "My Model 1",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      contextWindow: 200000,
      maxTokens: 64000,
    },
  ],
  
  // Optional: OAuth support
  oauth: {
    name: "My Provider OAuth",
    login: async (callbacks) => {
      callbacks.onAuth({ url: "https://..." });
      const code = await callbacks.onPrompt({ message: "Paste code:" });
      // Exchange code for tokens
      return { refresh: "...", access: "...", expires: Date.now() + 3600000 };
    },
    refreshToken: async (credentials) => {
      // Refresh tokens
      return { refresh: "...", access: "...", expires: Date.now() + 3600000 };
    },
    getApiKey: (credentials) => credentials.access,
  },
  
  // Custom streaming implementation
  streamSimple: (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    // Implement streaming...
    return stream;
  },
});
```

---

## SDK Usage

### Minimal Setup

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession();

session.subscribe((event) => {
  if (event.type === "message_update" && 
      event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

### Full Configuration

```typescript
import { getModel } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  createReadTool,
  createBashTool,
  createEditTool,
  createWriteTool,
  createCodingTools,
  readOnlyTools,
} from "@mariozechner/pi-coding-agent";

// Auth & Models
const authStorage = new AuthStorage(); // or new AuthStorage("/custom/path/auth.json")
authStorage.setRuntimeApiKey("anthropic", "sk-..."); // Runtime override
const modelRegistry = new ModelRegistry(authStorage);

// Model selection
const model = getModel("anthropic", "claude-sonnet-4-20250514");
const available = await modelRegistry.getAvailable();

// Settings
const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: false },
  retry: { enabled: true, maxRetries: 3 },
});

// Session management
const sessionManager = SessionManager.inMemory(); // No persistence
// const sessionManager = SessionManager.create(cwd); // New persistent
// const sessionManager = SessionManager.continueRecent(cwd); // Resume or new
// const sessionManager = SessionManager.open("/path/to/session.jsonl");

// List sessions
const sessions = await SessionManager.list(cwd);

// Resource loader (skills, prompts, extensions, context files)
const resourceLoader = new DefaultResourceLoader({
  systemPromptOverride: () => "Custom system prompt",
  appendSystemPromptOverride: () => [],
  skillsOverride: (current) => ({ skills: [...current.skills], diagnostics: [] }),
  promptsOverride: (current) => ({ prompts: [...current.prompts], diagnostics: [] }),
  agentsFilesOverride: (current) => ({ agentsFiles: [...current.agentsFiles] }),
  additionalExtensionPaths: ["./my-extension.ts"],
  extensionFactories: [(pi) => { /* inline extension */ }],
});
await resourceLoader.reload();

// Tools - IMPORTANT: Use factories with custom cwd
const cwd = "/path/to/project";
const tools = createCodingTools(cwd); // read, bash, edit, write
// Or individual:
// const tools = [createReadTool(cwd), createBashTool(cwd)];
// Or read-only (uses process.cwd()):
// const tools = readOnlyTools;

// Create session
const { session, modelFallbackMessage } = await createAgentSession({
  cwd,
  agentDir: "~/.pi/agent",
  model,
  thinkingLevel: "medium",
  authStorage,
  modelRegistry,
  resourceLoader,
  tools,
  sessionManager,
  settingsManager,
});

// Use session
session.subscribe((event) => {
  switch (event.type) {
    case "message_start":
    case "message_update":
    case "message_end":
      // Handle message events
      break;
    case "tool_call_start":
    case "tool_call_update":
    case "tool_call_end":
      // Handle tool events
      break;
  }
});

await session.prompt("Your prompt here");
console.log(session.state.messages);
```

---

## Common Patterns

### State Persistence via Session Entries

```typescript
interface MyState {
  enabled: boolean;
  items: string[];
}

let state: MyState = { enabled: false, items: [] };

// Persist state
function saveState() {
  pi.appendEntry<MyState>("my-extension-state", state);
}

// Restore state from branch
function restoreState(ctx: ExtensionContext) {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "my-extension-state") {
      state = entry.data as MyState;
    }
  }
}

pi.on("session_start", async (_event, ctx) => restoreState(ctx));
pi.on("session_fork", async (_event, ctx) => restoreState(ctx));
pi.on("session_tree", async (_event, ctx) => restoreState(ctx));
```

### Config Files

```typescript
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Config {
  enabled?: boolean;
  setting?: string;
}

function loadConfig(cwd: string): Config {
  const globalPath = join(homedir(), ".pi", "agent", "my-extension.json");
  const projectPath = join(cwd, ".pi", "my-extension.json");
  
  let config: Config = {};
  
  if (existsSync(globalPath)) {
    try {
      config = { ...config, ...JSON.parse(readFileSync(globalPath, "utf-8")) };
    } catch {}
  }
  
  if (existsSync(projectPath)) {
    try {
      config = { ...config, ...JSON.parse(readFileSync(projectPath, "utf-8")) };
    } catch {}
  }
  
  return config;
}
```

### Tool Output Truncation

```typescript
import {
  truncateHead, truncateTail,
  DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";

// Truncate from end (keep first N lines/bytes) - good for search results
const result = truncateHead(output, {
  maxLines: DEFAULT_MAX_LINES, // 2000
  maxBytes: DEFAULT_MAX_BYTES, // 50KB
});

// Truncate from start (keep last N lines/bytes) - good for logs
const result = truncateTail(output, { maxLines: 100, maxBytes: 10000 });

// result.truncated - whether truncation occurred
// result.content - truncated content
// result.totalLines / result.outputLines
// result.totalBytes / result.outputBytes

if (result.truncated) {
  const msg = `[Truncated: ${result.outputLines}/${result.totalLines} lines, ${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}]`;
}
```

### Blocking Destructive Commands

```typescript
const DANGEROUS_PATTERNS = [
  /\brm\s+(-rf?|--recursive)/i,
  /\bsudo\b/i,
  /\bgit\s+(push|reset\s+--hard)/i,
];

pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  
  const command = event.input.command as string;
  const isDangerous = DANGEROUS_PATTERNS.some(p => p.test(command));
  
  if (isDangerous) {
    if (!ctx.hasUI) {
      return { block: true, reason: "Dangerous command blocked (no UI)" };
    }
    
    const confirmed = await ctx.ui.confirm(
      "Dangerous Command",
      `Allow: ${command}?`
    );
    
    if (!confirmed) {
      return { block: true, reason: "Blocked by user" };
    }
  }
});
```

### Real-time Game Loop (30+ FPS)

```typescript
class GameComponent {
  private interval: ReturnType<typeof setInterval> | null = null;
  wantsKeyRelease = true; // Smooth key tracking
  
  constructor(private tui: TUI, private done: () => void) {
    this.interval = setInterval(() => {
      this.tick();
      this.tui.requestRender();
    }, 1000 / 35); // ~35 FPS
  }
  
  private tick(): void {
    // Game logic
  }
  
  handleInput(data: string): void {
    const released = isKeyRelease(data);
    
    if (!released && matchesKey(data, Key.escape)) {
      this.dispose();
      this.done();
      return;
    }
    
    // Track key states for smooth movement
    if (matchesKey(data, Key.left) || matchesKey(data, "a")) {
      this.keys.left = !released;
    }
  }
  
  render(width: number): string[] {
    // Render game frame
    return [...];
  }
  
  invalidate(): void {}
  
  dispose(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
```

---

## TypeBox Schema Reference

```typescript
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

// Basic types
Type.String({ description: "..." })
Type.Number({ description: "..." })
Type.Boolean({ description: "..." })
Type.Optional(Type.String())

// Enums
StringEnum(["option1", "option2", "option3"] as const, {
  description: "...",
  default: "option1",
})

// Objects
Type.Object({
  required: Type.String(),
  optional: Type.Optional(Type.Number()),
})

// Arrays
Type.Array(Type.Object({ ... }), { description: "..." })
```

---

## File Locations

| Path | Purpose |
|------|---------|
| `~/.pi/agent/extensions/` | Global extensions |
| `~/.pi/agent/skills/` | Global skills |
| `~/.pi/agent/prompts/` | Global prompt templates |
| `~/.pi/agent/agents/` | Global subagent definitions |
| `~/.pi/agent/models.json` | Custom model definitions |
| `~/.pi/agent/auth.json` | API keys and OAuth tokens |
| `~/.pi/agent/settings.json` | Global settings |
| `~/.pi/agent/sessions/` | Session files (by cwd hash) |
| `<cwd>/.pi/extensions/` | Project extensions |
| `<cwd>/.pi/skills/` | Project skills |
| `<cwd>/.pi/prompts/` | Project prompts |
| `<cwd>/.pi/agents/` | Project subagent definitions |
| `<cwd>/.pi/settings.json` | Project settings |
| `<cwd>/AGENTS.md` | Project context file |
| `<cwd>/.claude/rules/` | Claude rules (optional) |
