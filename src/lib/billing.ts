import type { PoolClient, QueryResultRow } from "pg";

import { initializeDatabase, query, withTransaction } from "./db.ts";
import {
  getWorkspaceUsageOverview,
  LIMIT_KEYS,
  PLAN_ENTITLEMENTS,
  type LimitKey,
  type PlanCode,
} from "./entitlements.ts";
import { isUuid } from "./identifiers.ts";
import { assertUserCanUseWorkspace } from "./workspace-collaboration.ts";
import { BillingError } from "./billing/errors.ts";
import {
  isSepayConfigured,
  parseSepayConfig,
  tryParseSepayConfig,
} from "./billing/providers/config.ts";
import {
  buildMockCheckout,
  isMockConfigured,
  verifyAndParseMockWebhook,
} from "./billing/providers/mock.ts";
import {
  buildSepayCheckout,
  querySepayOrder,
  verifyAndParseSepayWebhook,
} from "./billing/providers/sepay.ts";
import type {
  NormalizedWebhookEvent,
  ProviderCheckout,
  ProviderCheckoutRedirect,
} from "./billing/providers/types.ts";

export { BillingError };

export type BillingProviderCode = "mock" | "stripe" | "sepay";
export type CheckoutPlanCode = Exclude<PlanCode, "free">;
export type PaymentOrderStatus =
  | "pending"
  | "paid"
  | "expired"
  | "failed"
  | "canceled";

export type BillingPlan = {
  code: PlanCode;
  name: string;
  description: string;
  monthlyAmountCents: number;
  currency: string;
  checkoutEnabled: boolean;
  limits: Record<LimitKey, number | null>;
  features: string[];
};

export type PaymentOrder = {
  id: string;
  workspace_id: string;
  user_id: string;
  plan_code: CheckoutPlanCode;
  provider: BillingProviderCode;
  provider_order_id: string | null;
  checkout_url: string | null;
  amount_cents: number;
  currency: string;
  status: PaymentOrderStatus;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
};

export type WorkspaceSubscription = {
  workspace_id: string;
  plan_code: PlanCode;
  status: string;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_price_id: string | null;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
};

export type BillingOverview = {
  provider: BillingProviderCode;
  providerConfigured: boolean;
  /** Provider environment label, e.g. "sandbox" for SePay; null when not applicable. */
  providerEnvironment: string | null;
  plans: BillingPlan[];
  subscription: WorkspaceSubscription;
  pendingOrders: PaymentOrder[];
  usage: Awaited<ReturnType<typeof getWorkspaceUsageOverview>>;
};

export type BillingCheckout = {
  order: PaymentOrder;
  checkoutUrl: string;
  redirect: ProviderCheckoutRedirect;
};

type PaymentOrderRow = QueryResultRow & {
  id: string;
  workspace_id: string;
  user_id: string;
  plan_code: string;
  provider: string;
  provider_order_id: string | null;
  checkout_url: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  expires_at: Date | string | null;
  paid_at: Date | string | null;
  created_at: Date | string;
};

type SubscriptionRow = QueryResultRow & {
  workspace_id: string;
  plan_code: string;
  status: string;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_price_id: string | null;
  cancel_at_period_end: boolean;
  current_period_start: Date | string | null;
  current_period_end: Date | string | null;
};

type BillingEventRow = QueryResultRow & {
  id: string;
};

type BillingPlanRow = QueryResultRow & {
  plan_code: string;
  name: string;
  description: string;
  monthly_amount_cents: number;
  currency: string;
  checkout_enabled: boolean;
  limits: unknown;
  features: unknown;
};

export const BILLING_PLANS: Record<PlanCode, BillingPlan> = {
  free: {
    code: "free",
    name: PLAN_ENTITLEMENTS.free.name,
    description: "For trying Marekto with basic workspace and AI limits.",
    monthlyAmountCents: 0,
    currency: "vnd",
    checkoutEnabled: false,
    limits: { ...PLAN_ENTITLEMENTS.free.limits },
    features: [
      "1 owned workspace",
      "3 workspace members",
      "20 AI campaign-builder runs/month",
      "50 AI segmentation runs/month",
      "500 contact-intelligence rows/month",
    ],
  },
  pro: {
    code: "pro",
    name: PLAN_ENTITLEMENTS.pro.name,
    description: "For growing teams that need more AI usage and seats.",
    monthlyAmountCents: 99000,
    currency: "vnd",
    checkoutEnabled: true,
    limits: { ...PLAN_ENTITLEMENTS.pro.limits },
    features: [
      "3 owned workspaces",
      "Up to 10 workspace members",
      "200 AI campaign-builder runs/month",
      "500 AI segmentation runs/month",
      "2,000 AI personalized recipients/month",
      "10,000 contact-intelligence rows/month",
    ],
  },
  team: {
    code: "team",
    name: PLAN_ENTITLEMENTS.team.name,
    description: "For teams that need heavier collaboration and AI usage.",
    monthlyAmountCents: 299000,
    currency: "vnd",
    checkoutEnabled: true,
    limits: {
      "user.owned_workspaces": 10,
      "workspace.members": 25,
      "ai.campaign_builder": 1_000,
      "ai.segmentation": 2_500,
      "ai.personalization_recipients": 10_000,
      "contact_intelligence.rows": 50_000,
    },
    features: [
      "10 owned workspaces",
      "Up to 25 workspace members",
      "1,000 AI campaign-builder runs/month",
      "2,500 AI segmentation runs/month",
      "10,000 AI personalized recipients/month",
      "50,000 contact-intelligence rows/month",
    ],
  },
};

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeProvider(value: string | undefined): BillingProviderCode {
  if (value === "stripe" || value === "sepay") return value;
  return "mock";
}

function normalizePlanCode(value: string | null | undefined): PlanCode {
  return value === "pro" || value === "team" ? value : "free";
}

function normalizeCheckoutPlanCode(value: unknown): CheckoutPlanCode {
  if (value === "pro" || value === "team") return value;
  throw new BillingError("Billing plan is invalid", 400);
}

function normalizeOrderStatus(value: string): PaymentOrderStatus {
  if (
    value === "paid" ||
    value === "expired" ||
    value === "failed" ||
    value === "canceled"
  ) {
    return value;
  }

  return "pending";
}

function assertUuid(name: string, value: string): void {
  if (!isUuid(value)) {
    throw new BillingError(`${name} must be a UUID`, 400);
  }
}

function normalizeLimits(
  planCode: PlanCode,
  value: unknown,
): Record<LimitKey, number | null> {
  const fallback = BILLING_PLANS[planCode].limits;

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...fallback };
  }

  const raw = value as Record<string, unknown>;
  const limits = { ...fallback };

  for (const limitKey of LIMIT_KEYS) {
    const limit = raw[limitKey];
    if (limit === null) {
      limits[limitKey] = null;
    } else if (typeof limit === "number" && Number.isInteger(limit) && limit >= 0) {
      limits[limitKey] = limit;
    }
  }

  return limits;
}

function normalizeFeatures(planCode: PlanCode, value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...BILLING_PLANS[planCode].features];
  }

  const features = value
    .filter((feature): feature is string => typeof feature === "string")
    .map((feature) => feature.trim())
    .filter(Boolean)
    .slice(0, 12);

  return features.length > 0 ? features : [...BILLING_PLANS[planCode].features];
}

function mapBillingPlan(row: BillingPlanRow): BillingPlan {
  const planCode = normalizePlanCode(row.plan_code);

  return {
    code: planCode,
    name: row.name.trim() || BILLING_PLANS[planCode].name,
    description: row.description.trim() || BILLING_PLANS[planCode].description,
    monthlyAmountCents:
      Number.isInteger(row.monthly_amount_cents) && row.monthly_amount_cents >= 0
        ? row.monthly_amount_cents
        : BILLING_PLANS[planCode].monthlyAmountCents,
    currency: row.currency.trim().toLowerCase() || BILLING_PLANS[planCode].currency,
    checkoutEnabled: Boolean(row.checkout_enabled),
    limits: normalizeLimits(planCode, row.limits),
    features: normalizeFeatures(planCode, row.features),
  };
}

function getBillingProvider(): BillingProviderCode {
  return normalizeProvider(process.env.BILLING_PROVIDER?.trim().toLowerCase());
}

function getAppBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return configured && /^https?:\/\//i.test(configured)
    ? configured.replace(/\/+$/, "")
    : "http://localhost:3000";
}

function isProviderConfigured(provider: BillingProviderCode): boolean {
  if (provider === "mock") {
    return isMockConfigured();
  }

  if (provider === "stripe") {
    return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  }

  return isSepayConfigured();
}

function mapPaymentOrder(row: PaymentOrderRow): PaymentOrder {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    plan_code: normalizeCheckoutPlanCode(row.plan_code),
    provider: normalizeProvider(row.provider),
    provider_order_id: row.provider_order_id,
    checkout_url: row.checkout_url,
    amount_cents: row.amount_cents,
    currency: row.currency,
    status: normalizeOrderStatus(row.status),
    expires_at: toIsoString(row.expires_at),
    paid_at: toIsoString(row.paid_at),
    created_at: toIsoString(row.created_at) ?? "",
  };
}

function mapSubscription(row: SubscriptionRow | undefined, workspaceId: string) {
  return {
    workspace_id: workspaceId,
    plan_code: normalizePlanCode(row?.plan_code),
    status: row?.status ?? "active",
    provider: row?.provider ?? null,
    provider_customer_id: row?.provider_customer_id ?? null,
    provider_subscription_id: row?.provider_subscription_id ?? null,
    provider_price_id: row?.provider_price_id ?? null,
    cancel_at_period_end: row?.cancel_at_period_end ?? false,
    current_period_start: toIsoString(row?.current_period_start ?? null),
    current_period_end: toIsoString(row?.current_period_end ?? null),
  } satisfies WorkspaceSubscription;
}

async function assertWorkspaceOwner(userId: string, workspaceId: string): Promise<void> {
  const workspace = await assertUserCanUseWorkspace(userId, workspaceId);
  if (workspace.role !== "owner") {
    throw new BillingError("Forbidden: workspace owner access required", 403);
  }
}

async function readSubscription(
  workspaceId: string,
  client?: PoolClient,
): Promise<WorkspaceSubscription> {
  const text =
    'SELECT workspace_id, plan_code, status, provider, provider_customer_id, ' +
      "provider_subscription_id, provider_price_id, cancel_at_period_end, " +
      'current_period_start, current_period_end FROM "Workspace_subscriptions" ' +
      "WHERE workspace_id = $1 LIMIT 1";
  const params = [workspaceId];
  const result = client
    ? await client.query<SubscriptionRow>(text, params)
    : await query<SubscriptionRow>(text, params);

  return mapSubscription(result.rows[0], workspaceId);
}

async function readPendingOrders(workspaceId: string): Promise<PaymentOrder[]> {
  const result = await query<PaymentOrderRow>(
    'SELECT id, workspace_id, user_id, plan_code, provider, provider_order_id, ' +
      "checkout_url, amount_cents, currency, status, expires_at, paid_at, created_at " +
      'FROM "Payment_orders" WHERE workspace_id = $1 AND status = $2 ' +
      "ORDER BY created_at DESC, id DESC LIMIT 3",
    [workspaceId, "pending"],
  );

  return result.rows.map(mapPaymentOrder);
}

export async function getBillingPlanCatalog(): Promise<BillingPlan[]> {
  await initializeDatabase();
  const result = await query<BillingPlanRow>(
    'SELECT plan_code, name, description, monthly_amount_cents, currency, ' +
      'checkout_enabled, limits, features FROM "Billing_plans" ' +
      "ORDER BY CASE plan_code WHEN 'free' THEN 1 WHEN 'pro' THEN 2 WHEN 'team' THEN 3 ELSE 4 END",
  );
  const plans = new Map<PlanCode, BillingPlan>();

  for (const row of result.rows) {
    const plan = mapBillingPlan(row);
    plans.set(plan.code, plan);
  }

  return [
    plans.get("free") ?? BILLING_PLANS.free,
    plans.get("pro") ?? BILLING_PLANS.pro,
    plans.get("team") ?? BILLING_PLANS.team,
  ];
}

async function getBillingPlan(planCode: PlanCode): Promise<BillingPlan> {
  const plans = await getBillingPlanCatalog();
  return plans.find((plan) => plan.code === planCode) ?? BILLING_PLANS[planCode];
}

/**
 * Stable, unique invoice/order number derived from the Marekto payment order
 * UUID. Stored on the order and used to match incoming SePay IPN events.
 */
function buildSepayInvoiceNumber(orderId: string): string {
  return `MKT${orderId.replace(/-/g, "").toUpperCase()}`;
}

export async function getBillingOverview(input: {
  userId: string;
  workspaceId: string;
}): Promise<BillingOverview> {
  assertUuid("userId", input.userId);
  assertUuid("workspaceId", input.workspaceId);
  await initializeDatabase();
  await assertWorkspaceOwner(input.userId, input.workspaceId);

  const provider = getBillingProvider();
  const sepayConfig = provider === "sepay" ? tryParseSepayConfig() : null;

  return {
    provider,
    providerConfigured: isProviderConfigured(provider),
    providerEnvironment: sepayConfig?.env ?? null,
    plans: await getBillingPlanCatalog(),
    subscription: await readSubscription(input.workspaceId),
    pendingOrders: await readPendingOrders(input.workspaceId),
    usage: await getWorkspaceUsageOverview(input),
  };
}

function buildProviderCheckout(input: {
  provider: BillingProviderCode;
  orderId: string;
  planCode: CheckoutPlanCode;
  planName: string;
  amountCents: number;
  currency: string;
}): ProviderCheckout {
  const checkoutInput = {
    orderId: input.orderId,
    planCode: input.planCode,
    amountCents: input.amountCents,
    currency: input.currency,
    invoiceNumber: buildSepayInvoiceNumber(input.orderId),
    description: `Marekto ${input.planName} plan (monthly)`,
    appBaseUrl: getAppBaseUrl(),
  };

  if (input.provider === "sepay") {
    return buildSepayCheckout(checkoutInput, parseSepayConfig());
  }

  return buildMockCheckout(checkoutInput);
}

export async function createBillingCheckout(input: {
  userId: string;
  workspaceId: string;
  plan: unknown;
}): Promise<BillingCheckout> {
  assertUuid("userId", input.userId);
  assertUuid("workspaceId", input.workspaceId);
  await initializeDatabase();
  await assertWorkspaceOwner(input.userId, input.workspaceId);

  const planCode = normalizeCheckoutPlanCode(input.plan);
  const plan = await getBillingPlan(planCode);
  const provider = getBillingProvider();

  if (!isProviderConfigured(provider)) {
    throw new BillingError("Billing provider is not configured", 503);
  }

  if (provider !== "mock" && provider !== "sepay") {
    throw new BillingError(
      `${provider} checkout adapter is not implemented yet`,
      501,
    );
  }

  return withTransaction(async (client) => {
    const inserted = await client.query<PaymentOrderRow>(
      'INSERT INTO "Payment_orders" ' +
        "(workspace_id, user_id, plan_code, provider, amount_cents, currency, status, expires_at, metadata) " +
        "VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW() + INTERVAL '30 minutes', $7::jsonb) " +
        "RETURNING id, workspace_id, user_id, plan_code, provider, provider_order_id, checkout_url, " +
        "amount_cents, currency, status, expires_at, paid_at, created_at",
      [
        input.workspaceId,
        input.userId,
        planCode,
        provider,
        plan.monthlyAmountCents,
        plan.currency,
        JSON.stringify({ source: `${provider}_checkout` }),
      ],
    );
    const order = mapPaymentOrder(inserted.rows[0]);

    const checkout = buildProviderCheckout({
      provider,
      orderId: order.id,
      planCode,
      planName: plan.name,
      amountCents: order.amount_cents,
      currency: order.currency,
    });

    const updated = await client.query<PaymentOrderRow>(
      'UPDATE "Payment_orders" SET checkout_url = $1, provider_order_id = $2, ' +
        "metadata = metadata || $3::jsonb, updated_at = NOW() " +
        "WHERE id = $4 " +
        "RETURNING id, workspace_id, user_id, plan_code, provider, provider_order_id, checkout_url, " +
        "amount_cents, currency, status, expires_at, paid_at, created_at",
      [
        checkout.checkoutUrl,
        checkout.providerOrderId,
        JSON.stringify(checkout.safeMetadata),
        order.id,
      ],
    );

    return {
      order: mapPaymentOrder(updated.rows[0]),
      checkoutUrl: checkout.checkoutUrl,
      redirect: checkout.redirect,
    };
  });
}

const ORDER_COLUMNS =
  "id, workspace_id, user_id, plan_code, provider, provider_order_id, checkout_url, " +
  "amount_cents, currency, status, expires_at, paid_at, created_at";

async function findOrderForEvent(
  client: PoolClient,
  provider: BillingProviderCode,
  match: NormalizedWebhookEvent["orderMatch"],
): Promise<PaymentOrderRow | undefined> {
  // The lookup column is chosen from a fixed union (never user input), so the
  // two branches stay fully parameterized with no interpolated values.
  const text =
    match.by === "id"
      ? `SELECT ${ORDER_COLUMNS} FROM "Payment_orders" WHERE id = $1 AND provider = $2 LIMIT 1`
      : `SELECT ${ORDER_COLUMNS} FROM "Payment_orders" WHERE provider_order_id = $1 AND provider = $2 LIMIT 1`;
  const result = await client.query<PaymentOrderRow>(text, [match.value, provider]);
  return result.rows[0];
}

/**
 * Activate a paid order and grant one paid period. Idempotent: a renewal extends
 * from the later of now or the current period end so a re-run cannot stack time.
 */
async function activatePaidOrder(input: {
  client: PoolClient;
  eventId: string;
  order: PaymentOrderRow;
  provider: BillingProviderCode;
}): Promise<boolean> {
  const claimedOrder = await input.client.query<{ id: string }>(
    'UPDATE "Payment_orders" SET status = $1, paid_at = COALESCE(paid_at, NOW()), updated_at = NOW() ' +
      "WHERE id = $2 AND status = 'pending' RETURNING id",
    ["paid", input.order.id],
  );

  if (!claimedOrder.rows[0]) {
    return false;
  }

  await input.client.query(
    'INSERT INTO "Workspace_subscriptions" ' +
      "(workspace_id, plan_code, status, provider, provider_subscription_id, provider_price_id, " +
      "current_period_start, current_period_end, last_webhook_event_id, metadata) " +
      "VALUES ($1, $2, 'active', $3, $4, $5, NOW(), NOW() + INTERVAL '1 month', $6, $7::jsonb) " +
      "ON CONFLICT (workspace_id) DO UPDATE SET " +
      "plan_code = EXCLUDED.plan_code, status = EXCLUDED.status, provider = EXCLUDED.provider, " +
      "provider_subscription_id = EXCLUDED.provider_subscription_id, " +
      "provider_price_id = EXCLUDED.provider_price_id, " +
      'current_period_start = COALESCE("Workspace_subscriptions".current_period_end, NOW()), ' +
      'current_period_end = GREATEST("Workspace_subscriptions".current_period_end, NOW()) + INTERVAL \'1 month\', ' +
      "last_webhook_event_id = EXCLUDED.last_webhook_event_id, " +
      "metadata = EXCLUDED.metadata, updated_at = NOW()",
    [
      input.order.workspace_id,
      input.order.plan_code,
      input.provider,
      `${input.provider}_subscription_${input.order.id}`,
      input.order.plan_code,
      input.eventId,
      JSON.stringify({ payment_order_id: input.order.id }),
    ],
  );

  return true;
}

function verifyAndParseWebhook(
  provider: BillingProviderCode,
  headers: Headers,
  bodyText: string,
): NormalizedWebhookEvent {
  if (provider === "sepay") {
    return verifyAndParseSepayWebhook(headers, bodyText, parseSepayConfig());
  }
  return verifyAndParseMockWebhook(headers, bodyText);
}

/**
 * Authenticate, parse, and process a provider webhook/IPN. Only a verified paid
 * event whose amount and currency exactly match the trusted stored order can
 * activate a subscription. Duplicate events are recorded once and return
 * `processed: false` (HTTP 200). No route/query parameter can reach this path —
 * activation happens exclusively here.
 */
export async function processBillingWebhook(input: {
  headers: Headers;
  bodyText: string;
}): Promise<{ processed: boolean; eventId: string }> {
  await initializeDatabase();
  const provider = getBillingProvider();

  if (provider !== "mock" && provider !== "sepay") {
    throw new BillingError(`${provider} webhook adapter is not implemented yet`, 501);
  }

  const event = verifyAndParseWebhook(provider, input.headers, input.bodyText);

  return withTransaction(async (client) => {
    const eventResult = await client.query<BillingEventRow>(
      'INSERT INTO "Billing_events" ' +
        "(provider, provider_event_id, event_type, payload) " +
        "VALUES ($1, $2, $3, $4::jsonb) " +
        "ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id",
      [
        provider,
        event.providerEventId,
        event.eventType,
        JSON.stringify(event.sanitizedPayload),
      ],
    );

    // Duplicate delivery: the event already exists. Acknowledge with 200 and do
    // not re-activate.
    if (!eventResult.rows[0]) {
      return { processed: false, eventId: event.providerEventId };
    }

    const order = await findOrderForEvent(client, provider, event.orderMatch);

    if (!order) {
      throw new BillingError("Payment order not found", 404);
    }

    await client.query(
      'UPDATE "Billing_events" SET workspace_id = $1, payment_order_id = $2 WHERE id = $3',
      [order.workspace_id, order.id, eventResult.rows[0].id],
    );

    // Validate amount/currency against the trusted stored order before acting.
    // Mismatches are recorded (event persisted) but never activate entitlement.
    if (event.expectedAmountCents !== null && event.expectedAmountCents !== order.amount_cents) {
      return { processed: false, eventId: event.providerEventId };
    }
    if (
      event.expectedCurrency !== null &&
      event.expectedCurrency !== order.currency.toLowerCase()
    ) {
      return { processed: false, eventId: event.providerEventId };
    }

    if (event.outcome === "paid") {
      const activated = await activatePaidOrder({
        client,
        eventId: event.providerEventId,
        order,
        provider,
      });
      return { processed: activated, eventId: event.providerEventId };
    }

    if (event.outcome === "failed" || event.outcome === "canceled") {
      await client.query(
        'UPDATE "Payment_orders" SET status = $1, updated_at = NOW() WHERE id = $2',
        [event.outcome === "failed" ? "failed" : "canceled", order.id],
      );
      return { processed: true, eventId: event.providerEventId };
    }

    // Unsupported/ignored notification: recorded, no state change.
    return { processed: false, eventId: event.providerEventId };
  });
}

/**
 * Server-only reconciliation for a pending SePay order. Queries the SePay REST
 * API and, only if the provider confirms the exact order/amount/currency in a
 * captured state, activates the subscription idempotently (repairing a missed
 * IPN). Not wired to any public route; intended for an admin/cron-guarded caller.
 */
export async function reconcileSepayOrder(orderId: string): Promise<{
  reconciled: boolean;
  status: PaymentOrderStatus;
}> {
  assertUuid("orderId", orderId);
  await initializeDatabase();

  const provider = getBillingProvider();
  if (provider !== "sepay") {
    throw new BillingError("Reconciliation is only available for the SePay provider", 400);
  }
  const config = parseSepayConfig();

  return withTransaction(async (client) => {
    const orderResult = await client.query<PaymentOrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM "Payment_orders" WHERE id = $1 AND provider = $2 LIMIT 1`,
      [orderId, provider],
    );
    const order = orderResult.rows[0];
    if (!order) {
      throw new BillingError("Payment order not found", 404);
    }

    if (order.status === "paid") {
      return { reconciled: false, status: "paid" };
    }
    if (!order.provider_order_id) {
      return { reconciled: false, status: normalizeOrderStatus(order.status) };
    }

    const lookup = await querySepayOrder(order.provider_order_id, config);

    const matches =
      lookup.found &&
      lookup.orderStatus === "CAPTURED" &&
      lookup.amountCents === order.amount_cents &&
      (lookup.currency === null || lookup.currency === order.currency.toLowerCase());

    if (!matches) {
      return { reconciled: false, status: normalizeOrderStatus(order.status) };
    }

    await activatePaidOrder({
      client,
      eventId: `sepay_reconcile_${order.id}`,
      order,
      provider,
    });

    return { reconciled: true, status: "paid" };
  });
}

export async function createBillingPortalSession(input: {
  userId: string;
  workspaceId: string;
}): Promise<{ url: string }> {
  assertUuid("userId", input.userId);
  assertUuid("workspaceId", input.workspaceId);
  await initializeDatabase();
  await assertWorkspaceOwner(input.userId, input.workspaceId);

  const provider = getBillingProvider();

  if (provider === "mock") {
    throw new BillingError("Billing portal is not available for the mock provider", 501);
  }

  throw new BillingError(`${provider} billing portal adapter is not implemented yet`, 501);
}
