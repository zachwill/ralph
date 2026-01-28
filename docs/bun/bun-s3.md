# Bun S3

## Purpose

Use Bun's native S3 bindings to read, write, and presign objects from S3-compatible storage.

## Quick start

```ts
import { s3, write } from "bun";

// Bun.s3 reads environment variables for credentials
const metadata = s3.file("123.json");

// Download from S3 as JSON
const data = await metadata.json();

// Upload to S3
await write(metadata, JSON.stringify({ name: "John", age: 30 }));

// Presign a URL (no network request needed)
const url = metadata.presign({
  acl: "public-read",
  expiresIn: 60 * 60 * 24,
});

// Delete the file
await metadata.delete();
```

## Clients and credentials

`Bun.s3` is a global singleton equivalent to `new Bun.S3Client()`. To use explicit credentials or a custom endpoint, create an `S3Client`.

```ts
import { S3Client } from "bun";

const client = new S3Client({
  accessKeyId: "your-access-key",
  secretAccessKey: "your-secret-key",
  bucket: "my-bucket",
  // endpoint: "https://s3.us-east-1.amazonaws.com",
});
```

### Environment variables

Bun reads S3 credentials from `S3_*` variables, with `AWS_*` fallbacks:

| Option name       | Environment variable   | Fallback environment variable |
| ----------------- | ---------------------- | ----------------------------- |
| `accessKeyId`     | `S3_ACCESS_KEY_ID`     | `AWS_ACCESS_KEY_ID`           |
| `secretAccessKey` | `S3_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY`       |
| `region`          | `S3_REGION`            | `AWS_REGION`                  |
| `endpoint`        | `S3_ENDPOINT`          | `AWS_ENDPOINT`                |
| `bucket`          | `S3_BUCKET`            | `AWS_BUCKET`                  |
| `sessionToken`    | `S3_SESSION_TOKEN`     | `AWS_SESSION_TOKEN`           |

These values are read from `.env` files or the process environment during initialization.

## Working with S3 files

`S3Client.file()` returns a lazy `S3File` reference. It behaves like `Blob`, so the same methods that work on `Blob` work on S3 files.

```ts
const file = client.file("logs/2025-01-01.json");

const text = await file.text();
const json = await file.json();
const bytes = await file.bytes();

// Partial reads with Range requests
const partial = await file.slice(0, 1024).text();
```

### Writing and uploading

```ts
const file = client.file("reports/summary.json");

await file.write(JSON.stringify({ ok: true }), {
  type: "application/json",
});

// Streaming writes
const writer = file.writer({ type: "text/plain" });
writer.write("Hello");
writer.write(" World");
await writer.end();

// Or use Bun.write
await Bun.write(file, "Hello World");
```

### Large files and multipart uploads

Bun automatically handles multipart uploads for large files via the writer API.

```ts
const writer = file.writer({
  retry: 3,
  queueSize: 10,
  partSize: 5 * 1024 * 1024,
});

for (let i = 0; i < 10; i++) {
  writer.write(Buffer.alloc(5 * 1024 * 1024));
  await writer.flush();
}

await writer.end();
```

## Presigning URLs

Presigned URLs let clients upload/download directly from S3 without exposing credentials.

```ts
import { s3 } from "bun";

const download = s3.presign("public/readme.txt");

const upload = s3.presign("uploads/report.json", {
  method: "PUT",
  expiresIn: 3600,
  type: "application/json",
  acl: "public-read",
});
```

### Redirecting to presigned URLs

Passing an `S3File` to `new Response()` returns a redirect response to the presigned URL.

```ts
const file = s3.file("reports/summary.json");
const response = new Response(file);
```

## S3-compatible services

Use `endpoint` (or `region` for AWS) to target S3-compatible providers.

```ts
import { S3Client } from "bun";

const aws = new S3Client({
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  bucket: "my-bucket",
  region: "us-east-1",
});

const r2 = new S3Client({
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  bucket: "my-bucket",
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
});

const minio = new S3Client({
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  bucket: "my-bucket",
  endpoint: "http://localhost:9000",
});
```

### Virtual hosted-style endpoints

Set `virtualHostedStyle: true` when your endpoint uses the bucket as a subdomain.

```ts
const s3 = new S3Client({
  accessKeyId: "access-key",
  secretAccessKey: "secret-key",
  endpoint: "https://<bucket-name>.s3.<region>.amazonaws.com",
  virtualHostedStyle: true,
});
```

## `s3://` protocol

Use `s3://` URLs in `fetch` or `Bun.file` to share code between local and S3 files.

```ts
const response = await fetch("s3://my-bucket/my-file.txt", {
  s3: {
    accessKeyId: "your-access-key",
    secretAccessKey: "your-secret-key",
    endpoint: "https://s3.us-east-1.amazonaws.com",
  },
  headers: {
    range: "bytes=0-1023",
  },
});

const file = Bun.file("s3://my-bucket/my-file.txt");
```

## Error codes

Bun may throw errors with the following `code` values:

- `ERR_S3_MISSING_CREDENTIALS`
- `ERR_S3_INVALID_METHOD`
- `ERR_S3_INVALID_PATH`
- `ERR_S3_INVALID_ENDPOINT`
- `ERR_S3_INVALID_SIGNATURE`
- `ERR_S3_INVALID_SESSION_TOKEN`

Errors returned by the storage service are `S3Error` instances (name `"S3Error"`).

## References

- https://bun.com/docs/api/s3
