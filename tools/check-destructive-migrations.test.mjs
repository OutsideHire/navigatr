import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations } from "./check-destructive-migrations.mjs";

test("flags an unannotated drop column", () => {
  assert.deepEqual(findViolations("alter table public.deals drop column notes;"), ["DROP COLUMN"]);
});

test("flags drop table", () => {
  assert.deepEqual(findViolations("drop table public.old_thing;"), ["DROP TABLE"]);
});

test("flags a table rename and a column rename", () => {
  assert.deepEqual(findViolations("alter table a rename to b;"), ["RENAME"]);
  assert.deepEqual(findViolations("alter table a rename column x to y;"), ["RENAME"]);
});

test("reports every distinct violation in one file", () => {
  const sql = "drop table public.a;\nalter table b drop column c;\nalter table d rename to e;";
  assert.deepEqual(findViolations(sql).sort(), ["DROP COLUMN", "DROP TABLE", "RENAME"]);
});

test("allows destructive statements when an override comment is present", () => {
  const sql = "-- destructive-ok: unreferenced, no customer data\nalter table public.deals drop column notes;";
  assert.deepEqual(findViolations(sql), []);
});

test("the override comment is case-insensitive and tolerates spacing", () => {
  assert.deepEqual(findViolations("--DESTRUCTIVE-OK: why\ndrop table x;"), []);
  assert.deepEqual(findViolations("--   destructive-ok:  why\ndrop table x;"), []);
});

// Dropping an index loses no data; it can always be rebuilt. Flagging it would
// train people to annotate routine changes, which is how an override comment
// stops meaning anything.
test("ignores drop index", () => {
  assert.deepEqual(findViolations("drop index if exists deals_org_idx;"), []);
});

test("ignores drop policy and drop trigger", () => {
  assert.deepEqual(findViolations("drop policy if exists p on deals;"), []);
  assert.deepEqual(findViolations("drop trigger if exists t on deals;"), []);
});

test("passes a purely additive migration", () => {
  assert.deepEqual(findViolations("alter table public.deals add column source text;"), []);
});

// `cron.unschedule` removes a scheduled job, not data, and every snapshot cron
// migration re-schedules immediately after. Flagging it would make every cron
// change require an override.
test("ignores cron.unschedule", () => {
  const sql = "select cron.unschedule('coverage-snapshots-nightly') where exists (select 1 from cron.job);";
  assert.deepEqual(findViolations(sql), []);
});

// The word appearing inside a comment or a string is not a statement.
test("does not flag the words appearing in prose", () => {
  assert.deepEqual(findViolations("-- we should drop table foo one day, but not yet\n"), []);
  assert.deepEqual(findViolations("comment on table deals is 'do not drop table this';"), []);
});
