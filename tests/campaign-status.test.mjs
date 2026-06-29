import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCampaignSchedule,
  assertUserCampaignIsEditable,
  parseUserCampaignStatus,
} from "../src/lib/campaign-status.ts";

test("users can only assign draft or pending", () => {
  assert.equal(parseUserCampaignStatus("draft", "pending"), "draft");
  assert.equal(parseUserCampaignStatus("pending", "draft"), "pending");
  assert.throws(
    () => parseUserCampaignStatus("sent", "draft"),
    /Only draft or pending/,
  );
});

test("pending campaigns require a delivery time", () => {
  assert.throws(
    () => assertCampaignSchedule("pending", null),
    /require a delivery time/,
  );
  assert.doesNotThrow(() =>
    assertCampaignSchedule("pending", "2026-07-01T02:00:00.000Z"),
  );
});

test("worker-owned states cannot be edited by users", () => {
  assert.throws(() => assertUserCampaignIsEditable("processing"));
  assert.throws(() => assertUserCampaignIsEditable("sent"));
  assert.doesNotThrow(() => assertUserCampaignIsEditable("failed"));
});
