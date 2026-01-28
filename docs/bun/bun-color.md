# Bun Color

## Purpose

Parse and convert colors between formats using Bun's built-in CSS parser. Zero dependencies, full CSS color support.

## When to use

- Convert colors for terminal output (ANSI escape codes)
- Normalize user input to a canonical format
- Store colors as numbers in a database
- Extract RGB/RGBA components from any color format

## Basic usage

```ts
Bun.color("red", "hex");              // "#ff0000"
Bun.color("#ff0000", "css");          // "red"
Bun.color("hsl(0, 100%, 50%)", "rgb"); // "rgb(255, 0, 0)"
Bun.color("tomato", "number");        // 16737095
```

Returns `null` if the input can't be parsed.

## Input formats

Accepts anything CSS can parse as a color:

```ts
Bun.color("red", "hex");                      // named colors
Bun.color("#f00", "hex");                     // hex (3, 6, or 8 digits)
Bun.color(0xff0000, "hex");                   // numbers
Bun.color("rgb(255, 0, 0)", "hex");           // rgb/rgba
Bun.color("hsl(0, 100%, 50%)", "hex");        // hsl/hsla
Bun.color("lab(50% 50% 50%)", "hex");         // lab
Bun.color({ r: 255, g: 0, b: 0 }, "hex");     // {r, g, b} objects
Bun.color([255, 0, 0], "hex");                // [r, g, b] arrays
```

## Output formats

| Format       | Output                           | Use case                    |
| ------------ | -------------------------------- | --------------------------- |
| `"css"`      | `"red"`                          | Stylesheets, inline styles  |
| `"hex"`      | `"#ff0000"`                      | CSS, config files           |
| `"HEX"`      | `"#FF0000"`                      | Uppercase hex               |
| `"rgb"`      | `"rgb(255, 0, 0)"`               | CSS                         |
| `"rgba"`     | `"rgba(255, 0, 0, 1)"`           | CSS with alpha              |
| `"hsl"`      | `"hsl(0, 100%, 50%)"`            | CSS                         |
| `"number"`   | `16711680`                       | Database storage            |
| `"{rgb}"`    | `{ r: 255, g: 0, b: 0 }`         | Component access            |
| `"{rgba}"`   | `{ r: 255, g: 0, b: 0, a: 1 }`   | Component access with alpha |
| `"[rgb]"`    | `[255, 0, 0]`                    | Typed arrays                |
| `"[rgba]"`   | `[255, 0, 0, 255]`               | Typed arrays with alpha     |
| `"ansi"`     | `"\x1b[38;2;255;0;0m"`           | Terminal (auto-detects)     |
| `"ansi-16m"` | `"\x1b[38;2;255;0;0m"`           | 24-bit terminal             |
| `"ansi-256"` | `"\x1b[38;5;196m"`               | 256-color terminal          |
| `"ansi-16"`  | `"\x1b[38;5;9m"`                 | 16-color terminal           |

## Terminal colors

Use `"ansi"` for automatic detection based on terminal capabilities:

```ts
const red = Bun.color("red", "ansi");
console.log(`${red}This is red\x1b[0m`);
```

If the terminal doesn't support color, returns an empty string.

For explicit control:

```ts
Bun.color("red", "ansi-16m");  // 24-bit (16 million colors)
Bun.color("red", "ansi-256"); // 256-color palette
Bun.color("red", "ansi-16");  // Basic 16 colors
```

## Component extraction

Get individual color channels:

```ts
const { r, g, b, a } = Bun.color("tomato", "{rgba}");
// { r: 255, g: 99, b: 71, a: 1 }

const [r, g, b] = Bun.color("tomato", "[rgb]");
// [255, 99, 71]
```

Note: `{rgba}` returns alpha as 0–1, `[rgba]` returns alpha as 0–255.

## Bundle-time macros

Evaluate colors at build time for client-side code:

```ts
import { color } from "bun" with { type: "macro" };

// Resolved at bundle time, not runtime
const red = color("#f00", "css"); // becomes "red" in bundle
```

## Notes

- `"css"` returns the most compact representation (e.g., `"red"` instead of `"#ff0000"`).
- `"number"` is best for database storage—24-bit integer, no parsing needed.
- `"ansi"` checks `stdout` capabilities; use specific formats to bypass detection.

## References

- https://bun.com/docs/api/color
