# Pi Coding Agent SDK Reference

A complete guide to programmatically using the pi coding agent for automated tasks.

---

## Quick Start

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession();

session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("What files are in the current directory?");
```

---

## Core Function: `createAgentSession()`

The main entry point. Returns `{ session, modelFallbackMessage }`.

### Options

| Option | Type | Description |
|--------|------|-------------|
| `cwd` | `string` | Working directory (default: `process.cwd()`) |
| `agentDir` | `string` | Agent config directory (default: `~/.pi/agent`) |
| `model` | `Model` | Model to use |
| `thinkingLevel` | `"off" \| "minimal" \| "low" \| "medium" \| "high"` | Reasoning intensity |
| `authStorage` | `AuthStorage` | API key management |
| `modelRegistry` | `ModelRegistry` | Model discovery |
| `resourceLoader` | `ResourceLoader` | Skills, prompts, extensions loader |
| `tools` | `Tool[]` | Array of tools to enable |
| `sessionManager` | `SessionManager` | Session persistence strategy |
| `settingsManager` | `SettingsManager` | Settings configuration |

---

## Session API

### Methods

```typescript
// Send prompt and wait for completion
await session.prompt("Your instruction here");

// Subscribe to streaming events
const unsubscribe = session.subscribe((event) => {
  // Handle events
});

// Access state
session.state.messages;  // Conversation history
session.sessionFile;     // Path to session file (if persisted)
session.sessionId;       // Unique session ID
```

### Event Types

```typescript
session.subscribe((event) => {
  if (event.type === "message_update") {
    const e = event.assistantMessageEvent;
    
    switch (e.type) {
      case "text_delta":
        // Streaming text output
        process.stdout.write(e.delta);
        break;
      case "thinking_delta":
        // Model reasoning (when thinkingLevel > "off")
        console.log("[thinking]", e.delta);
        break;
      case "toolcall_start":
        console.log(`Tool: ${e.partial.content[e.contentIndex].name}`);
        break;
      case "toolcall_delta":
        // Tool argument streaming
        break;
      case "done":
        // Turn complete
        console.log("Stop reason:", e.reason);
        break;
      case "error":
        console.error("Error:", e.error.errorMessage);
        break;
    }
  }
});
```

---

## Tools

### Built-in Tools

```typescript
import {
  // Pre-instantiated tools (use process.cwd())
  readTool,
  bashTool,
  grepTool,
  editTool,
  writeTool,
  
  // Tool sets
  codingTools,     // All coding tools
  readOnlyTools,   // Read-only subset
  
  // Factory functions (for custom cwd)
  createReadTool,
  createBashTool,
  createGrepTool,
  createEditTool,
  createWriteTool,
  createCodingTools,
  createReadOnlyTools,
} from "@mariozechner/pi-coding-agent";
```

### Using with Custom Working Directory

**Important:** When using a custom `cwd`, always use factory functions:

```typescript
const cwd = "/path/to/project";

const { session } = await createAgentSession({
  cwd,
  tools: createCodingTools(cwd),  // Tools resolve paths relative to cwd
});

// Or select specific tools:
const { session } = await createAgentSession({
  cwd,
  tools: [
    createReadTool(cwd),
    createBashTool(cwd),
    createGrepTool(cwd),
  ],
});
```

---

## Session Management

### In-Memory (No Persistence)

```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});
```

### New Persistent Session

```typescript
const { session } = await createAgentSession({
  sessionManager: SessionManager.create(process.cwd()),
});
console.log("Session file:", session.sessionFile);
```

### Continue Most Recent Session

```typescript
const { session } = await createAgentSession({
  sessionManager: SessionManager.continueRecent(process.cwd()),
});
```

### List and Open Specific Session

```typescript
const sessions = await SessionManager.list(process.cwd());
for (const info of sessions) {
  console.log(`${info.id} - "${info.firstMessage}"`);
}

if (sessions.length > 0) {
  const { session } = await createAgentSession({
    sessionManager: SessionManager.open(sessions[0].path),
  });
}
```

---

## Authentication

### Default Auth Storage

```typescript
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

// Default: ~/.pi/agent/auth.json
const authStorage = new AuthStorage();
const modelRegistry = new ModelRegistry(authStorage);
```

### Custom Auth File Location

```typescript
const authStorage = new AuthStorage("/custom/path/auth.json");
const modelRegistry = new ModelRegistry(authStorage, "/custom/path/models.json");
```

### Runtime API Key Override

```typescript
// Set key at runtime (not persisted to disk)
authStorage.setRuntimeApiKey("anthropic", "sk-ant-...");
authStorage.setRuntimeApiKey("openai", "sk-...");
```

### Environment Variable Keys

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc. in environment.

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

---

## Custom System Prompt

### Replace Entirely

```typescript
import { DefaultResourceLoader, SessionManager } from "@mariozechner/pi-coding-agent";

const loader = new DefaultResourceLoader({
  systemPromptOverride: () => `You are a code reviewer.
Focus on security issues and best practices.
Be concise.`,
  appendSystemPromptOverride: () => [],  // Disable APPEND_SYSTEM.md
});
await loader.reload();

const { session } = await createAgentSession({
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
```

### Append to Default

```typescript
const loader = new DefaultResourceLoader({
  appendSystemPromptOverride: (base) => [
    ...base,
    "## Additional Rules\n- Always explain your reasoning
- Use bullet points",
  ],
});
await loader.reload();
```

---

## Settings

### In-Memory Settings

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

### Override Disk Settings

```typescript
const settingsManager = SettingsManager.create();
settingsManager.applyOverrides({
  compaction: { enabled: false },
});
```

---

## Full Control Example

Complete manual configuration with no auto-discovery:

```typescript
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createReadTool,
  createExtensionRuntime,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

const cwd = process.cwd();
const authStorage = new AuthStorage();
const modelRegistry = new ModelRegistry(authStorage);

// Set runtime API key if needed
if (process.env.ANTHROPIC_API_KEY) {
  authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY);
}

const model = getModel("anthropic", "claude-sonnet-4-5");
if (!model) throw new Error("Model not found");

// Minimal resource loader (no discovery)
const resourceLoader: ResourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => `You are a task automation assistant.
Available tools: read, bash.
Be concise. Output results in markdown.`,
  getAppendSystemPrompt: () => [],
  getPathMetadata: () => new Map(),
  reload: async () => {},
};

const { session } = await createAgentSession({
  cwd,
  model,
  thinkingLevel: "off",
  authStorage,
  modelRegistry,
  resourceLoader,
  tools: [createReadTool(cwd), createBashTool(cwd)],
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
});
```

---

## Bun Script Template

Self-contained script for automated tasks:

```typescript
#!/usr/bin/env bun
import { writeFileSync, readFileSync, existsSync } from "fs";
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createReadTool,
  createGrepTool,
  createExtensionRuntime,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

// --- Configuration ---
const CONFIG = {
  authFile: process.env.PI_AUTH_FILE || `${process.env.HOME}/.pi/agent/auth.json`,
  outputFile: process.env.OUTPUT_FILE,  // Optional: write to file instead of stdout
  model: { provider: "anthropic", id: "claude-sonnet-4-5" },
  thinkingLevel: "off" as const,
};

// --- Auth Setup ---
const authStorage = new AuthStorage(CONFIG.authFile);
const modelRegistry = new ModelRegistry(authStorage);

// Override with env var if present
if (process.env.ANTHROPIC_API_KEY) {
  authStorage.setRuntimeApiKey("anthropic", process.env.ANTHROPIC_API_KEY);
}

// --- Model ---
const model = getModel(CONFIG.model.provider, CONFIG.model.id);
if (!model) {
  console.error(`Model not found: ${CONFIG.model.provider}/${CONFIG.model.id}`);
  process.exit(1);
}

// --- Resource Loader (minimal) ---
const cwd = process.cwd();
const resourceLoader: ResourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => `You are a task automation assistant.
Working directory: ${cwd}

Available tools: read, bash, grep

Rules:
- Execute tasks efficiently
- Output findings in clean markdown format
- Be concise but thorough`,
  getAppendSystemPrompt: () => [],
  getPathMetadata: () => new Map(),
  reload: async () => {},
};

// --- Create Session ---
const { session } = await createAgentSession({
  cwd,
  model,
  thinkingLevel: CONFIG.thinkingLevel,
  authStorage,
  modelRegistry,
  resourceLoader,
  tools: [
    createReadTool(cwd),
    createBashTool(cwd),
    createGrepTool(cwd),
  ],
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  }),
});

// --- Capture Output ---
let output = "";
session.subscribe((event) => {
  if (event.type === "message_update") {
    const e = event.assistantMessageEvent;
    if (e.type === "text_delta") {
      output += e.delta;
      if (!CONFIG.outputFile) {
        process.stdout.write(e.delta);
      }
    }
  }
});

// --- Run Task ---
const task = process.argv[2] || "List and briefly describe the files in the current directory.";
await session.prompt(task);

// --- Write Output ---
if (CONFIG.outputFile) {
  writeFileSync(CONFIG.outputFile, output);
  console.log(`Output written to: ${CONFIG.outputFile}`);
}
```

### Usage

```bash
# Basic usage
bun run agent.ts "Analyze the package.json and summarize dependencies"

# Write to file
OUTPUT_FILE=report.md bun run agent.ts "Review the codebase structure"

# Custom auth file
PI_AUTH_FILE=/path/to/auth.json bun run agent.ts "Run tests and report results"

# With API key from env
ANTHROPIC_API_KEY=sk-ant-... bun run agent.ts "Check for security issues"
```

---

## Common Patterns

### Capture Final Text Output

```typescript
let finalOutput = "";
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    finalOutput += event.assistantMessageEvent.delta;
  }
});
await session.prompt("...");
console.log("Final output:", finalOutput);
```

### Access Structured Messages

```typescript
await session.prompt("...");

for (const msg of session.state.messages) {
  if (msg.role === "assistant") {
    for (const block of msg.content) {
      if (block.type === "text") {
        console.log("Text:", block.text);
      } else if (block.type === "toolCall") {
        console.log("Tool:", block.name, block.arguments);
      }
    }
  }
}
```

### Error Handling

```typescript
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "error") {
    console.error("Agent error:", event.assistantMessageEvent.error.errorMessage);
    process.exit(1);
  }
});
```

### Multiple Prompts in Sequence

```typescript
await session.prompt("First, analyze the project structure.");
await session.prompt("Now suggest improvements based on your analysis.");
await session.prompt("Finally, create a summary report.");
```

---

## Key Imports Reference

```typescript
// Main session creation
import { createAgentSession } from "@mariozechner/pi-coding-agent";

// Model utilities
import { getModel } from "@mariozechner/pi-ai";

// Auth and registry
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

// Session management
import { SessionManager } from "@mariozechner/pi-coding-agent";

// Settings
import { SettingsManager } from "@mariozechner/pi-coding-agent";

// Resource loading
import { DefaultResourceLoader, createExtensionRuntime } from "@mariozechner/pi-coding-agent";

// Tools
import {
  readTool, bashTool, grepTool, editTool, writeTool,
  codingTools, readOnlyTools,
  createReadTool, createBashTool, createGrepTool,
  createEditTool, createWriteTool,
  createCodingTools, createReadOnlyTools,
} from "@mariozechner/pi-coding-agent";

// Types
import type { ResourceLoader, Tool, Skill, PromptTemplate } from "@mariozechner/pi-coding-agent";
```

---

## Auth File Format

Default location: `~/.pi/agent/auth.json`

```json
{
  "anthropic": "sk-ant-...",
  "openai": "sk-...",
  "google": "...",
  "custom-provider": {
    "access": "...",
    "refresh": "...",
    "expires": 1234567890
  }
}
```
