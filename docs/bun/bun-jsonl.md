# Bun JSONL

## Purpose

Parse newline-delimited JSON (JSONL) with Bun's built-in streaming parser.

## When to use what

- Use `Bun.JSONL.parse()` for complete input (returns array of all values).
- Use `Bun.JSONL.parseChunk()` for streaming (returns partial results + position).

## Parsing complete input

```ts
import { JSONL } from "bun";

const input = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n';
const records = JSONL.parse(input);
// [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
```

Works with `Uint8Array` too (UTF-8 BOM is auto-skipped):

```ts
const buffer = new TextEncoder().encode('{"a":1}\n{"b":2}\n');
const results = Bun.JSONL.parse(buffer);
```

Any valid JSON value per line, not just objects:

```ts
const values = Bun.JSONL.parse('42\n"hello"\ntrue\nnull\n[1,2,3]\n');
// [42, "hello", true, null, [1, 2, 3]]
```

Throws `SyntaxError` on invalid JSON:

```ts
try {
  Bun.JSONL.parse('{"valid":true}\n{invalid}\n');
} catch (err) {
  console.error(err); // SyntaxError
}
```

## Streaming with `parseChunk()`

Parses as many complete values as possible and reports progress:

```ts
const chunk = '{"id":1}\n{"id":2}\n{"id":3';

const result = Bun.JSONL.parseChunk(chunk);
result.values; // [{ id: 1 }, { id: 2 }]
result.read;   // 17 — characters consumed
result.done;   // false — incomplete value remains
result.error;  // null — no parse error
```

### Accumulating chunks

Use `read` to slice off consumed input:

```ts
let buffer = "";

for await (const chunk of stream) {
  buffer += chunk;
  const result = Bun.JSONL.parseChunk(buffer);

  for (const value of result.values) {
    handleRecord(value);
  }

  buffer = buffer.slice(result.read);
}
```

### Binary streams

With `Uint8Array`, you can pass `start` and `end` offsets:

```ts
const buf = new TextEncoder().encode('{"a":1}\n{"b":2}\n{"c":3}\n');

const result = Bun.JSONL.parseChunk(buf, 8);
result.values; // [{ b: 2 }, { c: 3 }]
result.read;   // 24 (byte offset into original buffer)
```

Zero-copy streaming:

```ts
let buf = new Uint8Array(0);

for await (const chunk of stream) {
  const newBuf = new Uint8Array(buf.length + chunk.length);
  newBuf.set(buf);
  newBuf.set(chunk, buf.length);
  buf = newBuf;

  const result = Bun.JSONL.parseChunk(buf);

  for (const value of result.values) {
    handleRecord(value);
  }

  buf = buf.slice(result.read);
}
```

### Error recovery

Unlike `parse()`, `parseChunk()` doesn't throw. Errors are returned in `result.error`:

```ts
const input = '{"a":1}\n{invalid}\n{"b":2}\n';
const result = Bun.JSONL.parseChunk(input);

result.values; // [{ a: 1 }] — values parsed before error
result.error;  // SyntaxError
result.read;   // 8 — position up to last successful parse
```

## Notes

- ASCII input uses a zero-allocation fast path.
- Non-ASCII `Uint8Array` is decoded via SIMD-accelerated UTF-16 conversion.
- UTF-8 BOM at buffer start is auto-skipped.

## References

- https://bun.com/docs/api/jsonl
