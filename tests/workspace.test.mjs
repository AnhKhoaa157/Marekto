import assert from "node:assert/strict";
import test from "node:test";

import { getWorkspaceIdFromHeaders } from "../src/lib/workspace.ts";
import { WORKSPACE_ID } from "./test-ids.mjs";

test("tenant handlers reject missing workspace context", () => {
  assert.throws(
    () => getWorkspaceIdFromHeaders(new Headers()),
    /Missing workspace context/,
  );
});

test("tenant handlers accept only UUID workspace ids", () => {
  assert.equal(
    getWorkspaceIdFromHeaders(new Headers({ "x-workspace-id": WORKSPACE_ID })),
    WORKSPACE_ID,
  );
  assert.throws(() =>
    getWorkspaceIdFromHeaders(new Headers({ "x-workspace-id": "4" })),
  );
  assert.throws(() =>
    getWorkspaceIdFromHeaders(new Headers({ "x-workspace-id": "1.5" })),
  );
});
