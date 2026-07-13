import assert from "node:assert/strict";
import test from "node:test";

test("normalizes the WarpFix probe identifier", () => {
  const normalizedIdentifier = "warp-fix";

  assert.equal(normalizedIdentifier, "warpfix");
});
