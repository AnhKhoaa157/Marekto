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

export type PlanEntitlements = {
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

type PlanEntitlementRow = QueryResultRow & {
  name: string | null;
  limits: unknown;
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
      "user.owned_workspaces": 3,
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
      "user.owned_workspaces": 10,
      "workspace.members": 25,
      "ai.campaign_builder": 1_000,
      "ai.segmentation": 2_500,
      "ai.personalization_recipients": 10_000,
      "contact_intelligence.rows": 50_000,
    },
  },
};

export const PLAN_CODES: readonly PlanCode[] = ["free", "pro", "team"];

export const LIMIT_KEYS: readonly LimitKey[] = [
  "user.owned_workspaces",
  "workspace.members",
  "ai.campaign_builder",
  "ai.segmentation",
  "ai.personalization_recipients",
  "contact_intelligence.rows",
];

export const USAGE_KEYS: readonly UsageKey[] = [
  "ai.campaign_builder",
  "ai.segmentation",
  "ai.personalization_recipients",
  "contact_intelligence.rows",
];

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

function normalizeLimitValue(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

function normalizePlanLimits(
  planCode: PlanCode,
  value: unknown,
): Record<LimitKey, number | null> {
  const fallback = PLAN_ENTITLEMENTS[planCode].limits;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...fallback };
  }

  const raw = value as Record<string, unknown>;
  const limits = { ...fallback };

  for (const limitKey of LIMIT_KEYS) {
    const normalized = normalizeLimitValue(raw[limitKey]);
    if (normalized !== undefined) {
      limits[limitKey] = normalized;
    }
  }

  return limits;
}

export async function getPlanEntitlements(
  planCode: PlanCode,
  client?: PoolClient,
): Promise<PlanEntitlements> {
  const result = await runQuery<PlanEntitlementRow>(
    client,
    'SELECT name, limits FROM "Billing_plans" WHERE plan_code = $1 LIMIT 1',
    [planCode],
  );
  const row = result.rows[0];

  if (!row) {
    return {
      name: PLAN_ENTITLEMENTS[planCode].name,
      limits: { ...PLAN_ENTITLEMENTS[planCode].limits },
    };
  }

  return {
    name: row.name?.trim() || PLAN_ENTITLEMENTS[planCode].name,
    limits: normalizePlanLimits(planCode, row.limits),
  };
}

async function getLimit(
  planCode: PlanCode,
  limitKey: LimitKey,
  client?: PoolClient,
): Promise<number | null> {
  const entitlements = await getPlanEntitlements(planCode, client);
  return entitlements.limits[limitKey];
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
  const limit = await getLimit(planCode, "user.owned_workspaces", client);

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
  const limit = await getLimit(planCode, "workspace.members", client);

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
  const limit = await getLimit(
    planCode,
    usageKeyToLimitKey(input.usageKey),
    input.client,
  );

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
    const userEntitlements = await getPlanEntitlements(userPlan, client);
    const workspaceEntitlements = await getPlanEntitlements(workspacePlan, client);
    const ownedUsed = await countOwnedWorkspaces(input.userId, client);
    const memberUsed = await countWorkspaceMembers(input.workspaceId, client);
    const periodStart = currentMonthlyPeriodStart();
    const usage = {} as Record<UsageKey, LimitDetails>;

    for (const usageKey of USAGE_KEYS) {
      usage[usageKey] = {
        limit_key: usageKeyToLimitKey(usageKey),
        used: await readWorkspaceUsage(
          input.workspaceId,
          usageKey,
          periodStart,
          client,
        ),
        limit: workspaceEntitlements.limits[usageKeyToLimitKey(usageKey)],
      };
    }

    return {
      userPlan,
      workspacePlan,
      ownedWorkspaces: {
        limit_key: "user.owned_workspaces",
        used: ownedUsed,
        limit: userEntitlements.limits["user.owned_workspaces"],
      },
      workspaceMembers: {
        limit_key: "workspace.members",
        used: memberUsed,
        limit: workspaceEntitlements.limits["workspace.members"],
      },
      usage,
    };
  });
}
