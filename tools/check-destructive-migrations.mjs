// Blocks migrations that destroy data-bearing objects without an explicit,
// reasoned override.
//
// The rule (design spec section 6.4): once real customer data exists, a
// destructive migration cannot be undone. Rolling back the frontend takes
// seconds and rolling back edge functions takes a minute, but a dropped column
// is gone. So destructive changes are split across two releases: one adds the
// new shape and writes to both, a later one removes the old shape once nothing
// reads it.
//
// This exists because that rule is otherwise enforced by memory, and memory
// fails at 11pm. To override, put a line like this in the migration:
//
//   -- destructive-ok: <why this is safe>
//
// The comment is the point. It forces the reasoning to be written down where
// the next person will find it, and it makes the override visible in review.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Deliberately narrow. Each pattern must match a statement that destroys data.
//
//   - DROP INDEX, DROP POLICY and DROP TRIGGER are excluded: they lose no data
//     and can be rebuilt. Flagging them would make routine changes require an
//     override, which is how an override comment stops meaning anything.
//   - cron.unschedule is excluded for the same reason; every snapshot cron
//     migration unschedules and immediately re-schedules.
const PATTERNS = [
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\balter\s+table\b[\s\S]*?\bdrop\s+column\b/i, "DROP COLUMN"],
  [/\balter\s+table\b[\s\S]*?\brename\b/i, "RENAME"],
];

/**
 * Strip line comments and single-quoted strings so the word "drop" appearing in
 * prose or in a COMMENT ON body is not mistaken for a statement. Runs after the
 * override check, so an override comment is still seen.
 */
function stripNonCode(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, " '' ");
}

export function findViolations(sql) {
  if (/--\s*destructive-ok\s*:/i.test(sql)) return [];
  const code = stripNonCode(sql);
  return PATTERNS.filter(([re]) => re.test(code)).map(([, name]) => name);
}

export function checkDirectory(dir) {
  const failures = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const violations = findViolations(readFileSync(join(dir, file), "utf8"));
    if (violations.length) failures.push({ file, violations });
  }
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "supabase/migrations";
  const failures = checkDirectory(dir);

  for (const { file, violations } of failures) {
    console.error(`${file}: ${violations.join(", ")}`);
  }

  if (failures.length) {
    console.error(
      `\n${failures.length} migration(s) destroy data without an override.\n\n` +
        "Either split the change across two releases (add the new shape now,\n" +
        "remove the old one once nothing reads it), or add a line explaining\n" +
        "why this one is safe:\n\n" +
        "  -- destructive-ok: <reason>\n",
    );
    process.exit(1);
  }

  console.log(`No unannotated destructive migrations in ${dir}.`);
}
