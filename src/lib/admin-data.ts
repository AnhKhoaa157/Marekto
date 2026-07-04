import "server-only";

import {
  buildAdminAuditInsert,
  type AdminAuditEntry,
} from "@/lib/admin-audit";
import {
  COUNT_ADMIN_USERS_SQL,
  COUNT_ADMIN_WORKSPACES_SQL,
  MAX_DIAGNOSTICS_PER_WORKSPACE,
  SELECT_ADMIN_USERS_SQL,
  SELECT_ADMIN_WORKSPACES_SQL,
  SELECT_ADMIN_WORKSPACE_BY_ID_SQL,
  SELECT_WORKSPACE_CAMPAIGN_METRICS_SQL,
  SELECT_WORKSPACE_CONTACT_COUNT_SQL,
  SELECT_WORKSPACE_DELIVERY_FAILURES_SQL,
  SELECT_WORKSPACE_LIST_COUNT_SQL,
  SELECT_WORKSPACE_TEMPLATE_COUNT_SQL,
  sortDiagnosticsByRecency,
  toAdminDeliveryDiagnostic,
  toAdminUserSummary,
  toAdminWorkspaceDetail,
  toAdminWorkspaceSummary,
  type AdminDeliveryDiagnostic,
  type AdminDeliveryFailureRow,
  type AdminUserListRow,
  type AdminUserSummary,
  type AdminWorkspaceBaseRow,
  type AdminWorkspaceDetail,
  type AdminWorkspaceMetrics,
  type AdminWorkspaceSummary,
} from "@/lib/admin-console";
import {
  buildAdminHealthConfig,
  type AdminHealthStatus,
} from "@/lib/admin-health";
import { initializeDatabase, query, withWorkspace } from "@/lib/db";
import {
  SELECT_RECENT_DELIVERY_FAILURES_SQL,
  type RecentDeliveryFailureRow,
} from "@/lib/dashboard-delivery";

type CountRow = { count: number };
type CampaignMetricsRow = { count: number; latest_at: Date | string | null };
type WorkspaceNameRow = { id: number; name: string };

export type AdminPageParams = {
  search: string;
  page: number;
  pageSize: number;
};

export type AdminPaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Persist a successful admin read to `"Admin_audit_logs"`. Best-effort: a
 * transient audit-write failure is logged but never fails the read it describes,
 * so observability stays available. The record is sanitized and bounded by
 * `buildAdminAuditInsert`.
 */
export async function recordAdminAudit(entry: AdminAuditEntry): Promise<void> {
  try {
    const { text, params } = buildAdminAuditInsert(entry);
    await query(text, params);
  } catch (error) {
    console.error("Failed to write admin audit log:", {
      action: entry.action,
      target_type: entry.targetType,
      error,
    });
  }
}

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await query("SELECT 1");
    return true;
  } catch (error) {
    console.error("Admin health database probe failed:", error);
    return false;
  }
}

export async function loadAdminHealth(): Promise<AdminHealthStatus> {
  const config = buildAdminHealthConfig(process.env);
  const reachable = await isDatabaseReachable();

  return {
    ...config,
    database: { configured: config.database.configured, reachable },
    generated_at: new Date().toISOString(),
  };
}

async function loadWorkspaceMetrics(
  workspaceId: number,
): Promise<AdminWorkspaceMetrics> {
  try {
    return await withWorkspace(workspaceId, async (client) => {
      const contactResult = await client.query<CountRow>(
        SELECT_WORKSPACE_CONTACT_COUNT_SQL,
        [workspaceId],
      );
      const campaignResult = await client.query<CampaignMetricsRow>(
        SELECT_WORKSPACE_CAMPAIGN_METRICS_SQL,
        [workspaceId],
      );

      return {
        contactCount: contactResult.rows[0]?.count ?? 0,
        campaignCount: campaignResult.rows[0]?.count ?? 0,
        latestCampaignAt: campaignResult.rows[0]?.latest_at ?? null,
      };
    });
  } catch (error) {
    console.error("Failed to load workspace metrics:", { workspaceId, error });
    return { contactCount: 0, campaignCount: 0, latestCampaignAt: null };
  }
}

export async function loadAdminWorkspaces(
  params: AdminPageParams,
): Promise<AdminPaginatedResult<AdminWorkspaceSummary>> {
  await initializeDatabase();

  const offset = (params.page - 1) * params.pageSize;
  const [baseResult, countResult] = await Promise.all([
    query<AdminWorkspaceBaseRow>(SELECT_ADMIN_WORKSPACES_SQL, [
      params.search,
      params.pageSize,
      offset,
    ]),
    query<CountRow>(COUNT_ADMIN_WORKSPACES_SQL, [params.search]),
  ]);

  const items: AdminWorkspaceSummary[] = [];

  for (const base of baseResult.rows) {
    const metrics = await loadWorkspaceMetrics(base.id);
    items.push(toAdminWorkspaceSummary(base, metrics));
  }

  return {
    items,
    total: countResult.rows[0]?.count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function loadAdminWorkspaceDetail(
  workspaceId: number,
): Promise<AdminWorkspaceDetail | null> {
  await initializeDatabase();

  const baseResult = await query<AdminWorkspaceBaseRow>(
    SELECT_ADMIN_WORKSPACE_BY_ID_SQL,
    [workspaceId],
  );
  const base = baseResult.rows[0];

  if (!base) {
    return null;
  }

  const detail = await withWorkspace(workspaceId, async (client) => {
    const [contacts, campaigns, lists, templates, failures] = await Promise.all([
      client.query<CountRow>(SELECT_WORKSPACE_CONTACT_COUNT_SQL, [workspaceId]),
      client.query<CampaignMetricsRow>(SELECT_WORKSPACE_CAMPAIGN_METRICS_SQL, [
        workspaceId,
      ]),
      client.query<CountRow>(SELECT_WORKSPACE_LIST_COUNT_SQL, [workspaceId]),
      client.query<CountRow>(SELECT_WORKSPACE_TEMPLATE_COUNT_SQL, [workspaceId]),
      client.query<RecentDeliveryFailureRow>(
        SELECT_RECENT_DELIVERY_FAILURES_SQL,
        [workspaceId],
      ),
    ]);

    return {
      contacts: contacts.rows[0]?.count ?? 0,
      campaigns: campaigns.rows[0]?.count ?? 0,
      lists: lists.rows[0]?.count ?? 0,
      templates: templates.rows[0]?.count ?? 0,
      latestCampaignAt: campaigns.rows[0]?.latest_at ?? null,
      failures: failures.rows,
    };
  });

  return toAdminWorkspaceDetail(
    base,
    {
      contacts: detail.contacts,
      campaigns: detail.campaigns,
      lists: detail.lists,
      templates: detail.templates,
      latestCampaignAt: detail.latestCampaignAt,
    },
    detail.failures,
  );
}

export async function loadAdminUsers(
  params: AdminPageParams,
): Promise<AdminPaginatedResult<AdminUserSummary>> {
  await initializeDatabase();

  const offset = (params.page - 1) * params.pageSize;
  const [usersResult, countResult] = await Promise.all([
    query<AdminUserListRow>(SELECT_ADMIN_USERS_SQL, [
      params.search,
      params.pageSize,
      offset,
    ]),
    query<CountRow>(COUNT_ADMIN_USERS_SQL, [params.search]),
  ]);

  return {
    items: usersResult.rows.map(toAdminUserSummary),
    total: countResult.rows[0]?.count ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

async function loadWorkspaceDiagnostics(
  workspace: WorkspaceNameRow,
): Promise<AdminDeliveryDiagnostic[]> {
  try {
    return await withWorkspace(workspace.id, async (client) => {
      const result = await client.query<AdminDeliveryFailureRow>(
        SELECT_WORKSPACE_DELIVERY_FAILURES_SQL,
        [workspace.id, MAX_DIAGNOSTICS_PER_WORKSPACE],
      );

      return result.rows.map((row) =>
        toAdminDeliveryDiagnostic(workspace.id, workspace.name, row),
      );
    });
  } catch (error) {
    console.error("Failed to load workspace delivery diagnostics:", {
      workspaceId: workspace.id,
      error,
    });
    return [];
  }
}

export async function loadAdminDeliveryDiagnostics(
  limit: number,
): Promise<{ items: AdminDeliveryDiagnostic[]; total: number }> {
  await initializeDatabase();

  const workspacesResult = await query<WorkspaceNameRow>(
    'SELECT id, name FROM "Workspaces" ORDER BY id ASC',
  );

  const diagnostics: AdminDeliveryDiagnostic[] = [];

  for (const workspace of workspacesResult.rows) {
    diagnostics.push(...(await loadWorkspaceDiagnostics(workspace)));
  }

  const sorted = sortDiagnosticsByRecency(diagnostics);

  return {
    items: sorted.slice(0, limit),
    total: sorted.length,
  };
}
