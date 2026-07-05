import { sanitizeEmailLogDiagnostic } from "./email-log-display.ts";
import {
  categorizeEmailLogError,
  type EmailLogErrorCategory,
} from "./email-logs.ts";
import { parseUuid } from "./identifiers.ts";

/**
 * Admin console read models (pure SQL, row types, safe field mappers, and query
 * parsing). No database access lives here — the loaders in `@/lib/admin-data`
 * own that. Keeping mapping pure guarantees, and lets us unit-test, that admin
 * responses never surface `password_hash` or other secret columns.
 */

// --- Query parsing --------------------------------------------------------

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_SEARCH_LENGTH = 120;
export const DEFAULT_DIAGNOSTICS_LIMIT = 50;
export const MAX_DIAGNOSTICS_LIMIT = 100;
export const MAX_DIAGNOSTICS_PER_WORKSPACE = 10;

export function parseAdminSearch(value: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, MAX_SEARCH_LENGTH);
}

export function parseAdminPage(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

export function parseAdminPageSize(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(parsed, MAX_PAGE_SIZE);
}

export function parseAdminDiagnosticsLimit(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_DIAGNOSTICS_LIMIT;
  }

  return Math.min(parsed, MAX_DIAGNOSTICS_LIMIT);
}

export function parseWorkspaceIdParam(value: string): string {
  return parseUuid(value, "Workspace id");
}

export function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// --- Workspaces -----------------------------------------------------------

export const SELECT_ADMIN_WORKSPACES_SQL =
  'SELECT w.id, w.name, w.owner_id, owner.email AS owner_email, w.created_at, ' +
  '(SELECT COUNT(*)::int FROM "Workspace_members" m WHERE m.workspace_id = w.id) AS member_count ' +
  'FROM "Workspaces" w ' +
  'LEFT JOIN "Users" owner ON owner.id = w.owner_id ' +
  "WHERE ($1 = '' OR w.name ILIKE '%' || $1 || '%') " +
  "ORDER BY w.created_at DESC, w.id DESC LIMIT $2 OFFSET $3";

export const COUNT_ADMIN_WORKSPACES_SQL =
  'SELECT COUNT(*)::int AS count FROM "Workspaces" w ' +
  "WHERE ($1 = '' OR w.name ILIKE '%' || $1 || '%')";

export const SELECT_ADMIN_WORKSPACE_BY_ID_SQL =
  'SELECT w.id, w.name, w.owner_id, owner.email AS owner_email, w.created_at, ' +
  '(SELECT COUNT(*)::int FROM "Workspace_members" m WHERE m.workspace_id = w.id) AS member_count ' +
  'FROM "Workspaces" w ' +
  'LEFT JOIN "Users" owner ON owner.id = w.owner_id ' +
  "WHERE w.id = $1";

export const SELECT_WORKSPACE_CONTACT_COUNT_SQL =
  'SELECT COUNT(*)::int AS count FROM "Contacts" WHERE workspace_id = $1';

export const SELECT_WORKSPACE_CAMPAIGN_METRICS_SQL =
  'SELECT COUNT(*)::int AS count, MAX(updated_at) AS latest_at ' +
  'FROM "Campaigns" WHERE workspace_id = $1';

export const SELECT_WORKSPACE_LIST_COUNT_SQL =
  'SELECT COUNT(*)::int AS count FROM "Lists" WHERE workspace_id = $1';

export const SELECT_WORKSPACE_TEMPLATE_COUNT_SQL =
  'SELECT COUNT(*)::int AS count FROM "Templates" WHERE workspace_id = $1';

export type AdminWorkspaceBaseRow = {
  id: string;
  name: string;
  owner_id: string | null;
  owner_email: string | null;
  member_count: number;
  created_at: Date | string | null;
};

export type AdminWorkspaceMetrics = {
  contactCount: number;
  campaignCount: number;
  latestCampaignAt: Date | string | null;
};

export type AdminWorkspaceSummary = {
  id: string;
  name: string;
  owner_id: string | null;
  owner_email: string | null;
  member_count: number;
  contact_count: number;
  campaign_count: number;
  latest_campaign_at: string | null;
  created_at: string | null;
};

export function toAdminWorkspaceSummary(
  base: AdminWorkspaceBaseRow,
  metrics: AdminWorkspaceMetrics,
): AdminWorkspaceSummary {
  return {
    id: base.id,
    name: base.name,
    owner_id: base.owner_id,
    owner_email: base.owner_email,
    member_count: base.member_count ?? 0,
    contact_count: metrics.contactCount,
    campaign_count: metrics.campaignCount,
    latest_campaign_at: toIsoString(metrics.latestCampaignAt),
    created_at: toIsoString(base.created_at),
  };
}

export type AdminWorkspaceDetailMetrics = {
  contacts: number;
  campaigns: number;
  lists: number;
  templates: number;
  latestCampaignAt: Date | string | null;
};

export type AdminWorkspaceDetail = {
  id: string;
  name: string;
  owner_id: string | null;
  owner_email: string | null;
  member_count: number;
  created_at: string | null;
  metrics: {
    contacts: number;
    campaigns: number;
    lists: number;
    templates: number;
    latest_campaign_at: string | null;
  };
  recent_delivery_failures: AdminDeliveryFailureSummary[];
};

export type AdminDeliveryFailureSummary = {
  campaign_id: string | null;
  campaign_name: string | null;
  failed_count: number;
  last_failed_at: string | null;
};

export function toAdminWorkspaceDetail(
  base: AdminWorkspaceBaseRow,
  metrics: AdminWorkspaceDetailMetrics,
  recentFailures: ReadonlyArray<{
    campaign_id: string | null;
    campaign_name: string | null;
    failed_count: number;
    last_failed_at: Date | string | null;
  }>,
): AdminWorkspaceDetail {
  return {
    id: base.id,
    name: base.name,
    owner_id: base.owner_id,
    owner_email: base.owner_email,
    member_count: base.member_count ?? 0,
    created_at: toIsoString(base.created_at),
    metrics: {
      contacts: metrics.contacts,
      campaigns: metrics.campaigns,
      lists: metrics.lists,
      templates: metrics.templates,
      latest_campaign_at: toIsoString(metrics.latestCampaignAt),
    },
    recent_delivery_failures: recentFailures.map((failure) => ({
      campaign_id: failure.campaign_id,
      campaign_name: failure.campaign_name,
      failed_count: failure.failed_count,
      last_failed_at: toIsoString(failure.last_failed_at),
    })),
  };
}

// --- Users ----------------------------------------------------------------

export const SELECT_ADMIN_USERS_SQL =
  "SELECT u.id, u.email, u.role, u.created_at, " +
  '(SELECT COUNT(*)::int FROM "Workspace_members" m WHERE m.user_id = u.id) AS membership_count ' +
  'FROM "Users" u ' +
  "WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%') " +
  "ORDER BY u.created_at DESC, u.id DESC LIMIT $2 OFFSET $3";

export const COUNT_ADMIN_USERS_SQL =
  'SELECT COUNT(*)::int AS count FROM "Users" u ' +
  "WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%')";

export type AdminUserListRow = {
  id: string;
  email: string;
  role: string;
  created_at: Date | string | null;
  membership_count: number;
};

export type AdminUserSummary = {
  id: string;
  email: string;
  role: string;
  created_at: string | null;
  membership_count: number;
};

export function toAdminUserSummary(row: AdminUserListRow): AdminUserSummary {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    created_at: toIsoString(row.created_at),
    membership_count: row.membership_count ?? 0,
  };
}

// --- Delivery diagnostics -------------------------------------------------

export const SELECT_WORKSPACE_DELIVERY_FAILURES_SQL =
  "SELECT log.id, log.campaign_id, campaign.name AS campaign_name, log.status, " +
  "log.error_message, log.personalization_error, log.sent_at " +
  'FROM "Email_logs" log ' +
  'LEFT JOIN "Campaigns" campaign ' +
  "ON campaign.id = log.campaign_id AND campaign.workspace_id = log.workspace_id " +
  "WHERE log.workspace_id = $1 AND log.status = 'failed' " +
  "ORDER BY log.sent_at DESC NULLS LAST, log.id DESC LIMIT $2";

export type AdminDeliveryFailureRow = {
  id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string;
  error_message: string | null;
  personalization_error: string | null;
  sent_at: Date | string | null;
};

export type AdminDeliveryDiagnostic = {
  workspace_id: string;
  workspace_name: string;
  campaign_id: string | null;
  campaign_name: string | null;
  category: EmailLogErrorCategory;
  message: string | null;
  occurred_at: string | null;
};

/**
 * Map a raw failed email-log row to a sanitized diagnostic. Only the error
 * CATEGORY and a redacted, length-bounded message survive; raw provider
 * payloads, stack traces, SMTP credentials, and secrets are stripped by
 * `sanitizeEmailLogDiagnostic` / `categorizeEmailLogError`.
 */
export function toAdminDeliveryDiagnostic(
  workspaceId: string,
  workspaceName: string,
  row: AdminDeliveryFailureRow,
): AdminDeliveryDiagnostic {
  const category = categorizeEmailLogError({
    status: row.status === "sent" ? "sent" : "failed",
    error_message: row.error_message,
    personalization_error: row.personalization_error,
  });

  return {
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    category,
    message: sanitizeEmailLogDiagnostic(row.error_message),
    occurred_at: toIsoString(row.sent_at),
  };
}

export function sortDiagnosticsByRecency(
  diagnostics: AdminDeliveryDiagnostic[],
): AdminDeliveryDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const leftTime = left.occurred_at ? Date.parse(left.occurred_at) : 0;
    const rightTime = right.occurred_at ? Date.parse(right.occurred_at) : 0;
    return rightTime - leftTime;
  });
}
