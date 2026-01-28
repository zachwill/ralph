# Bun I/O

## Purpose

Work with the filesystem in Bun using the fast-path APIs (`Bun.file`, `Bun.write`) and fall back to `node:fs` for directory operations.

## When to use what

- Use `Bun.file()` to *reference* a file on disk (lazy; doesn’t read until you ask).
- Use `Bun.write()` for fast writes/copies (strings, bytes, `Response`, other files).
- Use `file.writer()` (`FileSink`) for incremental/stream-like writes.
- Use `node:fs/promises` for directory operations (`readdir`, `mkdir`, etc.).

## Reading files with `Bun.file()`

`Bun.file(path)` returns a `BunFile` (Blob-like) reference.

```ts
const file = Bun.file("./data/roster.json");

const exists = await file.exists();
if (!exists) throw new Error("Missing roster.json");

const roster = await file.json();
```

Common read formats:

```ts
const file = Bun.file("./notes.txt");

const asText = await file.text();
const asBytes = await file.bytes(); // Uint8Array
const asBuffer = await file.arrayBuffer();
const asStream = file.stream(); // ReadableStream
```

Notes:

- `Bun.file()` is lazy; it’s cheap to construct and pass around.
- A missing file can still have a `BunFile` reference; call `await file.exists()` to check.

## Writing files with `Bun.write()`

`Bun.write(destination, data)` writes or copies data and returns the number of bytes written.

Write a string:

```ts
await Bun.write("./out/report.txt", "hello\n");
```

Write JSON (stringify yourself so you control formatting):

```ts
const payload = { ok: true, ts: Date.now() };
await Bun.write("./out/status.json", JSON.stringify(payload, null, 2) + "\n");
```

Copy a file:

```ts
const src = Bun.file("./in/input.bin");
const dst = Bun.file("./out/input.bin");
await Bun.write(dst, src);
```

Persist a `fetch()` response body to disk:

```ts
const res = await fetch("https://example.com");
await Bun.write("./out/index.html", res);
```

Write to `stdout` / `stderr`:

```ts
await Bun.write(Bun.stdout, "generated OK\n");
```

## Incremental writing with `FileSink`

Use `file.writer()` when you want to append lots of small chunks efficiently.

```ts
const file = Bun.file("./out/log.txt");
const sink = file.writer();

sink.write("starting\n");
for (let i = 0; i < 3; i++) sink.write(`tick ${i}\n`);

await sink.flush();
await sink.end();
```

Notes:

- Call `end()` when you’re done. A sink can keep the process alive until closed.
- You can tune buffering via `highWaterMark`:

```ts
const sink = Bun.file("./out/big.log").writer({ highWaterMark: 1024 * 1024 });
```

## Directories (use `node:fs/promises`)

Bun’s Node.js compatibility layer is usually the right tool for directory ops.

```ts
import { mkdir, readdir } from "node:fs/promises";

await mkdir("./out/reports", { recursive: true });
const files = await readdir("./out/reports");
```

Recursive directory listing:

```ts
import { readdir } from "node:fs/promises";

const all = await readdir("./out", { recursive: true });
```

## Patterns and gotchas

- Prefer `import.meta.dir` for paths relative to the current module (instead of `process.cwd()`).

```ts
import { join } from "node:path";

const path = join(import.meta.dir, "../data/seed.json");
const seed = await Bun.file(path).json();
```

- For “atomic-ish” writes, write a temp file then rename via `node:fs/promises`.

```ts
import { rename } from "node:fs/promises";

const tmp = "./out/config.json.tmp";
const final = "./out/config.json";

await Bun.write(tmp, JSON.stringify({ v: 1 }) + "\n");
await rename(tmp, final);
```

## References

- https://bun.com/docs/api/bun-file
- https://bun.com/docs/api/bun-write
- https://bun.com/docs/api/http
- https://nodejs.org/api/fs.html
