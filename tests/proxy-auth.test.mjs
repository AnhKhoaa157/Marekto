import assert from "node:assert/strict";
import test from "node:test";

import { SESSION_ID, USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

import { authenticateTenantRequest } from "../src/lib/proxy-auth.ts";

function cookies(value) {
  return {
    get(name) {
      return name === "auth_token" && value ? { value } : undefined;
    },
  };
}

test("rejects a missing token", async () => {
  const result = await authenticateTenantRequest(
    new Headers(),
    cookies(null),
    async () => ({ ok: false, reason: "invalid" }),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "missing_token",
    error: "Unauthorized: Missing token",
  });
});

test("rejects an invalid or expired token", async () => {
  const result = await authenticateTenantRequest(
    new Headers({ authorization: "Bearer invalid" }),
    cookies(null),
    async () => ({ ok: false, reason: "invalid" }),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "invalid_token",
    error: "Unauthorized: Invalid or expired token",
  });
});

test("distinguishes a session replaced by another login", async () => {
  const result = await authenticateTenantRequest(
    new Headers({ authorization: "Bearer replaced" }),
    cookies(null),
    async () => ({ ok: false, reason: "replaced" }),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "session_replaced",
    error: "Session replaced",
  });
});

test("does not misreport a Redis outage as a replaced session", async () => {
  const result = await authenticateTenantRequest(
    new Headers({ authorization: "Bearer unavailable" }),
    cookies(null),
    async () => ({ ok: false, reason: "unavailable" }),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "session_unavailable",
    error: "Authentication service unavailable",
  });
});

test("replaces a spoofed workspace header with the verified JWT workspace", async () => {
  const result = await authenticateTenantRequest(
    new Headers({
      authorization: "Bearer valid",
      "x-workspace-id": "999",
    }),
    cookies(null),
    async () => ({
      ok: true,
      identity: { userId: USER_ID, workspaceId: WORKSPACE_ID, sessionId: SESSION_ID },
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.headers.get("x-workspace-id"), WORKSPACE_ID);
  }
});

test("rejects a valid account token with no workspace context", async () => {
  const result = await authenticateTenantRequest(
    new Headers({ authorization: "Bearer valid" }),
    cookies(null),
    async () => ({
      ok: true,
      identity: { userId: USER_ID, workspaceId: null, sessionId: SESSION_ID },
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    code: "workspace_required",
    error: "Unauthorized: Workspace required",
  });
});
