# Windmill Integration

For running pi agents as Windmill scripts.

## Required: Disable Bundling

Windmill bundles scripts by default, which breaks pi imports. Add this at the top:

```typescript
//nobundling
```

## Secrets via Windmill Variables

Store your auth JSON in a Windmill variable (e.g., `f/env/pi`):

```typescript
import * as wmill from "windmill-client";

const authJson = await wmill.getVariable("f/env/pi");
await Bun.write(AUTH_FILE, authJson);

const authStorage = new AuthStorage(AUTH_FILE);
```

Auth JSON format:
```json
{"anthropic": "sk-ant-...", "google-antigravity": "..."}
```

## Returning HTML to Windmill Apps

Windmill apps can render HTML directly. Return `{ html: string }`:

```typescript
import Showdown from "showdown";

function markdownToHtml(markdown: string): string {
  const converter = new Showdown.Converter({
    tables: true,
    ghCompatibleHeaderId: true,
    simpleLineBreaks: false,
    openLinksInNewWindow: true,
  });
  return converter.makeHtml(markdown);
}

export async function main(question: string) {
  // ... agent runs and writes to OUTPUT_FILE ...
  
  const markdown = await Bun.file(OUTPUT_FILE).text();
  return { html: wrapInHtmlTemplate(markdown) };
}
```

## Pattern: Agent Writes Output File

Have the agent write to a known file, then read it back:

```typescript
const OUTPUT_FILE = resolve(BASE_DIR, "output.md");

// In system prompt:
const systemPrompt = `...
Write your final answer to: ${OUTPUT_FILE}
Write ONLY the content — no meta-commentary like "I've written..."
...`;

// After agent runs:
const file = Bun.file(OUTPUT_FILE);
if (await file.exists()) {
  const markdown = await file.text();
  return { html: wrapHtml(markdown) };
}

// Fallback: extract from session messages
for (const msg of [...session.state.messages].reverse()) {
  if (msg.role === "assistant") {
    for (const block of msg.content) {
      if (block.type === "text" && block.text.trim()) {
        return { html: wrapHtml(block.text) };
      }
    }
  }
}
```

## Logging Helper

Useful for debugging in Windmill logs:

```typescript
function timestamp(): string {
  return new Date().toISOString().split("T")[1].slice(0, 12);
}

function log(category: string, message: string) {
  console.log(`[${timestamp()}] [${category}] ${message}`);
}

// Usage:
log("FETCH", `Fetching ${url}...`);
log("PARSE", `Extracted ${comments.length} comments`);
log("AGENT", `Agent finished in ${duration}s`);
```

## Full Windmill Agent Template

```typescript
//nobundling
import * as wmill from "windmill-client";
import Showdown from "showdown";
import { getModel } from "@mariozechner/pi-ai";
import {
  AuthStorage,
  createAgentSession,
  createBashTool,
  createReadTool,
  createWriteTool,
  createExtensionRuntime,
  ModelRegistry,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { resolve } from "path";

const BASE_DIR = resolve(process.cwd(), "shared");
const AUTH_FILE = resolve(BASE_DIR, "auth.json");
const OUTPUT_FILE = resolve(BASE_DIR, "output.md");

function log(cat: string, msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 23)}] [${cat}] ${msg}`);
}

export async function main(question: string) {
  log("START", `Agent starting`);

  // --- Auth from Windmill variable ---
  const authJson = await wmill.getVariable("f/env/pi");
  await Bun.write(AUTH_FILE, authJson);

  const cwd = BASE_DIR;
  const authStorage = new AuthStorage(AUTH_FILE);
  const modelRegistry = new ModelRegistry(authStorage);

  // --- Model ---
  const model = getModel("anthropic", "claude-sonnet-4-5");
  if (!model) throw new Error("Model not found");

  // --- Resource Loader ---
  const resourceLoader: ResourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => `You are a helpful assistant.

Working directory: ${cwd}

Write your final answer to: ${OUTPUT_FILE}
Write ONLY the answer — no meta-commentary.`,
    getAppendSystemPrompt: () => [],
    getPathMetadata: () => new Map(),
    reload: async () => {},
  };

  // --- Create Session ---
  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel: "low",
    authStorage,
    modelRegistry,
    resourceLoader,
    tools: [createReadTool(cwd), createBashTool(cwd), createWriteTool(cwd)],
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 3 },
    }),
  });

  // --- Run ---
  await session.prompt(question);

  // --- Read output ---
  const file = Bun.file(OUTPUT_FILE);
  if (await file.exists()) {
    const markdown = await file.text();
    return { html: wrapHtml(markdown) };
  }

  // Fallback
  for (const msg of [...session.state.messages].reverse()) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text" && block.text.trim()) {
          return { html: wrapHtml(block.text) };
        }
      }
    }
  }

  return { html: wrapHtml("No output generated.") };
}

function wrapHtml(markdown: string): string {
  const converter = new Showdown.Converter({ tables: true });
  const content = converter.makeHtml(markdown);
  return `<div id="output">
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  h1, h2, h3 { margin-top: 1.5rem; }
  code { background: #f0f0f0; padding: 0.2em 0.4em; border-radius: 3px; }
  pre { background: #1a1a1a; color: #e0e0e0; padding: 1rem; border-radius: 4px; overflow-x: auto; }
</style>
<div id="content">${content}</div>
</div>`;
}
```
