# LLML Prompting for Pi Agents

How to structure prompts so agents actually follow instructions.

## The Pattern

Use `@zenbase/llml` to create structured key: value prompts, then pass them in the user message (not the system prompt).

```typescript
import { llml } from "@zenbase/llml";

const SYSTEM_PROMPT = llml({
  role: "You are an expert NBA salary cap analyst",
  task: [
    "Search the CBA docs to answer the question",
    "Write your analysis to output.md",
  ],
  goal: "Provide accurate, well-cited answers",
  sources: [
    "cba/revised/ — Rewritten 2023 NBA CBA (preferred)",
    "cba/original/ — Original CBA text",
  ],
  approach: [
    "Use bash tools (rg, grep) to search — files are large",
    "Make multiple targeted tool calls rather than reading entire files",
  ],
  output: [
    "Write final answer to output.md with clear markdown",
    "Include citations to specific articles/sections",
  ],
  constraints: [
    "No meta-commentary ('I've written...', 'Here's my analysis...')",
    "Write ONLY the answer content directly",
  ],
});
```

Then pass it with a framing that signals importance:

```typescript
const prompt = `
- The following is your system prompt
- Search the CBA docs and answer the question
- Write your analysis to output.md
- Follow the system prompt or your task will be marked as a failure

SYSTEM PROMPT:

${SYSTEM_PROMPT}

QUESTION:

${question}`;

await session.prompt(prompt);
```

## Why This Works

1. **Key: value format** — Models parse structured data better than prose paragraphs
2. **User prompt positioning** — Instructions in the user turn get more attention than buried in system prompts
3. **Explicit failure framing** — "Follow or task fails" signals criticality
4. **Succinct bullets** — Short, scannable items beat long explanations

## Resource Loader Setup

Use `DefaultResourceLoader` — don't override the system prompt:

```typescript
const resourceLoader = new DefaultResourceLoader({
  cwd,
  noExtensions: true,
  noSkills: true,
});
```

The default pi system prompt handles tool usage and basics. Your LLML prompt in the user message handles the specific task.

## LLML Keys

Pick keys that make sense for your task. Common ones:

| Key | Purpose |
|-----|---------|
| `role` | Who the agent is |
| `task` | Steps to complete |
| `goal` | What success looks like |
| `sources` | Available data/files |
| `approach` | How to work |
| `output` | Format requirements |
| `constraints` | What NOT to do |
| `critical` | Warnings/gotchas |

You can use any keys — LLML just formats them as `key: value`. Use whatever fits your domain:

```typescript
// For a code review agent
llml({
  role: "You review pull requests for security issues",
  check: ["SQL injection", "XSS", "auth bypass", "secrets in code"],
  ignore: ["Style issues", "Minor refactors"],
  output: ["List issues with file:line", "Rate severity: low/medium/high/critical"],
});

// For a research agent
llml({
  role: "You research technical topics",
  sources: ["Search the web", "Read documentation"],
  synthesize: ["Compare approaches", "Note tradeoffs"],
  format: ["Markdown with headers", "Code examples where relevant"],
});
```

## Constraints > Positive Instructions

Telling the model what NOT to do is often more effective:

```typescript
// Good — specific about what to avoid
constraints: [
  "No meta-commentary ('I analyzed...', 'Here's what I found...')",
  "No summaries or overviews — only insights",
  "Never reference source files by name",
]

// Less effective — vague positive instruction
style: ["Be insightful"]
```

## Be Specific About Limits

```typescript
// Good — concrete
structure: ["2-3 insight sections (never more than 3)"]

// Vague — model will interpret loosely
structure: ["A few insight sections"]
```

## Full Example

```typescript
import { llml } from "@zenbase/llml";
import { getModel } from "@mariozechner/pi-ai";
import {
  createAgentSession,
  createBashTool,
  createReadTool,
  createWriteTool,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";

const SYSTEM_PROMPT = llml({
  role: "You extract tacit knowledge from Hacker News comments",
  task: [
    "Read comments.txt using your tools",
    "Extract and distill the tacit knowledge",
    "Write your analysis to output.md",
  ],
  goal: "Write like an insightful friend sharing what they learned — not a summary",
  focus: [
    "Tacit knowledge hidden in the comments",
    "Paradoxes and disagreements (there could be insight there)",
  ],
  structure: [
    "Summary: 2-3 sentence TLDR",
    "Insights: 2-3 sections, tiered by significance",
  ],
  style: [
    "Clarity, insight, brevity",
    "Preserve specifics: numbers, tool names, company names",
  ],
  constraints: [
    "No meta-commentary ('I analyzed...', 'Here's what I found...')",
    "Never reference the source files by name",
    "Never produce an overview — only insights",
  ],
});

const { session } = await createAgentSession({
  cwd,
  model: getModel("anthropic", "claude-opus-4-5"),
  thinkingLevel: "high",
  resourceLoader: new DefaultResourceLoader({ cwd, noExtensions: true, noSkills: true }),
  tools: [createReadTool(cwd), createBashTool(cwd), createWriteTool(cwd)],
  sessionManager: SessionManager.inMemory(),
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
});

const prompt = `
- The following is your system prompt
- Read comments.txt and extract key insights
- Write your analysis to output.md
- Follow the system prompt or your task will be marked as a failure

SYSTEM PROMPT:

${SYSTEM_PROMPT}`;

await session.prompt(prompt);
```

## Summary

1. Use `llml()` to create structured key: value prompts
2. Pass via user message, not system prompt
3. Use `DefaultResourceLoader` — don't override system prompt
4. Frame with "follow or task fails"
5. Constraints beat positive instructions
6. Be specific about limits
