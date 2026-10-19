import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBundle, findForbidden } from "./check-client-bundle.mjs";

test("finds each server-only string", () => {
  assert.deepEqual(findForbidden('fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify")'), ["siteverify"]);
  assert.deepEqual(findForbidden('Deno.env.get("PUBLIC_FORM_SIGNING_SECRET")'), ["PUBLIC_FORM_SIGNING_SECRET"]);
  assert.deepEqual(findForbidden("TURNSTILE_SECRET_KEY"), ["TURNSTILE_SECRET_KEY"]);
});

test("leaves the client site key and ordinary code alone", () => {
  assert.deepEqual(findForbidden('import.meta.env.VITE_TURNSTILE_SITE_KEY; const website = "";'), []);
});

test("walks nested text files and skips binaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "bundle-"));
  try {
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<html></html>");
    writeFileSync(join(dir, "assets", "clean.js"), "console.log(1)");
    writeFileSync(join(dir, "assets", "leak.js"), "const u='/siteverify';");
    writeFileSync(join(dir, "assets", "logo.png"), "siteverify");
    assert.deepEqual(checkBundle(dir), [{ file: join("assets", "leak.js"), found: ["siteverify"] }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
