import assert from "node:assert/strict";
import test from "node:test";

import { USER_ID, WORKSPACE_ID } from "./test-ids.mjs";

import {
  ADMIN_AUDIT_INSERT_SQL,
  buildAdminAuditInsert,
  sanitizeAuditMetadata,
} from "../src/lib/admin-audit.ts";

test("sanitizeAuditMetadata keeps only primitive values", () => {
  const result = sanitizeAuditMetadata({
    search: "acme",
    page: 2,
    ok: true,
    nested: { secret: "x" },
    list: [1, 2, 3],
    nothing: null,
    undef: undefined,
    notFinite: Number.POSITIVE_INFINITY,
  });

  assert.deepEqual(result, { search: "acme", page: 2, ok: true });
});

test("sanitizeAuditMetadata redacts secrets embedded in string values", () => {
  const result = sanitizeAuditMetadata({
    reason: "auth failed api_key=supersecretvalue0000",
    header: "Authorization: Bearer eyJabc.def.ghi",
  });

  assert.doesNotMatch(String(result.reason), /supersecretvalue0000/);
  assert.doesNotMatch(String(result.header), /eyJabc\.def\.ghi/);
});

test("sanitizeAuditMetadata bounds string length and key count", () => {
  const longValue = "a".repeat(500);
  const many = {};
  for (let index = 0; index < 40; index += 1) {
    many[`k${index}`] = index;
  }

  const longResult = sanitizeAuditMetadata({ value: longValue });
  assert.ok(String(longResult.value).length <= 200);

  const manyResult = sanitizeAuditMetadata(many);
  assert.ok(Object.keys(manyResult).length <= 12);
});

test("sanitizeAuditMetadata returns an empty object for missing metadata", () => {
  assert.deepEqual(sanitizeAuditMetadata(undefined), {});
});

test("buildAdminAuditInsert produces parameterized, sanitized params", () => {
  const { text, params } = buildAdminAuditInsert({
    adminUserId: USER_ID,
    action: "admin.workspaces.list",
    targetType: "workspace_list",
    targetId: null,
    metadata: { search: "token=abcd1234secret", page: 1 },
  });

  assert.equal(text, ADMIN_AUDIT_INSERT_SQL);
  assert.match(text, /\$5::jsonb/);
  assert.equal(params[0], USER_ID);
  assert.equal(params[1], "admin.workspaces.list");
  assert.equal(params[2], "workspace_list");
  assert.equal(params[3], null);

  const metadata = JSON.parse(params[4]);
  assert.equal(metadata.page, 1);
  assert.doesNotMatch(String(metadata.search), /abcd1234secret/);
});

test("buildAdminAuditInsert carries a UUID target id", () => {
  const { params } = buildAdminAuditInsert({
    adminUserId: USER_ID,
    action: "admin.workspaces.read",
    targetType: "workspace",
    targetId: WORKSPACE_ID,
  });

  assert.equal(params[3], WORKSPACE_ID);
  assert.equal(params[4], "{}");
});
