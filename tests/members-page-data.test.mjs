import assert from "node:assert/strict";
import test from "node:test";

import {
  createMembersPageLoader,
  loadMembersPageData,
} from "../src/features/workspace/lib/members-page-data.ts";
import { INVITE_ID, USER_ID } from "./test-ids.mjs";

const EVENT_ID = "00000000-0000-4000-8000-000000000009";

const okBodies = {
  "/api/workspace/members": {
    success: true,
    data: {
      members: [
        { user_id: USER_ID, email: "owner@example.com", role: "owner", joined_at: "2026-07-01T00:00:00.000Z" },
      ],
    },
  },
  "/api/workspace/invites": {
    success: true,
    data: {
      invites: [
        {
          id: INVITE_ID,
          workspace_name: "Acme",
          created_by_email: "owner@example.com",
          expires_at: "2026-07-12T00:00:00.000Z",
          revoked_at: null,
          created_at: "2026-07-05T00:00:00.000Z",
        },
      ],
    },
  },
  "/api/workspace/activity": {
    success: true,
    data: {
      events: [
        {
          id: EVENT_ID,
          actor_email: "owner@example.com",
          target_type: "member",
          target_id: USER_ID,
          action: "member.role_updated",
          created_at: "2026-07-05T00:00:00.000Z",
        },
      ],
    },
  },
};

function buildFetch(overrides = {}, calls = []) {
  return async (path, init) => {
    calls.push({ path, init });
    const override = overrides[path];
    if (override) {
      return override();
    }
    return Response.json(okBodies[path]);
  };
}

test("loads members, invites, and activity with UUID string identities", async () => {
  const calls = [];
  const result = await loadMembersPageData(buildFetch({}, calls));

  assert.equal(result.kind, "ok");
  assert.deepEqual(
    calls.map((call) => call.path).sort(),
    ["/api/workspace/activity", "/api/workspace/invites", "/api/workspace/members"],
  );
  assert.equal(result.data.members[0].user_id, USER_ID);
  assert.equal(typeof result.data.members[0].user_id, "string");
  assert.equal(result.data.invites[0].id, INVITE_ID);
  assert.equal(result.data.events[0].target_id, USER_ID);
  // Requests carry credentials so the session cookie is always sent.
  assert.ok(calls.every((call) => call.init.credentials === "include"));
});

test("classifies an expired or legacy session as unauthorized instead of a raw token error", async () => {
  const result = await loadMembersPageData(
    buildFetch({
      "/api/workspace/members": () =>
        Response.json(
          { success: false, error: "Unauthorized: Invalid or expired token" },
          { status: 401 },
        ),
    }),
  );

  assert.deepEqual(result, { kind: "unauthorized" });
});

test("classifies owner-only access as forbidden with the API message", async () => {
  const result = await loadMembersPageData(
    buildFetch({
      "/api/workspace/members": () =>
        Response.json(
          { success: false, error: "Forbidden: workspace owner access required" },
          { status: 403 },
        ),
    }),
  );

  assert.deepEqual(result, {
    kind: "forbidden",
    message: "Forbidden: workspace owner access required",
  });
});

test("rejects numeric identifiers instead of coercing them", async () => {
  const result = await loadMembersPageData(
    buildFetch({
      "/api/workspace/members": () =>
        Response.json({
          success: true,
          data: {
            members: [
              { user_id: 7, email: "owner@example.com", role: "owner", joined_at: null },
            ],
          },
        }),
    }),
  );

  assert.equal(result.kind, "error");
  assert.match(result.message, /invalid shape/);
});

test("reports a service failure as a plain error result", async () => {
  const result = await loadMembersPageData(
    buildFetch({
      "/api/workspace/activity": () =>
        Response.json({ success: false, error: "Failed to load workspace activity" }, { status: 500 }),
    }),
  );

  assert.deepEqual(result, { kind: "error", message: "Failed to load workspace activity" });
});

test("reports a network failure without throwing", async () => {
  const result = await loadMembersPageData(async () => {
    throw new TypeError("fetch failed");
  });

  assert.deepEqual(result, { kind: "error", message: "fetch failed" });
});

test("coalesces concurrent loads into one request batch", async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchImpl = async (path, init) => {
    calls.push({ path, init });
    // Simulate slow authentication/workspace hydration on the server.
    await gate;
    return Response.json(okBodies[path]);
  };

  const load = createMembersPageLoader(fetchImpl);
  const first = load();
  const second = load();

  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls.length, 3, "concurrent loads must not duplicate API requests");
  assert.equal(firstResult.kind, "ok");
  assert.equal(secondResult, firstResult);

  // After the in-flight load settles, a fresh load issues new requests.
  const third = await load();
  assert.equal(calls.length, 6);
  assert.equal(third.kind, "ok");
});

test("a delayed session still resolves on the first load without retries", async () => {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, init });
    await new Promise((resolve) => setTimeout(resolve, 25));
    return Response.json(okBodies[path]);
  };

  const result = await createMembersPageLoader(fetchImpl)();

  assert.equal(result.kind, "ok");
  assert.equal(calls.length, 3);
});

test("propagates aborts so unmounts stay silent", async () => {
  const controller = new AbortController();
  const fetchImpl = async (_path, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
    });

  const pending = loadMembersPageData(fetchImpl, { signal: controller.signal });
  controller.abort();

  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof DOMException && error.name === "AbortError");
    return true;
  });
});
