import assert from "node:assert/strict";
import test from "node:test";

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
    async () => null,
  );

  assert.deepEqual(result, {
    ok: false,
    error: "Unauthorized: Missing token",
  });
});

test("rejects an invalid or expired token", async () => {
  const result = await authenticateTenantRequest(
    new Headers({ authorization: "Bearer invalid" }),
    cookies(null),
    async () => null,
  );

  assert.deepEqual(result, {
    ok: false,
    error: "Unauthorized: Invalid or expired token",
  });
});

test("replaces a spoofed workspace header with the verified JWT workspace", async () => {
  const result = await authenticateTenantRequest(
    new Headers({
      authorization: "Bearer valid",
      "x-workspace-id": "999",
    }),
    cookies(null),
    async () => ({ userId: 8, workspaceId: 12 }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.headers.get("x-workspace-id"), "12");
  }
});

test("rejects a valid account token with no workspace context", async () => {
  const result = await authenticateTenantRequest(
    new Headers({ authorization: "Bearer valid" }),
    cookies(null),
    async () => ({ userId: 8, workspaceId: null }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: "Unauthorized: Workspace required",
  });
});
