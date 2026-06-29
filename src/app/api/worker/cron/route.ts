import { NextResponse, type NextRequest } from "next/server";

import {
  buildContactSelection,
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "@/lib/campaign-filters";
import {
  CLAIM_CAMPAIGN_SQL,
  CLAIM_LEASE_MINUTES,
  FAILED_STATUS,
  PENDING_STATUS,
  PROCESSING_STATUS,
} from "@/lib/campaign-worker";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { initializeDatabase, query, withWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DELIVERY_UNAVAILABLE_REASON = "Email delivery is not configured";

const SELECT_ACTIVE_WORKSPACES_SQL =
  'SELECT id AS workspace_id FROM "Workspaces" ORDER BY id ASC';

const SELECT_TEMPLATE_SQL =
  'SELECT 1 FROM "Templates" WHERE id = $1 AND workspace_id = $2';

const MARK_CAMPAIGN_FAILED_SQL =
  'UPDATE "Campaigns" SET status = $1, processing_started_at = NULL, ' +
  "failure_reason = $2, updated_at = NOW() " +
  "WHERE id = $3 AND workspace_id = $4 AND status = $5";

type WorkspaceRow = {
  workspace_id: number;
};

type ClaimedCampaignRow = {
  id: number;
  workspace_id: number;
  template_id: number | null;
  target_filters: CampaignTargetFilters | null;
};

type ContactRow = {
  id: number;
  email: string;
};

type CampaignResult = {
  campaign_id: number;
  recipients: number;
  status: "failed";
  reason: string;
};

type WorkspaceResult = {
  workspace_id: number;
  campaigns_processed: number;
  campaigns_failed: number;
  emails_sent: number;
  campaigns: CampaignResult[];
};

async function claimNextCampaign(
  workspaceId: number,
): Promise<ClaimedCampaignRow | null> {
  return withWorkspace(workspaceId, async (client) => {
    const result = await client.query<ClaimedCampaignRow>(CLAIM_CAMPAIGN_SQL, [
      workspaceId,
      PROCESSING_STATUS,
      PENDING_STATUS,
      CLAIM_LEASE_MINUTES,
    ]);

    return result.rows[0] ?? null;
  });
}

async function markCampaignFailed(
  workspaceId: number,
  campaignId: number,
  reason: string,
): Promise<void> {
  await withWorkspace(workspaceId, async (client) => {
    await client.query(MARK_CAMPAIGN_FAILED_SQL, [
      FAILED_STATUS,
      reason,
      campaignId,
      workspaceId,
      PROCESSING_STATUS,
    ]);
  });
}

async function processClaimedCampaign(
  workspaceId: number,
  campaign: ClaimedCampaignRow,
): Promise<CampaignResult> {
  const recipients = await withWorkspace(workspaceId, async (client) => {
    if (campaign.template_id !== null) {
      const templateResult = await client.query(SELECT_TEMPLATE_SQL, [
        campaign.template_id,
        workspaceId,
      ]);

      if (templateResult.rowCount === 0) {
        throw new Error("Campaign template is unavailable");
      }
    }

    const filters = parseCampaignTargetFilters(campaign.target_filters);
    const selection = buildContactSelection(workspaceId, filters);
    const contactsResult = await client.query<ContactRow>(
      selection.text,
      selection.params,
    );

    return contactsResult.rows.length;
  });

  const reason =
    recipients === 0
      ? "No recipients matched the campaign filters"
      : DELIVERY_UNAVAILABLE_REASON;

  await markCampaignFailed(workspaceId, campaign.id, reason);

  return {
    campaign_id: campaign.id,
    recipients,
    status: "failed",
    reason,
  };
}

async function processWorkspace(workspaceId: number): Promise<WorkspaceResult> {
  const campaigns: CampaignResult[] = [];

  while (true) {
    const campaign = await claimNextCampaign(workspaceId);

    if (!campaign) {
      break;
    }

    try {
      campaigns.push(await processClaimedCampaign(workspaceId, campaign));
    } catch (error) {
      const failureMessage =
        error instanceof Error ? error.message : "Campaign processing failed";

      console.error(
        `[worker] Failed to process campaign ${campaign.id} in workspace ${workspaceId}:`,
        error,
      );

      await markCampaignFailed(workspaceId, campaign.id, failureMessage);
      campaigns.push({
        campaign_id: campaign.id,
        recipients: 0,
        status: "failed",
        reason: failureMessage,
      });
    }
  }

  return {
    workspace_id: workspaceId,
    campaigns_processed: campaigns.length,
    campaigns_failed: campaigns.length,
    emails_sent: 0,
    campaigns,
  };
}

async function runCronWorker(request: NextRequest) {
  const authorization = authorizeCronRequest(
    request.headers.get("authorization"),
    process.env.CRON_SECRET,
    process.env.NODE_ENV === "production",
  );

  if (!authorization.ok) {
    return NextResponse.json(
      { success: false, error: authorization.error },
      { status: authorization.status },
    );
  }

  try {
    await initializeDatabase();

    const workspacesResult = await query<WorkspaceRow>(SELECT_ACTIVE_WORKSPACES_SQL);
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

    const campaignsProcessed = results.reduce(
      (sum, result) => sum + result.campaigns_processed,
      0,
    );
    const campaignsFailed = results.reduce(
      (sum, result) => sum + result.campaigns_failed,
      0,
    );

    return NextResponse.json({
      success: true,
      data: {
        workspaces_processed: results.length,
        campaigns_processed: campaignsProcessed,
        campaigns_failed: campaignsFailed,
        emails_sent: 0,
        delivery_available: false,
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

export async function POST(request: NextRequest) {
  return runCronWorker(request);
}

export async function GET(request: NextRequest) {
  return runCronWorker(request);
}
