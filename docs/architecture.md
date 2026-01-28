# Architecture

## Key Imports

### Main Session Creation

```typescript
import { createAgentSession } from "@mariozechner/pi-coding-agent";
```

### Model Utilities

```typescript
import { getModel } from "@mariozechner/pi-ai";
```

### Auth and Registry

```typescript
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
```

### Session Management

```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent";
```

### Settings

```typescript
import { SettingsManager } from "@mariozechner/pi-coding-agent";
```

### Resource Loading

```typescript
import {
  DefaultResourceLoader,
  createExtensionRuntime,
  type ResourceLoader,
} from "@mariozechner/pi-coding-agent";
```

### Types

```typescript
import type {
  ResourceLoader,
  Tool,
  Skill,
  PromptTemplate,
} from "@mariozechner/pi-coding-agent";
```

### For Custom Tools

```typescript
import { Type } from "@sinclair/typebox";
```

---

## Event Handling

### Subscribe to Events

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

### Event Types

| Type | Description |
|------|-------------|
| `text_delta` | Streaming text output from the model |
| `thinking_delta` | Model reasoning (when thinking is enabled) |
| `toolcall_start` | Tool call initiated |
| `toolcall_delta` | Tool argument streaming |
| `done` | Turn complete |
| `error` | Error occurred |

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

---

## Common Patterns

### Parallel Agent Execution

Run multiple agents concurrently using Bun's Promise handling:

```typescript
const tasks = [
  { cwd: "/project/module-a", prompt: "Analyze this module" },
  { cwd: "/project/module-b", prompt: "Analyze this module" },
];

const results = await Promise.all(
  tasks.map(async (task) => {
    const { session } = await createAgentSession({
      cwd: task.cwd,
      tools: createReadOnlyTools(task.cwd),
      sessionManager: SessionManager.inMemory(),
      resourceLoader: createMinimalResourceLoader(task.cwd),
    });
    
    let output = "";
    session.subscribe((e) => {
      if (e.type === "message_update" && e.assistantMessageEvent.type === "text_delta") {
        output += e.assistantMessageEvent.delta;
      }
    });
    
    await session.prompt(task.prompt);
    return { cwd: task.cwd, output };
  })
);
```

### Agent with Timeout

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60_000);

try {
  await session.prompt("Complex analysis task", { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
```

### Sequential Prompts with Context

```typescript
await session.prompt("First, analyze the project structure.");
await session.prompt("Now suggest improvements based on your analysis.");
await session.prompt("Finally, create a summary report.");
```

### Capture Output to Variable

```typescript
let output = "";
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    output += event.assistantMessageEvent.delta;
  }
});
await session.prompt("...");
// output now contains full response
```

### Write Output to File

```typescript
import { writeFileSync } from "fs";

let output = "";
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    output += event.assistantMessageEvent.delta;
  }
});

await session.prompt("Generate a report");
writeFileSync("report.md", output);
```

### Minimal ResourceLoader Factory

```typescript
function createMinimalResourceLoader(cwd: string, systemPrompt?: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt || `You are a task automation assistant.\nWorking directory: ${cwd}`,
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    reload: async () => {},
  };
}
```

### Error Recovery Pattern

```typescript
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "error") {
    const error = event.assistantMessageEvent.error;
    console.error("Agent error:", error.errorMessage);
    // Handle gracefully or retry
  }
});
```
