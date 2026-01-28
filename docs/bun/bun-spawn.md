# Bun Spawn

## Purpose

Run external commands from Bun using `Bun.spawn()` (async) or `Bun.spawnSync()` (blocking).

## When to use spawn

- Use `Bun.spawn()` in servers and long-running apps where you want streaming output, cancellation, and non-blocking behavior.
- Use `Bun.spawnSync()` in CLIs and scripts where blocking is fine and you want a simple result object.

## Minimal `Bun.spawn()`

Pass the command as an array of strings.

```ts
const proc = Bun.spawn(["bun", "--version"], { stdout: "pipe", stderr: "pipe" });

const stdout = await proc.stdout.text();
const exitCode = await proc.exited;

if (exitCode !== 0) throw new Error(`bun --version failed: ${exitCode}`);
console.log(stdout.trim());
```

## Capturing output (stdout/stderr)

Set `stdout: "pipe"` (default) and/or `stderr: "pipe"` to read output as `ReadableStream`.

```ts
const proc = Bun.spawn(["git", "status", "--porcelain"], {
  stdout: "pipe",
  stderr: "pipe",
});

const [out, err, code] = await Promise.all([
  proc.stdout.text(),
  proc.stderr.text(),
  proc.exited,
]);

if (code !== 0) throw new Error(err || `git status failed: ${code}`);
console.log(out);
```

Other useful modes:

- `"inherit"`: show output in the parent process (great for interactive debugging)
- `"ignore"`: discard output
- `Bun.file("...")`: write output directly to a file

## Providing input (stdin)

### Simple input (buffer/string)

```ts
const encoder = new TextEncoder();
const proc = Bun.spawn(["cat"], {
  stdin: encoder.encode("hello\n"),
  stdout: "pipe",
});

console.log(await proc.stdout.text());
```

### Streaming input (`stdin: "pipe"`)

Use `stdin: "pipe"` to get a `FileSink` you can `.write()` into.

```ts
const proc = Bun.spawn(["cat"], { stdin: "pipe", stdout: "pipe" });

proc.stdin.write("hello ");
proc.stdin.write("world\n");
proc.stdin.end();

console.log(await proc.stdout.text());
```

## Exit handling + cancellation

### `proc.exited`

`proc.exited` is a `Promise<number>` that resolves with the exit code.

```ts
const proc = Bun.spawn(["sleep", "10"]);
await proc.exited;
```

### AbortSignal

Use an `AbortController` to cancel a child process.

```ts
const controller = new AbortController();
const proc = Bun.spawn({ cmd: ["sleep", "100"], signal: controller.signal });

setTimeout(() => controller.abort(), 250);
await proc.exited;
```

### Timeout

Use `timeout` (ms) to automatically terminate a process; customize the signal with `killSignal`.

```ts
const proc = Bun.spawn({ cmd: ["sleep", "10"], timeout: 500, killSignal: "SIGKILL" });
await proc.exited;
```

## `Bun.spawnSync()` for CLIs

`Bun.spawnSync()` returns buffers instead of streams.

```ts
const result = Bun.spawnSync(["echo", "hello"]);

if (!result.success) throw new Error(`exit ${result.exitCode}`);
console.log(result.stdout?.toString() ?? "");
```

## Notes

- Prefer `stdout: "inherit"` when you want real-time logs (especially for dev tooling).
- Use `proc.unref()` when you *don’t* want child processes keeping Bun alive.
- Advanced topics like IPC and PTY terminals exist, but only reach for them when you need interactive TTY behavior or structured cross-process messaging.

## References

- https://bun.com/docs/api/spawn
- https://bun.com/docs/api/streams
