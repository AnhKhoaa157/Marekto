import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

const ACCOUNT_AUTH_STUB_URL = "marekto-test:billing-account-auth-stub";
const BILLING_STUB_URL = "marekto-test:billing-lib-stub";
const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");

const stubState = {
  identity: { userId: USER_ID, workspaceId: WORKSPACE_ID },
  checkoutCalls: [],
  checkoutError: null,
  webhookCalls: [],
  webhookError: null,
};
globalThis.__marektoBillingRouteStub = stubState;

const ACCOUNT_AUTH_STUB_SOURCE = `
const state = globalThis.__marektoBillingRouteStub;

export async function authenticateAccountRequest() {
  return state.identity;
}

export function statusForAccountAuthError(message) {
  if (message.startsWith("Unauthorized:")) return 401;
  if (message.startsWith("Forbidden:")) return 403;
  return 500;
}
`;

const BILLING_STUB_SOURCE = `
const state = globalThis.__marektoBillingRouteStub;

export class BillingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "BillingError";
    this.status = status;
  }
}

export async function createBillingCheckout(input) {
  state.checkoutCalls.push(input);
  if (state.checkoutError) throw state.checkoutError;
  const checkoutUrl = "http://localhost:3000/settings/billing?mock_order=order";
  return {
    checkoutUrl,
    order: { id: "order-id", plan_code: input.plan, status: "pending" },
    redirect: { kind: "url", url: checkoutUrl },
  };
}

export async function processBillingWebhook(input) {
  state.webhookCalls.push(input);
  if (state.webhookError) throw state.webhookError;
  return { processed: true, eventId: "evt_test" };
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/account-auth") {
      return { url: ACCOUNT_AUTH_STUB_URL, shortCircuit: true };
    }

    if (specifier === "@/lib/billing") {
      return { url: BILLING_STUB_URL, shortCircuit: true };
    }

    if (specifier.startsWith("@/")) {
      const target = pathToFileURL(
        path.join(SRC_ROOT, `${specifier.slice(2)}.ts`),
      ).href;
      return nextResolve(target, context);
    }

    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === ACCOUNT_AUTH_STUB_URL) {
      return {
        format: "module",
        source: ACCOUNT_AUTH_STUB_SOURCE,
        shortCircuit: true,
      };
    }

    if (url === BILLING_STUB_URL) {
      return { format: "module", source: BILLING_STUB_SOURCE, shortCircuit: true };
    }

    return nextLoad(url, context);
  },
});

const { POST: checkoutPost } = await import(
  pathToFileURL(
    path.join(SRC_ROOT, "app", "api", "billing", "checkout", "route.ts"),
  ).href
);
const { POST: webhookPost } = await import(
  pathToFileURL(
    path.join(SRC_ROOT, "app", "api", "billing", "webhook", "route.ts"),
  ).href
);
const { BillingError } = await import(BILLING_STUB_URL);
const { NextRequest } = await import("next/server.js");

function resetStub() {
  stubState.identity = { userId: USER_ID, workspaceId: WORKSPACE_ID };
  stubState.checkoutCalls = [];
  stubState.checkoutError = null;
  stubState.webhookCalls = [];
  stubState.webhookError = null;
}

function jsonRequest(url, body, headers = {}) {
  return new NextRequest(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}

test("billing checkout returns a provider URL and never accepts workspace from body", async () => {
  resetStub();
  const response = await checkoutPost(
    jsonRequest("http://localhost/api/billing/checkout", {
      plan: "pro",
      workspaceId: "spoofed",
    }),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.url.includes("/settings/billing"), true);
  assert.deepEqual(stubState.checkoutCalls, [
    { userId: USER_ID, workspaceId: WORKSPACE_ID, plan: "pro" },
  ]);
});

test("billing checkout rejects sessions without workspace context", async () => {
  resetStub();
  stubState.identity = { userId: USER_ID, workspaceId: null };

  const response = await checkoutPost(
    jsonRequest("http://localhost/api/billing/checkout", { plan: "pro" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.success, false);
  assert.equal(payload.error, "Workspace context is required");
  assert.deepEqual(stubState.checkoutCalls, []);
});

test("billing checkout maps billing errors to their explicit status", async () => {
  resetStub();
  stubState.checkoutError = new BillingError(
    "Forbidden: workspace owner access required",
    403,
  );

  const response = await checkoutPost(
    jsonRequest("http://localhost/api/billing/checkout", { plan: "team" }),
  );
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error, "Forbidden: workspace owner access required");
});

test("billing webhook returns idempotent processing result", async () => {
  resetStub();
  const response = await webhookPost(
    jsonRequest(
      "http://localhost/api/billing/webhook",
      { event_id: "evt_test", type: "payment_order.paid", order_id: WORKSPACE_ID },
      { "x-marekto-billing-signature": "secret" },
    ),
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    success: true,
    data: { processed: true, eventId: "evt_test" },
  });
  assert.equal(stubState.webhookCalls.length, 1);
});

test("billing webhook maps signature errors", async () => {
  resetStub();
  stubState.webhookError = new BillingError(
    "Invalid billing webhook signature",
    401,
  );

  const response = await webhookPost(
    jsonRequest("http://localhost/api/billing/webhook", {}),
  );
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error, "Invalid billing webhook signature");
});
