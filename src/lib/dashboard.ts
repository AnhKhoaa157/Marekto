import { initializeDatabase, withWorkspace } from "@/lib/db";

type CountRow = {
  count: number;
};

export type CampaignRow = {
  id: number;
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
};

export type ReadyDashboardData = {
  status: "ready";
  metrics: DashboardMetrics;
  campaigns: CampaignRow[];
  error: null;
};

export async function loadDashboardData(
  workspaceId: number,
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

    return {
      status: "ready",
      metrics: {
        contacts: contactsResult.rows[0]?.count ?? 0,
        campaigns: campaignsResult.rows[0]?.count ?? 0,
        lists: listsResult.rows[0]?.count ?? 0,
        templates: templatesResult.rows[0]?.count ?? 0,
      },
      campaigns: campaignRowsResult.rows,
      error: null,
    };
  });
}
