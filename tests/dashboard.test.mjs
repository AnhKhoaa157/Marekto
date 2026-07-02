import assert from "node:assert/strict";
import test from "node:test";

import {
  SELECT_EMAIL_DELIVERY_METRICS_SQL,
  SELECT_RECENT_DELIVERY_FAILURES_SQL,
  toEmailDeliveryMetrics,
} from "../src/lib/dashboard-delivery.ts";

test("dashboard delivery metrics map real aggregate rows and empty data", () => {
  assert.deepEqual(toEmailDeliveryMetrics(undefined), {
    sentEmails: 0,
    failedEmails: 0,
  });
  assert.deepEqual(
    toEmailDeliveryMetrics({ sent_count: 12, failed_count: 3 }),
    { sentEmails: 12, failedEmails: 3 },
  );
});

test("dashboard email log queries are tenant-scoped and static", () => {
  for (const sql of [
    SELECT_EMAIL_DELIVERY_METRICS_SQL,
    SELECT_RECENT_DELIVERY_FAILURES_SQL,
  ]) {
    assert.match(sql, /workspace_id = \$1/);
    assert.doesNotMatch(sql, /\$\{/);
    assert.doesNotMatch(sql, /`/);
  }

  assert.match(SELECT_EMAIL_DELIVERY_METRICS_SQL, /status = 'sent'/);
  assert.match(SELECT_EMAIL_DELIVERY_METRICS_SQL, /status = 'failed'/);
  assert.match(SELECT_RECENT_DELIVERY_FAILURES_SQL, /FROM "Email_logs"/);
  assert.match(SELECT_RECENT_DELIVERY_FAILURES_SQL, /LIMIT 5/);
});
