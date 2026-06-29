import assert from "node:assert/strict";
import test from "node:test";

import { getWorkspaceIdFromHeaders } from "../src/lib/workspace.ts";

test("tenant handlers reject missing workspace context", () => {
  assert.throws(
    () => getWorkspaceIdFromHeaders(new Headers()),
    /Missing workspace context/,
  );
});

test("tenant handlers accept only positive integer workspace ids", () => {
  assert.equal(
    getWorkspaceIdFromHeaders(new Headers({ "x-workspace-id": "4" })),
    4,
  );
  assert.throws(() =>
    getWorkspaceIdFromHeaders(new Headers({ "x-workspace-id": "0" })),
  );
  assert.throws(() =>
    getWorkspaceIdFromHeaders(new Headers({ "x-workspace-id": "1.5" })),
  );
});
