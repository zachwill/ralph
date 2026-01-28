# Bun Utils

## Purpose

Use Bun’s built-in utility APIs for common runtime tasks: sleeping, locating binaries, formatting output, timing, and consuming streams.

## When to use Bun utils

- Prefer `Bun.sleep()` over ad-hoc `setTimeout` wrappers.
- Prefer `Bun.which()` over shelling out to `which`.
- Prefer `Bun.readableStreamTo*()` helpers when you need to consume a `ReadableStream` body efficiently.
- Prefer `Bun.nanoseconds()` for high-resolution timing.

## Version + runtime info

```ts
console.log(Bun.version);
console.log(Bun.revision);
console.log(Bun.main);
```

Notes:

- `Bun.env` is an alias for `process.env`.
- `Bun.main` is useful to detect “executed vs imported”.

```ts
if (import.meta.path === Bun.main) {
  // executed directly via `bun run ...`
}
```

## Sleep

```ts
await Bun.sleep(250);
Bun.sleepSync(50); // blocking
```

You can also sleep until a specific `Date`.

```ts
await Bun.sleep(new Date(Date.now() + 1000));
```

## Find executables with `Bun.which()`

```ts
const git = Bun.which("git");
if (!git) throw new Error("git not found on PATH");
```

Override resolution via `PATH` or `cwd`:

```ts
const bin = Bun.which("my-tool", { cwd: "/tmp", PATH: "/usr/local/bin:/usr/bin:/bin" });
```

## Inspect + tables

`Bun.inspect()` formats values the way Bun would print them.

```ts
const s = Bun.inspect({ ok: true, ts: Date.now() });
console.log(s);
```

Tabular formatting (like `console.table`, but returns a string):

```ts
console.log(Bun.inspect.table([{ a: 1, b: 2 }, { a: 3, b: 4 }]));
```

## Timing with `Bun.nanoseconds()`

```ts
const start = Bun.nanoseconds();
// ...work...
const elapsedNs = Bun.nanoseconds() - start;
console.log({ elapsedNs });
```

## Stream consumption helpers

When you have a `ReadableStream` (e.g. `Response.body`), Bun provides helpers to consume it.

```ts
const res = await fetch("https://example.com");
if (!res.body) throw new Error("no body");

const text = await Bun.readableStreamToText(res.body);
```

Other common conversions:

```ts
const bytes = await Bun.readableStreamToBytes(stream);
const json = await Bun.readableStreamToJSON(stream);
const blob = await Bun.readableStreamToBlob(stream);
```

## Terminal-string helpers

Strip ANSI escape codes:

```ts
const plain = Bun.stripANSI("\u001b[31mred\u001b[0m");
```

Measure how wide a string will render in a terminal:

```ts
const cols = Bun.stringWidth("hi\u001b[0m");
```

## Module/path helpers

Resolve specifiers the way Bun would:

```ts
const resolved = Bun.resolveSync("zod", process.cwd());
```

Convert between paths and `file://` URLs:

```ts
const url = Bun.pathToFileURL("/tmp/a.txt");
const path = Bun.fileURLToPath(url);
```

## Notes

- `Bun.peek()` is a performance-oriented primitive; avoid it unless you know you need to bypass microtasks.
- Compression helpers (`gzipSync`, `deflateSync`, `zstdCompress*`) are great for tooling, but keep server hot paths simple and measure before optimizing.

## References

- https://bun.com/docs/api/utils
- https://bun.com/docs/api/fetch
- https://bun.com/docs/api/streams
