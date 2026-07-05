import type { PoolClient, QueryResultRow } from "pg";

import { initializeDatabase, query, withTransaction } from "./db.ts";
import { isUuid } from "./identifiers.ts";

export const PLAN_LIMIT_EXCEEDED = "plan_limit_exceeded";

export type PlanCode = "free" | "pro" | "team";

export type LimitKey =
  | "user.owned_workspaces"
  | "workspace.members"
  | "ai.campaign_builder"
  | "ai.segmentation"
  | "ai.personalization_recipients"
  | "contact_intelligence.rows";

export type UsageKey =
  | "ai.campaign_builder"
  | "ai.segmentation"
  | "ai.personalization_recipients"
  | "contact_intelligence.rows";

type PlanEntitlements = {
  name: string;
  limits: Record<LimitKey, number | null>;
};

export type LimitDetails = {
  limit_key: LimitKey;
  used: number;
  limit: number | null;
};

export type LimitErrorResponse = {
  success: false;
  error: typeof PLAN_LIMIT_EXCEEDED;
  message: string;
  details: LimitDetails;
};

type CountRow = QueryResultRow & {
  count: number;
};

type PlanRow = QueryResultRow & {
  plan_code: string | null;
};

type UsageRow = QueryResultRow & {
  used_count: number;
};

async function runQuery<T extends QueryResultRow>(
  client: PoolClient | undefined,
  text: string,
  params: readonly unknown[],
) {
  return client ? client.query<T>(text, params as unknown[]) : query<T>(text, params);
}

export const PLAN_ENTITLEMENTS: Record<PlanCode, PlanEntitlements> = {
  free: {
    name: "Free",
    limits: {
      "user.owned_workspaces": 1,
      "workspace.members": 3,
      "ai.campaign_builder": 20,
      "ai.segmentation": 50,
      "ai.personalization_recipients": 100,
      "contact_intelligence.rows": 500,
    },
  },
  pro: {
    name: "Pro",
    limits: {
      "user.owned_workspaces": 5,
      "workspace.members": 10,
      "ai.campaign_builder": 200,
      "ai.segmentation": 500,
      "ai.personalization_recipients": 2_000,
      "contact_intelligence.rows": 10_000,
    },
  },
  team: {
    name: "Team",
    limits: {
      "user.owned_workspaces": null,
      "workspace.members": null,
      "ai.campaign_builder": null,
      "ai.segmentation": null,
      "ai.personalization_recipients": null,
      "contact_intelligence.rows": null,
    },
  },
};

export class PlanLimitExceededError extends Error {
  readonly details: LimitDetails;

  constructor(message: string, details: LimitDetails) {
    super(message);
    this.name = "PlanLimitExceededError";
    this.details = details;
  }
}

function normalizePlanCode(value: string | null | undefined): PlanCode {
  return value === "pro" || value === "team" ? value : "free";
}

function assertUuid(name: string, value: string): void {
  if (!isUuid(value)) {
    throw new Error(`${name} must be a UUID`);
  }
}

function getLimit(planCode: PlanCode, limitKey: LimitKey): number | null {
  return PLAN_ENTITLEMENTS[planCode].limits[limitKey];
}

export function limitErrorResponse(error: PlanLimitExceededError): LimitErrorResponse {
  return {
    success: false,
    error: PLAN_LIMIT_EXCEEDED,
    message: error.message,
    details: error.details,
  };
}

export function statusForPlanLimitError(error: unknown): number | null {
  return error instanceof PlanLimitExceededError ? 402 : null;
}

export function currentMonthlyPeriodStart(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-01`;
}

export async function getUserPlanCode(
  userId: string,
  client?: PoolClient,
): Promise<PlanCode> {
  assertUuid("userId", userId);
  const result = await runQuery<PlanRow>(
    client,
    'SELECT plan_code FROM "User_entitlements" WHERE user_id = $1 LIMIT 1',
    [userId],
  );

  return normalizePlanCode(result.rows[0]?.plan_code);
}

export async function getWorkspacePlanCode(
  workspaceId: string,
  client?: PoolClient,
): Promise<PlanCode> {
  assertUuid("workspaceId", workspaceId);
  const result = await runQuery<PlanRow>(
    client,
    'SELECT plan_code FROM "Workspace_subscriptions" ' +
      "WHERE workspace_id = $1 AND status IN ('active', 'trialing') LIMIT 1",
    [workspaceId],
  );

  return normalizePlanCode(result.rows[0]?.plan_code);
}

export async function countOwnedWorkspaces(
  userId: string,
  client?: PoolClient,
): Promise<number> {
  assertUuid("userId", userId);
  const result = await runQuery<CountRow>(
    client,
    'SELECT COUNT(*)::int AS count FROM "Workspace_members" ' +
      "WHERE user_id = $1 AND role = 'owner'",
    [userId],
  );

  return result.rows[0]?.count ?? 0;
}

export async function countWorkspaceMembers(
  workspaceId: string,
  client?: PoolClient,
): Promise<number> {
  assertUuid("workspaceId", workspaceId);
  const result = await runQuery<CountRow>(
    client,
    'SELECT COUNT(*)::int AS count FROM "Workspace_members" WHERE workspace_id = $1',
    [workspaceId],
  );

  return result.rows[0]?.count ?? 0;
}

export async function assertCanCreateOwnedWorkspace(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const planCode = await getUserPlanCode(userId, client);
  const limit = getLimit(planCode, "user.owned_workspaces");

  if (limit === null) return;

  const used = await countOwnedWorkspaces(userId, client);
  if (used >= limit) {
    throw new PlanLimitExceededError(
      "Free plan workspace limit reached. Upgrade to create more workspaces.",
      { limit_key: "user.owned_workspaces", used, limit },
    );
  }
}

export async function assertWorkspaceHasMemberCapacity(
  workspaceId: string,
  client?: PoolClient,
): Promise<void> {
  const planCode = await getWorkspacePlanCode(workspaceId, client);
  const limit = getLimit(planCode, "workspace.members");

  if (limit === null) return;

  const used = await countWorkspaceMembers(workspaceId, client);
  if (used >= limit) {
    throw new PlanLimitExceededError(
      "Free plan member limit reached. Upgrade to invite more members.",
      { limit_key: "workspace.members", used, limit },
    );
  }
}

export function usageKeyToLimitKey(usageKey: UsageKey): LimitKey {
  return usageKey;
}

export async function readWorkspaceUsage(
  workspaceId: string,
  usageKey: UsageKey,
  periodStart = currentMonthlyPeriodStart(),
  client?: PoolClient,
): Promise<number> {
  assertUuid("workspaceId", workspaceId);
  const result = await runQuery<UsageRow>(
    client,
    'SELECT used_count FROM "Usage_counters" ' +
      "WHERE workspace_id = $1 AND user_id IS NULL AND usage_key = $2 AND period_start = $3::date",
    [workspaceId, usageKey, periodStart],
  );

  return result.rows[0]?.used_count ?? 0;
}

export async function assertWorkspaceUsageAvailable(input: {
  workspaceId: string;
  usageKey: UsageKey;
  amount?: number;
  client?: PoolClient;
}): Promise<void> {
  const amount = input.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error("Usage amount must be a positive integer");
  }

  const planCode = await getWorkspacePlanCode(input.workspaceId, input.client);
  const limit = getLimit(planCode, usageKeyToLimitKey(input.usageKey));

  if (limit === null) return;

  const used = await readWorkspaceUsage(
    input.workspaceId,
    input.usageKey,
    currentMonthlyPeriodStart(),
    input.client,
  );

  if (used + amount > limit) {
    throw new PlanLimitExceededError(
      "Plan usage limit reached. Upgrade to continue using this feature.",
      {
        limit_key: usageKeyToLimitKey(input.usageKey),
        used,
        limit,
      },
    );
  }
}

export async function consumeWorkspaceUsage(input: {
  workspaceId: string;
  usageKey: UsageKey;
  amount?: number;
}): Promise<void> {
  const amount = input.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error("Usage amount must be a positive integer");
  }

  await initializeDatabase();
  await withTransaction(async (client) => {
    const periodStart = currentMonthlyPeriodStart();
    await assertWorkspaceUsageAvailable({
      workspaceId: input.workspaceId,
      usageKey: input.usageKey,
      amount,
      client,
    });

    await client.query(
      'INSERT INTO "Usage_counters" ' +
        "(workspace_id, user_id, usage_key, period_start, used_count) " +
        "VALUES ($1, NULL, $2, $3::date, $4) " +
        "ON CONFLICT (workspace_id, user_id, usage_key, period_start) " +
        "DO UPDATE SET used_count = \"Usage_counters\".used_count + EXCLUDED.used_count, updated_at = NOW()",
      [input.workspaceId, input.usageKey, periodStart, amount],
    );
  });
}

export async function getWorkspaceUsageOverview(input: {
  userId: string;
  workspaceId: string;
}): Promise<{
  userPlan: PlanCode;
  workspacePlan: PlanCode;
  ownedWorkspaces: LimitDetails;
  workspaceMembers: LimitDetails;
  usage: Record<UsageKey, LimitDetails>;
}> {
  await initializeDatabase();

  return withTransaction(async (client) => {
    const userPlan = await getUserPlanCode(input.userId, client);
    const workspacePlan = await getWorkspacePlanCode(input.workspaceId, client);
    const ownedUsed = await countOwnedWorkspaces(input.userId, client);
    const memberUsed = await countWorkspaceMembers(input.workspaceId, client);
    const periodStart = currentMonthlyPeriodStart();
    const usageKeys: UsageKey[] = [
      "ai.campaign_builder",
      "ai.segmentation",
      "ai.personalization_recipients",
      "contact_intelligence.rows",
    ];
    const usage = {} as Record<UsageKey, LimitDetails>;

    for (const usageKey of usageKeys) {
      usage[usageKey] = {
        limit_key: usageKeyToLimitKey(usageKey),
        used: await readWorkspaceUsage(
          input.workspaceId,
          usageKey,
          periodStart,
          client,
        ),
        limit: getLimit(workspacePlan, usageKeyToLimitKey(usageKey)),
      };
    }

    return {
      userPlan,
      workspacePlan,
      ownedWorkspaces: {
        limit_key: "user.owned_workspaces",
        used: ownedUsed,
        limit: getLimit(userPlan, "user.owned_workspaces"),
      },
      workspaceMembers: {
        limit_key: "workspace.members",
        used: memberUsed,
        limit: getLimit(workspacePlan, "workspace.members"),
      },
      usage,
    };
  });
}
