/**
 * Figma MCP output-capture helper — wire format + parser for `use_figma`.
 *
 * ============================================================================
 *  Why this file exists
 * ============================================================================
 *
 * The Figma Remote MCP `use_figma` tool runs JavaScript inside Figma's
 * plugin sandbox. **The plugin runtime discards return values and
 * `console.log` output** — there is no documented way to surface arbitrary
 * data back to the caller through the success channel. The MCP tool just
 * reports "Code executed with no return value."
 *
 * The only channel that comes back intact is the error message. So we
 * intentionally `throw new Error("OUT::" + JSON.stringify(result))` at the
 * end of every `use_figma` call where we want data, and parse the marker
 * out on the caller side. The rejection contains a stack trace appended
 * after the JSON; the parser strips it before `JSON.parse`.
 *
 * This is a deliberate workaround, not a bug to "fix." If/when the Figma
 * MCP server starts surfacing `return` values normally, retire this helper
 * and switch every call site to the success path — fix in one place.
 *
 * ============================================================================
 *  Who calls what
 * ============================================================================
 *
 * The chat agent (Claude) invokes the `mcp__c564a1a7-…__use_figma` tool
 * **directly** via MCP tool-use — not through this TypeScript module.
 * This file is the **single source of truth for the wire format** that the
 * agent reads at session start and replicates in its direct calls.
 *
 * For Node-side scripts (figma audit, token sync, CI integration) that
 * call the MCP through the SDK, the exported `wrapForOutput`, `parseUseFigmaResult`,
 * and `maybeUnwrap` are real, executable helpers — import them.
 *
 * ============================================================================
 *  Convention for chat-agent sessions
 * ============================================================================
 *
 * When the agent calls `use_figma` and wants data back:
 *
 *   1. End the JS payload with:
 *
 *        const __result = await main();
 *        throw new Error("OUT::" + JSON.stringify(__result));
 *
 *      (or the equivalent — what matters is the `OUT::` prefix on the
 *       error message and JSON-serializable payload after it).
 *
 *   2. The tool call rejects. Parse `error.message`: find `"OUT::"`,
 *      take everything after it up to the first `\n    at ` (Figma's
 *      stack-trace prefix), and `JSON.parse` that.
 *
 *   3. If the message has no `"OUT::"` marker, it's a real error — surface
 *      it to the user, don't pretend it's data.
 *
 * ============================================================================
 *  Convention for Node-side callers
 * ============================================================================
 *
 *   import { wrapForOutput, maybeUnwrap, OUT_MARKER } from "./figma-mcp-helper";
 *
 *   const data = await maybeUnwrap<Spec>(
 *     mcpClient.callTool("mcp__…__use_figma", {
 *       fileKey,
 *       description: "Read Button spec",
 *       code: wrapForOutput(`
 *         async function main() {
 *           const node = await figma.getNodeByIdAsync("19:300");
 *           return { name: node.name, type: node.type };
 *         }
 *         return await main();
 *       `),
 *     })
 *   );
 */

// ============================================================================
// Wire format
// ============================================================================

/** Prefix marking a use_figma success payload in the thrown error message. */
export const OUT_MARKER = "OUT::" as const;

/**
 * Wrap a body of JS so its return value is JSON-serialized and surfaced via
 * the `OUT::`-prefixed error throw described in the file-level doc.
 *
 * The body must:
 *   - `return` (or end with) the value to surface — it'll be JSON.stringify'd
 *   - Be valid as the body of an `async` function (top-level `await` allowed)
 *
 * If the body throws on its own (e.g. `figma.getNodeByIdAsync` rejects, a
 * variable lookup fails), the original error propagates without the marker
 * prefix, and `parseUseFigmaResult` correctly classifies it as an error.
 */
export function wrapForOutput(body: string): string {
  return `
    async function __runUserBody() {
${body}
    }
    const __navigatr_result = await __runUserBody();
    throw new Error(${JSON.stringify(OUT_MARKER)} + JSON.stringify(__navigatr_result));
  `;
}

// ============================================================================
// Parsing
// ============================================================================

export type ParsedResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: Error };

/**
 * Pull the JSON payload out of a `use_figma` rejection.
 *
 * - `{ ok: true,  data  }` — the rejection was an `OUT::`-tagged output;
 *                            `data` is the JSON-parsed result
 * - `{ ok: false, error }` — anything else (real plugin error, JSON parse
 *                            failure, etc.) — surface upstream
 */
export function parseUseFigmaResult<T = unknown>(err: unknown): ParsedResult<T> {
  const message = extractMessage(err);
  const idx = message.indexOf(OUT_MARKER);

  if (idx === -1) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error(message),
    };
  }

  // Strip everything before the marker and the Figma stack trace appended
  // after the JSON payload. The stack trace lines look like:
  //   "\n    at <anonymous> (PLUGIN_1_SOURCE:..)"
  // JSON.parse would stop at end-of-document on its own, but defensively
  // cut at the stack prefix to avoid pathological strings.
  const afterMarker = message.slice(idx + OUT_MARKER.length);
  const jsonOnly = afterMarker.split(/\n\s*at\s/)[0];

  try {
    return { ok: true, data: JSON.parse(jsonOnly) as T };
  } catch (parseErr) {
    return {
      ok: false,
      error: new Error(
        `Failed to JSON.parse use_figma output. First 200 chars: ${jsonOnly.slice(0, 200)}… (parse error: ${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        })`,
      ),
    };
  }
}

/**
 * Linear-code convenience for Node-side callers.
 *
 *   const spec = await maybeUnwrap<ButtonSpec>(mcpClient.use_figma({...}));
 *
 * Throws on real errors. Throws a clear message if the user JS didn't end
 * with the OUT_MARKER throw (a common mistake).
 */
export async function maybeUnwrap<T>(call: Promise<unknown>): Promise<T> {
  try {
    await call;
  } catch (err) {
    const parsed = parseUseFigmaResult<T>(err);
    if (parsed.ok) return parsed.data;
    throw parsed.error;
  }
  throw new Error(
    "use_figma call resolved without throwing. The JS body must end with " +
      "`throw new Error(OUT_MARKER + JSON.stringify(result))` — see " +
      "tools/figma-mcp-helper.ts.",
  );
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}
