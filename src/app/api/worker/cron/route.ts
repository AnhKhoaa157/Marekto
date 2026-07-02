import { NextResponse, type NextRequest } from "next/server";

import { resolveCampaignDeliveryContent } from "@/lib/ai/personalization";
import {
  buildContactSelection,
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "@/lib/campaign-filters";
import {
  CLAIM_CAMPAIGN_SQL,
  CLAIM_LEASE_MINUTES,
  FAILED_STATUS,
  INSERT_EMAIL_LOG_SQL,
  PENDING_STATUS,
  PROCESSING_STATUS,
  SENT_STATUS,
  resolveCampaignDeliveryOutcome,
  type EmailPersonalizationSource,
} from "@/lib/campaign-worker";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { initializeDatabase, query, withWorkspace } from "@/lib/db";
import {
  createSmtpTransporter,
  isSmtpConfigured,
  resolveSmtpConfig,
  sanitizeMailError,
  sendCampaignEmail,
  type MailTransporter,
  type SmtpConfig,
} from "@/lib/mail/nodemailer";
import {
  categorizeWorkerFailure,
  sanitizeWorkerLogReason,
  writeWorkerLog,
} from "@/lib/worker-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT_ACTIVE_WORKSPACES_SQL =
  'SELECT id AS workspace_id FROM "Workspaces" ORDER BY id ASC';

const SELECT_TEMPLATE_SQL =
  'SELECT id, body_html FROM "Templates" WHERE id = $1 AND workspace_id = $2';

const MARK_CAMPAIGN_FAILED_SQL =
  'UPDATE "Campaigns" SET status = $1, processing_started_at = NULL, ' +
  "failure_reason = $2, updated_at = NOW() " +
  "WHERE id = $3 AND workspace_id = $4 AND status = $5";

const MARK_CAMPAIGN_SENT_SQL =
  'UPDATE "Campaigns" SET status = $1, processing_started_at = NULL, ' +
  "failure_reason = NULL, updated_at = NOW() " +
  "WHERE id = $2 AND workspace_id = $3 AND status = $4";

type WorkspaceRow = {
  workspace_id: number;
};

type ClaimedCampaignRow = {
  id: number;
  workspace_id: number;
  template_id: number | null;
  name: string;
  target_filters: CampaignTargetFilters | null;
  ai_personalization_enabled: boolean;
};

type ContactRow = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  properties: unknown;
};

type TemplateRow = {
  id: number;
  body_html: string;
};

type PreparedCampaign = {
  contacts: ContactRow[];
  emailHtml: string;
};

type CampaignResult = {
  campaign_id: number;
  recipients: number;
  emails_sent: number;
  emails_failed: number;
  status: "sent" | "failed";
  reason: string | null;
};

type WorkspaceResult = {
  workspace_id: number;
  campaigns_processed: number;
  campaigns_failed: number;
  emails_sent: number;
  emails_failed: number;
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

async function markCampaignSent(
  workspaceId: number,
  campaignId: number,
): Promise<void> {
  await withWorkspace(workspaceId, async (client) => {
    await client.query(MARK_CAMPAIGN_SENT_SQL, [
      SENT_STATUS,
      campaignId,
      workspaceId,
      PROCESSING_STATUS,
    ]);
  });
}

async function recordEmailLog(
  workspaceId: number,
  campaignId: number,
  contactId: number,
  status: "sent" | "failed",
  errorMessage: string | null,
  personalizationSource: EmailPersonalizationSource | null,
  personalizationError: string | null,
): Promise<void> {
  await withWorkspace(workspaceId, async (client) => {
    await client.query(INSERT_EMAIL_LOG_SQL, [
      workspaceId,
      campaignId,
      contactId,
      status,
      errorMessage,
      personalizationSource,
      personalizationError,
    ]);
  });
}

async function prepareCampaignDelivery(
  workspaceId: number,
  campaign: ClaimedCampaignRow,
): Promise<PreparedCampaign> {
  return withWorkspace(workspaceId, async (client) => {
    let emailHtml = "";

    if (campaign.template_id !== null) {
      const templateResult = await client.query<TemplateRow>(SELECT_TEMPLATE_SQL, [
        campaign.template_id,
        workspaceId,
      ]);
      const template = templateResult.rows[0];

      if (!template) {
        throw new Error("Campaign template is unavailable");
      }

      emailHtml = template.body_html.trim();
    }

    const filters = parseCampaignTargetFilters(campaign.target_filters);
    const selection = buildContactSelection(workspaceId, filters);
    const contactsResult = await client.query<ContactRow>(
      selection.text,
      selection.params,
    );

    return {
      contacts: contactsResult.rows,
      emailHtml,
    };
  });
}

function createCampaignTransporter(): {
  transporter: MailTransporter | null;
  config: SmtpConfig | null;
  setupError: string | null;
} {
  try {
    const config = resolveSmtpConfig();

    return {
      transporter: createSmtpTransporter(config),
      config,
      setupError: null,
    };
  } catch (error) {
    return {
      transporter: null,
      config: null,
      setupError: sanitizeMailError(error),
    };
  }
}

async function processClaimedCampaign(
  workspaceId: number,
  campaign: ClaimedCampaignRow,
): Promise<CampaignResult> {
  const preparedCampaign = await prepareCampaignDelivery(workspaceId, campaign);
  const recipients = preparedCampaign.contacts.length;

  if (recipients === 0) {
    const outcome = resolveCampaignDeliveryOutcome(0, 0, 0);
    await markCampaignFailed(workspaceId, campaign.id, outcome.reason ?? "No recipients");
    writeWorkerLog("warn", "campaign_delivery_skipped", {
      workspaceId,
      campaignId: campaign.id,
      category: "no_recipients",
      reason: outcome.reason,
    });

    return {
      campaign_id: campaign.id,
      recipients,
      emails_sent: 0,
      emails_failed: 0,
      status: "failed",
      reason: outcome.reason,
    };
  }

  if (!preparedCampaign.emailHtml) {
    const reason = "Campaign email template content is unavailable";

    writeWorkerLog("error", "campaign_delivery_blocked", {
      workspaceId,
      campaignId: campaign.id,
      category: "template_missing",
      reason,
    });

    for (const contact of preparedCampaign.contacts) {
      await recordEmailLog(
        workspaceId,
        campaign.id,
        contact.id,
        "failed",
        reason,
        null,
        null,
      );
    }

    await markCampaignFailed(workspaceId, campaign.id, reason);

    return {
      campaign_id: campaign.id,
      recipients,
      emails_sent: 0,
      emails_failed: recipients,
      status: "failed",
      reason,
    };
  }

  const { transporter, config, setupError } = createCampaignTransporter();
  let emailsSent = 0;
  let emailsFailed = 0;
  let firstFailureReason: string | null = setupError;

  if (setupError) {
    writeWorkerLog("error", "campaign_delivery_blocked", {
      workspaceId,
      campaignId: campaign.id,
      category: "smtp_unconfigured",
      reason: setupError,
    });
  }

  for (const contact of preparedCampaign.contacts) {
    if (setupError || !transporter || !config) {
      emailsFailed += 1;
      await recordEmailLog(
        workspaceId,
        campaign.id,
        contact.id,
        "failed",
        setupError ?? "SMTP delivery is not configured",
        null,
        null,
      );
      continue;
    }

    let personalizationSource: EmailPersonalizationSource | null = null;
    let personalizationError: string | null = null;

    try {
      const emailContent = await resolveCampaignDeliveryContent(
        {
          campaign: { name: campaign.name },
          template: { bodyHtml: preparedCampaign.emailHtml },
          contact: {
            email: contact.email,
            firstName: contact.first_name,
            lastName: contact.last_name,
            properties: contact.properties,
          },
        },
        campaign.ai_personalization_enabled,
      );

      personalizationSource = emailContent.source;
      personalizationError = emailContent.personalizationError;

      if (personalizationError) {
        writeWorkerLog("warn", "recipient_personalization_fallback", {
          workspaceId,
          campaignId: campaign.id,
          contactId: contact.id,
          category: "ai_personalization_fallback",
          reason: personalizationError,
        });
      }

      await sendCampaignEmail(
        {
          to: contact.email,
          subject: emailContent.subject,
          html: emailContent.html,
          ...(emailContent.text !== null ? { text: emailContent.text } : {}),
        },
        transporter,
        config,
      );
      emailsSent += 1;
      await recordEmailLog(
        workspaceId,
        campaign.id,
        contact.id,
        "sent",
        null,
        personalizationSource,
        personalizationError,
      );
    } catch (error) {
      const deliveryFailure = sanitizeMailError(error);
      const failureCategory =
        personalizationSource === null
          ? categorizeWorkerFailure(error)
          : "smtp_send_failed";
      const failureReason = personalizationError
        ? `${deliveryFailure}; AI personalization fallback was used: ${personalizationError}`
        : deliveryFailure;

      firstFailureReason ??= failureReason;
      emailsFailed += 1;
      writeWorkerLog("error", "recipient_delivery_failed", {
        workspaceId,
        campaignId: campaign.id,
        contactId: contact.id,
        category: failureCategory,
        reason: failureReason,
      });
      await recordEmailLog(
        workspaceId,
        campaign.id,
        contact.id,
        "failed",
        failureReason,
        personalizationSource,
        personalizationError,
      );
    }
  }

  const outcome = resolveCampaignDeliveryOutcome(
    recipients,
    emailsSent,
    emailsFailed,
  );
  const failureReason =
    outcome.status === "failed" && emailsFailed === recipients
      ? firstFailureReason ?? outcome.reason ?? "Campaign delivery failed"
      : outcome.reason;
  const persistedFailureReason = failureReason ?? "Campaign delivery failed";

  if (outcome.status === "sent") {
    await markCampaignSent(workspaceId, campaign.id);
  } else {
    await markCampaignFailed(workspaceId, campaign.id, persistedFailureReason);
  }

  writeWorkerLog(
    outcome.status === "sent" ? "info" : "warn",
    "campaign_delivery_completed",
    {
      workspaceId,
      campaignId: campaign.id,
      ...(outcome.status === "failed"
        ? { category: "campaign_failed" as const, reason: persistedFailureReason }
        : {}),
    },
  );

  return {
    campaign_id: campaign.id,
    recipients,
    emails_sent: emailsSent,
    emails_failed: emailsFailed,
    status: outcome.status,
    reason: outcome.status === "failed" ? persistedFailureReason : null,
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
      const failureMessage = sanitizeWorkerLogReason(error);

      writeWorkerLog("error", "campaign_processing_failed", {
        workspaceId,
        campaignId: campaign.id,
        category: categorizeWorkerFailure(error),
        reason: error,
      });

      await markCampaignFailed(workspaceId, campaign.id, failureMessage);
      campaigns.push({
        campaign_id: campaign.id,
        recipients: 0,
        emails_sent: 0,
        emails_failed: 0,
        status: "failed",
        reason: failureMessage,
      });
    }
  }

  const campaignsFailed = campaigns.filter(
    (campaign) => campaign.status === "failed",
  ).length;
  const emailsSent = campaigns.reduce(
    (sum, campaign) => sum + campaign.emails_sent,
    0,
  );
  const emailsFailed = campaigns.reduce(
    (sum, campaign) => sum + campaign.emails_failed,
    0,
  );

  return {
    workspace_id: workspaceId,
    campaigns_processed: campaigns.length,
    campaigns_failed: campaignsFailed,
    emails_sent: emailsSent,
    emails_failed: emailsFailed,
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
        writeWorkerLog("error", "workspace_processing_failed", {
          workspaceId: workspace_id,
          category: "workspace_failed",
          reason: workspaceError,
        });
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
    const emailsSent = results.reduce(
      (sum, result) => sum + result.emails_sent,
      0,
    );
    const emailsFailed = results.reduce(
      (sum, result) => sum + result.emails_failed,
      0,
    );

    return NextResponse.json({
      success: true,
      data: {
        workspaces_processed: results.length,
        campaigns_processed: campaignsProcessed,
        campaigns_failed: campaignsFailed,
        emails_sent: emailsSent,
        emails_failed: emailsFailed,
        delivery_available: isSmtpConfigured(),
        details: results,
      },
    });
  } catch (error) {
    writeWorkerLog("error", "worker_run_failed", {
      category: "worker_failed",
      reason: error,
    });

    const message = sanitizeWorkerLogReason(error);

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return runCronWorker(request);
}

export async function GET(request: NextRequest) {
  return runCronWorker(request);
}
