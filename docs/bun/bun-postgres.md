# Bun PostgreSQL

## Purpose

Use Bun's built-in PostgreSQL client (`Bun.sql` / `SQL`) for fast, typed SQL access without extra dependencies.

## Quick start

```ts
import { sql, SQL } from "bun";

// Uses PostgreSQL by default when DATABASE_URL is unset or a Postgres URL.
const users = await sql`
  SELECT * FROM users
  WHERE active = ${true}
  ORDER BY created_at DESC
  LIMIT ${10}
`;

// Explicit connection string
const pg = new SQL("postgres://user:pass@localhost:5432/mydb");
await pg`SELECT now()`;
```

## Configuration

Postgres is the default adapter when the connection string doesn’t match MySQL or SQLite patterns.

```ts
import { SQL } from "bun";

const sql = new SQL({
  // Postgres is auto-detected when using url or host params.
  url: "postgres://user:pass@localhost:5432/mydb",

  hostname: "localhost",
  port: 5432,
  database: "mydb",
  username: "dbuser",
  password: "secretpass",

  // Connection pool settings
  max: 20,
  idleTimeout: 30,
  maxLifetime: 0,
  connectionTimeout: 30,

  // TLS settings
  tls: true,

  onconnect: client => {
    console.log("Connected to PostgreSQL");
  },
  onclose: client => {
    console.log("PostgreSQL connection closed");
  },
});
```

### Environment variables

Bun will automatically detect PostgreSQL configuration from the environment.

**Connection URLs**

| Environment Variable        | Description                                |
| --------------------------- | ------------------------------------------ |
| `POSTGRES_URL`              | Primary connection URL for PostgreSQL      |
| `DATABASE_URL`              | Alternative connection URL (auto-detected) |
| `PGURL`                     | Alternative connection URL                 |
| `PG_URL`                    | Alternative connection URL                 |
| `TLS_POSTGRES_DATABASE_URL` | SSL/TLS-enabled connection URL             |
| `TLS_DATABASE_URL`          | Alternative SSL/TLS-enabled connection URL |

**Fallback parameters**

| Environment Variable | Fallback Variables           | Default Value | Description       |
| -------------------- | ---------------------------- | ------------- | ----------------- |
| `PGHOST`             | -                            | `localhost`   | Database host     |
| `PGPORT`             | -                            | `5432`        | Database port     |
| `PGUSERNAME`         | `PGUSER`, `USER`, `USERNAME` | `postgres`    | Database user     |
| `PGPASSWORD`         | -                            | (empty)       | Database password |
| `PGDATABASE`         | -                            | username      | Database name     |

## Common queries

```ts
import { sql } from "bun";

const [user] = await sql`SELECT * FROM users WHERE id = ${userId}`;
const allUsers = await sql`SELECT * FROM users ORDER BY created_at DESC`;
```

### Inserts

```ts
import { sql } from "bun";

const userData = {
  name: "Alice",
  email: "alice@example.com",
};

const [user] = await sql`
  INSERT INTO users ${sql(userData)}
  RETURNING *
`;
```

### Bulk inserts

```ts
import { sql } from "bun";

const users = [
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
  { name: "Charlie", email: "charlie@example.com" },
];

await sql`INSERT INTO users ${sql(users)}`;
```

## Result formats

By default, results are arrays of objects keyed by column name.

```ts
const rows = await sql`SELECT id, email FROM users`;
```

### `sql``.values()`

Returns rows as arrays of values (preserves duplicate column names by index).

```ts
const rows = await sql`SELECT id, email FROM users`.values();
```

### `sql``.raw()`

Returns rows as arrays of `Buffer` objects (useful for binary data).

```ts
const rows = await sql`SELECT * FROM blobs`.raw();
```

## Transactions

```ts
await sql.begin(async tx => {
  await tx`INSERT INTO users (name) VALUES (${"Alice"})`;
  await tx`UPDATE accounts SET balance = balance - 100 WHERE user_id = 1`;
});
```

### Savepoints

```ts
await sql.begin(async tx => {
  await tx`INSERT INTO users (name) VALUES (${"Alice"})`;

  await tx.savepoint(async sp => {
    await sp`UPDATE users SET status = 'active'`;
    if (someCondition) {
      throw new Error("Rollback to savepoint");
    }
  });

  await tx`INSERT INTO audit_log (action) VALUES ('user_created')`;
});
```

### Distributed transactions

```ts
await sql.beginDistributed("tx1", async tx => {
  await tx`INSERT INTO users (name) VALUES (${"Alice"})`;
});

await sql.commitDistributed("tx1");
// Or: await sql.rollbackDistributed("tx1");
```

## Connection pooling & reserved connections

Bun manages a connection pool by default. Connections are created on first query.

```ts
const sql = new SQL({ max: 20, idleTimeout: 30 });

await sql`SELECT 1`;
await sql`SELECT 2`;

await Promise.all([
  sql`INSERT INTO users ${sql({ name: "Alice" })}`,
  sql`UPDATE users SET name = ${"Bob"} WHERE id = ${userId}`,
]);

await sql.close();
```

Reserve a single connection when you need isolation:

```ts
const reserved = await sql.reserve();

try {
  await reserved`SELECT 1`;
} finally {
  reserved.release();
}
```

## SQL fragments and dynamic identifiers

Use `sql()` to safely reference identifiers or build conditional clauses.

```ts
const table = "users";
await sql`SELECT * FROM ${sql(table)}`;

const includeInactive = false;
await sql`
  SELECT * FROM users
  WHERE active = ${true}
  ${includeInactive ? sql`` : sql`AND deleted_at IS NULL`}
`;
```

### `sql.array` helper (PostgreSQL-only)

```ts
await sql`INSERT INTO tags (items) VALUES (${sql.array(["red", "blue", "green"])})`;
await sql`SELECT * FROM products WHERE ids = ANY(${sql.array([1, 2, 3])})`;
```

## Advanced execution

### Simple queries

Use `.simple()` for multiple statements in a single query (no parameters allowed).

```ts
await sql`
  SELECT 1;
  SELECT 2;
`.simple();
```

### File-based queries

```ts
const result = await sql.file("query.sql", [1, 2, 3]);
```

### Unsafe queries

```ts
const result = await sql.unsafe(
  "SELECT " + columns + " FROM users WHERE id = $1",
  [userId],
);
```

## Authentication & TLS

PostgreSQL authentication methods supported by Bun:

- SASL (SCRAM-SHA-256)
- MD5
- Clear Text

### SSL modes

```ts
const sql = new SQL({
  hostname: "localhost",
  username: "user",
  password: "password",
  ssl: "prefer", // disable | prefer | require | verify-ca | verify-full
});
```

You can also set `sslmode` in the connection string:

```ts
const sql = new SQL("postgres://user:password@localhost/mydb?sslmode=verify-full");
```

## Preconnect at runtime

Use `--sql-preconnect` to establish a PostgreSQL connection at startup:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/db bun --sql-preconnect index.ts
```

## Error handling

```ts
import { SQL } from "bun";

try {
  await sql`SELECT * FROM users`;
} catch (error) {
  if (error instanceof SQL.PostgresError) {
    console.log(error.code);
    console.log(error.detail);
    console.log(error.hint);
  } else if (error instanceof SQL.SQLError) {
    console.log(error.message);
  }
}
```

## BigInt handling

Large 64-bit numbers may be returned as strings by default. Enable `bigint: true` to receive `BigInt` values.

```ts
const sql = new SQL({ bigint: true });
const [{ x }] = await sql`SELECT 9223372036854777 as x`;
```

## Notes

- `sql.array` is PostgreSQL-only and may not support multidimensional arrays or NULL elements yet.
- Disabling prepared statements with `prepare: false` can help with some PGBouncer setups.

## References

- https://bun.com/docs/cli/sql
