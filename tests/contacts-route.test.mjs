import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { WORKSPACE_ID } from "./test-ids.mjs";
const DB_STUB_URL = "marekto-test:contacts-db-stub";
const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");

// Keep enrichment deterministic: without configuration the route must fall
// back to saving the contact unchanged with an "unavailable" status.
delete process.env.DATA_INTELLIGENCE_BASE_URL;
delete process.env.DATA_INTELLIGENCE_INTERNAL_SECRET;
delete process.env.DATA_INTELLIGENCE_TIMEOUT_MS;

const dbStub = {
  initializeDatabaseCalls: 0,
  withWorkspaceCalls: [],
  client: null,
};
globalThis.__marektoContactsRouteDbStub = dbStub;

const DB_STUB_SOURCE = `
const state = globalThis.__marektoContactsRouteDbStub;

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
  pathToFileURL(path.join(SRC_ROOT, "app", "api", "contacts", "route.ts")).href
);
const { NextRequest } = await import("next/server.js");

function resetDbStub(client = null) {
  dbStub.initializeDatabaseCalls = 0;
  dbStub.withWorkspaceCalls = [];
  dbStub.client = client;
}

function buildPostRequest(body, headers = { "x-workspace-id": String(WORKSPACE_ID) }) {
  return new NextRequest("http://localhost/api/contacts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("creates the contact with an unavailable intelligence status when the service is not configured", async () => {
  const queries = [];
  resetDbStub({
    query: async (text, params) => {
      queries.push({ text, params });
      return {
        rows: [
          {
            id: 42,
            workspace_id: WORKSPACE_ID,
            email: params[1],
            first_name: params[2],
            last_name: params[3],
            phone: params[4],
            properties: JSON.parse(params[5]),
            created_at: new Date("2026-07-05T00:00:00.000Z"),
          },
        ],
      };
    },
  });

  const response = await POST(
    buildPostRequest({
      email: "  User@Example.com ",
      first_name: "An",
      last_name: "Nguyen",
      phone: "+84000000001",
      properties: { city: "HCM", company: "Acme" },
    }),
  );
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.equal(payload.success, true);
  assert.deepEqual(dbStub.withWorkspaceCalls, [WORKSPACE_ID]);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params.slice(0, 5), [
    WORKSPACE_ID,
    "user@example.com",
    "An",
    "Nguyen",
    "+84000000001",
  ]);
  // User-submitted properties are preserved and only the status is added.
  assert.deepEqual(JSON.parse(queries[0].params[5]), {
    city: "HCM",
    company: "Acme",
    data_intelligence_status: "unavailable",
  });
  assert.equal(payload.data.properties.data_intelligence_status, "unavailable");
});

test("rejects an invalid body before any enrichment or insert", async () => {
  resetDbStub();

  const response = await POST(buildPostRequest({ email: "   " }));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.success, false);
  assert.equal(payload.error, "Email is required");
  assert.deepEqual(dbStub.withWorkspaceCalls, []);
});

test("rejects a missing workspace header", async () => {
  resetDbStub();

  const response = await POST(
    buildPostRequest({ email: "user@example.com" }, {}),
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Missing workspace context");
  assert.deepEqual(dbStub.withWorkspaceCalls, []);
});
