import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmailLogSelection,
  categorizeEmailLogError,
  DEFAULT_EMAIL_LOG_LIMIT,
  MAX_EMAIL_LOG_LIMIT,
  parseEmailLogCursor,
  parseEmailLogLimit,
  SELECT_CAMPAIGN_DELIVERY_SQL,
  SELECT_EMAIL_LOG_SUMMARY_SQL,
  toCampaignDeliveryCampaign,
  toCampaignDeliverySummary,
  toCampaignEmailLogItem,
} from "../src/lib/email-logs.ts";

test("limit parser defaults and enforces bounds", () => {
  assert.equal(parseEmailLogLimit(null), DEFAULT_EMAIL_LOG_LIMIT);
  assert.equal(parseEmailLogLimit("25"), 25);
  assert.equal(parseEmailLogLimit(String(MAX_EMAIL_LOG_LIMIT)), MAX_EMAIL_LOG_LIMIT);
  assert.throws(() => parseEmailLogLimit("101"), /limit must be 100 or fewer/);
  assert.throws(() => parseEmailLogLimit("abc"), /limit must be a positive integer/);
  assert.throws(() => parseEmailLogLimit("2.5"), /limit must be a positive integer/);
  assert.throws(() => parseEmailLogLimit("0"), /limit must be a positive integer/);
  assert.throws(() => parseEmailLogLimit("-5"), /limit must be a positive integer/);
});

test("cursor parser accepts only positive integer log ids", () => {
  assert.equal(parseEmailLogCursor(null), null);
  assert.equal(parseEmailLogCursor("42"), 42);
  assert.throws(() => parseEmailLogCursor("abc"), /cursor must be a positive integer/);
  assert.throws(() => parseEmailLogCursor("0"), /cursor must be a positive integer/);
  assert.throws(() => parseEmailLogCursor("-1"), /cursor must be a positive integer/);
  assert.throws(() => parseEmailLogCursor("1.5"), /cursor must be a positive integer/);
});

test("categorizes delivery outcomes from real log fields", () => {
  assert.equal(
    categorizeEmailLogError({
      status: "sent",
      error_message: null,
      personalization_error: null,
    }),
    "none",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "sent",
      error_message: null,
      personalization_error: "quota exhausted",
    }),
    "ai_fallback",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "failed",
      error_message: "SMTP delivery is not configured",
      personalization_error: null,
    }),
    "smtp_unconfigured",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "failed",
      error_message: "Missing required SMTP environment variables: SMTP_HOST",
      personalization_error: null,
    }),
    "smtp_unconfigured",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "failed",
      error_message: "Connection refused by mail server",
      personalization_error: "quota exhausted",
    }),
    "smtp_failure",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "failed",
      error_message: "Campaign email template content is unavailable",
      personalization_error: null,
    }),
    "template_missing",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "failed",
      error_message: "No recipients matched the campaign filters",
      personalization_error: null,
    }),
    "no_recipients",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "failed",
      error_message: "   ",
      personalization_error: null,
    }),
    "unknown",
  );
  assert.equal(
    categorizeEmailLogError({
      status: "failed",
      error_message: null,
      personalization_error: null,
    }),
    "unknown",
  );
});

test("email log SQL is parameterized and tenant-scoped", () => {
  const selection = buildEmailLogSelection(7, 3, 50, null);
  const cursorSelection = buildEmailLogSelection(7, 3, 50, 120);

  for (const sql of [
    SELECT_CAMPAIGN_DELIVERY_SQL,
    SELECT_EMAIL_LOG_SUMMARY_SQL,
    selection.text,
    cursorSelection.text,
  ]) {
    assert.doesNotMatch(sql, /\$\{/);
    assert.doesNotMatch(sql, /`/);
    assert.match(sql, /workspace_id = \$/);
  }

  assert.match(SELECT_CAMPAIGN_DELIVERY_SQL, /id = \$1 AND workspace_id = \$2/);
  assert.match(SELECT_EMAIL_LOG_SUMMARY_SQL, /workspace_id = \$1 AND campaign_id = \$2/);
  assert.match(SELECT_EMAIL_LOG_SUMMARY_SQL, /status = 'sent' AND personalization_source = 'template'/);
  assert.match(SELECT_EMAIL_LOG_SUMMARY_SQL, /personalization_error IS NOT NULL/);
  assert.match(SELECT_CAMPAIGN_DELIVERY_SQL, /ai_context/);
  assert.match(selection.text, /log\.campaign_id = \$2/);
  assert.match(selection.text, /LEFT JOIN "Contacts"/);
  assert.match(selection.text, /LIMIT \$3/);
  assert.deepEqual(selection.params, [7, 3, 50]);
  assert.match(cursorSelection.text, /log\.id < \$3/);
  assert.match(cursorSelection.text, /LIMIT \$4/);
  assert.deepEqual(cursorSelection.params, [7, 3, 120, 50]);
});

test("email log selection rejects invalid pagination inputs", () => {
  assert.throws(() => buildEmailLogSelection(0, 3, 50, null), /workspaceId/);
  assert.throws(() => buildEmailLogSelection(7, -1, 50, null), /campaignId/);
  assert.throws(() => buildEmailLogSelection(7, 3, 0, null), /limit/);
  assert.throws(() => buildEmailLogSelection(7, 3, 101, null), /limit must be 100 or fewer/);
  assert.throws(() => buildEmailLogSelection(7, 3, 50, 0), /cursor/);
});

test("summary maps aggregate rows and represents empty logs as zero counts", () => {
  assert.deepEqual(toCampaignDeliverySummary(undefined), {
    total_recipients: 0,
    sent_count: 0,
    failed_count: 0,
    gemini_personalized_count: 0,
    template_sent_count: 0,
    ai_fallback_count: 0,
    first_sent_at: null,
    last_sent_at: null,
  });

  assert.deepEqual(
    toCampaignDeliverySummary({
      total_recipients: 10,
      sent_count: 8,
      failed_count: 2,
      gemini_personalized_count: 5,
      template_sent_count: 3,
      ai_fallback_count: 1,
      first_sent_at: new Date("2026-07-02T00:00:00.000Z"),
      last_sent_at: new Date("2026-07-02T00:05:00.000Z"),
    }),
    {
      total_recipients: 10,
      sent_count: 8,
      failed_count: 2,
      gemini_personalized_count: 5,
      template_sent_count: 3,
      ai_fallback_count: 1,
      first_sent_at: "2026-07-02T00:00:00.000Z",
      last_sent_at: "2026-07-02T00:05:00.000Z",
    },
  );
});

test("log items keep nullable recipient fields for deleted contacts", () => {
  const item = toCampaignEmailLogItem({
    id: 12,
    contact_id: null,
    status: "sent",
    error_message: null,
    personalization_source: "gemini",
    personalization_error: null,
    sent_at: new Date("2026-07-02T00:00:00.000Z"),
    recipient_email: null,
    recipient_first_name: null,
    recipient_last_name: null,
  });

  assert.deepEqual(item, {
    id: 12,
    contact_id: null,
    recipient_email: null,
    recipient_first_name: null,
    recipient_last_name: null,
    status: "sent",
    error_message: null,
    error_category: "none",
    personalization_source: "gemini",
    personalization_error: null,
    sent_at: "2026-07-02T00:00:00.000Z",
  });
});

test("log items derive error category and reject unsupported statuses", () => {
  const failedItem = toCampaignEmailLogItem({
    id: 13,
    contact_id: 4,
    status: "failed",
    error_message: "Connection refused by mail server",
    personalization_source: "template",
    personalization_error: "quota exhausted",
    sent_at: new Date("2026-07-02T00:01:00.000Z"),
    recipient_email: "an.nguyen@example.com",
    recipient_first_name: "An",
    recipient_last_name: "Nguyen",
  });

  assert.equal(failedItem.status, "failed");
  assert.equal(failedItem.error_category, "smtp_failure");
  assert.equal(failedItem.personalization_source, "template");
  assert.equal(failedItem.recipient_email, "an.nguyen@example.com");

  assert.throws(
    () =>
      toCampaignEmailLogItem({
        id: 14,
        contact_id: 4,
        status: "queued",
        error_message: null,
        personalization_source: null,
        personalization_error: null,
        sent_at: null,
        recipient_email: null,
        recipient_first_name: null,
        recipient_last_name: null,
      }),
    /Unsupported email log status/,
  );
});

test("API mappings redact secrets from stored diagnostic fields", () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "stored-jwt-secret";

  try {
    const campaign = toCampaignDeliveryCampaign({
      id: 8,
      name: "Security test campaign",
      status: "failed",
      failure_reason: "Worker failed token=stored-token stored-jwt-secret",
      ai_personalization_enabled: true,
      ai_context: { tone: "warm" },
      scheduled_at: null,
      run_at: null,
    });
    const log = toCampaignEmailLogItem({
      id: 15,
      contact_id: 4,
      status: "failed",
      error_message: "SMTP failed password=stored-password",
      personalization_source: "template",
      personalization_error:
        "Gemini failed with AIza123456789012345678901234567890",
      sent_at: null,
      recipient_email: null,
      recipient_first_name: null,
      recipient_last_name: null,
    });

    assert.equal(campaign.failure_reason.includes("stored-token"), false);
    assert.equal(campaign.failure_reason.includes("stored-jwt-secret"), false);
    assert.deepEqual(campaign.ai_context, { tone: "warm" });
    assert.equal(log.error_message.includes("stored-password"), false);
    assert.equal(
      log.personalization_error.includes(
        "AIza123456789012345678901234567890",
      ),
      false,
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }
});
