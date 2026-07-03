import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CAMPAIGN_AI_CONTEXT_LIMITS,
  parseCampaignAiContext,
  CampaignAiContextError,
} from "../src/lib/campaign-ai-context.ts";
import { CLAIM_CAMPAIGN_SQL } from "../src/lib/campaign-worker.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

function readWorkspaceFile(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("campaign AI context accepts and normalizes supported string fields", () => {
  assert.deepEqual(
    parseCampaignAiContext({
      goal: "  announce a seasonal offer  ",
      tone: " friendly ",
      cta: " book a demo ",
      audience_description: " VIP customers in HCM ",
      language: " en ",
    }),
    {
      goal: "announce a seasonal offer",
      tone: "friendly",
      cta: "book a demo",
      audience_description: "VIP customers in HCM",
      language: "en",
    },
  );
});

test("campaign AI context defaults to an empty object and omits blank fields", () => {
  assert.deepEqual(parseCampaignAiContext(undefined), {});
  assert.deepEqual(parseCampaignAiContext(null), {});
  assert.deepEqual(parseCampaignAiContext({ goal: "   ", tone: "" }), {});
});

test("campaign AI context rejects arrays, nested objects, and unknown fields", () => {
  assert.throws(
    () => parseCampaignAiContext([]),
    /ai_context must be a JSON object/,
  );
  assert.throws(
    () => parseCampaignAiContext({ goal: { text: "launch" } }),
    /ai_context\.goal must be a string/,
  );
  assert.throws(
    () => parseCampaignAiContext({ discount: "20%" }),
    /ai_context contains unsupported key: discount/,
  );
});

test("campaign AI context enforces per-field length limits", () => {
  for (const [key, limit] of Object.entries(CAMPAIGN_AI_CONTEXT_LIMITS)) {
    assert.throws(
      () => parseCampaignAiContext({ [key]: "x".repeat(limit + 1) }),
      new RegExp(`ai_context\\.${key} must be ${limit} characters or fewer`),
    );
  }
});

test("campaign AI context errors use a dedicated error type", () => {
  assert.throws(
    () => parseCampaignAiContext("not-json"),
    CampaignAiContextError,
  );
});

test("campaign API and database schema expose ai_context", () => {
  const dbSource = readWorkspaceFile("src/lib/db.ts");
  const campaignsRouteSource = readWorkspaceFile("src/app/api/campaigns/route.ts");
  const campaignDetailRouteSource = readWorkspaceFile(
    "src/app/api/campaigns/[id]/route.ts",
  );

  assert.match(dbSource, /MIGRATION_VERSION = "v10_campaign_ai_context"/);
  assert.match(
    dbSource,
    /ai_context JSONB NOT NULL DEFAULT '\{\}'::jsonb/,
  );
  assert.match(
    dbSource,
    /ALTER TABLE "Campaigns" ADD COLUMN IF NOT EXISTS ai_context JSONB NOT NULL DEFAULT '\{\}'::jsonb/,
  );

  for (const source of [campaignsRouteSource, campaignDetailRouteSource]) {
    assert.match(source, /parseCampaignAiContext/);
    assert.match(source, /ai_context/);
    assert.match(source, /message\.startsWith\("ai_context"\)/);
  }
});

test("worker claims campaign AI context without passing it to segmentation", () => {
  const segmentationSource = readWorkspaceFile("src/lib/ai/segmentation.ts");

  assert.match(CLAIM_CAMPAIGN_SQL, /campaign\.ai_context/);
  assert.doesNotMatch(segmentationSource, /ai_context|aiContext|CampaignAiContext/);
});
