import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const migrationsDir = path.join(repoRoot, "db", "migrations");
const flywayVersionedMigrationPattern = /^V\d+__[a-z0-9_]+\.sql$/;

test("Flyway migrations use versioned naming and safe static SQL", async () => {
  const files = (await readdir(migrationsDir)).filter((file) =>
    file.endsWith(".sql"),
  );

  assert.ok(files.length > 0, "expected at least one Flyway migration");

  for (const file of files) {
    assert.match(file, flywayVersionedMigrationPattern);

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    assert.ok(sql.trim().length > 0, `${file} must not be empty`);
    assert.equal(sql.includes("${"), false, `${file} must not interpolate SQL`);
    assert.equal(sql.includes("`"), false, `${file} must not use template SQL`);
  }
});

test("Flyway baseline captures the current application schema surface", async () => {
  const baseline = await readFile(
    path.join(migrationsDir, "V001__baseline_schema.sql"),
    "utf8",
  );

  for (const table of [
    "Schema_migrations",
    "Users",
    "Workspaces",
    "Workspace_members",
    "Contacts",
    "Lists",
    "Contact_list_relation",
    "Templates",
    "Campaigns",
    "Email_logs",
    "Ai_outputs",
    "Admin_audit_logs",
    "Workspace_invites",
    "Workspace_audit_logs",
    "User_entitlements",
    "Workspace_subscriptions",
    "Usage_counters",
  ]) {
    assert.match(
      baseline,
      new RegExp(`CREATE TABLE IF NOT EXISTS "${table}"`),
      `baseline migration must create ${table}`,
    );
  }

  assert.match(baseline, /ENABLE ROW LEVEL SECURITY/);
  assert.match(baseline, /CREATE POLICY contacts_workspace_isolation/);
  assert.match(baseline, /INSERT INTO "Schema_migrations"/);
});
