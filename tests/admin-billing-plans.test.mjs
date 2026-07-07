import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/marekto";

const { parseBillingPlanUpdateForm } = await import(
  "../src/lib/admin-billing-plans.ts"
);

function validForm(overrides = {}) {
  const formData = new FormData();
  const values = {
    "limit:ai.campaign_builder": "200",
    "limit:ai.personalization_recipients": "2000",
    "limit:ai.segmentation": "500",
    "limit:contact_intelligence.rows": "10000",
    "limit:user.owned_workspaces": "3",
    "limit:workspace.members": "10",
    checkoutEnabled: "on",
    currency: "vnd",
    description: "Recommended for small teams.",
    features: "3 owned workspaces\n10 members\n200 AI runs",
    monthlyAmountCents: "99000",
    name: "Pro",
    planCode: "pro",
    ...overrides,
  };

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  return formData;
}

test("parseBillingPlanUpdateForm normalizes plan pricing, limits, and features", () => {
  const parsed = parseBillingPlanUpdateForm(
    validForm({ "limit:workspace.members": "" }),
  );

  assert.equal(parsed.code, "pro");
  assert.equal(parsed.monthlyAmountCents, 99000);
  assert.equal(parsed.currency, "vnd");
  assert.equal(parsed.checkoutEnabled, true);
  assert.equal(parsed.limits["workspace.members"], null);
  assert.equal(parsed.limits["ai.campaign_builder"], 200);
  assert.deepEqual(parsed.features, [
    "3 owned workspaces",
    "10 members",
    "200 AI runs",
  ]);
});

test("parseBillingPlanUpdateForm rejects invalid plan updates", () => {
  assert.throws(
    () => parseBillingPlanUpdateForm(validForm({ planCode: "enterprise" })),
    /Billing plan code is invalid/,
  );
  assert.throws(
    () => parseBillingPlanUpdateForm(validForm({ monthlyAmountCents: "-1" })),
    /Monthly amount/,
  );
  assert.throws(
    () => parseBillingPlanUpdateForm(validForm({ features: "" })),
    /At least one plan feature/,
  );
});
