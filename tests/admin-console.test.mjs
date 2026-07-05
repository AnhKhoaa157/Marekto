import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseAdminDiagnosticsLimit,
  parseAdminPage,
  parseAdminPageSize,
  parseAdminSearch,
  parseWorkspaceIdParam,
  SELECT_ADMIN_USERS_SQL,
  SELECT_ADMIN_WORKSPACES_SQL,
  sortDiagnosticsByRecency,
  toAdminDeliveryDiagnostic,
  toAdminUserSummary,
  toAdminWorkspaceSummary,
} from "../src/lib/admin-console.ts";

test("parseAdminSearch trims and bounds length", () => {
  assert.equal(parseAdminSearch("  acme  "), "acme");
  assert.equal(parseAdminSearch(null), "");
  assert.equal(parseAdminSearch("a".repeat(500)).length, 120);
});

test("parseAdminPage defaults to 1 for invalid input", () => {
  assert.equal(parseAdminPage("3"), 3);
  assert.equal(parseAdminPage("0"), 1);
  assert.equal(parseAdminPage("-2"), 1);
  assert.equal(parseAdminPage("abc"), 1);
  assert.equal(parseAdminPage(null), 1);
});

test("parseAdminPageSize clamps to the maximum", () => {
  assert.equal(parseAdminPageSize(null), DEFAULT_PAGE_SIZE);
  assert.equal(parseAdminPageSize("10"), 10);
  assert.equal(parseAdminPageSize("9999"), MAX_PAGE_SIZE);
  assert.equal(parseAdminPageSize("0"), DEFAULT_PAGE_SIZE);
});

test("parseAdminDiagnosticsLimit clamps to the maximum", () => {
  assert.equal(parseAdminDiagnosticsLimit("10"), 10);
  assert.equal(parseAdminDiagnosticsLimit("9999"), 100);
  assert.equal(parseAdminDiagnosticsLimit(null), 50);
});

test("parseWorkspaceIdParam rejects non-positive integers", () => {
  assert.equal(parseWorkspaceIdParam("12"), 12);
  assert.throws(() => parseWorkspaceIdParam("0"), /Invalid workspace id/);
  assert.throws(() => parseWorkspaceIdParam("-1"), /Invalid workspace id/);
  assert.throws(() => parseWorkspaceIdParam("abc"), /Invalid workspace id/);
});

test("toAdminWorkspaceSummary maps only safe operational fields", () => {
  const summary = toAdminWorkspaceSummary(
    {
      id: 3,
      name: "Acme",
      owner_id: 8,
      owner_email: "owner@acme.test",
      member_count: 4,
      created_at: "2026-01-02T03:04:05.000Z",
    },
    { contactCount: 120, campaignCount: 7, latestCampaignAt: "2026-05-01T00:00:00.000Z" },
  );

  assert.deepEqual(summary, {
    id: 3,
    name: "Acme",
    owner_id: 8,
    owner_email: "owner@acme.test",
    member_count: 4,
    contact_count: 120,
    campaign_count: 7,
    latest_campaign_at: "2026-05-01T00:00:00.000Z",
    created_at: "2026-01-02T03:04:05.000Z",
  });
});

test("toAdminUserSummary exposes safe fields only and never password_hash", () => {
  const summary = toAdminUserSummary({
    id: 2,
    email: "user@example.com",
    role: "user",
    created_at: "2026-01-01T00:00:00.000Z",
    membership_count: 1,
    // A stray secret column must never survive mapping.
    password_hash: "salt:deadbeef",
  });

  assert.deepEqual(Object.keys(summary).sort(), [
    "created_at",
    "email",
    "id",
    "membership_count",
    "role",
  ]);
  assert.equal("password_hash" in summary, false);
});

test("admin list SQL never selects password_hash", () => {
  assert.doesNotMatch(SELECT_ADMIN_USERS_SQL, /password_hash/i);
  assert.doesNotMatch(SELECT_ADMIN_WORKSPACES_SQL, /password_hash/i);
});

test("toAdminDeliveryDiagnostic sanitizes secrets and keeps only category/message", () => {
  const diagnostic = toAdminDeliveryDiagnostic(5, "Acme", {
    id: 99,
    campaign_id: 12,
    campaign_name: "Launch",
    status: "failed",
    error_message:
      "SMTP send failed token=abcd1234secret Bearer eyJhead.body.sig\n    at send (mail.js:1:1)",
    personalization_error: null,
    sent_at: "2026-06-01T10:00:00.000Z",
  });

  assert.equal(diagnostic.workspace_id, 5);
  assert.equal(diagnostic.workspace_name, "Acme");
  assert.equal(diagnostic.campaign_id, 12);
  assert.equal(diagnostic.category, "smtp_failure");
  assert.doesNotMatch(String(diagnostic.message), /abcd1234secret/);
  assert.doesNotMatch(String(diagnostic.message), /eyJhead/);
  assert.doesNotMatch(String(diagnostic.message), /at send/);
  assert.equal(diagnostic.occurred_at, "2026-06-01T10:00:00.000Z");
});

test("sortDiagnosticsByRecency orders newest first", () => {
  const sorted = sortDiagnosticsByRecency([
    { occurred_at: "2026-01-01T00:00:00.000Z" },
    { occurred_at: "2026-06-01T00:00:00.000Z" },
    { occurred_at: null },
  ]);

  assert.equal(sorted[0].occurred_at, "2026-06-01T00:00:00.000Z");
  assert.equal(sorted[1].occurred_at, "2026-01-01T00:00:00.000Z");
});
