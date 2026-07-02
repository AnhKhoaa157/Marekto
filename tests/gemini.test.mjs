import assert from "node:assert/strict";
import test from "node:test";

import {
  GeminiProviderUnavailableError,
  generateGeminiJson,
  isGeminiProviderUnavailableError,
  resolveGeminiConfig,
} from "../src/lib/ai/gemini.ts";

const primaryKey = "primary-test-key";
const fallbackKey = "fallback-test-key";

test("resolves one primary key and de-duplicated fallback keys", () => {
  assert.deepEqual(
    resolveGeminiConfig({
      GEMINI_API_KEY: primaryKey,
      GEMINI_FALLBACK_API_KEYS: `${fallbackKey}, ${primaryKey};second-fallback`,
    }),
    {
      apiKeys: [primaryKey, fallbackKey, "second-fallback"],
      model: "gemini-2.5-flash",
      timeoutMs: 20_000,
    },
  );
});

test("marks missing provider keys as provider unavailable", () => {
  assert.throws(
    () => resolveGeminiConfig({}),
    (error) => {
      assert.ok(error instanceof GeminiProviderUnavailableError);
      assert.equal(isGeminiProviderUnavailableError(error), true);
      assert.match(error.message, /GEMINI_API_KEY is required/);
      return true;
    },
  );
});

test("uses a fallback key when the primary key is rate-limited", async () => {
  const attemptedKeys = [];
  const fetchImpl = async (url, options) => {
    attemptedKeys.push(options.headers["x-goog-api-key"]);
    assert.match(url, /gemini-2\.5-flash:generateContent$/);

    if (attemptedKeys.length === 1) {
      return new Response("quota exceeded", { status: 429 });
    }

    return Response.json({
      candidates: [
        {
          content: {
            parts: [{ text: '{"city":"HCM"}' }],
          },
        },
      ],
    });
  };

  const result = await generateGeminiJson(
    { prompt: "Customers in HCM" },
    {
      env: {
        GEMINI_API_KEY: primaryKey,
        GEMINI_FALLBACK_API_KEYS: fallbackKey,
      },
      fetchImpl,
    },
  );

  assert.deepEqual(attemptedKeys, [primaryKey, fallbackKey]);
  assert.deepEqual(result, { city: "HCM" });
});

test("does not leak configured keys when every key is rejected", async () => {
  const fetchImpl = async (_url, options) =>
    new Response(`rejected ${options.headers["x-goog-api-key"]}`, {
      status: 403,
    });

  await assert.rejects(
    generateGeminiJson(
      { prompt: "Create filters" },
      {
        env: {
          GEMINI_API_KEY: primaryKey,
          GEMINI_FALLBACK_API_KEYS: fallbackKey,
        },
        fetchImpl,
      },
    ),
    (error) => {
      assert.ok(isGeminiProviderUnavailableError(error));
      assert.equal(error.message.includes(primaryKey), false);
      assert.equal(error.message.includes(fallbackKey), false);
      assert.match(error.message, /All configured Gemini API keys/);
      return true;
    },
  );
});

test("does not rotate keys for a non-key request error", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return new Response("invalid request", { status: 400 });
  };

  await assert.rejects(
    generateGeminiJson(
      { prompt: "Create filters" },
      {
        env: {
          GEMINI_API_KEY: primaryKey,
          GEMINI_FALLBACK_API_KEYS: fallbackKey,
        },
        fetchImpl,
      },
    ),
    /status 400/,
  );

  assert.equal(attempts, 1);
});
