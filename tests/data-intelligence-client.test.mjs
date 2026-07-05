import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  DataIntelligenceUnavailableError,
  analyzeCampaign,
  buildDataIntelligenceSignature,
  isDataIntelligenceUnavailableError,
  normalizeContacts,
  resolveDataIntelligenceConfig,
  scoreLead,
} from "../src/lib/data-intelligence/client.ts";

const secret = "test-internal-secret";
const env = {
  DATA_INTELLIGENCE_BASE_URL: "http://data-intelligence:8080",
  DATA_INTELLIGENCE_INTERNAL_SECRET: secret,
};

const normalizeResponse = {
  accepted: [
    {
      row_number: 1,
      email: "user@example.com",
      first_name: null,
      last_name: null,
      phone: null,
      city: null,
      tags: [],
      lead_score: null,
      properties: {},
      warnings: [],
    },
  ],
  rejected: [],
  duplicate_emails: [],
  total_rows: 1,
};

test("builds an HMAC signature matching the Python service contract", () => {
  const timestamp = "1700000000";
  const body = JSON.stringify({
    rows: [{ row_number: 1, email: "user@example.com" }],
  });

  // Pinned vector: hmac-sha256(secret, `${timestamp}.${body}`), same payload
  // format as services/data-intelligence/app/security.py build_signature.
  assert.equal(
    buildDataIntelligenceSignature(secret, timestamp, body),
    "sha256=0d850a623826d0483361fb43baaee9458039c66571151c273d6d99cd0f64ae0b",
  );
  assert.equal(
    buildDataIntelligenceSignature(secret, timestamp, body),
    `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
  );
  assert.notEqual(
    buildDataIntelligenceSignature(secret, timestamp, body),
    buildDataIntelligenceSignature(secret, "1700000001", body),
  );
});

test("resolves config with default timeout and trimmed base URL", () => {
  assert.deepEqual(
    resolveDataIntelligenceConfig({
      DATA_INTELLIGENCE_BASE_URL: "http://data-intelligence:8080/",
      DATA_INTELLIGENCE_INTERNAL_SECRET: ` ${secret} `,
    }),
    {
      baseUrl: "http://data-intelligence:8080",
      secret,
      timeoutMs: 10_000,
    },
  );
});

test("marks missing configuration as service unavailable", () => {
  assert.throws(
    () => resolveDataIntelligenceConfig({}),
    (error) => {
      assert.ok(isDataIntelligenceUnavailableError(error));
      assert.match(error.message, /DATA_INTELLIGENCE_BASE_URL is required/);
      return true;
    },
  );

  assert.throws(
    () =>
      resolveDataIntelligenceConfig({
        DATA_INTELLIGENCE_BASE_URL: "http://data-intelligence:8080",
      }),
    (error) => {
      assert.ok(error instanceof DataIntelligenceUnavailableError);
      assert.match(error.message, /DATA_INTELLIGENCE_INTERNAL_SECRET is required/);
      return true;
    },
  );
});

test("rejects an invalid timeout configuration", () => {
  assert.throws(
    () =>
      resolveDataIntelligenceConfig({
        ...env,
        DATA_INTELLIGENCE_TIMEOUT_MS: "50",
      }),
    /DATA_INTELLIGENCE_TIMEOUT_MS must be an integer between 1000 and 120000/,
  );
});

test("fails safely without calling the service when not configured", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return Response.json(normalizeResponse);
  };

  await assert.rejects(
    normalizeContacts({ rows: [{ row_number: 1 }] }, { env: {}, fetchImpl }),
    isDataIntelligenceUnavailableError,
  );
  assert.equal(called, false);
});

test("signs and parses a successful normalize request", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return Response.json(normalizeResponse);
  };

  const result = await normalizeContacts(
    { rows: [{ row_number: 1, email: "user@example.com" }] },
    { env, fetchImpl },
  );

  assert.equal(captured.url, "http://data-intelligence:8080/v1/contacts/normalize");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["content-type"], "application/json");
  assert.equal(
    captured.options.body,
    JSON.stringify({ rows: [{ row_number: 1, email: "user@example.com" }] }),
  );

  const timestamp = captured.options.headers["x-marekto-timestamp"];
  assert.match(timestamp, /^\d+$/);
  assert.ok(Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) <= 5);
  assert.equal(
    captured.options.headers["x-marekto-signature"],
    buildDataIntelligenceSignature(secret, timestamp, captured.options.body),
  );
  assert.deepEqual(result, normalizeResponse);
});

test("maps scoreLead and analyzeCampaign to their endpoints", async () => {
  const urls = [];
  const responses = {
    "/v1/leads/score": {
      score: 82,
      labels: ["high_intent"],
      factors: [{ name: "has_phone", impact: 10, reason: "phone present" }],
      model_version: "rules_v1",
    },
    "/v1/campaigns/analyze": {
      total_count: 20,
      sent_count: 18,
      failed_count: 2,
      failure_rate: 0.1,
      insufficient_data: false,
      segments: [],
      high_failure_segments: [],
      recommendations: [],
    },
  };
  const fetchImpl = async (url) => {
    urls.push(url);
    const path = new URL(url).pathname;
    return Response.json(responses[path]);
  };

  const score = await scoreLead({ email_valid: true, has_phone: true }, { env, fetchImpl });
  const analytics = await analyzeCampaign({ sent_count: 18, failed_count: 2 }, { env, fetchImpl });

  assert.deepEqual(urls, [
    "http://data-intelligence:8080/v1/leads/score",
    "http://data-intelligence:8080/v1/campaigns/analyze",
  ]);
  assert.deepEqual(score, responses["/v1/leads/score"]);
  assert.deepEqual(analytics, responses["/v1/campaigns/analyze"]);
});

test("reports non-2xx responses without leaking the secret", async () => {
  const fetchImpl = async () =>
    new Response(`unauthorized ${secret}`, { status: 401 });

  await assert.rejects(
    scoreLead({ email_valid: true }, { env, fetchImpl }),
    (error) => {
      assert.equal(isDataIntelligenceUnavailableError(error), false);
      assert.match(error.message, /\/v1\/leads\/score failed with status 401/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("maps gateway errors to service unavailable", async () => {
  const fetchImpl = async () => new Response("maintenance", { status: 503 });

  await assert.rejects(
    analyzeCampaign({ sent_count: 0, failed_count: 0 }, { env, fetchImpl }),
    (error) => {
      assert.ok(isDataIntelligenceUnavailableError(error));
      assert.match(error.message, /status 503/);
      return true;
    },
  );
});

test("rejects a malformed success payload", async () => {
  const fetchImpl = async () => Response.json({ accepted: "not-a-list" });

  await assert.rejects(
    normalizeContacts({ rows: [{ row_number: 1 }] }, { env, fetchImpl }),
    /\/v1\/contacts\/normalize returned an invalid response/,
  );
});

test("maps network failures to service unavailable", async () => {
  const fetchImpl = async () => {
    throw new TypeError(`fetch failed for ${secret}`);
  };

  await assert.rejects(
    scoreLead({ email_valid: true }, { env, fetchImpl }),
    (error) => {
      assert.ok(isDataIntelligenceUnavailableError(error));
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("maps timeouts to service unavailable", async () => {
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });

  await assert.rejects(
    scoreLead(
      { email_valid: true },
      { env: { ...env, DATA_INTELLIGENCE_TIMEOUT_MS: "1000" }, fetchImpl },
    ),
    (error) => {
      assert.ok(isDataIntelligenceUnavailableError(error));
      assert.match(error.message, /timed out after 1000ms/);
      return true;
    },
  );
});
