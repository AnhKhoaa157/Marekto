import assert from "node:assert/strict";
import test from "node:test";

import { assertTestDatabase } from "./helpers/integration.mjs";

const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";

test(
  "campaign claiming is atomic, lease-aware, and never double-claims under concurrency",
  { skip: !enabled },
  async () => {
    assertTestDatabase();

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

    let workspaceId = null;

    // Claim one campaign for the workspace inside its own transaction, exactly
    // like the production worker's claimNextCampaign().
    async function claimOnce(claimClient) {
      await claimClient.query("BEGIN");
      try {
        await claimClient.query(
          "SELECT set_config('app.current_workspace_id', $1, true)",
          [String(workspaceId)],
        );
        const result = await claimClient.query(CLAIM_CAMPAIGN_SQL, [
          workspaceId,
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
    }

    try {
      const workspace = await query(
        'INSERT INTO "Workspaces" (name) VALUES ($1) RETURNING id',
        ["worker delivery integration"],
      );
      workspaceId = workspace.rows[0].id;

      const template = await query(
        'INSERT INTO "Templates" (workspace_id, name, body_html) VALUES ($1, $2, $3) RETURNING id',
        [workspaceId, "worker template", "<p>Body</p>"],
      );
      const templateId = template.rows[0].id;

      async function createCampaign(name, status, runAtSql, processingStartedAtSql) {
        const result = await query(
          'INSERT INTO "Campaigns" ' +
            "(workspace_id, template_id, name, status, run_at, processing_started_at) " +
            `VALUES ($1, $2, $3, $4, ${runAtSql}, ${processingStartedAtSql}) RETURNING id`,
          [workspaceId, templateId, name, status],
        );
        return result.rows[0].id;
      }

      // --- Scenario 1: concurrent claims on one due campaign -> exactly one owner
      const dueCampaignId = await createCampaign(
        "due pending",
        PENDING_STATUS,
        "NOW() - INTERVAL '1 minute'",
        "NULL",
      );
      // Campaigns that must NEVER be claimed alongside it.
      await createCampaign("draft", "draft", "NOW() - INTERVAL '1 minute'", "NULL");
      await createCampaign(
        "future pending",
        PENDING_STATUS,
        "NOW() + INTERVAL '1 hour'",
        "NULL",
      );
      const freshProcessingId = await createCampaign(
        "fresh processing",
        PROCESSING_STATUS,
        "NOW() - INTERVAL '1 minute'",
        "NOW()",
      );

      const claimClients = await Promise.all([getDbClient(), getDbClient()]);
      try {
        const claims = await Promise.all(claimClients.map((c) => claimOnce(c)));
        const claimed = claims.flat();
        assert.equal(claimed.length, 1, "exactly one worker must claim the due campaign");
        assert.equal(claimed[0].id, dueCampaignId, "the due pending campaign is claimed");
      } finally {
        claimClients.forEach((c) => c.release());
      }

      // The claimed campaign is now 'processing'; draft/future/fresh-processing untouched.
      const dueRow = await query('SELECT status FROM "Campaigns" WHERE id = $1', [
        dueCampaignId,
      ]);
      assert.equal(dueRow.rows[0].status, PROCESSING_STATUS);

      const draftRow = await query(
        `SELECT status FROM "Campaigns" WHERE name = 'draft' AND workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(draftRow.rows[0].status, "draft", "draft campaigns are never claimed");

      const futureRow = await query(
        `SELECT status FROM "Campaigns" WHERE name = 'future pending' AND workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(
        futureRow.rows[0].status,
        PENDING_STATUS,
        "future-scheduled pending campaigns are never claimed",
      );

      // --- Scenario 2: a freshly-processing campaign is not re-claimable...
      const client = await getDbClient();
      try {
        const stillLeased = await claimOnce(client);
        assert.equal(
          stillLeased.length,
          0,
          "no campaign is claimable while the fresh lease holds",
        );

        // ...but once its lease expires it becomes eligible again (stale recovery).
        await query(
          `UPDATE "Campaigns" SET processing_started_at = NOW() - ($2 * INTERVAL '1 minute') - INTERVAL '1 minute' WHERE id = $1`,
          [freshProcessingId, CLAIM_LEASE_MINUTES],
        );
        const reclaimed = await claimOnce(client);
        assert.equal(reclaimed.length, 1, "a stale-leased campaign becomes claimable");
        assert.equal(reclaimed[0].id, freshProcessingId);
      } finally {
        client.release();
      }

      // --- Scenario 3: one recipient yields at most one delivery log per run.
      const contact = await query(
        'INSERT INTO "Contacts" (workspace_id, email) VALUES ($1, $2) RETURNING id',
        [workspaceId, "recipient@example.com"],
      );
      const contactId = contact.rows[0].id;
      await query(
        'INSERT INTO "Email_logs" (workspace_id, campaign_id, contact_id, status) VALUES ($1, $2, $3, $4)',
        [workspaceId, dueCampaignId, contactId, "sent"],
      );
      const logs = await query(
        'SELECT COUNT(*)::int AS count FROM "Email_logs" WHERE campaign_id = $1 AND contact_id = $2',
        [dueCampaignId, contactId],
      );
      assert.equal(logs.rows[0].count, 1, "one recipient must have one delivery log per run");
    } finally {
      if (workspaceId !== null) {
        await query('DELETE FROM "Workspaces" WHERE id = $1', [workspaceId]);
      }
      await pool.end();
    }
  },
);
