# Tools

## Built-in Tools

| Tool | Purpose |
|------|---------|
| `read` | Read file contents (text + images) |
| `write` | Create or overwrite files |
| `edit` | Surgical find-and-replace edits |
| `bash` | Execute shell commands |
| `grep` | Search file contents |
| `find` | Find files by name/pattern |
| `ls` | List directory contents |

## Tool Sets

```typescript
import { codingTools, readOnlyTools } from "@mariozechner/pi-coding-agent";

codingTools   // read, write, edit, bash
readOnlyTools // read, bash, grep, find, ls
```

## Tool Imports

### Pre-instantiated (use process.cwd())

```typescript
import {
  readTool,
  bashTool,
  grepTool,
  editTool,
  writeTool,
  codingTools,
  readOnlyTools,
} from "@mariozechner/pi-coding-agent";
```

### Factory Functions (for custom cwd)

```typescript
import {
  createReadTool,
  createBashTool,
  createGrepTool,
  createEditTool,
  createWriteTool,
  createCodingTools,
  createReadOnlyTools,
} from "@mariozechner/pi-coding-agent";
```

## Factory Functions (REQUIRED for custom cwd)

**Important:** When using a custom `cwd`, you MUST use factory functions. The pre-instantiated tools use `process.cwd()`.

```typescript
const cwd = "/path/to/project";

// All coding tools for custom cwd
const { session } = await createAgentSession({
  cwd,
  tools: createCodingTools(cwd),
});

// Or select specific tools
const { session } = await createAgentSession({
  cwd,
  tools: [
    createReadTool(cwd),
    createBashTool(cwd),
    createGrepTool(cwd),
  ],
});
```

## Read-Only Analysis Agent

```typescript
const { session } = await createAgentSession({
  cwd,
  tools: createReadOnlyTools(cwd),  // read, bash, grep, find, ls — no write/edit
  sessionManager: SessionManager.inMemory(),
});
```

## Tool Output Truncation

Tools should truncate large outputs:

```typescript
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";

const truncation = truncateHead(output, {
  maxLines: DEFAULT_MAX_LINES,  // 2000
  maxBytes: DEFAULT_MAX_BYTES,  // 50KB
});

if (truncation.truncated) {
  resultText += `\n[Truncated: ${truncation.outputLines}/${truncation.totalLines} lines]`;
}
```

---

## Custom Tools

### Registering a Tool

```typescript
import { Type } from "@sinclair/typebox";

const myTool = {
  name: "my_tool",
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
};

const { session } = await createAgentSession({
  tools: [createReadTool(cwd), createBashTool(cwd), myTool],
  sessionManager: SessionManager.inMemory(),
});
```

### Tool Execute Signature

```typescript
async execute(
  toolCallId: string,
  params: TParams,
  onUpdate?: (update: ToolUpdate) => void,
  ctx?: ToolContext,
  signal?: AbortSignal
): Promise<ToolResult>
```

### ToolUpdate Structure

```typescript
interface ToolUpdate {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
}
```

### ToolResult Structure

```typescript
interface ToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; ... }>;
  details?: Record<string, unknown>;
}
```

### Using Custom Tools with Sessions

```typescript
const { session } = await createAgentSession({
  tools: [
    createReadTool(cwd),
    createBashTool(cwd),
    myCustomTool,
    anotherCustomTool,
  ],
  sessionManager: SessionManager.inMemory(),
});
```
