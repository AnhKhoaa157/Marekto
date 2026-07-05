import assert from "node:assert/strict";
import test from "node:test";

import {
  formatEntityCode,
  isUuid,
  parseUuid,
} from "../src/lib/identifiers.ts";
import { USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

test("UUID validation rejects legacy numeric identifiers", () => {
  assert.equal(isUuid(USER_ID), true);
  assert.equal(isUuid(1), false);
  assert.throws(() => parseUuid("1", "User id"), /Invalid user id/);
});

test("entity codes expose only the requested prefix and final four characters", () => {
  assert.equal(formatEntityCode("US", USER_ID), "US-0001");
  assert.equal(formatEntityCode("WS", WORKSPACE_ID), "WS-0002");
});
