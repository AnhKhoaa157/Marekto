import assert from "node:assert/strict";
import test from "node:test";

import { assertTestDatabase, TENANT_OWNED_TABLES } from "./helpers/integration.mjs";

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";

test(
  "two workspaces are isolated for select/update/delete/relate under a restricted role",
  { skip: !enabled },
  async () => {
    assertTestDatabase();

    const { getDbClient, initializeDatabase, pool, query } = await import(
      "../src/lib/db.ts"
    );

    await initializeDatabase();

    const roleName = `marekto_rls_test_${process.pid}`;
    const quotedRoleName = `"${roleName}"`;
    let roleCreated = false;
    let workspaceIds = [];
    const client = await getDbClient();

    // Every tenant operation runs as the restricted (non-superuser, non-BYPASSRLS)
    // application role with an explicit workspace context, exactly like the app.
    async function runInWorkspace(workspaceId, callback) {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${quotedRoleName}`);
        await client.query(
          "SELECT set_config('app.current_workspace_id', $1, true)",
          [String(workspaceId)],
        );
        const result = await callback();
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    async function runWithoutWorkspace(callback) {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${quotedRoleName}`);
        const result = await callback();
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    try {
      await query(`CREATE ROLE ${quotedRoleName} NOLOGIN`);
      roleCreated = true;
      await query(`GRANT USAGE ON SCHEMA public TO ${quotedRoleName}`);
      await query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRoleName}`,
      );
      await query(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRoleName}`,
      );

      // Confirm the role cannot bypass RLS (would invalidate the whole test).
      const roleAttrs = await query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
        [roleName],
      );
      assert.equal(roleAttrs.rows[0].rolsuper, false, "test role must not be superuser");
      assert.equal(
        roleAttrs.rows[0].rolbypassrls,
        false,
        "test role must not have BYPASSRLS",
      );

      const workspaceResult = await query(
        'INSERT INTO "Workspaces" (name) VALUES ($1), ($2) RETURNING id',
        ["RLS integration A", "RLS integration B"],
      );
      workspaceIds = workspaceResult.rows.map((row) => row.id);
      const [workspaceA, workspaceB] = workspaceIds;

      async function seedWorkspace(workspaceId, label) {
        return runInWorkspace(workspaceId, async () => {
          const contact = await client.query(
            'INSERT INTO "Contacts" (workspace_id, email) VALUES ($1, $2) RETURNING id',
            [workspaceId, "same@example.com"], // overlapping email across tenants
          );
          const list = await client.query(
            'INSERT INTO "Lists" (workspace_id, name) VALUES ($1, $2) RETURNING id',
            [workspaceId, `${label} list`],
          );
          const template = await client.query(
            'INSERT INTO "Templates" (workspace_id, name, body_html) VALUES ($1, $2, $3) RETURNING id',
            [workspaceId, `${label} template`, "<p>Hi</p>"],
          );
          const campaign = await client.query(
            'INSERT INTO "Campaigns" (workspace_id, template_id, name) VALUES ($1, $2, $3) RETURNING id',
            [workspaceId, template.rows[0].id, `${label} campaign`],
          );
          await client.query(
            'INSERT INTO "Contact_list_relation" (workspace_id, contact_id, list_id) VALUES ($1, $2, $3)',
            [workspaceId, contact.rows[0].id, list.rows[0].id],
          );
          await client.query(
            'INSERT INTO "Email_logs" (workspace_id, campaign_id, contact_id, status) VALUES ($1, $2, $3, $4)',
            [workspaceId, campaign.rows[0].id, contact.rows[0].id, "sent"],
          );
          await client.query(
            'INSERT INTO "Ai_outputs" ' +
              "(workspace_id, feature, input_hash, input_text, output_json, provider, model) " +
              "VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)",
            [
              workspaceId,
              "segmentation",
              `hash-${label}`,
              "input",
              JSON.stringify({ ok: true }),
              "gemini",
              "gemini-2.5-flash",
            ],
          );
          return {
            contactId: contact.rows[0].id,
            listId: list.rows[0].id,
            campaignId: campaign.rows[0].id,
          };
        });
      }

      const recordsA = await seedWorkspace(workspaceA, "Workspace A");
      const recordsB = await seedWorkspace(workspaceB, "Workspace B");

      // Overlapping email is allowed because contact identity is tenant-local.
      assert.notEqual(recordsA.contactId, recordsB.contactId);

      // 1) Workspace A sees only its own row in every tenant-owned table.
      await runInWorkspace(workspaceA, async () => {
        for (const table of TENANT_OWNED_TABLES) {
          const result = await client.query(
            `SELECT COUNT(*)::int AS count FROM "${table}"`,
          );
          assert.equal(result.rows[0].count, 1, `${table} leaked into workspace A`);
        }

        // 2) Cross-tenant SELECT of B's specific contact returns nothing.
        const crossSelect = await client.query(
          'SELECT id FROM "Contacts" WHERE id = $1',
          [recordsB.contactId],
        );
        assert.equal(crossSelect.rowCount, 0, "cross-tenant select must return nothing");

        // 3) Cross-tenant UPDATE of B's campaign affects zero rows.
        const crossUpdate = await client.query(
          'UPDATE "Campaigns" SET name = $1 WHERE id = $2',
          ["hijacked", recordsB.campaignId],
        );
        assert.equal(crossUpdate.rowCount, 0, "cross-tenant update must affect no rows");

        // 4) Cross-tenant DELETE of B's list affects zero rows.
        const crossDelete = await client.query(
          'DELETE FROM "Lists" WHERE id = $1',
          [recordsB.listId],
        );
        assert.equal(crossDelete.rowCount, 0, "cross-tenant delete must affect no rows");

        // 5) Cross-tenant relation creation cannot link B's contact.
        const crossRelation = await client.query(
          'INSERT INTO "Contact_list_relation" (workspace_id, contact_id, list_id) ' +
            "SELECT $1, $2, $3 WHERE EXISTS (" +
            'SELECT 1 FROM "Contacts" WHERE id = $2 AND workspace_id = $1' +
            ") ON CONFLICT (contact_id, list_id) DO NOTHING RETURNING contact_id",
          [workspaceA, recordsB.contactId, recordsA.listId],
        );
        assert.equal(crossRelation.rowCount, 0, "cross-tenant relation must not be created");
      });

      // 6) Spoofed write: inserting a row tagged for workspace B while the
      // context is workspace A must fail the RLS WITH CHECK clause.
      await assert.rejects(
        runInWorkspace(workspaceA, async () => {
          await client.query(
            'INSERT INTO "Contacts" (workspace_id, email) VALUES ($1, $2)',
            [workspaceB, "spoofed@example.com"],
          );
        }),
        /row-level security|violates/i,
        "spoofed workspace_id insert must be rejected by RLS",
      );

      // 7) B's campaign really was untouched by A's cross-tenant update attempt.
      await runInWorkspace(workspaceB, async () => {
        const campaign = await client.query(
          'SELECT name FROM "Campaigns" WHERE id = $1',
          [recordsB.campaignId],
        );
        assert.equal(campaign.rows[0].name, "Workspace B campaign");
      });

      // 8) Missing workspace context: no tenant data is visible at all.
      await runWithoutWorkspace(async () => {
        for (const table of TENANT_OWNED_TABLES) {
          const result = await client.query(
            `SELECT COUNT(*)::int AS count FROM "${table}"`,
          );
          assert.equal(result.rows[0].count, 0, `${table} leaked without context`);
        }
      });
    } finally {
      client.release();

      if (workspaceIds.length > 0) {
        await query('DELETE FROM "Workspaces" WHERE id = ANY($1::uuid[])', [workspaceIds]);
      }
      if (roleCreated) {
        await query(`DROP OWNED BY ${quotedRoleName}`);
        await query(`DROP ROLE IF EXISTS ${quotedRoleName}`);
      }
      await pool.end();
    }
  },
);
