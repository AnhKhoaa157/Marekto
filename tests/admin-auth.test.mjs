import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_FORBIDDEN_ERROR,
  ADMIN_ROLE,
  ADMIN_UNAUTHENTICATED_ERROR,
  resolveAdminAuthorization,
  SELECT_ADMIN_USER_SQL,
} from "../src/lib/admin-auth.ts";

test("missing session is unauthenticated (401)", () => {
  const result = resolveAdminAuthorization(null, null);

  assert.deepEqual(result, {
    ok: false,
    status: 401,
    error: ADMIN_UNAUTHENTICATED_ERROR,
  });
});

test("authenticated session with no matching user row is 401", () => {
  const result = resolveAdminAuthorization({ userId: 5, workspaceId: 2 }, null);

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("authenticated non-admin user is forbidden (403)", () => {
  const result = resolveAdminAuthorization(
    { userId: 7, workspaceId: 3 },
    { id: 7, email: "user@example.com", role: "user" },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    error: ADMIN_FORBIDDEN_ERROR,
  });
});

test("admin user is authorized and returns a sanitized identity", () => {
  const result = resolveAdminAuthorization(
    { userId: 9, workspaceId: 4 },
    { id: 9, email: "admin@example.com", role: ADMIN_ROLE },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.identity, {
      userId: 9,
      email: "admin@example.com",
      role: "admin",
      workspaceId: 4,
    });
  }
});

test("resolved admin identity never carries a password hash or extra fields", () => {
  const result = resolveAdminAuthorization(
    { userId: 1, workspaceId: 1 },
    {
      id: 1,
      email: "admin@example.com",
      role: ADMIN_ROLE,
      // A caller passing a stray secret must not have it echoed back.
      password_hash: "salt:deadbeef",
    },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(Object.keys(result.identity).sort(), [
      "email",
      "role",
      "userId",
      "workspaceId",
    ]);
    assert.equal("password_hash" in result.identity, false);
  }
});

test("the admin user lookup projection never selects password_hash", () => {
  assert.match(SELECT_ADMIN_USER_SQL, /SELECT id, email, role FROM "Users"/);
  assert.doesNotMatch(SELECT_ADMIN_USER_SQL, /password_hash/i);
});
