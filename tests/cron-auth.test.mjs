import assert from "node:assert/strict";
import test from "node:test";

import { authorizeCronRequest } from "../src/lib/cron-auth.ts";

test("allows unconfigured local cron and blocks unconfigured production cron", () => {
  assert.deepEqual(authorizeCronRequest(null, undefined, false), { ok: true });
  assert.deepEqual(authorizeCronRequest(null, undefined, true), {
    ok: false,
    status: 503,
    error: "Cron worker is not configured",
  });
});

test("requires the configured cron bearer secret", () => {
  assert.deepEqual(authorizeCronRequest("Bearer expected", "expected", true), {
    ok: true,
  });
  assert.equal(authorizeCronRequest("Bearer wrong", "expected", true).ok, false);
  assert.equal(authorizeCronRequest(null, "expected", false).ok, false);
});
