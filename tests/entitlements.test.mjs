import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/marekto";

const {
  assertCanCreateOwnedWorkspace,
  assertWorkspaceHasMemberCapacity,
  currentMonthlyPeriodStart,
  limitErrorResponse,
  PlanLimitExceededError,
} = await import("../src/lib/entitlements.ts");
const { USER_ID, WORKSPACE_ID } = await import("./test-ids.mjs");

function fakeClient({ userPlan = null, workspacePlan = null, owned = 0, members = 0 }) {
  return {
    async query(text) {
      if (text.includes('"User_entitlements"')) {
        return { rows: [{ plan_code: userPlan }] };
      }

      if (text.includes('"Workspace_subscriptions"')) {
        return { rows: [{ plan_code: workspacePlan }] };
      }

      if (text.includes("role = 'owner'")) {
        return { rows: [{ count: owned }] };
      }

      if (text.includes('"Workspace_members" WHERE workspace_id')) {
        return { rows: [{ count: members }] };
      }

      return { rows: [] };
    },
  };
}

test("currentMonthlyPeriodStart returns the UTC month boundary", () => {
  assert.equal(
    currentMonthlyPeriodStart(new Date("2026-07-20T23:59:59.000Z")),
    "2026-07-01",
  );
});

test("free user cannot create a second owned workspace", async () => {
  await assert.rejects(
    assertCanCreateOwnedWorkspace(USER_ID, fakeClient({ owned: 1 })),
    (error) => {
      assert.ok(error instanceof PlanLimitExceededError);
      assert.deepEqual(error.details, {
        limit_key: "user.owned_workspaces",
        used: 1,
        limit: 1,
      });
      return true;
    },
  );
});

test("mock paid user can exceed the free workspace limit", async () => {
  await assert.doesNotReject(
    assertCanCreateOwnedWorkspace(USER_ID, fakeClient({ userPlan: "pro", owned: 2 })),
  );
});

test("free workspace cannot exceed three members", async () => {
  await assert.rejects(
    assertWorkspaceHasMemberCapacity(WORKSPACE_ID, fakeClient({ members: 3 })),
    (error) => {
      assert.ok(error instanceof PlanLimitExceededError);
      assert.equal(error.details.limit_key, "workspace.members");
      assert.equal(error.details.used, 3);
      assert.equal(error.details.limit, 3);
      return true;
    },
  );
});

test("plan limit response uses the shared contract", () => {
  const error = new PlanLimitExceededError("Limit reached", {
    limit_key: "ai.segmentation",
    used: 50,
    limit: 50,
  });

  assert.deepEqual(limitErrorResponse(error), {
    success: false,
    error: "plan_limit_exceeded",
    message: "Limit reached",
    details: {
      limit_key: "ai.segmentation",
      used: 50,
      limit: 50,
    },
  });
});
