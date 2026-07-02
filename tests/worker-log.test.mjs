import assert from "node:assert/strict";
import test from "node:test";

import { parseCampaignTargetFilters } from "../src/lib/campaign-filters.ts";
import {
  categorizeWorkerFailure,
  sanitizeWorkerLogReason,
  writeWorkerLog,
} from "../src/lib/worker-log.ts";

test("categorizes known worker failures", () => {
  assert.equal(
    categorizeWorkerFailure(new Error("Unsupported filter operator")),
    "filter_invalid",
  );
  assert.equal(
    categorizeWorkerFailure(new Error("Campaign template is unavailable")),
    "template_missing",
  );
  assert.equal(
    categorizeWorkerFailure(new Error("SMTP delivery is not configured")),
    "smtp_unconfigured",
  );
  assert.equal(
    categorizeWorkerFailure(new Error("No recipients matched")),
    "no_recipients",
  );
  assert.equal(
    categorizeWorkerFailure(new Error("Unexpected processing error")),
    "campaign_failed",
  );
});

test("categorizes the real invalid target-filter validation path", () => {
  let validationError;

  try {
    parseCampaignTargetFilters({ city_contains: "unsupported" });
  } catch (error) {
    validationError = error;
  }

  assert.ok(validationError instanceof Error);
  assert.equal(categorizeWorkerFailure(validationError), "filter_invalid");
});

test("sanitizes configured secrets and common credential formats", () => {
  const reason = sanitizeWorkerLogReason(
    new Error(
      "password=mail-pass Bearer bearer-token " +
        "https://mailer:mail-pass@smtp.example.test " +
        "AIza123456789012345678901234567890",
    ),
    {
      SMTP_PASSWORD: "mail-pass",
      SMTP_USER: "mailer@example.test",
    },
  );

  assert.equal(reason.includes("mail-pass"), false);
  assert.equal(reason.includes("bearer-token"), false);
  assert.equal(reason.includes("AIza123456789012345678901234567890"), false);
  assert.match(reason, /\[REDACTED\]/);
});

test("writes one structured JSON event without raw error stacks", () => {
  const messages = [];
  const sink = {
    info(message) {
      messages.push(message);
    },
    warn(message) {
      messages.push(message);
    },
    error(message) {
      messages.push(message);
    },
  };
  const error = new Error("Connection failed token=private-token");

  writeWorkerLog(
    "error",
    "campaign_processing_failed",
    {
      workspaceId: 7,
      campaignId: 12,
      contactId: 18,
      category: "smtp_send_failed",
      reason: error,
    },
    sink,
    {},
  );

  assert.equal(messages.length, 1);
  const record = JSON.parse(messages[0]);
  assert.deepEqual(record, {
    service: "campaign-worker",
    level: "error",
    event: "campaign_processing_failed",
    workspace_id: 7,
    campaign_id: 12,
    contact_id: 18,
    category: "smtp_send_failed",
    reason: "Connection failed token=[REDACTED]",
  });
  assert.equal(messages[0].includes("at "), false);
});
