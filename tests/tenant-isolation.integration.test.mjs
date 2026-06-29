import assert from "node:assert/strict";
import test from "node:test";

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";

test(
  "tenant tables and list relations are isolated across two workspaces",
  { skip: !enabled },
  async () => {
    await import("dotenv/config");
    const { getDbClient, initializeDatabase, pool, query } = await import(
      "../src/lib/db.ts"
    );
    const {
      CLAIM_CAMPAIGN_SQL,
      CLAIM_LEASE_MINUTES,
      PENDING_STATUS,
      PROCESSING_STATUS,
    } = await import("../src/lib/campaign-worker.ts");

    await initializeDatabase();

    const roleName = `marekto_rls_test_${process.pid}`;
    const quotedRoleName = `"${roleName}"`;
    let roleCreated = false;
    let workspaceIds = [];
    const client = await getDbClient();

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
      await query(
        `GRANT USAGE ON SCHEMA public TO ${quotedRoleName}`,
      );
      await query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRoleName}`,
      );
      await query(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quotedRoleName}`,
      );

      const workspaceResult = await query(
        'INSERT INTO "Workspaces" (name) VALUES ($1), ($2) RETURNING id',
        ["RLS integration A", "RLS integration B"],
      );
      workspaceIds = workspaceResult.rows.map((row) => row.id);
      const [workspaceA, workspaceB] = workspaceIds;

      const recordsA = await runInWorkspace(workspaceA, async () => {
        const contact = await client.query(
          'INSERT INTO "Contacts" (workspace_id, email) VALUES ($1, $2) RETURNING id',
          [workspaceA, "same@example.com"],
        );
        const list = await client.query(
          'INSERT INTO "Lists" (workspace_id, name) VALUES ($1, $2) RETURNING id',
          [workspaceA, "Workspace A list"],
        );
        const template = await client.query(
          'INSERT INTO "Templates" (workspace_id, name) VALUES ($1, $2) RETURNING id',
          [workspaceA, "Workspace A template"],
        );
        const campaign = await client.query(
          'INSERT INTO "Campaigns" (workspace_id, template_id, name, status, run_at, scheduled_at) ' +
            "VALUES ($1, $2, $3, $4, NOW() - INTERVAL '1 minute', NOW() - INTERVAL '1 minute') RETURNING id",
          [workspaceA, template.rows[0].id, "Workspace A campaign", PENDING_STATUS],
        );
        await client.query(
          'INSERT INTO "Contact_list_relation" (workspace_id, contact_id, list_id) VALUES ($1, $2, $3)',
          [workspaceA, contact.rows[0].id, list.rows[0].id],
        );
        await client.query(
          'INSERT INTO "Email_logs" (workspace_id, campaign_id, contact_id, status) VALUES ($1, $2, $3, $4)',
          [workspaceA, campaign.rows[0].id, contact.rows[0].id, "failed"],
        );

        return {
          contactId: contact.rows[0].id,
          listId: list.rows[0].id,
          campaignId: campaign.rows[0].id,
        };
      });

      const recordsB = await runInWorkspace(workspaceB, async () => {
        const contact = await client.query(
          'INSERT INTO "Contacts" (workspace_id, email) VALUES ($1, $2) RETURNING id',
          [workspaceB, "same@example.com"],
        );
        await client.query(
          'INSERT INTO "Lists" (workspace_id, name) VALUES ($1, $2) RETURNING id',
          [workspaceB, "Workspace B list"],
        );
        const template = await client.query(
          'INSERT INTO "Templates" (workspace_id, name) VALUES ($1, $2) RETURNING id',
          [workspaceB, "Workspace B template"],
        );
        const campaign = await client.query(
          'INSERT INTO "Campaigns" (workspace_id, template_id, name) VALUES ($1, $2, $3) RETURNING id',
          [workspaceB, template.rows[0].id, "Workspace B campaign"],
        );
        await client.query(
          'INSERT INTO "Email_logs" (workspace_id, campaign_id, contact_id, status) VALUES ($1, $2, $3, $4)',
          [workspaceB, campaign.rows[0].id, contact.rows[0].id, "failed"],
        );

        return { contactId: contact.rows[0].id };
      });

      const tenantTables = [
        "Contacts",
        "Lists",
        "Contact_list_relation",
        "Templates",
        "Campaigns",
        "Email_logs",
      ];

      const claimClients = await Promise.all([getDbClient(), getDbClient()]);
      try {
        const claim = async (claimClient) => {
          await claimClient.query("BEGIN");
          try {
            await claimClient.query(`SET LOCAL ROLE ${quotedRoleName}`);
            await claimClient.query(
              "SELECT set_config('app.current_workspace_id', $1, true)",
              [String(workspaceA)],
            );
            const result = await claimClient.query(CLAIM_CAMPAIGN_SQL, [
              workspaceA,
              PROCESSING_STATUS,
              PENDING_STATUS,
              CLAIM_LEASE_MINUTES,
            ]);
            await claimClient.query("COMMIT");
            return result.rows;
          } catch (error) {
            await claimClient.query("ROLLBACK");
            throw error;
          }
        };

        const claims = await Promise.all(claimClients.map(claim));
        const claimedCampaigns = claims.flat();
        assert.equal(claimedCampaigns.length, 1);
        assert.equal(claimedCampaigns[0].id, recordsA.campaignId);
      } finally {
        claimClients.forEach((claimClient) => claimClient.release());
      }

      await runInWorkspace(workspaceA, async () => {
        for (const table of tenantTables) {
          const result = await client.query(
            `SELECT COUNT(*)::int AS count FROM "${table}"`,
          );
          assert.equal(result.rows[0].count, 1, `${table} leaked into workspace A`);
        }

        const crossTenantRelation = await client.query(
          'INSERT INTO "Contact_list_relation" (workspace_id, contact_id, list_id) ' +
            'SELECT $1, $2, $3 WHERE EXISTS (' +
            'SELECT 1 FROM "Contacts" WHERE id = $2 AND workspace_id = $1' +
            ') ON CONFLICT (contact_id, list_id) DO NOTHING RETURNING contact_id',
          [workspaceA, recordsB.contactId, recordsA.listId],
        );
        assert.equal(crossTenantRelation.rowCount, 0);
      });

      await runWithoutWorkspace(async () => {
        for (const table of tenantTables) {
          const result = await client.query(
            `SELECT COUNT(*)::int AS count FROM "${table}"`,
          );
          assert.equal(result.rows[0].count, 0, `${table} leaked without context`);
        }
      });

      assert.notEqual(recordsA.contactId, recordsB.contactId);
    } finally {
      client.release();

      if (workspaceIds.length > 0) {
        await query('DELETE FROM "Workspaces" WHERE id = ANY($1::int[])', [
          workspaceIds,
        ]);
      }
      if (roleCreated) {
        await query(`DROP OWNED BY ${quotedRoleName}`);
        await query(`DROP ROLE IF EXISTS ${quotedRoleName}`);
      }
      await pool.end();
    }
  },
);
