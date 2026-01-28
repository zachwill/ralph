# Bun Server

## Purpose

Use `Bun.serve` for a fast HTTP server with optional routing, HTML imports, and WebSocket support.

## Quick start

```ts
const server = Bun.serve({
  routes: {
    "/api/status": new Response("OK"),

    "/users/:id": req => {
      return new Response(`Hello User ${req.params.id}!`);
    },

    "/api/posts": {
      GET: () => new Response("List posts"),
      POST: async req => {
        const body = await req.json();
        return Response.json({ created: true, ...body });
      },
    },

    "/api/*": Response.json({ message: "Not found" }, { status: 404 }),
    "/blog/hello": Response.redirect("/blog/hello/world"),
    "/favicon.ico": Bun.file("./favicon.ico"),
  },

  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}`);
```

## HTML imports

Bun supports importing HTML files directly into server code, enabling full-stack apps with zero extra bundler setup.

```ts
import myReactSinglePageApp from "./index.html";

Bun.serve({
  routes: {
    "/": myReactSinglePageApp,
  },
});
```

**Development (`bun --hot`):** Assets are bundled on-demand at runtime with HMR.

**Production (`bun build --target=bun`):** HTML imports resolve to a pre-built manifest for optimized asset serving.

## Configuration

### Changing the `port` and `hostname`

```ts
Bun.serve({
  port: 8080, // defaults to $BUN_PORT, $PORT, $NODE_PORT otherwise 3000
  hostname: "mydomain.com", // defaults to "0.0.0.0"
  fetch(req) {
    return new Response("404!");
  },
});
```

To randomly select an available port, set `port` to `0`.

```ts
const server = Bun.serve({
  port: 0,
  fetch(req) {
    return new Response("404!");
  },
});

console.log(server.port);
console.log(server.url);
```

### Default port sources

- `--port` CLI flag
- `BUN_PORT` environment variable
- `PORT` environment variable
- `NODE_PORT` environment variable

## Unix domain sockets

```ts
Bun.serve({
  unix: "/tmp/my-socket.sock",
  fetch(req) {
    return new Response(`404!`);
  },
});
```

### Abstract namespace sockets

```ts
Bun.serve({
  unix: "\0my-abstract-socket",
  fetch(req) {
    return new Response(`404!`);
  },
});
```

## idleTimeout

```ts
Bun.serve({
  idleTimeout: 10,
  fetch(req) {
    return new Response("Bun!");
  },
});
```

## Export default syntax

```ts
import type { Serve } from "bun";

export default {
  fetch(req) {
    return new Response("Bun!");
  },
} satisfies Serve.Options<undefined>;
```

## Hot route reloading

```ts
const server = Bun.serve({
  routes: {
    "/api/version": () => Response.json({ version: "1.0.0" }),
  },
});

server.reload({
  routes: {
    "/api/version": () => Response.json({ version: "2.0.0" }),
  },
});
```

## Server lifecycle methods

### `server.stop()`

```ts
const server = Bun.serve({
  fetch(req) {
    return new Response("Hello!");
  },
});

await server.stop();
await server.stop(true);
```

### `server.ref()` and `server.unref()`

```ts
server.unref();
server.ref();
```

### `server.reload()`

```ts
const server = Bun.serve({
  routes: {
    "/api/version": Response.json({ version: "v1" }),
  },
  fetch(req) {
    return new Response("v1");
  },
});

server.reload({
  routes: {
    "/api/version": Response.json({ version: "v2" }),
  },
  fetch(req) {
    return new Response("v2");
  },
});
```

## Per-request controls

### `server.timeout(Request, seconds)`

```ts
const server = Bun.serve({
  async fetch(req, server) {
    server.timeout(req, 60);
    await req.text();
    return new Response("Done!");
  },
});
```

### `server.requestIP(Request)`

```ts
const server = Bun.serve({
  fetch(req, server) {
    const address = server.requestIP(req);
    if (address) {
      return new Response(`Client IP: ${address.address}, Port: ${address.port}`);
    }
    return new Response("Unknown client");
  },
});
```

## Server metrics

### `server.pendingRequests` and `server.pendingWebSockets`

```ts
const server = Bun.serve({
  fetch(req, server) {
    return new Response(
      `Active requests: ${server.pendingRequests}\n` +
        `Active WebSockets: ${server.pendingWebSockets}`,
    );
  },
});
```

### `server.subscriberCount(topic)`

```ts
const server = Bun.serve({
  fetch(req, server) {
    const chatUsers = server.subscriberCount("chat");
    return new Response(`${chatUsers} users in chat`);
  },
  websocket: {
    message(ws) {
      ws.subscribe("chat");
    },
  },
});
```

## Practical example: REST API

```ts
import type { Post } from "./types.ts";
import { Database } from "bun:sqlite";

const db = new Database("posts.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

Bun.serve({
  routes: {
    "/api/posts": {
      GET: () => {
        const posts = db.query("SELECT * FROM posts").all();
        return Response.json(posts);
      },
      POST: async req => {
        const post: Omit<Post, "id" | "created_at"> = await req.json();
        const id = crypto.randomUUID();

        db.query(
          `INSERT INTO posts (id, title, content, created_at)
           VALUES (?, ?, ?, ?)`
        ).run(id, post.title, post.content, new Date().toISOString());

        return Response.json({ id, ...post }, { status: 201 });
      },
    },

    "/api/posts/:id": req => {
      const post = db.query("SELECT * FROM posts WHERE id = ?").get(req.params.id);

      if (!post) {
        return new Response("Not Found", { status: 404 });
      }

      return Response.json(post);
    },
  },

  error(error) {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  },
});
```

```ts
export interface Post {
  id: string;
  title: string;
  content: string;
  created_at: string;
}
```

## References

- https://bun.com/docs/api/http
- https://bun.com/docs/bundler/fullstack
