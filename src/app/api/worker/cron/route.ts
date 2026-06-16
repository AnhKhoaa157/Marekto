import { NextResponse } from "next/server";
import type { PoolClient } from "pg";

import { initializeDatabase, query, withWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Direct "Contacts" columns that may be matched verbatim from target_filters.
// Any other filter key is treated as a JSONB key inside "Contacts".properties.
const CONTACT_FILTER_COLUMNS = new Set([
  "email",
  "first_name",
  "last_name",
  "phone",
]);

const SELECT_ACTIVE_WORKSPACES_SQL =
  'SELECT DISTINCT workspace_id FROM "Campaigns" ' +
  "WHERE status = $1 AND run_at IS NOT NULL AND run_at <= NOW() " +
  "ORDER BY workspace_id ASC";

const SELECT_PENDING_CAMPAIGNS_SQL =
  "SELECT id, workspace_id, template_id, target_filters " +
  'FROM "Campaigns" ' +
  "WHERE workspace_id = $1 AND status = $2 AND run_at IS NOT NULL AND run_at <= NOW() " +
  "ORDER BY id ASC";

const SELECT_TEMPLATE_SQL =
  'SELECT id, name, body_html, content FROM "Templates" ' +
  "WHERE id = $1 AND workspace_id = $2";

const INSERT_EMAIL_LOGS_SQL =
  'INSERT INTO "Email_logs" (workspace_id, campaign_id, contact_id, status) ' +
  "SELECT $1, $2, contact_id, $3 FROM UNNEST($4::int[]) AS targeted(contact_id) " +
  "RETURNING id";

const UPDATE_CAMPAIGN_STATUS_SQL =
  'UPDATE "Campaigns" SET status = $1, updated_at = NOW() ' +
  "WHERE id = $2 AND workspace_id = $3";

const PENDING_STATUS = "pending";
const SENT_STATUS = "sent";

type WorkspaceRow = {
  workspace_id: number;
};

type PendingCampaignRow = {
  id: number;
  workspace_id: number;
  template_id: number | null;
  target_filters: Record<string, unknown> | null;
};

type TemplateRow = {
  id: number;
  name: string;
  body_html: string;
  content: string | null;
};

type ContactRow = {
  id: number;
  email: string;
};

type CampaignResult = {
  campaign_id: number;
  template_id: number | null;
  recipients: number;
  logged: number;
};

type WorkspaceResult = {
  workspace_id: number;
  campaigns_processed: number;
  emails_sent: number;
};

type ContactSelection = {
  text: string;
  params: unknown[];
};

/**
 * Build a parameterized SELECT over "Contacts" for the campaign's target_filters.
 * Whitelisted columns are matched directly; every other key is resolved against
 * the JSONB "properties" column with the key itself passed as a bound parameter
 * to keep the statement injection-safe. Empty filters select every contact in
 * the workspace.
 */
function buildContactSelection(
  workspaceId: number,
  targetFilters: Record<string, unknown> | null,
): ContactSelection {
  const params: unknown[] = [workspaceId];
  const conditions: string[] = ["workspace_id = $1"];

  for (const [key, rawValue] of Object.entries(targetFilters ?? {})) {
    if (rawValue === undefined) {
      continue;
    }

    const value = rawValue === null ? null : String(rawValue);

    if (CONTACT_FILTER_COLUMNS.has(key)) {
      if (value === null) {
        conditions.push(`"${key}" IS NULL`);
        continue;
      }

      params.push(value);
      conditions.push(`"${key}" = $${params.length}`);
      continue;
    }

    params.push(key);
    const keyIndex = params.length;

    if (value === null) {
      conditions.push(`properties->>$${keyIndex} IS NULL`);
      continue;
    }

    params.push(value);
    conditions.push(`properties->>$${keyIndex} = $${params.length}`);
  }

  const text =
    'SELECT id, email FROM "Contacts" WHERE ' +
    conditions.join(" AND ") +
    " ORDER BY id ASC";

  return { text, params };
}

async function processCampaign(
  client: PoolClient,
  workspaceId: number,
  campaign: PendingCampaignRow,
): Promise<CampaignResult> {
  let template: TemplateRow | null = null;

  if (campaign.template_id !== null) {
    const templateResult = await client.query<TemplateRow>(SELECT_TEMPLATE_SQL, [
      campaign.template_id,
      workspaceId,
    ]);
    template = templateResult.rows[0] ?? null;
  }

  const selection = buildContactSelection(workspaceId, campaign.target_filters);
  const contactsResult = await client.query<ContactRow>(
    selection.text,
    selection.params,
  );
  const contacts = contactsResult.rows;

  // Mock email transmission. Replace with Nodemailer/Resend integration later.
  for (const contact of contacts) {
    console.log(
      `[worker] Sending campaign ${campaign.id} (template ${
        template?.id ?? "none"
      }) to ${contact.email} for workspace ${workspaceId}`,
    );
  }

  let logged = 0;

  if (contacts.length > 0) {
    const contactIds = contacts.map((contact) => contact.id);
    const insertResult = await client.query<{ id: number }>(
      INSERT_EMAIL_LOGS_SQL,
      [workspaceId, campaign.id, SENT_STATUS, contactIds],
    );
    logged = insertResult.rowCount ?? 0;
  }

  await client.query(UPDATE_CAMPAIGN_STATUS_SQL, [
    SENT_STATUS,
    campaign.id,
    workspaceId,
  ]);

  return {
    campaign_id: campaign.id,
    template_id: campaign.template_id,
    recipients: contacts.length,
    logged,
  };
}

async function processWorkspace(workspaceId: number): Promise<WorkspaceResult> {
  return withWorkspace(workspaceId, async (client) => {
    const pendingResult = await client.query<PendingCampaignRow>(
      SELECT_PENDING_CAMPAIGNS_SQL,
      [workspaceId, PENDING_STATUS],
    );

    let emailsSent = 0;

    for (const campaign of pendingResult.rows) {
      const result = await processCampaign(client, workspaceId, campaign);
      emailsSent += result.logged;
    }

    return {
      workspace_id: workspaceId,
      campaigns_processed: pendingResult.rows.length,
      emails_sent: emailsSent,
    };
  });
}

export async function GET() {
  try {
    await initializeDatabase();

    // Discovery runs without a workspace context, so the connecting role must be
    // able to read across tenants (superuser / BYPASSRLS) for this step.
    const workspacesResult = await query<WorkspaceRow>(
      SELECT_ACTIVE_WORKSPACES_SQL,
      [PENDING_STATUS],
    );

    const results: WorkspaceResult[] = [];

    for (const { workspace_id } of workspacesResult.rows) {
      try {
        results.push(await processWorkspace(workspace_id));
      } catch (workspaceError) {
        console.error(
          `[worker] Failed to process workspace ${workspace_id}:`,
          workspaceError,
        );
      }
    }

    const totalCampaigns = results.reduce(
      (sum, result) => sum + result.campaigns_processed,
      0,
    );
    const totalEmails = results.reduce(
      (sum, result) => sum + result.emails_sent,
      0,
    );

    return NextResponse.json({
      success: true,
      data: {
        workspaces_processed: results.length,
        campaigns_processed: totalCampaigns,
        emails_sent: totalEmails,
        details: results,
      },
    });
  } catch (error) {
    console.error("Failed to run cron worker:", error);

    const message =
      error instanceof Error ? error.message : "Failed to run cron worker";

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
