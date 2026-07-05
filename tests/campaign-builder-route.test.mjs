import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { WORKSPACE_ID } from "./test-ids.mjs";
const SRC_ROOT = path.resolve(import.meta.dirname, "..", "src");
const GEMINI_URL = pathToFileURL(
  path.join(SRC_ROOT, "lib", "ai", "gemini.ts"),
).href;
const DB_STUB_URL = "marekto-test:campaign-builder-db-stub";
const ENTITLEMENTS_STUB_URL = "marekto-test:campaign-builder-entitlements-stub";

const geminiStub = {
  requests: [],
  mode: "ok",
  output: null,
};
globalThis.__marektoBuilderGeminiStub = geminiStub;
const entitlementStub = {
  checks: [],
  consumes: [],
  mode: "ok",
};
globalThis.__marektoBuilderEntitlementStub = entitlementStub;

// Replace only the Gemini provider module so the route exercises the real
// input/output validation while we control provider behavior. The relative
// "./gemini.ts" import inside campaign-builder.ts resolves to the same URL as
// the route's "@/lib/ai/gemini" import, so a single stub covers both.
const GEMINI_STUB_SOURCE = `
const state = globalThis.__marektoBuilderGeminiStub;

export const GEMINI_MODEL = "gemini-2.5-flash";

export class GeminiProviderUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "GeminiProviderUnavailableError";
  }
}

export function isGeminiProviderUnavailableError(error) {
  return error instanceof GeminiProviderUnavailableError;
}

export async function generateGeminiJson(request) {
  state.requests.push(request);
  if (state.mode === "unavailable") {
    throw new GeminiProviderUnavailableError("provider unavailable");
  }
  return state.output;
}
`;

const DB_STUB_SOURCE = `
export async function initializeDatabase() {}
`;

const ENTITLEMENTS_STUB_SOURCE = `
const state = globalThis.__marektoBuilderEntitlementStub;

export class PlanLimitExceededError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "PlanLimitExceededError";
    this.details = details;
  }
}

export function limitErrorResponse(error) {
  return {
    success: false,
    error: "plan_limit_exceeded",
    message: error.message,
    details: error.details,
  };
}

export function statusForPlanLimitError(error) {
  return error instanceof PlanLimitExceededError ? 402 : null;
}

export async function assertWorkspaceUsageAvailable(input) {
  state.checks.push(input);
  if (state.mode === "exhausted") {
    throw new PlanLimitExceededError("Plan usage limit reached.", {
      limit_key: input.usageKey,
      used: 20,
      limit: 20,
    });
  }
}

export async function consumeWorkspaceUsage(input) {
  state.consumes.push(input);
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/db") {
      return { url: DB_STUB_URL, shortCircuit: true };
    }

    if (specifier === "@/lib/entitlements") {
      return { url: ENTITLEMENTS_STUB_URL, shortCircuit: true };
    }

    if (specifier.startsWith("@/")) {
      const target = pathToFileURL(
        path.join(SRC_ROOT, `${specifier.slice(2)}.ts`),
      ).href;
      return nextResolve(target, context);
    }

    if (specifier === "next/server") {
      return nextResolve("next/server.js", context);
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === GEMINI_URL) {
      return { format: "module", source: GEMINI_STUB_SOURCE, shortCircuit: true };
    }

    if (url === DB_STUB_URL) {
      return { format: "module", source: DB_STUB_SOURCE, shortCircuit: true };
    }

    if (url === ENTITLEMENTS_STUB_URL) {
      return {
        format: "module",
        source: ENTITLEMENTS_STUB_SOURCE,
        shortCircuit: true,
      };
    }

    return nextLoad(url, context);
  },
});

const { POST } = await import(
  pathToFileURL(
    path.join(SRC_ROOT, "app", "api", "ai", "campaign-builder", "route.ts"),
  ).href
);
const { NextRequest } = await import("next/server.js");

const VALID_OUTPUT = {
  campaignName: "July Beginner English Signup Push",
  brief: "Promote the July beginner English cohort.",
  audienceExplanation: "Targets HCM contacts with lead score above 70.",
  targetFilters: { city: "HCM", lead_score_gt: 70 },
  subjectIdeas: ["Start speaking English this July"],
  emailHtml: "<!doctype html><html><body><p>Hi</p></body></html>",
  aiContext: { goal: "Increase signups", tone: "Friendly" },
  scheduleNotes: "Save as draft first, then schedule manually.",
  warnings: [],
};

const VALID_BODY = {
  productOrService: "Online English course for beginners",
  campaignGoal: "Increase signups for the July cohort",
  targetAudiencePrompt: "Contacts in HCM with lead score over 70",
  enablePersonalization: true,
};

function resetStub(mode = "ok", output = VALID_OUTPUT) {
  geminiStub.requests = [];
  geminiStub.mode = mode;
  geminiStub.output = output;
  entitlementStub.checks = [];
  entitlementStub.consumes = [];
  entitlementStub.mode = "ok";
}

function buildRequest(body, headers = { "x-workspace-id": String(WORKSPACE_ID) }) {
  return new NextRequest("http://localhost/api/ai/campaign-builder", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects a missing workspace context without calling the provider", async (t) => {
  t.mock.method(console, "error", () => {});
  resetStub();

  const response = await POST(buildRequest(VALID_BODY, {}));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.success, false);
  assert.equal(body.error, "Missing workspace context");
  assert.equal(geminiStub.requests.length, 0);
});

test("rejects an invalid workspace context", async (t) => {
  t.mock.method(console, "error", () => {});
  resetStub();

  const response = await POST(
    buildRequest(VALID_BODY, { "x-workspace-id": "not-a-number" }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid workspace id");
  assert.equal(geminiStub.requests.length, 0);
});

test("returns a validated draft package for a valid authenticated request", async () => {
  resetStub();

  const response = await POST(buildRequest(VALID_BODY));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.data.campaignName, "July Beginner English Signup Push");
  assert.equal(body.data.filtersValid, true);
  assert.deepEqual(body.data.targetFilters, { city: "HCM", lead_score_gt: 70 });
  assert.equal(geminiStub.requests.length, 1);
  assert.deepEqual(entitlementStub.checks, [
    { workspaceId: WORKSPACE_ID, usageKey: "ai.campaign_builder" },
  ]);
  assert.deepEqual(entitlementStub.consumes, [
    { workspaceId: WORKSPACE_ID, usageKey: "ai.campaign_builder" },
  ]);
});

test("does not call Gemini when campaign-builder quota is exhausted", async (t) => {
  t.mock.method(console, "error", () => {});
  resetStub();
  entitlementStub.mode = "exhausted";

  const response = await POST(buildRequest(VALID_BODY));
  const body = await response.json();

  assert.equal(response.status, 402);
  assert.equal(body.success, false);
  assert.equal(body.error, "plan_limit_exceeded");
  assert.equal(geminiStub.requests.length, 0);
  assert.equal(entitlementStub.consumes.length, 0);
});

test("never sends contact records or workspace data to the provider", async () => {
  resetStub();

  await POST(buildRequest(VALID_BODY));
  const sentPrompt = geminiStub.requests[0].prompt;

  assert.doesNotMatch(sentPrompt, /"email"|"properties"|contact record/i);
  assert.doesNotMatch(sentPrompt, /workspace_id|x-workspace-id/i);
});

test("does not accept workspace_id from the request body", async (t) => {
  t.mock.method(console, "error", () => {});
  resetStub();

  const response = await POST(
    buildRequest({ ...VALID_BODY, workspace_id: 999 }),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Unsupported request field: workspace_id/);
  assert.equal(geminiStub.requests.length, 0);
  assert.equal(entitlementStub.checks.length, 0);
});

test("maps provider unavailability to a safe 503", async (t) => {
  t.mock.method(console, "error", () => {});
  resetStub("unavailable");

  const response = await POST(buildRequest(VALID_BODY));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.match(body.error, /temporarily unavailable/);
});

test("maps invalid provider output to a safe 500 without leaking details", async (t) => {
  t.mock.method(console, "error", () => {});
  resetStub("ok", { campaignName: "Only a name" });

  const response = await POST(buildRequest(VALID_BODY));
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.success, false);
  assert.equal(body.error, "AI campaign builder could not produce a valid draft.");
});
