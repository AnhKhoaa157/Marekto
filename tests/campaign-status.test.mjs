import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCampaignSchedule,
  assertUserCampaignIsEditable,
  parseAiPersonalizationEnabled,
  parseUserCampaignStatus,
} from "../src/lib/campaign-status.ts";
import {
  CLAIM_CAMPAIGN_SQL,
  FAILED_STATUS,
  INSERT_EMAIL_LOG_SQL,
  SENT_STATUS,
  resolveCampaignDeliveryOutcome,
} from "../src/lib/campaign-worker.ts";

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

test("campaign AI personalization toggle accepts only booleans", () => {
  assert.equal(parseAiPersonalizationEnabled(true, false), true);
  assert.equal(parseAiPersonalizationEnabled(false, true), false);
  assert.equal(parseAiPersonalizationEnabled(undefined, false), false);
  assert.equal(parseAiPersonalizationEnabled(undefined, true), true);
  assert.throws(
    () => parseAiPersonalizationEnabled("true", false),
    /ai_personalization_enabled must be a boolean/,
  );
  assert.throws(
    () => parseAiPersonalizationEnabled(1, false),
    /ai_personalization_enabled must be a boolean/,
  );
  assert.throws(
    () => parseAiPersonalizationEnabled(null, false),
    /ai_personalization_enabled must be a boolean/,
  );
});

test("worker claim returns the campaign AI personalization toggle", () => {
  assert.match(CLAIM_CAMPAIGN_SQL, /RETURNING/);
  assert.match(CLAIM_CAMPAIGN_SQL, /campaign\.ai_personalization_enabled/);
});

test("email log insert records personalization observability columns", () => {
  assert.match(INSERT_EMAIL_LOG_SQL, /personalization_source/);
  assert.match(INSERT_EMAIL_LOG_SQL, /personalization_error/);
  assert.match(INSERT_EMAIL_LOG_SQL, /\$7/);
  assert.doesNotMatch(INSERT_EMAIL_LOG_SQL, /\$\{/);
});

test("campaign delivery status requires all recipients to send successfully", () => {
  assert.deepEqual(resolveCampaignDeliveryOutcome(2, 2, 0), {
    status: SENT_STATUS,
    reason: null,
  });
  assert.deepEqual(resolveCampaignDeliveryOutcome(2, 1, 1), {
    status: FAILED_STATUS,
    reason: "1 of 2 recipient deliveries failed",
  });
  assert.deepEqual(resolveCampaignDeliveryOutcome(0, 0, 0), {
    status: FAILED_STATUS,
    reason: "No recipients matched the campaign filters",
  });
});
