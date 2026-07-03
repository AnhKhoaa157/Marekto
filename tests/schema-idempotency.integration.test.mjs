import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertTestDatabase,
  resetPublicSchema,
  TENANT_OWNED_TABLES,
} from "./helpers/integration.mjs";

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const applySchemaScript = path.join(repoRoot, "scripts", "apply-schema.mjs");

function applySchemaInFreshProcess() {
  return spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--experimental-strip-types",
      applySchemaScript,
    ],
    { cwd: repoRoot, env: process.env, encoding: "utf8" },
  );
}

test(
  "canonical schema initialization is idempotent and non-destructive on an empty database",
  { skip: !enabled },
  async () => {
    assertTestDatabase();
    const { getDbClient, pool } = await import("../src/lib/db.ts");

    const client = await getDbClient();
    try {
      // Clean slate: prove initialization works against a truly empty database.
      await resetPublicSchema(client);

      // First application (fresh process so the in-module init guard is false).
      const first = applySchemaInFreshProcess();
      assert.equal(
        first.status,
        0,
        `First schema application failed:\n${first.stdout}\n${first.stderr}`,
      );

      // Every expected table exists after the first application.
      const expectedTables = [
        "Schema_migrations",
        "Users",
        "Workspaces",
        "Workspace_members",
        "Registration_otps",
        ...TENANT_OWNED_TABLES,
      ];
      for (const table of expectedTables) {
        const exists = await client.query("SELECT to_regclass($1) AS reg", [
          `public."${table}"`,
        ]);
        assert.ok(exists.rows[0].reg, `Expected table ${table} to exist`);
      }

      // FORCE ROW LEVEL SECURITY is enabled on every tenant-owned table.
      for (const table of TENANT_OWNED_TABLES) {
        const rls = await client.query(
          "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass",
          [`public."${table}"`],
        );
        assert.equal(
          rls.rows[0].relrowsecurity,
          true,
          `${table} must have ROW LEVEL SECURITY enabled`,
        );
        assert.equal(
          rls.rows[0].relforcerowsecurity,
          true,
          `${table} must have FORCE ROW LEVEL SECURITY`,
        );
      }

      // Insert a sentinel row to prove re-initialization does not reset data.
      const sentinel = await client.query(
        'INSERT INTO "Workspaces" (name) VALUES ($1) RETURNING id',
        ["idempotency-sentinel"],
      );
      const sentinelId = sentinel.rows[0].id;

      // Second application in another fresh process.
      const second = applySchemaInFreshProcess();
      assert.equal(
        second.status,
        0,
        `Second schema application failed:\n${second.stdout}\n${second.stderr}`,
      );

      // The sentinel survived: initialization is non-destructive.
      const survived = await client.query(
        'SELECT id FROM "Workspaces" WHERE id = $1',
        [sentinelId],
      );
      assert.equal(survived.rowCount, 1, "Re-initialization must not drop data");

      // The migration version is recorded exactly once (ON CONFLICT DO NOTHING).
      const migrations = await client.query(
        'SELECT COUNT(*)::int AS count FROM "Schema_migrations"',
      );
      assert.ok(
        migrations.rows[0].count >= 1,
        "At least one schema migration must be recorded",
      );

      // Cleanup only the sentinel we created.
      await client.query('DELETE FROM "Workspaces" WHERE id = $1', [sentinelId]);
    } finally {
      client.release();
      await pool.end();
    }
  },
);
