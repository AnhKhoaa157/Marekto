import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  buildEmailLogSelection,
  DEFAULT_EMAIL_LOG_LIMIT,
  SELECT_CAMPAIGN_DELIVERY_SQL,
  SELECT_EMAIL_LOG_SUMMARY_SQL,
} from "../src/lib/email-logs.ts";

const WORKSPACE_ID = 7;
const CAMPAIGN_ID = 42;
const DB_STUB_URL = "marekto-test:email-logs-db-stub";
const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");

// The route module resolves `@/lib/db` to this stub, so route-level tests run
// against a fake workspace transaction instead of a real PostgreSQL pool.
const dbStub = {
  initializeDatabaseCalls: 0,
  withWorkspaceCalls: [],
  client: null,
};
globalThis.__marektoEmailLogsRouteDbStub = dbStub;

const DB_STUB_SOURCE = `
const state = globalThis.__marektoEmailLogsRouteDbStub;

export async function initializeDatabase() {
  state.initializeDatabaseCalls += 1;
}

export async function withWorkspace(workspaceId, callback) {
  state.withWorkspaceCalls.push(workspaceId);
  return callback(state.client);
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") {
      return { url: DB_STUB_URL, shortCircuit: true };
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
    if (url === DB_STUB_URL) {
      return { format: "module", source: DB_STUB_SOURCE, shortCircuit: true };
    }

    return nextLoad(url, context);
  },
});

const { GET } = await import(
  pathToFileURL(
    path.join(
      SRC_ROOT,
      "app",
      "api",
      "campaigns",
      "[id]",
      "email-logs",
      "route.ts",
    ),
  ).href
);
const { NextRequest } = await import("next/server.js");

const CAMPAIGN_ROW = {
  id: CAMPAIGN_ID,
  name: "Route test campaign",
  status: "sent",
  failure_reason: null,
  ai_personalization_enabled: true,
  ai_context: { tone: "warm" },
  scheduled_at: new Date("2026-07-01T00:00:00.000Z"),
  run_at: new Date("2026-07-01T00:01:00.000Z"),
};

const EMPTY_SUMMARY_ROW = {
  total_recipients: 0,
  sent_count: 0,
  failed_count: 0,
  gemini_personalized_count: 0,
  template_sent_count: 0,
  ai_fallback_count: 0,
  first_sent_at: null,
  last_sent_at: null,
};

function resetDbStub(client = null) {
  dbStub.initializeDatabaseCalls = 0;
  dbStub.withWorkspaceCalls = [];
  dbStub.client = client;
}

function createFakeClient(respond) {
  const executed = [];

  return {
    executed,
    async query(text, params) {
      executed.push({ text, params });
      return respond(text, params);
    },
  };
}

function buildRequest(headers = {}) {
  return new NextRequest(
    `http://localhost/api/campaigns/${CAMPAIGN_ID}/email-logs`,
    { headers },
  );
}

function routeContext(id = String(CAMPAIGN_ID)) {
  return { params: Promise.resolve({ id }) };
}

test("missing workspace header is rejected before any workspace access", async (t) => {
  t.mock.method(console, "error", () => {});
  resetDbStub();

  const response = await GET(buildRequest(), routeContext());
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, { success: false, error: "Missing workspace context" });
  assert.deepEqual(dbStub.withWorkspaceCalls, []);
});

test("invalid workspace header values are rejected", async (t) => {
  t.mock.method(console, "error", () => {});

  for (const headerValue of ["abc", "0", "-1", "2.5"]) {
    resetDbStub();

    const response = await GET(
      buildRequest({ "x-workspace-id": headerValue }),
      routeContext(),
    );
    const body = await response.json();

    assert.equal(response.status, 400, `expected 400 for "${headerValue}"`);
    assert.deepEqual(body, { success: false, error: "Invalid workspace id" });
    assert.deepEqual(dbStub.withWorkspaceCalls, []);
  }
});

test("campaign outside the workspace returns 404 without leaking log queries", async () => {
  const client = createFakeClient((text, params) => {
    if (text === SELECT_CAMPAIGN_DELIVERY_SQL) {
      assert.deepEqual(params, [CAMPAIGN_ID, WORKSPACE_ID]);
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${text}`);
  });
  resetDbStub(client);

  const response = await GET(
    buildRequest({ "x-workspace-id": String(WORKSPACE_ID) }),
    routeContext(),
  );
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body, { success: false, error: "Campaign not found" });
  assert.deepEqual(dbStub.withWorkspaceCalls, [WORKSPACE_ID]);
  assert.equal(client.executed.length, 1);
});

test("campaign with no logs returns zero counts and an empty log list", async () => {
  const logsSelection = buildEmailLogSelection(
    WORKSPACE_ID,
    CAMPAIGN_ID,
    DEFAULT_EMAIL_LOG_LIMIT,
    null,
  );
  const client = createFakeClient((text, params) => {
    if (text === SELECT_CAMPAIGN_DELIVERY_SQL) {
      assert.deepEqual(params, [CAMPAIGN_ID, WORKSPACE_ID]);
      return { rows: [CAMPAIGN_ROW] };
    }

    if (text === SELECT_EMAIL_LOG_SUMMARY_SQL) {
      assert.deepEqual(params, [WORKSPACE_ID, CAMPAIGN_ID]);
      return { rows: [EMPTY_SUMMARY_ROW] };
    }

    if (text === logsSelection.text) {
      assert.deepEqual(params, logsSelection.params);
      return { rows: [] };
    }

    throw new Error(`Unexpected query: ${text}`);
  });
  resetDbStub(client);

  const response = await GET(
    buildRequest({ "x-workspace-id": String(WORKSPACE_ID) }),
    routeContext(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    data: {
      campaign: {
        id: CAMPAIGN_ID,
        name: "Route test campaign",
        status: "sent",
        failure_reason: null,
        ai_personalization_enabled: true,
        ai_context: { tone: "warm" },
        scheduled_at: "2026-07-01T00:00:00.000Z",
        run_at: "2026-07-01T00:01:00.000Z",
      },
      summary: {
        total_recipients: 0,
        sent_count: 0,
        failed_count: 0,
        gemini_personalized_count: 0,
        template_sent_count: 0,
        ai_fallback_count: 0,
        first_sent_at: null,
        last_sent_at: null,
      },
      logs: [],
    },
  });
  assert.deepEqual(dbStub.withWorkspaceCalls, [WORKSPACE_ID]);
  assert.equal(client.executed.length, 3);
});

test("route returns truthful sent, failed, mixed, Gemini, and fallback outcomes", async () => {
  const sentAt = new Date("2026-07-02T00:00:00.000Z");
  const laterAt = new Date("2026-07-02T00:05:00.000Z");
  const scenarios = [
    {
      name: "all sent with Gemini and original template",
      summary: {
        total_recipients: 2,
        sent_count: 2,
        failed_count: 0,
        gemini_personalized_count: 1,
        template_sent_count: 1,
        ai_fallback_count: 0,
        first_sent_at: sentAt,
        last_sent_at: laterAt,
      },
      logs: [
        {
          id: 2,
          contact_id: 11,
          status: "sent",
          error_message: null,
          personalization_source: "gemini",
          personalization_error: null,
          sent_at: laterAt,
          recipient_email: "gemini@example.test",
          recipient_first_name: "Gemini",
          recipient_last_name: "Recipient",
        },
        {
          id: 1,
          contact_id: 10,
          status: "sent",
          error_message: null,
          personalization_source: "template",
          personalization_error: null,
          sent_at: sentAt,
          recipient_email: "template@example.test",
          recipient_first_name: "Template",
          recipient_last_name: "Recipient",
        },
      ],
      expectedStatuses: ["sent", "sent"],
      expectedCategories: ["none", "none"],
    },
    {
      name: "all failed",
      summary: {
        total_recipients: 2,
        sent_count: 0,
        failed_count: 2,
        gemini_personalized_count: 0,
        template_sent_count: 0,
        ai_fallback_count: 0,
        first_sent_at: null,
        last_sent_at: null,
      },
      logs: [
        {
          id: 4,
          contact_id: 13,
          status: "failed",
          error_message: "SMTP delivery is not configured",
          personalization_source: null,
          personalization_error: null,
          sent_at: laterAt,
          recipient_email: "failed-two@example.test",
          recipient_first_name: null,
          recipient_last_name: null,
        },
        {
          id: 3,
          contact_id: 12,
          status: "failed",
          error_message: "Campaign email template content is unavailable",
          personalization_source: null,
          personalization_error: null,
          sent_at: sentAt,
          recipient_email: "failed-one@example.test",
          recipient_first_name: null,
          recipient_last_name: null,
        },
      ],
      expectedStatuses: ["failed", "failed"],
      expectedCategories: ["smtp_unconfigured", "template_missing"],
    },
    {
      name: "mixed sent and failed",
      summary: {
        total_recipients: 2,
        sent_count: 1,
        failed_count: 1,
        gemini_personalized_count: 1,
        template_sent_count: 0,
        ai_fallback_count: 0,
        first_sent_at: sentAt,
        last_sent_at: sentAt,
      },
      logs: [
        {
          id: 6,
          contact_id: 15,
          status: "failed",
          error_message: "Connection refused by mail server",
          personalization_source: "template",
          personalization_error: null,
          sent_at: laterAt,
          recipient_email: "mixed-failed@example.test",
          recipient_first_name: null,
          recipient_last_name: null,
        },
        {
          id: 5,
          contact_id: 14,
          status: "sent",
          error_message: null,
          personalization_source: "gemini",
          personalization_error: null,
          sent_at: sentAt,
          recipient_email: "mixed-sent@example.test",
          recipient_first_name: null,
          recipient_last_name: null,
        },
      ],
      expectedStatuses: ["failed", "sent"],
      expectedCategories: ["smtp_failure", "none"],
    },
    {
      name: "successful template fallback",
      summary: {
        total_recipients: 1,
        sent_count: 1,
        failed_count: 0,
        gemini_personalized_count: 0,
        template_sent_count: 1,
        ai_fallback_count: 1,
        first_sent_at: sentAt,
        last_sent_at: sentAt,
      },
      logs: [
        {
          id: 7,
          contact_id: 16,
          status: "sent",
          error_message: null,
          personalization_source: "template",
          personalization_error: "Gemini provider unavailable",
          sent_at: sentAt,
          recipient_email: "fallback@example.test",
          recipient_first_name: null,
          recipient_last_name: null,
        },
      ],
      expectedStatuses: ["sent"],
      expectedCategories: ["ai_fallback"],
    },
  ];

  for (const scenario of scenarios) {
    const logsSelection = buildEmailLogSelection(
      WORKSPACE_ID,
      CAMPAIGN_ID,
      DEFAULT_EMAIL_LOG_LIMIT,
      null,
    );
    const client = createFakeClient((text) => {
      if (text === SELECT_CAMPAIGN_DELIVERY_SQL) {
        return { rows: [CAMPAIGN_ROW] };
      }

      if (text === SELECT_EMAIL_LOG_SUMMARY_SQL) {
        return { rows: [scenario.summary] };
      }

      if (text === logsSelection.text) {
        return { rows: scenario.logs };
      }

      throw new Error(`Unexpected query: ${text}`);
    });
    resetDbStub(client);

    const response = await GET(
      buildRequest({ "x-workspace-id": String(WORKSPACE_ID) }),
      routeContext(),
    );
    const body = await response.json();

    assert.equal(response.status, 200, scenario.name);
    assert.equal(body.data.summary.sent_count, scenario.summary.sent_count);
    assert.equal(body.data.summary.failed_count, scenario.summary.failed_count);
    assert.equal(
      body.data.summary.ai_fallback_count,
      scenario.summary.ai_fallback_count,
    );
    assert.deepEqual(
      body.data.logs.map((log) => log.status),
      scenario.expectedStatuses,
      scenario.name,
    );
    assert.deepEqual(
      body.data.logs.map((log) => log.error_category),
      scenario.expectedCategories,
      scenario.name,
    );
  }
});
