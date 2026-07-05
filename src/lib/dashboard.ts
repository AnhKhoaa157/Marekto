import { initializeDatabase, withWorkspace } from "@/lib/db";
import {
  SELECT_EMAIL_DELIVERY_METRICS_SQL,
  SELECT_RECENT_DELIVERY_FAILURES_SQL,
  toEmailDeliveryMetrics,
  type EmailDeliveryMetricsRow,
  type RecentDeliveryFailureRow,
} from "@/lib/dashboard-delivery";

export type { RecentDeliveryFailureRow } from "@/lib/dashboard-delivery";

type CountRow = {
  count: number;
};

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  scheduled_at: Date | string | null;
  run_at: Date | string | null;
};

export type DashboardMetrics = {
  contacts: number;
  campaigns: number;
  lists: number;
  templates: number;
  sentEmails: number;
  failedEmails: number;
};

export type ReadyDashboardData = {
  status: "ready";
  metrics: DashboardMetrics;
  campaigns: CampaignRow[];
  recentDeliveryFailures: RecentDeliveryFailureRow[];
  error: null;
};

export async function loadDashboardData(
  workspaceId: string,
  searchQuery: string,
): Promise<ReadyDashboardData> {
  await initializeDatabase();

  return withWorkspace(workspaceId, async (client) => {
    const contactsResult = await client.query<CountRow>(
      'SELECT COUNT(*)::int AS count FROM "Contacts" WHERE workspace_id = $1',
      [workspaceId],
    );
    const campaignsResult = await client.query<CountRow>(
      'SELECT COUNT(*)::int AS count FROM "Campaigns" WHERE workspace_id = $1',
      [workspaceId],
    );
    const listsResult = await client.query<CountRow>(
      'SELECT COUNT(*)::int AS count FROM "Lists" WHERE workspace_id = $1',
      [workspaceId],
    );
    const templatesResult = await client.query<CountRow>(
      'SELECT COUNT(*)::int AS count FROM "Templates" WHERE workspace_id = $1',
      [workspaceId],
    );
    const campaignRowsResult = await client.query<CampaignRow>(
      'SELECT id, name, status, scheduled_at, run_at FROM "Campaigns" ' +
        "WHERE workspace_id = $1 AND ($2 = '' OR name ILIKE '%' || $2 || '%') " +
        "ORDER BY created_at DESC, id DESC LIMIT 8",
      [workspaceId, searchQuery],
    );
    const deliveryMetricsResult = await client.query<EmailDeliveryMetricsRow>(
      SELECT_EMAIL_DELIVERY_METRICS_SQL,
      [workspaceId],
    );
    const recentDeliveryFailuresResult =
      await client.query<RecentDeliveryFailureRow>(
        SELECT_RECENT_DELIVERY_FAILURES_SQL,
        [workspaceId],
      );
    const deliveryMetrics = toEmailDeliveryMetrics(
      deliveryMetricsResult.rows[0],
    );

    return {
      status: "ready",
      metrics: {
        contacts: contactsResult.rows[0]?.count ?? 0,
        campaigns: campaignsResult.rows[0]?.count ?? 0,
        lists: listsResult.rows[0]?.count ?? 0,
        templates: templatesResult.rows[0]?.count ?? 0,
        ...deliveryMetrics,
      },
      campaigns: campaignRowsResult.rows,
      recentDeliveryFailures: recentDeliveryFailuresResult.rows,
      error: null,
    };
  });
}
