# Bun SSE

## Purpose

Stream one-way server-to-client updates using Server-Sent Events (SSE) with Bun.

## When to use SSE

SSE is a great fit for one-way, server-to-client streaming updates like:

- job logs and progress updates
- AI/agent streaming responses
- notifications and presence pings

SSE uses a long-lived HTTP response with `text/event-stream` content type, so you can stream incremental updates without WebSockets.

## Minimal SSE response

Use a `ReadableStream` to push SSE frames. Make sure to set headers for long-lived streaming responses.

```ts
export function createSSEResponse(
  gen: AsyncGenerator<string>,
  signal?: AbortSignal,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const enqueue = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {}
      };

      enqueue(`retry: 5000\n\n`);
      const iv = setInterval(() => enqueue(`: keepalive ${Date.now()}\n\n`), 15000);

      try {
        for await (const chunk of gen) {
          if (signal?.aborted) break;
          enqueue(chunk);
        }
      } catch (err) {
        console.error("SSE stream error:", err);
      } finally {
        clearInterval(iv);
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

## SSE framing helpers

SSE expects each message to be split into `event:` and `data:` lines. This helper makes it easy to send HTML patches or signal updates as structured SSE events.

```ts
import { renderToString } from "react-dom/server";
import type { JSX } from "react";

const NEWLINE = "\n";
const END = NEWLINE + NEWLINE;

function multiline(prefix: string, text: string) {
  return text
    .split(/\r?\n/)
    .map((l, i) => (i === 0 ? `data: ${prefix}` : `data: ${prefix.trim()} `) + l)
    .join(NEWLINE);
}

export function patchElements(
  selector: string,
  html: string | JSX.Element,
  mode: "inner" | "replace" | "append" | "prepend" = "inner",
) {
  const htmlString = typeof html === "string" ? html : renderToString(html);
  const lines = [
    "event: datastar-patch-elements",
    `data: mode ${mode}`,
    `data: selector ${selector}`,
    multiline("elements ", htmlString),
  ];
  return lines.join(NEWLINE) + END;
}

export function patchSignals(signals: Record<string, unknown>) {
  const payload = JSON.stringify(signals);
  const lines = ["event: datastar-patch-signals", `data: signals ${payload}`];
  return lines.join(NEWLINE) + END;
}
```

## Generator pattern

Use async generators to emit chunks. Each chunk should already be a fully formatted SSE frame.

```ts
import { createSSEResponse, patchElements, patchSignals } from "./sse";

async function* runStream() {
  yield patchSignals({ status: "starting" });

  yield patchElements("#log", "<p>Booted worker.</p>", "append");
  await Bun.sleep(300);

  yield patchElements("#log", "<p>Fetching data...</p>", "append");
  await Bun.sleep(300);

  yield patchSignals({ status: "done" });
}

export function handleSSE(req: Request) {
  return createSSEResponse(runStream(), req.signal);
}
```

## Notes

- Always send a `retry` line to control auto-reconnect behavior.
- Keepalive comments (`: ...`) help proxies keep the connection open.
- Use `req.signal` to stop work if the client disconnects.
- Each SSE event is separated by a blank line (`\n\n`).

## References

- https://bun.com/docs/api/http
- https://bun.com/docs/api/streams
