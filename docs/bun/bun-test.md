# Bun Test Runner

## Purpose

Use Bun's built-in, Jest-compatible test runner for frontend and shared package tests.

## Run tests

```bash
bun test
```

Tests are written in JavaScript or TypeScript with a Jest-like API.

```ts
import { expect, test } from "bun:test";

test("2 + 2", () => {
  expect(2 + 2).toBe(4);
});
```

Bun searches for test files that match:

- `*.test.{js|jsx|ts|tsx}`
- `*_test.{js|jsx|ts|tsx}`
- `*.spec.{js|jsx|ts|tsx}`
- `*_spec.{js|jsx|ts|tsx}`

## Filtering tests

Pass positional filters to select which test files run. Globs are not yet supported, so treat these as simple path filters.

```bash
bun test <filter> <filter> ...
```

To filter by test name, use `-t` / `--test-name-pattern`.

```bash
bun test --test-name-pattern addition
```

To run a specific file, make sure the path starts with `./` or `/` so it’s not interpreted as a filter name.

```bash
bun test ./test/specific-file.test.ts
```

## CI/CD integration

`bun test` supports CI/CD integrations and can emit CI-friendly output formats.

### GitHub Actions

```yaml
jobs:
  build:
    name: build-app
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Install bun
        uses: oven-sh/setup-bun@v2
      - name: Install dependencies
        run: bun install
      - name: Run tests
        run: bun test
```

### JUnit XML reports

```bash
bun test --reporter=junit --reporter-outfile=./bun.xml
```

## Execution control

### Timeouts

```bash
bun test --timeout 20
```

### Concurrent test execution

```bash
bun test --concurrent
bun test --concurrent --max-concurrency 4
```

Mark individual tests as concurrent or serial:

```ts
import { test, expect } from "bun:test";

test.concurrent("concurrent test 1", async () => {
  await fetch("/api/endpoint1");
  expect(true).toBe(true);
});

test.concurrent("concurrent test 2", async () => {
  await fetch("/api/endpoint2");
  expect(true).toBe(true);
});

test.serial("first serial test", () => {
  expect(true).toBe(true);
});
```

### Rerun and randomize

```bash
bun test --rerun-each 100
bun test --randomize
bun test --seed 123456
```

### Bail early

```bash
bun test --bail
bun test --bail=10
```

### Watch mode

```bash
bun test --watch
```

## Lifecycle hooks

Bun supports the standard lifecycle hooks:

| Hook         | Description                 |
| ------------ | --------------------------- |
| `beforeAll`  | Runs once before all tests. |
| `beforeEach` | Runs before each test.      |
| `afterEach`  | Runs after each test.       |
| `afterAll`   | Runs once after all tests.  |

Hooks can live in test files or in a preloaded setup file:

```bash
bun test --preload ./setup.ts
```

## Mocks

Create mock functions with `mock()` or `jest.fn()` (compatible API).

```ts
import { test, expect, mock } from "bun:test";

const random = mock(() => Math.random());

test("random", () => {
  const val = random();
  expect(val).toBeGreaterThan(0);
  expect(random).toHaveBeenCalledTimes(1);
});
```

```ts
import { test, expect, jest } from "bun:test";

const random = jest.fn(() => Math.random());
```

## Snapshots

Snapshots are supported via `toMatchSnapshot`.

```ts
import { test, expect } from "bun:test";

test("snapshot", () => {
  expect({ a: 1 }).toMatchSnapshot();
});
```

Update snapshots with:

```bash
bun test --update-snapshots
```

## UI & DOM testing

Bun is compatible with popular DOM testing libraries such as HappyDOM and Testing Library. Use them with `bun test` as you would in Jest.

## AI agent integration

To reduce output verbosity for AI assistants, set any of the following environment variables:

- `CLAUDECODE=1`
- `REPL_ID=1`
- `AGENT=1`

```bash
CLAUDECODE=1 bun test
```

## CLI usage

```bash
bun test <patterns>
```

### Execution control

- `--timeout <number>`: set per-test timeout (ms)
- `--rerun-each <number>`: rerun each test file N times
- `--concurrent`: treat all tests as concurrent
- `--randomize`: run tests in random order
- `--seed <number>`: set random seed
- `--bail [number]`: exit after N failures
- `--max-concurrency <number>`: cap concurrent tests

### Test filtering

- `--todo`: include `test.todo()` tests
- `--test-name-pattern <regex>` (alias: `-t`)

### Reporting

- `--reporter <format>`: `junit` (requires `--reporter-outfile`), `dots`
- `--reporter-outfile <path>`: output file path
- `--dots`: shorthand for `--reporter=dots`

### Coverage

- `--coverage`: generate coverage profile
- `--coverage-reporter <format>`: `text` and/or `lcov` (default `text`)
- `--coverage-dir <path>`: coverage output directory (default `coverage`)

### Snapshots

- `--update-snapshots` (alias: `-u`)

## References

- https://bun.com/docs/cli/test
- https://bun.com/docs/api/test
