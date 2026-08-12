// Checks an environment's Edge Function secrets against
// supabase/secrets.manifest.json.
//
//   SUPABASE_PROJECT_REF=<ref> node tools/check-secrets.mjs production
//   node tools/check-secrets.mjs --audit
//
// Two modes, because there are two ways this goes wrong.
//
//   default   Does the live environment have what it needs, and nothing it must
//             not have? Catches a half-configured staging project, and catches
//             a mock flag left switched on in production.
//
//   --audit   Does the manifest still describe the code? Reads every
//             Deno.env.get() in supabase/functions and fails if the code needs
//             a secret no environment declares. Without this the manifest rots
//             quietly, and a rotted manifest is worse than none because it
//             reports success.
//
// PRINTS NAMES ONLY, NEVER VALUES. `supabase secrets list` prints real secret
// values in its second column, not digests, so this reads column one and
// discards the rest. Running that command unfiltered has already leaked a
// credential into a transcript once.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MANIFEST = "supabase/secrets.manifest.json";
const FUNCTIONS_DIR = "supabase/functions";

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

/** Every secret name the function code actually reads. */
function secretsReferencedInCode(dir = FUNCTIONS_DIR, found = new Set()) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      secretsReferencedInCode(path, found);
      continue;
    }
    if (!/\.(ts|js)$/.test(entry) || /\.test\.ts$/.test(entry)) continue;
    const src = readFileSync(path, "utf8");
    for (const m of src.matchAll(/Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

/**
 * Secret NAMES set on a project.
 *
 * `supabase secrets list` renders a table whose first column is the name and
 * whose second is the value. Only column one is read, and it is filtered to
 * things shaped like an env var so table borders, headers and any CLI notices
 * are discarded.
 */
function liveSecretNames(projectRef) {
  const raw = execFileSync("supabase", ["secrets", "list", "--project-ref", projectRef], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const names = new Set();
  for (const line of raw.split("\n")) {
    const first = line.split("|")[0]?.trim();
    if (first && /^[A-Z][A-Z0-9_]*$/.test(first) && first !== "NAME") names.add(first);
  }
  return names;
}

function audit() {
  const manifest = loadManifest();
  const declared = new Set(manifest.platformInjected);
  for (const env of Object.values(manifest.environments)) {
    for (const k of env.required ?? []) declared.add(k);
    for (const k of env.forbidden ?? []) declared.add(k);
  }

  const undeclared = [...secretsReferencedInCode()].filter((k) => !declared.has(k)).sort();

  if (undeclared.length) {
    console.error("Secrets read by the function code but declared in no environment:\n");
    for (const k of undeclared) console.error(`  ${k}`);
    console.error(
      "\nAdd each to supabase/secrets.manifest.json, as `required` where it is\n" +
        "needed and `forbidden` where its presence would be a mistake.\n",
    );
    process.exit(1);
  }
  console.log("Manifest covers every secret the function code reads.");
}

function checkEnvironment(envName) {
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!projectRef) {
    console.error("SUPABASE_PROJECT_REF is not set.");
    process.exit(2);
  }

  const manifest = loadManifest();
  const spec = manifest.environments[envName];
  if (!spec) {
    console.error(
      `No manifest entry for "${envName}". Known: ${Object.keys(manifest.environments).join(", ")}`,
    );
    process.exit(2);
  }

  const live = liveSecretNames(projectRef);
  const missing = (spec.required ?? []).filter((k) => !live.has(k));
  const present = (spec.forbidden ?? []).filter((k) => live.has(k));

  if (missing.length) {
    console.error(`MISSING from ${envName} (required): ${missing.join(", ")}`);
  }
  if (present.length) {
    console.error(`PRESENT in ${envName} but must not be: ${present.join(", ")}`);
  }

  if (missing.length || present.length) {
    process.exit(1);
  }

  console.log(
    `${envName}: all ${spec.required?.length ?? 0} required secrets present, ` +
      `${spec.forbidden?.length ?? 0} forbidden absent.`,
  );
}

const arg = process.argv[2];
if (!arg) {
  console.error("usage: check-secrets.mjs <environment> | --audit");
  process.exit(2);
}
if (arg === "--audit") audit();
else checkEnvironment(arg);
