# Sessions

## Session Management

### In-Memory (No Persistence) — Most Common for Scripts

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

### Session File Locations

Sessions are stored at: `~/.pi/agent/sessions/<cwd-hash>/`

### Multiple Prompts in Sequence

```typescript
await session.prompt("First, analyze the project structure.");
await session.prompt("Now suggest improvements based on your analysis.");
await session.prompt("Finally, create a summary report.");
```

### Session State Access

```typescript
session.state.messages;  // Conversation history
session.sessionFile;     // Path to session file (if persisted)
session.sessionId;       // Unique session ID
```

---

## Resource Loader (System Prompt)

For self-contained scripts, you typically want full control over the system prompt without file discovery.

### Minimal ResourceLoader (No Discovery)

```typescript
import { createExtensionRuntime, type ResourceLoader } from "@mariozechner/pi-coding-agent";

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
```

### Using DefaultResourceLoader with Overrides

```typescript
import { DefaultResourceLoader, SettingsManager } from "@mariozechner/pi-coding-agent";

const cwd = process.cwd();

const loader = new DefaultResourceLoader({
  cwd,
  settingsManager: SettingsManager.inMemory(),
  
  // Replace system prompt entirely
  systemPrompt: `You are a code reviewer.
Working directory: ${cwd}
Focus on security issues and best practices.
Be concise.`,
  
  // Append to system prompt
  appendSystemPrompt: `## Additional Rules
- Always explain your reasoning
- Use bullet points`,
  
  // Disable discovery features
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
});

await loader.reload();

const { session } = await createAgentSession({
  cwd,
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
```

### DefaultResourceLoader Options

| Option | Type | Description |
|--------|------|-------------|
| `cwd` | `string` | Working directory |
| `agentDir` | `string` | Config directory (default: `~/.pi/agent`) |
| `systemPrompt` | `string` | Replace system prompt entirely |
| `appendSystemPrompt` | `string` | Append to system prompt |
| `noExtensions` | `boolean` | Skip extension discovery |
| `noSkills` | `boolean` | Skip skill discovery |
| `noPromptTemplates` | `boolean` | Skip prompt template discovery |
| `noThemes` | `boolean` | Skip theme discovery |

### Helper: Minimal ResourceLoader Factory

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
