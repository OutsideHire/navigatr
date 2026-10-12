// Fails if the built browser bundle contains server-only code or secret names.
//
// The public referral form page imports shared field rules from
// supabase/functions/_shared/portalPublicForm.ts. That module also holds the
// Turnstile siteverify call and reads the signing and Turnstile secrets in the
// edge function. Tree-shaking keeps those out of the bundle today; this check
// keeps it that way, because a refactor that pulls them in would ship
// server-only code (and the names of server secrets) to every visitor with no
// test noticing.
//
//   node tools/check-client-bundle.mjs            # checks apps/app/dist
//   node tools/check-client-bundle.mjs <dir>
//
// Run it after `pnpm --filter app build`. A missing directory fails: a check
// that passes because nothing was built is worse than none.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FORBIDDEN = ["siteverify", "PUBLIC_FORM_SIGNING_SECRET", "TURNSTILE_SECRET_KEY"];

/** Text assets only; images and fonts cannot carry these strings meaningfully. */
const TEXT_EXT = /\.(js|mjs|cjs|css|html|json|map|txt|webmanifest|svg)$/i;

/** The forbidden strings found in one file's text. */
export function findForbidden(text) {
  return FORBIDDEN.filter((s) => text.includes(s));
}

/** Every text file under dir with the forbidden strings it contains. */
export function checkBundle(dir) {
  const failures = [];
  const walk = (d) => {
    for (const entry of readdirSync(d).sort()) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (TEXT_EXT.test(entry)) {
        const found = findForbidden(readFileSync(path, "utf8"));
        if (found.length) failures.push({ file: relative(dir, path), found });
      }
    }
  };
  walk(dir);
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dir = process.argv[2] ?? "apps/app/dist";
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`${dir} does not exist. Run \`pnpm --filter app build\` first.`);
    process.exit(1);
  }
  const failures = checkBundle(dir);
  for (const { file, found } of failures) console.error(`${file}: ${found.join(", ")}`);
  if (failures.length) {
    console.error(
      `\n${failures.length} file(s) in the client bundle contain server-only strings.\n` +
        "Something imported server code from supabase/functions/_shared into the app.\n" +
        "Move the shared constants or types the page needs into a client-safe module.\n",
    );
    process.exit(1);
  }
  console.log(`Client bundle clean: none of ${FORBIDDEN.join(", ")} in ${dir}.`);
}
