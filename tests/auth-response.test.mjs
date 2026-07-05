import assert from "node:assert/strict";
import test from "node:test";

import { isAuthenticatedData } from "../src/lib/auth-response.ts";
import { USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

test("auth response accepts UUID identities used by login redirects", () => {
  assert.equal(
    isAuthenticatedData({
      token: "signed-token",
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      nextPath: "/admin",
    }),
    true,
  );
});

test("auth response rejects legacy numeric identities", () => {
  assert.equal(
    isAuthenticatedData({ token: "signed-token", userId: 1, workspaceId: 2 }),
    false,
  );
});
