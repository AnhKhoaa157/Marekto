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
  plans: BillingPlan[];
  subscription: WorkspaceSubscription;
  pendingOrders: PaymentOrder[];
  usage: Awaited<ReturnType<typeof getWorkspaceUsageOverview>>;
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

export class BillingError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BillingError";
    this.status = status;
  }
}

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

function isSepaySandboxEnabled(): boolean {
  return process.env.SEPAY_SANDBOX?.trim().toLowerCase() === "true";
}

function isProviderConfigured(provider: BillingProviderCode): boolean {
  if (provider === "mock") {
    return process.env.NODE_ENV !== "production";
  }

  if (provider === "stripe") {
    return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  }

  return (
    (process.env.NODE_ENV !== "production" && isSepaySandboxEnabled()) ||
    Boolean(process.env.SEPAY_WEBHOOK_SECRET)
  );
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

function buildSepayPaymentCode(orderId: string): string {
  return `MKT${orderId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function buildCheckoutUrl(provider: BillingProviderCode, orderId: string): string {
  const param = provider === "sepay" ? "sepay_order" : "mock_order";
  return `${getAppBaseUrl()}/settings/billing?${param}=${orderId}`;
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

  return {
    provider,
    providerConfigured: isProviderConfigured(provider),
    plans: await getBillingPlanCatalog(),
    subscription: await readSubscription(input.workspaceId),
    pendingOrders: await readPendingOrders(input.workspaceId),
    usage: await getWorkspaceUsageOverview(input),
  };
}

export async function createBillingCheckout(input: {
  userId: string;
  workspaceId: string;
  plan: unknown;
}): Promise<{ order: PaymentOrder; checkoutUrl: string }> {
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
        JSON.stringify({
          source: provider === "sepay" ? "sepay_sandbox_checkout" : "mock_checkout",
        }),
      ],
    );
    const order = mapPaymentOrder(inserted.rows[0]);
    const checkoutUrl = buildCheckoutUrl(provider, order.id);
    const providerOrderId =
      provider === "sepay" ? buildSepayPaymentCode(order.id) : `mock_${order.id}`;
    const providerMetadata =
      provider === "sepay"
        ? {
            sepay_payment_code: providerOrderId,
            transfer_content: providerOrderId,
          }
        : { mock_order_id: providerOrderId };

    const updated = await client.query<PaymentOrderRow>(
      'UPDATE "Payment_orders" SET checkout_url = $1, provider_order_id = $2, ' +
        "metadata = metadata || $3::jsonb, updated_at = NOW() " +
        "WHERE id = $4 " +
        "RETURNING id, workspace_id, user_id, plan_code, provider, provider_order_id, checkout_url, " +
        "amount_cents, currency, status, expires_at, paid_at, created_at",
      [checkoutUrl, providerOrderId, JSON.stringify(providerMetadata), order.id],
    );

    return {
      order: mapPaymentOrder(updated.rows[0]),
      checkoutUrl,
    };
  });
}

function parseMockWebhookPayload(bodyText: string): {
  eventId: string;
  eventType: "payment_order.paid" | "payment_order.failed";
  orderId: string;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new BillingError("Webhook payload is invalid", 400);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BillingError("Webhook payload is invalid", 400);
  }

  const payload = parsed as Record<string, unknown>;
  const eventId = typeof payload.event_id === "string" ? payload.event_id : "";
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const orderId = typeof payload.order_id === "string" ? payload.order_id : "";

  if (eventId.trim().length === 0) {
    throw new BillingError("Webhook event id is required", 400);
  }

  if (eventType !== "payment_order.paid" && eventType !== "payment_order.failed") {
    throw new BillingError("Webhook event type is unsupported", 400);
  }

  if (!isUuid(orderId)) {
    throw new BillingError("Webhook order id is invalid", 400);
  }

  return { eventId, eventType, orderId };
}

function assertMockWebhookSignature(headers: Headers): void {
  const expected =
    process.env.BILLING_MOCK_WEBHOOK_SECRET ?? "marekto-mock-billing-secret";
  const actual = headers.get("x-marekto-billing-signature");

  if (!actual || actual !== expected) {
    throw new BillingError("Invalid billing webhook signature", 401);
  }
}

function assertSepayWebhookAuth(headers: Headers): void {
  const expected = process.env.SEPAY_WEBHOOK_SECRET?.trim();

  if (
    !expected &&
    process.env.NODE_ENV !== "production" &&
    isSepaySandboxEnabled()
  ) {
    return;
  }

  const authorization = headers.get("authorization")?.trim();
  const sandboxSecret = headers.get("x-sepay-webhook-secret")?.trim();

  if (
    !expected ||
    (authorization !== `Apikey ${expected}` && sandboxSecret !== expected)
  ) {
    throw new BillingError("Invalid SePay webhook signature", 401);
  }
}

function parseSepayWebhookPayload(bodyText: string): {
  eventId: string;
  paymentCode: string;
  transferAmount: number;
  transferType: string;
  payload: Record<string, unknown>;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new BillingError("Webhook payload is invalid", 400);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BillingError("Webhook payload is invalid", 400);
  }

  const payload = parsed as Record<string, unknown>;
  const rawId = payload.id;
  const eventId =
    typeof rawId === "number" || typeof rawId === "string"
      ? `sepay_${String(rawId).trim()}`
      : "";
  const rawTransferAmount = payload.transferAmount;
  const transferAmount =
    typeof rawTransferAmount === "number" ? rawTransferAmount : Number.NaN;
  const transferType =
    typeof payload.transferType === "string" ? payload.transferType.trim() : "";
  const candidates = [
    typeof payload.code === "string" ? payload.code : "",
    typeof payload.content === "string" ? payload.content : "",
    typeof payload.description === "string" ? payload.description : "",
  ];
  const paymentCode =
    candidates
      .map((candidate) => candidate.match(/\bMKT[A-Z0-9]{12}\b/i)?.[0])
      .find(Boolean)
      ?.toUpperCase() ?? "";

  if (!eventId || eventId === "sepay_") {
    throw new BillingError("SePay webhook id is required", 400);
  }

  if (!Number.isInteger(transferAmount) || transferAmount < 0) {
    throw new BillingError("SePay transfer amount is invalid", 400);
  }

  if (!paymentCode) {
    throw new BillingError("SePay payment code was not found", 400);
  }

  return { eventId, paymentCode, payload, transferAmount, transferType };
}

async function activatePaidOrder(input: {
  client: PoolClient;
  eventId: string;
  order: PaymentOrderRow;
  provider: BillingProviderCode;
}): Promise<void> {
  await input.client.query(
    'UPDATE "Payment_orders" SET status = $1, paid_at = COALESCE(paid_at, NOW()), updated_at = NOW() ' +
      "WHERE id = $2",
    ["paid", input.order.id],
  );

  await input.client.query(
    'INSERT INTO "Workspace_subscriptions" ' +
      "(workspace_id, plan_code, status, provider, provider_subscription_id, provider_price_id, " +
      "current_period_start, current_period_end, last_webhook_event_id, metadata) " +
      "VALUES ($1, $2, 'active', $3, $4, $5, NOW(), NOW() + INTERVAL '1 month', $6, $7::jsonb) " +
      "ON CONFLICT (workspace_id) DO UPDATE SET " +
      "plan_code = EXCLUDED.plan_code, status = EXCLUDED.status, provider = EXCLUDED.provider, " +
      "provider_subscription_id = EXCLUDED.provider_subscription_id, " +
      "provider_price_id = EXCLUDED.provider_price_id, current_period_start = EXCLUDED.current_period_start, " +
      "current_period_end = EXCLUDED.current_period_end, last_webhook_event_id = EXCLUDED.last_webhook_event_id, " +
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
}

export async function processBillingWebhook(input: {
  headers: Headers;
  bodyText: string;
}): Promise<{ processed: boolean; eventId: string }> {
  await initializeDatabase();
  const provider = getBillingProvider();

  if (provider !== "mock" && provider !== "sepay") {
    throw new BillingError(`${provider} webhook adapter is not implemented yet`, 501);
  }

  if (provider === "sepay") {
    assertSepayWebhookAuth(input.headers);
    const payload = parseSepayWebhookPayload(input.bodyText);

    return withTransaction(async (client) => {
      const eventResult = await client.query<BillingEventRow>(
        'INSERT INTO "Billing_events" ' +
          "(provider, provider_event_id, event_type, payload) " +
          "VALUES ($1, $2, $3, $4::jsonb) " +
          "ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id",
        [
          provider,
          payload.eventId,
          `sepay.transfer.${payload.transferType || "unknown"}`,
          JSON.stringify(payload.payload),
        ],
      );

      if (!eventResult.rows[0]) {
        return { processed: false, eventId: payload.eventId };
      }

      const orderResult = await client.query<PaymentOrderRow>(
        'SELECT id, workspace_id, user_id, plan_code, provider, provider_order_id, checkout_url, ' +
          "amount_cents, currency, status, expires_at, paid_at, created_at " +
          'FROM "Payment_orders" WHERE provider = $1 AND provider_order_id = $2 LIMIT 1',
        [provider, payload.paymentCode],
      );
      const order = orderResult.rows[0];

      if (!order) {
        throw new BillingError("Payment order not found", 404);
      }

      await client.query(
        'UPDATE "Billing_events" SET workspace_id = $1, payment_order_id = $2 WHERE id = $3',
        [order.workspace_id, order.id, eventResult.rows[0].id],
      );

      if (payload.transferType !== "in" || payload.transferAmount < order.amount_cents) {
        return { processed: false, eventId: payload.eventId };
      }

      await activatePaidOrder({ client, eventId: payload.eventId, order, provider });

      return { processed: true, eventId: payload.eventId };
    });
  }

  assertMockWebhookSignature(input.headers);
  const payload = parseMockWebhookPayload(input.bodyText);

  return withTransaction(async (client) => {
    const eventResult = await client.query<BillingEventRow>(
      'INSERT INTO "Billing_events" ' +
        "(provider, provider_event_id, event_type, payload) " +
        "VALUES ($1, $2, $3, $4::jsonb) " +
        "ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id",
      [
        provider,
        payload.eventId,
        payload.eventType,
        JSON.stringify({
          event_id: payload.eventId,
          type: payload.eventType,
          order_id: payload.orderId,
        }),
      ],
    );

    if (!eventResult.rows[0]) {
      return { processed: false, eventId: payload.eventId };
    }

    const orderResult = await client.query<PaymentOrderRow>(
      'SELECT id, workspace_id, user_id, plan_code, provider, provider_order_id, checkout_url, ' +
        "amount_cents, currency, status, expires_at, paid_at, created_at " +
        'FROM "Payment_orders" WHERE id = $1 AND provider = $2 LIMIT 1',
      [payload.orderId, provider],
    );
    const order = orderResult.rows[0];

    if (!order) {
      throw new BillingError("Payment order not found", 404);
    }

    await client.query(
      'UPDATE "Billing_events" SET workspace_id = $1, payment_order_id = $2 WHERE id = $3',
      [order.workspace_id, order.id, eventResult.rows[0].id],
    );

    if (payload.eventType === "payment_order.failed") {
      await client.query(
        'UPDATE "Payment_orders" SET status = $1, updated_at = NOW() WHERE id = $2',
        ["failed", order.id],
      );
      return { processed: true, eventId: payload.eventId };
    }

    await activatePaidOrder({ client, eventId: payload.eventId, order, provider });

    return { processed: true, eventId: payload.eventId };
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
