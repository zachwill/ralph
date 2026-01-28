# Bun Shell

## Purpose

Run shell commands from JavaScript or TypeScript using Bun's built-in shell.

## When to use Bun Shell

Bun Shell is a good fit for:

- build and tooling scripts inside a Bun app
- cross-platform command execution (Windows, macOS, Linux)
- piping data between commands and JS objects
- safer command construction with automatic escaping

## Minimal usage

Use the `$` template literal to run a command.

```ts
import { $ } from "bun";

await $`echo "Hello World!"`;
```

To read output, use `.text()` or `.json()`.

```ts
import { $ } from "bun";

const text = await $`echo "Hello World!"`.text();
const json = await $`echo '{"foo":"bar"}'`.json();
```

## Redirection and piping

Bun Shell supports standard redirection and pipes.

```ts
import { $ } from "bun";

await $`echo "Hello" | wc -c`;
await $`echo "Hello" > greeting.txt`;
await $`bun run index.ts 2> errors.txt`;
```

JavaScript objects can be used as stdin/stdout.

```ts
import { $ } from "bun";

const response = new Response("hello i am a response body");
const result = await $`cat < ${response} | wc -w`.text();
```

## Error handling

Non-zero exit codes throw by default.

```ts
import { $ } from "bun";

try {
  const output = await $`something-that-may-fail`.text();
  console.log(output);
} catch (err) {
  console.log(`Failed with code ${err.exitCode}`);
  console.log(err.stdout.toString());
  console.log(err.stderr.toString());
}
```

Disable throwing with `.nothrow()` or `$.throws(false)`.

```ts
import { $ } from "bun";

const { stdout, stderr, exitCode } = await $`something-that-may-fail`
  .nothrow()
  .quiet();
```

## Environment and working directory

Set env vars inline or with `.env()` and `.cwd()`.

```ts
import { $ } from "bun";

await $`FOO=bar bun -e 'console.log(process.env.FOO)'`;
await $`pwd`.cwd("/tmp");
await $`echo $FOO`.env({ ...process.env, FOO: "bar" });
```

## Command substitution

Use `$(...)` to insert output from another command.

```ts
import { $ } from "bun";

await $`echo Hash: $(git rev-parse HEAD)`;
```

## Notes

- Bun Shell escapes interpolated values to reduce command injection risk.
- If you explicitly spawn a shell (e.g. `bash -c`), sanitize inputs.
- Built-in commands include `ls`, `cd`, `rm`, `echo`, `pwd`, `cat`, and more.

## References

- https://bun.com/docs/runtime/shell
- https://bun.com/docs/api/cli
