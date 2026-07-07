import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { SignJWT } from "jose";

import { SESSION_ID, USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

const DB_STUB_URL = "marekto-test:members-db-stub";
const COLLABORATION_STUB_URL = "marekto-test:members-collaboration-stub";
const SESSION_AUTH_STUB_URL = "marekto-test:members-session-auth-stub";
const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");

process.env.JWT_SECRET = "workspace-members-route-test-secret";

const stubState = {
  roleRows: [{ role: "user" }],
  members: [
    {
      user_id: USER_ID,
      email: "owner@example.com",
      role: "owner",
      joined_at: "2026-07-01T00:00:00.000Z",
    },
  ],
  listCalls: [],
  roleQueries: [],
  listError: null,
};
globalThis.__marektoMembersRouteStub = stubState;

const DB_STUB_SOURCE = `
const state = globalThis.__marektoMembersRouteStub;

export async function initializeDatabase() {}

export async function query(text, params) {
  state.roleQueries.push({ text, params });
  return { rows: state.roleRows };
}
`;

const COLLABORATION_STUB_SOURCE = `
const state = globalThis.__marektoMembersRouteStub;

export async function listWorkspaceMembers(actorUserId, workspaceId) {
  state.listCalls.push({ actorUserId, workspaceId });
  if (state.listError) {
    throw state.listError;
  }
  return state.members;
}
`;

const SESSION_AUTH_STUB_SOURCE = `
import { verifyJWT } from ${JSON.stringify(pathToFileURL(path.join(SRC_ROOT, "lib", "auth.ts")).href)};

export async function verifySessionToken(token) {
  const identity = await verifyJWT(token);
  return identity
    ? { ok: true, identity }
    : { ok: false, reason: "invalid" };
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") {
      return { url: DB_STUB_URL, shortCircuit: true };
    }

    if (specifier === "@/lib/workspace-collaboration") {
      return { url: COLLABORATION_STUB_URL, shortCircuit: true };
    }

    if (specifier === "@/lib/session-auth") {
      return { url: SESSION_AUTH_STUB_URL, shortCircuit: true };
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

    if (url === COLLABORATION_STUB_URL) {
      return {
        format: "module",
        source: COLLABORATION_STUB_SOURCE,
        shortCircuit: true,
      };
    }


    if (url === SESSION_AUTH_STUB_URL) {
      return { format: "module", source: SESSION_AUTH_STUB_SOURCE, shortCircuit: true };
    }

    return nextLoad(url, context);
  },
});

const { GET } = await import(
  pathToFileURL(
    path.join(SRC_ROOT, "app", "api", "workspace", "members", "route.ts"),
  ).href
);
const { signJWT } = await import(
  pathToFileURL(path.join(SRC_ROOT, "lib", "auth.ts")).href
);
const { NextRequest } = await import("next/server.js");

function resetStub() {
  stubState.roleRows = [{ role: "user" }];
  stubState.listCalls = [];
  stubState.roleQueries = [];
  stubState.listError = null;
}

function buildRequest(cookieValue) {
  return new NextRequest("http://localhost/api/workspace/members", {
    headers: cookieValue ? { cookie: `auth_token=${cookieValue}` } : {},
  });
}

/**
 * Sign a token outside the app's UUID-validating signer, mimicking sessions
 * issued before the UUID migration (numeric ids) or with custom claims.
 */
async function signRawToken(payload, options = {}) {
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(options.issuedAt)
    .setIssuer("marekto")
    .setAudience("marekto-app")
    .setExpirationTime(options.expiresAt ?? "7d");

  return builder.sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

test("returns members for a valid UUID session and passes ids as strings", async () => {
  resetStub();
  const token = await signJWT({ userId: USER_ID, workspaceId: WORKSPACE_ID, sessionId: SESSION_ID });

  const response = await GET(buildRequest(token));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.deepEqual(payload.data.members, stubState.members);
  assert.deepEqual(stubState.listCalls, [
    { actorUserId: USER_ID, workspaceId: WORKSPACE_ID },
  ]);
  assert.equal(typeof stubState.listCalls[0].actorUserId, "string");
  // The account role lookup also receives the UUID string, never a number.
  assert.deepEqual(stubState.roleQueries[0].params, [USER_ID]);
});

test("rejects a legacy numeric-id session with 401, not a crash", async () => {
  resetStub();
  const legacyToken = await signRawToken({ userId: 7, workspaceId: 3 });

  const response = await GET(buildRequest(legacyToken));
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.success, false);
  assert.match(payload.error, /Invalid or expired token/);
  assert.deepEqual(stubState.listCalls, []);
});

test("rejects an expired session with 401", async () => {
  resetStub();
  const now = Math.floor(Date.now() / 1000);
  const expiredToken = await signRawToken(
    { userId: USER_ID, workspaceId: WORKSPACE_ID },
    { issuedAt: now - 60 * 60 * 24 * 8, expiresAt: now - 60 * 60 * 24 },
  );

  const response = await GET(buildRequest(expiredToken));
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.match(payload.error, /Invalid or expired token/);
  assert.deepEqual(stubState.listCalls, []);
});

test("rejects a missing session with 401", async () => {
  resetStub();

  const response = await GET(buildRequest(null));
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.match(payload.error, /Missing token/);
  assert.deepEqual(stubState.listCalls, []);
});

test("rejects a session without workspace context with 400", async () => {
  resetStub();
  const token = await signJWT({ userId: USER_ID, workspaceId: null, sessionId: SESSION_ID });

  const response = await GET(buildRequest(token));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Workspace context is required");
  assert.deepEqual(stubState.listCalls, []);
});

test("maps owner-only access to 403 for non-owner members", async () => {
  resetStub();
  stubState.listError = new Error("Forbidden: workspace owner access required");
  const token = await signJWT({ userId: USER_ID, workspaceId: WORKSPACE_ID, sessionId: SESSION_ID });

  const response = await GET(buildRequest(token));
  const payload = await response.json();

  assert.equal(response.status, 403);
  assert.equal(payload.error, "Forbidden: workspace owner access required");
});
