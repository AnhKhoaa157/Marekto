import assert from "node:assert/strict";
import test from "node:test";

import { enrichContactRecord } from "../src/lib/data-intelligence/contact-intelligence.ts";

const env = {
  DATA_INTELLIGENCE_BASE_URL: "http://data-intelligence:8080",
  DATA_INTELLIGENCE_INTERNAL_SECRET: "test-internal-secret",
};

function buildRecord() {
  return {
    email: "user@example.com",
    firstName: "An",
    lastName: "Nguyen",
    phone: "+84 000 000 001",
    properties: {
      city: "hcm",
      tags: ["VIP", "Beta Tester"],
      lead_score: 40,
      company: "Acme",
      plan_details: { tier: "pro", seats: 4 },
    },
  };
}

const acceptedNormalization = {
  accepted: [
    {
      row_number: 1,
      email: "user@example.com",
      first_name: "An",
      last_name: "Nguyen",
      phone: "+84 000 000 001",
      city: "Ho Chi Minh",
      tags: ["vip", "beta_tester"],
      lead_score: 40,
      properties: {},
      warnings: ["city_normalized:Ho Chi Minh"],
    },
  ],
  rejected: [],
  duplicate_emails: [],
  total_rows: 1,
};

const leadScore = {
  score: 83,
  labels: ["high_intent"],
  factors: [
    { name: "valid_email", impact: 10, reason: "A valid email supports reachability." },
  ],
  model_version: "rules_v1",
};

function buildServiceFetch(overrides = {}) {
  const calls = [];
  const responses = {
    "/v1/contacts/normalize": () => Response.json(acceptedNormalization),
    "/v1/leads/score": () => Response.json(leadScore),
    ...overrides,
  };
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: JSON.parse(options.body) });
    return responses[path]();
  };
  return { calls, fetchImpl };
}

test("enriches a contact with normalized fields and a deterministic score", async () => {
  const { calls, fetchImpl } = buildServiceFetch();

  const result = await enrichContactRecord(buildRecord(), { env, fetchImpl });

  assert.deepEqual(calls.map((call) => call.path), [
    "/v1/contacts/normalize",
    "/v1/leads/score",
  ]);

  // Only the fields needed for normalization are sent; never free-form
  // user properties.
  assert.deepEqual(calls[0].body, {
    rows: [
      {
        row_number: 1,
        email: "user@example.com",
        first_name: "An",
        last_name: "Nguyen",
        phone: "+84 000 000 001",
        city: "hcm",
        tags: ["VIP", "Beta Tester"],
        lead_score: 40,
      },
    ],
  });
  assert.deepEqual(calls[1].body, {
    email_valid: true,
    has_phone: true,
    city: "Ho Chi Minh",
    tags: ["vip", "beta_tester"],
  });

  assert.deepEqual(result, {
    email: "user@example.com",
    firstName: "An",
    lastName: "Nguyen",
    phone: "+84 000 000 001",
    properties: {
      company: "Acme",
      plan_details: { tier: "pro", seats: 4 },
      city: "Ho Chi Minh",
      tags: ["vip", "beta_tester"],
      normalization_warnings: ["city_normalized:Ho Chi Minh"],
      lead_score: 83,
      lead_score_labels: ["high_intent"],
      lead_score_factors: leadScore.factors,
      lead_score_version: "rules_v1",
      data_intelligence_status: "scored",
    },
  });
});

test("saves the contact unchanged when the service is not configured", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return Response.json({});
  };
  const record = buildRecord();

  const result = await enrichContactRecord(record, { env: {}, fetchImpl });

  assert.equal(called, false);
  assert.deepEqual(result, {
    ...buildRecord(),
    properties: {
      ...buildRecord().properties,
      data_intelligence_status: "unavailable",
    },
  });
  // The input record is never mutated.
  assert.deepEqual(record, buildRecord());
});

test("falls back safely when the service is unreachable", async () => {
  const fetchImpl = async () => {
    throw new TypeError("fetch failed");
  };

  const result = await enrichContactRecord(buildRecord(), { env, fetchImpl });

  assert.deepEqual(result.properties, {
    ...buildRecord().properties,
    data_intelligence_status: "unavailable",
  });
});

test("falls back safely on a non-2xx service response", async () => {
  const { fetchImpl } = buildServiceFetch({
    "/v1/contacts/normalize": () => new Response("validation failed", { status: 422 }),
  });

  const result = await enrichContactRecord(buildRecord(), { env, fetchImpl });

  assert.deepEqual(result, {
    ...buildRecord(),
    properties: {
      ...buildRecord().properties,
      data_intelligence_status: "unavailable",
    },
  });
});

test("invalid scoring output does not corrupt contact properties", async () => {
  const invalidScorePayloads = [
    { ...leadScore, score: 150 },
    { ...leadScore, factors: [{ name: "x", impact: "high" }] },
    { ...leadScore, score: "high" },
  ];

  for (const payload of invalidScorePayloads) {
    const { fetchImpl } = buildServiceFetch({
      "/v1/leads/score": () => Response.json(payload),
    });
    const result = await enrichContactRecord(buildRecord(), { env, fetchImpl });

    // No partial normalization output is applied either; the record stays
    // exactly as the user submitted it.
    assert.deepEqual(result, {
      ...buildRecord(),
      properties: {
        ...buildRecord().properties,
        data_intelligence_status: "unavailable",
      },
    });
  }
});

test("keeps user values and scores reachability when normalization rejects the row", async () => {
  const { calls, fetchImpl } = buildServiceFetch({
    "/v1/contacts/normalize": () =>
      Response.json({
        accepted: [],
        rejected: [{ row_number: 1, reasons: ["invalid_email"] }],
        duplicate_emails: [],
        total_rows: 1,
      }),
    "/v1/leads/score": () =>
      Response.json({
        score: 30,
        labels: ["low_data"],
        factors: [
          { name: "invalid_email", impact: -25, reason: "Invalid email reduces reachability." },
        ],
        model_version: "rules_v1",
      }),
  });
  const record = {
    ...buildRecord(),
    email: "not-an-email",
  };

  const result = await enrichContactRecord(record, { env, fetchImpl });

  assert.equal(calls[1].body.email_valid, false);
  assert.equal(result.email, "not-an-email");
  assert.equal(result.firstName, "An");
  assert.deepEqual(result.properties.normalization_warnings, ["invalid_email"]);
  assert.equal(result.properties.lead_score, 30);
  assert.equal(result.properties.data_intelligence_status, "scored");
  // User-submitted hints are kept when the service cannot normalize them.
  assert.equal(result.properties.city, "hcm");
  assert.deepEqual(result.properties.tags, ["VIP", "Beta Tester"]);
  assert.equal(result.properties.company, "Acme");
});

test("ignores invalid property hints instead of failing the request", async () => {
  const { calls, fetchImpl } = buildServiceFetch({
    "/v1/contacts/normalize": () =>
      Response.json({
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
      }),
  });
  const record = {
    email: "user@example.com",
    firstName: null,
    lastName: null,
    phone: null,
    properties: {
      city: 42,
      tags: "not-a-list",
      lead_score: 250,
    },
  };

  const result = await enrichContactRecord(record, { env, fetchImpl });

  // Invalid hints are not sent to the service at all.
  assert.deepEqual(calls[0].body, {
    rows: [
      {
        row_number: 1,
        email: "user@example.com",
        first_name: null,
        last_name: null,
        phone: null,
      },
    ],
  });
  assert.deepEqual(calls[1].body, { email_valid: true, has_phone: false });
  assert.equal(result.properties.data_intelligence_status, "scored");
  assert.equal(result.properties.lead_score, 83);
  // Invalid user hints are preserved as-is in properties, not deleted.
  assert.equal(result.properties.city, 42);
  assert.equal(result.properties.tags, "not-a-list");
});
