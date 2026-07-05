import assert from "node:assert/strict";
import test from "node:test";

import { GeminiProviderUnavailableError } from "../src/lib/ai/gemini.ts";
import {
  generateAudienceFilters,
  generateAudienceFiltersWithCache,
  parseAiSegmentationFilters,
  parseSegmentationPrompt,
  SegmentationUnavailableError,
} from "../src/lib/ai/segmentation.ts";
import { EMAIL_LOG_ID, WORKSPACE_ID } from "./test-ids.mjs";

test("normalizes a valid audience description", () => {
  assert.equal(
    parseSegmentationPrompt("  VIP customers in HCM  "),
    "VIP customers in HCM",
  );
  assert.throws(() => parseSegmentationPrompt("   "), /description is required/);
  assert.throws(() => parseSegmentationPrompt("x".repeat(501)), /500 characters/);
});

test("accepts only the supported AI audience filter contract", () => {
  assert.deepEqual(
    parseAiSegmentationFilters({
      city: " HCM ",
      lead_score_gt: 80,
      tags_contains: "VIP",
    }),
    {
      city: "HCM",
      lead_score_gt: 80,
      tags_contains: "VIP",
    },
  );

  assert.throws(
    () => parseAiSegmentationFilters({ company_size: "large" }),
    /unsupported audience filter/,
  );
  assert.throws(() => parseAiSegmentationFilters({}), /empty audience filter/);
  assert.throws(
    () => parseAiSegmentationFilters({ lead_score_gte: 101 }),
    /0-100 range/,
  );
  assert.throws(
    () =>
      parseAiSegmentationFilters({
        tags_contains: "VIP recognised, City is HCM, Lead score is over 80",
      }),
    /invalid tag filter/,
  );
  assert.throws(
    () => parseAiSegmentationFilters({ tags_contains: "VIP customers" }),
    /invalid tag filter/,
  );
});

test("repairs explicit supported rules when Gemini collapses them into a tag", () => {
  assert.deepEqual(
    parseAiSegmentationFilters(
      {
        tags_contains: "VIP recognised, City is HCM, Lead score is over 80",
      },
      "Tag is VIP. City is HCM. Lead score is over 80.",
    ),
    {
      tags_contains: "VIP",
      city: "HCM",
      lead_score_gt: 80,
    },
  );
});

test("generates structured filters and validates the provider output", async () => {
  let request;
  const filters = await generateAudienceFilters(
    "VIP customers in HCM with lead score over 80",
    async (geminiRequest) => {
      request = geminiRequest;
      return {
        city: "HCM",
        lead_score_gt: 80,
        tags_contains: "VIP",
      };
    },
  );

  assert.deepEqual(filters, {
    city: "HCM",
    lead_score_gt: 80,
    tags_contains: "VIP",
  });
  assert.equal(request.prompt, "VIP customers in HCM with lead score over 80");
  assert.match(request.systemInstruction, /Use only city/);
  assert.equal(Object.hasOwn(request.responseSchema, "additionalProperties"), false);
});

test("generated filters include explicit prompt rules even when provider output is incomplete", async () => {
  const filters = await generateAudienceFilters(
    "Tag is VIP. City is HCM. Lead score is over 80.",
    async () => ({
      tags_contains: "VIP_customer",
    }),
  );

  assert.deepEqual(filters, {
    tags_contains: "VIP",
    city: "HCM",
    lead_score_gt: 80,
  });
});

test("rejects invalid provider output instead of creating a fake audience", async () => {
  await assert.rejects(
    generateAudienceFilters("Customers with unsupported data", async () => ({
      revenue_gt: 1000,
    })),
    /Unsupported filter operator|unsupported audience filter/,
  );
});

test("saves validated Gemini audience filters into the workspace cache", async () => {
  const writes = [];
  const result = await generateAudienceFiltersWithCache(
    WORKSPACE_ID,
    "VIP customers in HCM with lead score over 80",
    {
      generateJson: async () => ({
        city: "HCM",
        lead_score_gt: 80,
        tags_contains: "VIP",
      }),
      readCache: async () => {
        throw new Error("cache should not be read after Gemini succeeds");
      },
      writeCache: async (input) => {
        writes.push(input);
      },
    },
  );

  assert.deepEqual(result, {
    targetFilters: {
      city: "HCM",
      lead_score_gt: 80,
      tags_contains: "VIP",
    },
    source: "gemini",
  });
  assert.deepEqual(writes, [
    {
      workspaceId: WORKSPACE_ID,
      feature: "segmentation",
      inputText: "VIP customers in HCM with lead score over 80",
      outputJson: {
        city: "HCM",
        lead_score_gt: 80,
        tags_contains: "VIP",
      },
      provider: "gemini",
      model: "gemini-2.5-flash",
    },
  ]);
});

test("uses exact-match cached segmentation when Gemini is unavailable", async () => {
  const reads = [];
  const result = await generateAudienceFiltersWithCache(
    WORKSPACE_ID,
    "VIP customers in HCM",
    {
      generateJson: async () => {
        throw new GeminiProviderUnavailableError("quota exhausted");
      },
      readCache: async (workspaceId, feature, inputText) => {
        reads.push({ workspaceId, feature, inputText });

        return {
          id: EMAIL_LOG_ID,
          workspaceId,
          feature,
          inputHash: "hash",
          inputText,
          outputJson: { city: "HCM", tags_contains: "VIP" },
          provider: "gemini",
          model: "gemini-2.5-flash",
          status: "generated",
          createdBy: null,
          createdAt: new Date("2026-06-30T00:00:00.000Z"),
          updatedAt: new Date("2026-06-30T00:00:00.000Z"),
        };
      },
      writeCache: async () => {
        throw new Error("cache should not be written during fallback");
      },
    },
  );

  assert.deepEqual(reads, [
    { workspaceId: WORKSPACE_ID, feature: "segmentation", inputText: "VIP customers in HCM" },
  ]);
  assert.deepEqual(result, {
    targetFilters: { city: "HCM", tags_contains: "VIP" },
    source: "cache",
  });
});

test("returns unavailable when Gemini fails and no exact cache exists", async () => {
  await assert.rejects(
    generateAudienceFiltersWithCache(WORKSPACE_ID, "VIP customers in HCM", {
      generateJson: async () => {
        throw new GeminiProviderUnavailableError("GEMINI_API_KEY is required");
      },
      readCache: async () => null,
      writeCache: async () => {
        throw new Error("cache should not be written during fallback");
      },
    }),
    SegmentationUnavailableError,
  );
});

test("does not fallback to cache when Gemini returns invalid filter JSON", async () => {
  let readCacheCalled = false;

  await assert.rejects(
    generateAudienceFiltersWithCache(WORKSPACE_ID, "Bad provider output", {
      generateJson: async () => ({ revenue_gt: 1000 }),
      readCache: async () => {
        readCacheCalled = true;
        return null;
      },
      writeCache: async () => {
        throw new Error("invalid provider output must not be cached");
      },
    }),
    /Unsupported filter operator|unsupported audience filter/,
  );

  assert.equal(readCacheCalled, false);
});
