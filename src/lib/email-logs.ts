import type { EmailPersonalizationSource } from "./campaign-worker.ts";
import {
  parseCampaignAiContext,
  type CampaignAiContext,
} from "./campaign-ai-context.ts";
import { sanitizeWorkerLogReason } from "./worker-log.ts";
import { isUuid, parseUuid } from "./identifiers.ts";

export type { EmailPersonalizationSource } from "./campaign-worker.ts";

export const DEFAULT_EMAIL_LOG_LIMIT = 50;
export const MAX_EMAIL_LOG_LIMIT = 100;

export type EmailLogStatus = "sent" | "failed";

export type EmailLogErrorCategory =
  | "none"
  | "ai_fallback"
  | "smtp_unconfigured"
  | "smtp_failure"
  | "template_missing"
  | "no_recipients"
  | "unknown";

export const SELECT_CAMPAIGN_DELIVERY_SQL =
  "SELECT id, name, status, failure_reason, ai_personalization_enabled, ai_context, scheduled_at, run_at " +
  'FROM "Campaigns" WHERE id = $1 AND workspace_id = $2';

export const SELECT_EMAIL_LOG_SUMMARY_SQL =
  "SELECT " +
  "COUNT(*)::int AS total_recipients, " +
  "COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count, " +
  "COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count, " +
  "COUNT(*) FILTER (WHERE status = 'sent' AND personalization_source = 'gemini')::int AS gemini_personalized_count, " +
  "COUNT(*) FILTER (WHERE status = 'sent' AND personalization_source = 'template')::int AS template_sent_count, " +
  "COUNT(*) FILTER (WHERE personalization_source = 'template' AND personalization_error IS NOT NULL)::int AS ai_fallback_count, " +
  "MIN(sent_at) FILTER (WHERE status = 'sent') AS first_sent_at, " +
  "MAX(sent_at) FILTER (WHERE status = 'sent') AS last_sent_at " +
  'FROM "Email_logs" WHERE workspace_id = $1 AND campaign_id = $2';

const SELECT_EMAIL_LOGS_BASE_SQL =
  "SELECT log.id, log.contact_id, log.status, log.error_message, " +
  "log.personalization_source, log.personalization_error, log.sent_at, " +
  "contact.email AS recipient_email, " +
  "contact.first_name AS recipient_first_name, " +
  "contact.last_name AS recipient_last_name " +
  'FROM "Email_logs" log ' +
  'LEFT JOIN "Contacts" contact ' +
  "ON contact.id = log.contact_id AND contact.workspace_id = log.workspace_id " +
  "WHERE log.workspace_id = $1 AND log.campaign_id = $2";

export type CampaignDeliveryRow = {
  id: string;
  name: string;
  status: string;
  failure_reason: string | null;
  ai_personalization_enabled: boolean;
  ai_context: unknown;
  scheduled_at: Date | null;
  run_at: Date | null;
};

export type EmailLogSummaryRow = {
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  gemini_personalized_count: number;
  template_sent_count: number;
  ai_fallback_count: number;
  first_sent_at: Date | null;
  last_sent_at: Date | null;
};

export type EmailLogListRow = {
  id: string;
  contact_id: string | null;
  status: string;
  error_message: string | null;
  personalization_source: string | null;
  personalization_error: string | null;
  sent_at: Date | null;
  recipient_email: string | null;
  recipient_first_name: string | null;
  recipient_last_name: string | null;
};

export type CampaignDeliveryCampaign = {
  id: string;
  name: string;
  status: string;
  failure_reason: string | null;
  ai_personalization_enabled: boolean;
  ai_context: CampaignAiContext;
  scheduled_at: string | null;
  run_at: string | null;
};

export type CampaignDeliverySummary = {
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  gemini_personalized_count: number;
  template_sent_count: number;
  ai_fallback_count: number;
  first_sent_at: string | null;
  last_sent_at: string | null;
};

export type CampaignEmailLogItem = {
  id: string;
  contact_id: string | null;
  recipient_email: string | null;
  recipient_first_name: string | null;
  recipient_last_name: string | null;
  status: EmailLogStatus;
  error_message: string | null;
  error_category: EmailLogErrorCategory;
  personalization_source: EmailPersonalizationSource | null;
  personalization_error: string | null;
  sent_at: string | null;
};

export type CampaignEmailLogsData = {
  campaign: CampaignDeliveryCampaign;
  summary: CampaignDeliverySummary;
  logs: CampaignEmailLogItem[];
};

export type EmailLogSelection = {
  text: string;
  params: unknown[];
};

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function isEmailLogStatus(value: unknown): value is EmailLogStatus {
  return value === "sent" || value === "failed";
}

function normalizePersonalizationSource(
  value: string | null,
): EmailPersonalizationSource | null {
  return value === "gemini" || value === "template" ? value : null;
}

export function parseEmailLogLimit(value: string | null): number {
  if (value === null) {
    return DEFAULT_EMAIL_LOG_LIMIT;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit must be a positive integer");
  }

  if (limit > MAX_EMAIL_LOG_LIMIT) {
    throw new Error(`limit must be ${MAX_EMAIL_LOG_LIMIT} or fewer`);
  }

  return limit;
}

export function parseEmailLogCursor(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return parseUuid(value, "cursor");
}

export function buildEmailLogSelection(
  workspaceId: string,
  campaignId: string,
  limit: number,
  cursor: string | null,
): EmailLogSelection {
  if (!isUuid(workspaceId) || !isUuid(campaignId)) {
    throw new Error("workspaceId and campaignId must be UUIDs");
  }
  assertPositiveInteger("limit", limit);

  if (limit > MAX_EMAIL_LOG_LIMIT) {
    throw new Error(`limit must be ${MAX_EMAIL_LOG_LIMIT} or fewer`);
  }

  const params: unknown[] = [workspaceId, campaignId];
  let text = SELECT_EMAIL_LOGS_BASE_SQL;

  if (cursor !== null) {
    if (!isUuid(cursor)) throw new Error("cursor must be a UUID");
    params.push(cursor);
    text +=
      " AND (log.sent_at, log.id) < (" +
      "SELECT cursor_log.sent_at, cursor_log.id FROM \"Email_logs\" cursor_log " +
      "WHERE cursor_log.workspace_id = $1 AND cursor_log.campaign_id = $2 " +
      "AND cursor_log.id = $" +
      params.length +
      ")";
  }

  params.push(limit);
  text += " ORDER BY log.sent_at DESC, log.id DESC LIMIT $" + params.length;

  return { text, params };
}

export function categorizeEmailLogError(input: {
  status: EmailLogStatus;
  error_message: string | null;
  personalization_error: string | null;
}): EmailLogErrorCategory {
  if (input.status === "sent") {
    return input.personalization_error ? "ai_fallback" : "none";
  }

  const message = input.error_message?.trim().toLowerCase() ?? "";

  if (message.length === 0) {
    return "unknown";
  }

  if (message.includes("template") && message.includes("unavailable")) {
    return "template_missing";
  }

  if (message.includes("no recipients")) {
    return "no_recipients";
  }

  if (
    message.includes("smtp delivery is not configured") ||
    message.includes("missing required smtp environment variables")
  ) {
    return "smtp_unconfigured";
  }

  return "smtp_failure";
}

export function toCampaignDeliveryCampaign(
  row: CampaignDeliveryRow,
): CampaignDeliveryCampaign {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    failure_reason: row.failure_reason
      ? sanitizeWorkerLogReason(row.failure_reason)
      : null,
    ai_personalization_enabled: row.ai_personalization_enabled,
    ai_context: parseCampaignAiContext(row.ai_context),
    scheduled_at: toIsoString(row.scheduled_at),
    run_at: toIsoString(row.run_at),
  };
}

export function toCampaignDeliverySummary(
  row: EmailLogSummaryRow | undefined,
): CampaignDeliverySummary {
  return {
    total_recipients: row?.total_recipients ?? 0,
    sent_count: row?.sent_count ?? 0,
    failed_count: row?.failed_count ?? 0,
    gemini_personalized_count: row?.gemini_personalized_count ?? 0,
    template_sent_count: row?.template_sent_count ?? 0,
    ai_fallback_count: row?.ai_fallback_count ?? 0,
    first_sent_at: toIsoString(row?.first_sent_at ?? null),
    last_sent_at: toIsoString(row?.last_sent_at ?? null),
  };
}

export function toCampaignEmailLogItem(row: EmailLogListRow): CampaignEmailLogItem {
  if (!isEmailLogStatus(row.status)) {
    throw new Error(`Unsupported email log status: ${row.status}`);
  }

  return {
    id: row.id,
    contact_id: row.contact_id,
    recipient_email: row.recipient_email,
    recipient_first_name: row.recipient_first_name,
    recipient_last_name: row.recipient_last_name,
    status: row.status,
    error_message: row.error_message
      ? sanitizeWorkerLogReason(row.error_message)
      : null,
    error_category: categorizeEmailLogError({
      status: row.status,
      error_message: row.error_message,
      personalization_error: row.personalization_error,
    }),
    personalization_source: normalizePersonalizationSource(
      row.personalization_source,
    ),
    personalization_error: row.personalization_error
      ? sanitizeWorkerLogReason(row.personalization_error)
      : null,
    sent_at: toIsoString(row.sent_at),
  };
}
