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

const stubState = {
  events: new Set(),
  order: null,
  subscription: null,
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

      if (text.includes('FROM "Payment_orders" WHERE provider = $1')) {
        return state.order?.provider_order_id === params[1]
          ? { rows: [state.order] }
          : { rows: [] };
      }

      if (text.startsWith('UPDATE "Billing_events"')) {
        return { rows: [] };
      }

      if (text.startsWith('UPDATE "Payment_orders" SET status')) {
        state.order = { ...state.order, status: params[0], paid_at: new Date().toISOString() };
        return { rows: [] };
      }

      if (text.startsWith('INSERT INTO "Workspace_subscriptions"')) {
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
  process.env.BILLING_PROVIDER = "sepay";
  process.env.SEPAY_SANDBOX = "true";
  delete process.env.SEPAY_WEBHOOK_SECRET;
}

test("SePay sandbox checkout creates a payment code and local checkout URL", async () => {
  resetStub();

  const checkout = await createBillingCheckout({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    plan: "pro",
  });

  assert.equal(checkout.order.provider, "sepay");
  assert.match(checkout.order.provider_order_id, /^MKT[A-Z0-9]{12}$/);
  assert.equal(checkout.checkoutUrl.includes("sepay_order="), true);
});

test("SePay sandbox webhook marks matching paid orders active", async () => {
  resetStub();
  const checkout = await createBillingCheckout({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    plan: "pro",
  });

  const result = await processBillingWebhook({
    headers: new Headers(),
    bodyText: JSON.stringify({
      id: 92704,
      code: checkout.order.provider_order_id,
      content: `${checkout.order.provider_order_id} chuyen tien`,
      transferAmount: 99000,
      transferType: "in",
    }),
  });

  assert.deepEqual(result, { processed: true, eventId: "sepay_92704" });
  assert.equal(stubState.order.status, "paid");
  assert.deepEqual(stubState.subscription, {
    workspace_id: WORKSPACE_ID,
    plan_code: "pro",
    provider: "sepay",
  });
});

test("SePay sandbox webhook ignores underpaid matching orders", async () => {
  resetStub();
  const checkout = await createBillingCheckout({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    plan: "pro",
  });

  const result = await processBillingWebhook({
    headers: new Headers(),
    bodyText: JSON.stringify({
      id: 92705,
      code: checkout.order.provider_order_id,
      transferAmount: 98000,
      transferType: "in",
    }),
  });

  assert.deepEqual(result, { processed: false, eventId: "sepay_92705" });
  assert.equal(stubState.order.status, "pending");
  assert.equal(stubState.subscription, null);
});
