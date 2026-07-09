import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

const DB_STUB_URL = "marekto-test:billing-sepay-db-stub";
const ENTITLEMENTS_STUB_URL = "marekto-test:billing-sepay-entitlements-stub";
const WORKSPACE_STUB_URL = "marekto-test:billing-sepay-workspace-stub";
const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");
const ORDER_ID = "12345678-1234-4abc-8def-123456789abc";
const INVOICE_NUMBER = `MKT${ORDER_ID.replace(/-/g, "").toUpperCase()}`;
const TRANSACTION_ID = "384c66dd-41e6-4316-a544-b4141682595c";

const stubState = {
  events: new Set(),
  order: null,
  subscription: null,
  activations: 0,
};
globalThis.__marektoSepayBillingStub = stubState;

const DB_STUB_SOURCE = `
const state = globalThis.__marektoSepayBillingStub;
const ORDER_ID = "${ORDER_ID}";
const USER_ID = "${USER_ID}";
const WORKSPACE_ID = "${WORKSPACE_ID}";

function orderRow(overrides = {}) {
  return {
    id: ORDER_ID,
    workspace_id: WORKSPACE_ID,
    user_id: USER_ID,
    plan_code: "pro",
    provider: "sepay",
    provider_order_id: null,
    checkout_url: null,
    amount_cents: 99000,
    currency: "vnd",
    status: "pending",
    expires_at: new Date().toISOString(),
    paid_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export async function initializeDatabase() {}

export async function query(text) {
  if (text.includes('"Billing_plans"')) {
    return {
      rows: [
        {
          plan_code: "pro",
          name: "Pro",
          description: "Small team plan",
          monthly_amount_cents: 99000,
          currency: "vnd",
          checkout_enabled: true,
          limits: {
            "user.owned_workspaces": 3,
            "workspace.members": 10,
            "ai.campaign_builder": 200,
            "ai.segmentation": 500,
            "ai.personalization_recipients": 2000,
            "contact_intelligence.rows": 10000,
          },
          features: ["Pro feature"],
        },
      ],
    };
  }

  return { rows: [] };
}

export async function withTransaction(callback) {
  const client = {
    async query(text, params = []) {
      if (text.startsWith('INSERT INTO "Payment_orders"')) {
        state.order = orderRow({
          plan_code: params[2],
          provider: params[3],
          amount_cents: params[4],
          currency: params[5],
        });
        return { rows: [state.order] };
      }

      if (text.startsWith('UPDATE "Payment_orders" SET checkout_url')) {
        state.order = {
          ...state.order,
          checkout_url: params[0],
          provider_order_id: params[1],
        };
        return { rows: [state.order] };
      }

      if (text.startsWith('INSERT INTO "Billing_events"')) {
        const eventKey = params[1];
        if (state.events.has(eventKey)) return { rows: [] };
        state.events.add(eventKey);
        return { rows: [{ id: "event-id" }] };
      }

      if (text.includes('WHERE provider_order_id = $1 AND provider = $2')) {
        return state.order?.provider_order_id === params[0]
          ? { rows: [state.order] }
          : { rows: [] };
      }

      if (text.startsWith('UPDATE "Billing_events"')) {
        return { rows: [] };
      }

      if (text.startsWith('UPDATE "Payment_orders" SET status')) {
        if (text.includes("AND status = 'pending'") && state.order.status !== "pending") {
          return { rows: [] };
        }
        state.order = { ...state.order, status: params[0], paid_at: new Date().toISOString() };
        return { rows: [{ id: state.order.id }] };
      }

      if (text.startsWith('INSERT INTO "Workspace_subscriptions"')) {
        state.activations += 1;
        state.subscription = {
          workspace_id: params[0],
          plan_code: params[1],
          provider: params[2],
        };
        return { rows: [] };
      }

      return { rows: [] };
    },
  };

  return callback(client);
}
`;

const ENTITLEMENTS_STUB_SOURCE = `
export const LIMIT_KEYS = [
  "user.owned_workspaces",
  "workspace.members",
  "ai.campaign_builder",
  "ai.segmentation",
  "ai.personalization_recipients",
  "contact_intelligence.rows",
];

export const PLAN_ENTITLEMENTS = {
  free: { name: "Free", limits: {} },
  pro: { name: "Pro", limits: {} },
  team: { name: "Team", limits: {} },
};

export async function getWorkspaceUsageOverview() {
  return {};
}
`;

const WORKSPACE_STUB_SOURCE = `
export async function assertUserCanUseWorkspace() {
  return { role: "owner" };
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./db.ts" &&
      context.parentURL?.endsWith("/src/lib/billing.ts")
    ) {
      return { url: DB_STUB_URL, shortCircuit: true };
    }

    if (
      specifier === "./entitlements.ts" &&
      context.parentURL?.endsWith("/src/lib/billing.ts")
    ) {
      return { url: ENTITLEMENTS_STUB_URL, shortCircuit: true };
    }

    if (
      specifier === "./workspace-collaboration.ts" &&
      context.parentURL?.endsWith("/src/lib/billing.ts")
    ) {
      return { url: WORKSPACE_STUB_URL, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === DB_STUB_URL) {
      return { format: "module", source: DB_STUB_SOURCE, shortCircuit: true };
    }

    if (url === ENTITLEMENTS_STUB_URL) {
      return {
        format: "module",
        source: ENTITLEMENTS_STUB_SOURCE,
        shortCircuit: true,
      };
    }

    if (url === WORKSPACE_STUB_URL) {
      return {
        format: "module",
        source: WORKSPACE_STUB_SOURCE,
        shortCircuit: true,
      };
    }

    return nextLoad(url, context);
  },
});

const { createBillingCheckout, processBillingWebhook } = await import(
  pathToFileURL(path.join(SRC_ROOT, "lib", "billing.ts")).href
);

function resetStub() {
  stubState.events = new Set();
  stubState.order = null;
  stubState.subscription = null;
  stubState.activations = 0;
  process.env.BILLING_PROVIDER = "sepay";
  process.env.SEPAY_ENV = "sandbox";
  process.env.SEPAY_MERCHANT_ID = "MERCHANT_TEST";
  process.env.SEPAY_SECRET_KEY = "secret-key-test";
  process.env.SEPAY_IPN_SECRET = "ipn-secret-test";
  delete process.env.SEPAY_REQUEST_TIMEOUT_MS;
  delete process.env.SEPAY_SANDBOX;
  delete process.env.SEPAY_WEBHOOK_SECRET;
}

function ipnBody(overrides = {}) {
  return JSON.stringify({
    timestamp: 1757058220,
    notification_type: overrides.notification_type ?? "ORDER_PAID",
    order: {
      id: "e2c195be-c721-47eb-b323-99ab24e52d85",
      order_id: "NPSETVI00101000042R",
      order_status: "CAPTURED",
      order_currency: "VND",
      order_amount: "99000.00",
      order_invoice_number: INVOICE_NUMBER,
      order_description: "Marekto Pro plan (monthly)",
      ...overrides.order,
    },
    transaction: {
      id: TRANSACTION_ID,
      transaction_id: "68ba94ac80123",
      transaction_type: "PAYMENT",
      transaction_status: "APPROVED",
      transaction_amount: "99000",
      transaction_currency: "VND",
      payment_method: "CARD",
      ...overrides.transaction,
    },
  });
}

function ipnHeaders(secret = "ipn-secret-test") {
  return new Headers({ "x-secret-key": secret });
}

test("official SePay checkout returns a signed sandbox form and stores no secret", async () => {
  resetStub();

  const checkout = await createBillingCheckout({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    plan: "pro",
  });

  assert.equal(checkout.order.provider, "sepay");
  // Server resolves amount from the plan catalog, never the browser.
  assert.equal(checkout.order.amount_cents, 99000);
  assert.equal(checkout.redirect.kind, "form");
  assert.equal(checkout.redirect.action, "https://pay-sandbox.sepay.vn/v1/checkout/init");
  assert.equal(checkout.order.provider_order_id, INVOICE_NUMBER);
  assert.equal(typeof checkout.redirect.fields.signature, "string");
  assert.equal(JSON.stringify(checkout.order).includes("secret-key-test"), false);
});

test("valid ORDER_PAID IPN activates exactly one entitlement period", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  const result = await processBillingWebhook({
    headers: ipnHeaders(),
    bodyText: ipnBody(),
  });

  assert.deepEqual(result, {
    processed: true,
    eventId: `sepay_${TRANSACTION_ID}`,
  });
  assert.equal(stubState.order.status, "paid");
  assert.equal(stubState.activations, 1);
  assert.deepEqual(stubState.subscription, {
    workspace_id: WORKSPACE_ID,
    plan_code: "pro",
    provider: "sepay",
  });
});

test("duplicate IPN returns success and does not double-activate", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  await processBillingWebhook({ headers: ipnHeaders(), bodyText: ipnBody() });
  const duplicate = await processBillingWebhook({ headers: ipnHeaders(), bodyText: ipnBody() });

  assert.deepEqual(duplicate, { processed: false, eventId: `sepay_${TRANSACTION_ID}` });
  assert.equal(stubState.activations, 1);
});

test("same order cannot be activated twice with a different provider event id", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  await processBillingWebhook({ headers: ipnHeaders(), bodyText: ipnBody() });
  const second = await processBillingWebhook({
    headers: ipnHeaders(),
    bodyText: ipnBody({
      transaction: {
        id: "a4d6f7b2-df34-4a25-aac7-cf3567a32100",
        transaction_id: "68ba94ac-second",
      },
    }),
  });

  assert.deepEqual(second, {
    processed: false,
    eventId: "sepay_a4d6f7b2-df34-4a25-aac7-cf3567a32100",
  });
  assert.equal(stubState.order.status, "paid");
  assert.equal(stubState.activations, 1);
});

test("wrong X-Secret-Key is rejected without activation", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  await assert.rejects(
    () => processBillingWebhook({ headers: ipnHeaders("nope"), bodyText: ipnBody() }),
    /Invalid SePay IPN secret/,
  );
  assert.equal(stubState.activations, 0);
  assert.equal(stubState.order.status, "pending");
});

test("wrong amount is rejected without activation", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  const result = await processBillingWebhook({
    headers: ipnHeaders(),
    bodyText: ipnBody({ order: { order_amount: "1000.00" } }),
  });

  assert.equal(result.processed, false);
  assert.equal(stubState.activations, 0);
  assert.equal(stubState.order.status, "pending");
});

test("wrong currency is rejected without activation", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  const result = await processBillingWebhook({
    headers: ipnHeaders(),
    bodyText: ipnBody({ order: { order_currency: "USD" } }),
  });

  assert.equal(result.processed, false);
  assert.equal(stubState.activations, 0);
});

test("unknown invoice is rejected", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  await assert.rejects(
    () =>
      processBillingWebhook({
        headers: ipnHeaders(),
        bodyText: ipnBody({ order: { order_invoice_number: "MKTUNKNOWN0000" } }),
      }),
    /Payment order not found/,
  );
  assert.equal(stubState.activations, 0);
});

test("unsupported notification/status does not activate", async () => {
  resetStub();
  await createBillingCheckout({ userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" });

  const result = await processBillingWebhook({
    headers: ipnHeaders(),
    bodyText: ipnBody({ order: { order_status: "PENDING" }, transaction: { transaction_status: "PENDING" } }),
  });

  assert.equal(result.processed, false);
  assert.equal(stubState.activations, 0);
  assert.equal(stubState.order.status, "pending");
});
