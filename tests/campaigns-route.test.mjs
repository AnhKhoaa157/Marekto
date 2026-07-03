import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const WORKSPACE_ID = 7;
const DB_STUB_URL = "marekto-test:campaigns-db-stub";
const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");

const dbStub = {
  initializeDatabaseCalls: 0,
  withWorkspaceCalls: [],
  client: null,
};
globalThis.__marektoCampaignsRouteDbStub = dbStub;

const DB_STUB_SOURCE = `
const state = globalThis.__marektoCampaignsRouteDbStub;

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

const { POST } = await import(
  pathToFileURL(path.join(SRC_ROOT, "app", "api", "campaigns", "route.ts")).href
);
const { NextRequest } = await import("next/server.js");

function resetDbStub(client = null) {
  dbStub.initializeDatabaseCalls = 0;
  dbStub.withWorkspaceCalls = [];
  dbStub.client = client;
}

function buildPostRequest(body, headers = { "x-workspace-id": String(WORKSPACE_ID) }) {
  return new NextRequest("http://localhost/api/campaigns", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("campaign API accepts valid ai_context and persists normalized JSON", async () => {
  const aiContext = { goal: " bring VIPs back ", tone: " warm " };
  const createdCampaign = {
    id: 123,
    workspace_id: WORKSPACE_ID,
    template_id: null,
    name: "Spring launch",
    status: "draft",
    target_filters: {},
    ai_personalization_enabled: true,
    ai_context: { goal: "bring VIPs back", tone: "warm" },
    scheduled_at: null,
    run_at: null,
    created_at: new Date("2026-07-03T00:00:00.000Z"),
    updated_at: new Date("2026-07-03T00:00:00.000Z"),
  };
  const client = {
    async query(text, params) {
      assert.match(text, /INSERT INTO "Campaigns"/);
      assert.match(text, /ai_context/);
      assert.deepEqual(params, [
        WORKSPACE_ID,
        null,
        "Spring launch",
        "draft",
        "{}",
        true,
        JSON.stringify(createdCampaign.ai_context),
        null,
      ]);
      return { rows: [createdCampaign] };
    },
  };
  resetDbStub(client);

  const response = await POST(
    buildPostRequest({
      name: " Spring launch ",
      ai_personalization_enabled: true,
      ai_context: aiContext,
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.deepEqual(body.data.ai_context, createdCampaign.ai_context);
  assert.deepEqual(dbStub.withWorkspaceCalls, [WORKSPACE_ID]);
});

test("campaign API rejects invalid ai_context before campaign insert", async (t) => {
  t.mock.method(console, "error", () => {});
  resetDbStub({
    async query() {
      throw new Error("Database should not be queried for invalid ai_context");
    },
  });

  const response = await POST(
    buildPostRequest({
      name: "Spring launch",
      ai_context: ["not", "an", "object"],
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(body, {
    success: false,
    error: "ai_context must be a JSON object",
  });
  assert.deepEqual(dbStub.withWorkspaceCalls, []);
});
