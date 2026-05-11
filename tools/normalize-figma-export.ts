/**
 * Normalize the Figma tokens export at apps/app/src/tokens/figma-export.json.
 *
 * Why this exists: some Figma plugins (Variables2JSON in particular) hand you a
 * JSON-stringified payload when you use "Copy to clipboard" instead of
 * "Save as file". That produces a `tokens.json` whose contents are a single
 * escaped string — `JSON.parse(raw)` returns a string, not an object — which
 * breaks the Session 2 token pipeline.
 *
 * This script:
 *   1. Reads apps/app/src/tokens/figma-export.json
 *   2. Detects whether the payload is double-encoded (or worse) and unwraps
 *      it as many times as needed until JSON.parse yields an object
 *   3. Rewrites the file as pretty-printed JSON with a trailing newline
 *   4. Verifies the canonical shape Session 2 expects:
 *        - colors.light / colors.dark
 *        - spacing.mode1
 *        - radius.mode1
 *      Missing collections are warned about, not errored — partial exports
 *      are valid intermediate states.
 *
 * Run via `pnpm tokens:normalize` from the monorepo root.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(__dirname, "..", "apps/app/src/tokens/figma-export.json");

// ANSI helpers (no chalk dep — script must run with zero install)
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

interface TokensShape {
  colors?: { light?: Record<string, string>; dark?: Record<string, string> };
  spacing?: { mode1?: Record<string, number> } | Record<string, number>;
  radius?: { mode1?: Record<string, number> } | Record<string, number>;
  typography?: unknown;
  [key: string]: unknown;
}

function fail(msg: string): never {
  console.error(c.red("✖ ") + msg);
  process.exit(1);
}

function main(): void {
  console.log(c.bold("normalize-figma-export") + c.dim(" — apps/app/src/tokens/figma-export.json"));

  if (!existsSync(TOKENS_PATH)) {
    fail(`File not found: ${TOKENS_PATH}\n  Place your Figma export there first.`);
  }

  const raw = readFileSync(TOKENS_PATH, "utf8");

  // Unwrap as many times as it takes. Bound to 5 to refuse pathological input.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON in figma-export.json: ${(err as Error).message}`);
  }

  let unwraps = 1;
  while (typeof parsed === "string") {
    if (unwraps >= 5) fail("Refusing to unwrap more than 5 levels — input looks pathological.");
    try {
      parsed = JSON.parse(parsed);
      unwraps++;
    } catch (err) {
      fail(`Unwrap level ${unwraps} produced invalid JSON: ${(err as Error).message}`);
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(`After unwrapping, payload is ${typeof parsed} — expected an object.`);
  }

  const tokens = parsed as TokensShape;

  // Write back canonical form.
  const pretty = JSON.stringify(tokens, null, 2) + "\n";
  writeFileSync(TOKENS_PATH, pretty);

  console.log(
    c.green("✔ ") +
      `unwrapped ${unwraps === 1 ? c.dim("(already normalized)") : c.yellow(`${unwraps - 1}× extra layer${unwraps - 1 === 1 ? "" : "s"}`)}`,
  );
  console.log(c.green("✔ ") + `rewrote ${c.cyan("apps/app/src/tokens/figma-export.json")} as pretty JSON`);

  // Shape verification — warn on missing pieces, don't fail.
  const checks: Array<{ label: string; present: boolean; count?: number }> = [
    {
      label: "colors.light",
      present: !!tokens.colors?.light,
      count: tokens.colors?.light ? Object.keys(tokens.colors.light).length : undefined,
    },
    {
      label: "colors.dark",
      present: !!tokens.colors?.dark,
      count: tokens.colors?.dark ? Object.keys(tokens.colors.dark).length : undefined,
    },
    {
      label: "spacing.mode1",
      present: !!(tokens.spacing && typeof tokens.spacing === "object" && "mode1" in tokens.spacing),
      count:
        tokens.spacing && typeof tokens.spacing === "object" && "mode1" in tokens.spacing
          ? Object.keys((tokens.spacing as { mode1: object }).mode1).length
          : undefined,
    },
    {
      label: "radius.mode1",
      present: !!(tokens.radius && typeof tokens.radius === "object" && "mode1" in tokens.radius),
      count:
        tokens.radius && typeof tokens.radius === "object" && "mode1" in tokens.radius
          ? Object.keys((tokens.radius as { mode1: object }).mode1).length
          : undefined,
    },
    { label: "typography", present: !!tokens.typography },
  ];

  console.log("");
  console.log(c.bold("Shape:"));
  for (const ch of checks) {
    const tick = ch.present ? c.green("✔") : c.yellow("○");
    const count = ch.count !== undefined ? c.dim(`(${ch.count} tokens)`) : ch.present ? "" : c.dim("(absent)");
    console.log(`  ${tick} ${ch.label.padEnd(16)} ${count}`);
  }

  // Sanity check Session 2 will require colors at minimum.
  if (!tokens.colors?.light || !tokens.colors?.dark) {
    console.log("");
    console.log(
      c.yellow("⚠ ") +
        "Session 2 requires both colors.light and colors.dark. Re-export from Figma before running it.",
    );
    process.exit(2);
  }

  console.log("");
  console.log(c.green("✔ ") + "ready for Session 2");
}

main();
