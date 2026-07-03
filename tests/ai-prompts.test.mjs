import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSegmentationRequest,
  SEGMENTATION_PROMPT_NAME,
  SEGMENTATION_PROMPT_VERSION,
  SEGMENTATION_RESPONSE_SCHEMA,
  SEGMENTATION_SYSTEM_INSTRUCTION,
} from "../src/lib/ai/prompts/segmentation-prompt.ts";
import {
  buildPersonalizationPrompt,
  PERSONALIZATION_PROMPT_NAME,
  PERSONALIZATION_PROMPT_VERSION,
  PERSONALIZATION_RESPONSE_SCHEMA,
  PERSONALIZATION_SYSTEM_INSTRUCTION,
  PersonalizationInputError,
} from "../src/lib/ai/prompts/personalization-prompt.ts";

const SEGMENTATION_FIELDS = [
  "city",
  "lead_score_gt",
  "lead_score_gte",
  "lead_score_lt",
  "lead_score_lte",
  "tags_contains",
];

test("segmentation prompt exposes an explicit name and version", () => {
  assert.equal(SEGMENTATION_PROMPT_NAME, "segmentation_v1");
  assert.equal(typeof SEGMENTATION_PROMPT_VERSION, "string");
  assert.ok(SEGMENTATION_PROMPT_VERSION.length > 0);
});

test("personalization prompt exposes an explicit name and version", () => {
  assert.equal(PERSONALIZATION_PROMPT_NAME, "email_personalization_v1");
  assert.equal(typeof PERSONALIZATION_PROMPT_VERSION, "string");
  assert.ok(PERSONALIZATION_PROMPT_VERSION.length > 0);
});

test("segmentation instruction names every supported field and operator", () => {
  for (const field of SEGMENTATION_FIELDS) {
    assert.ok(
      SEGMENTATION_SYSTEM_INSTRUCTION.includes(field),
      `expected instruction to mention ${field}`,
    );
  }
});

test("segmentation instruction forbids SQL, explanations, and unsupported keys", () => {
  assert.match(
    SEGMENTATION_SYSTEM_INSTRUCTION,
    /Never add explanations, SQL, contact records, or unsupported keys\./,
  );
});

test("segmentation request builder is testable without calling Gemini", () => {
  const request = buildSegmentationRequest("VIP customers in HCM");

  assert.equal(request.prompt, "VIP customers in HCM");
  assert.equal(request.systemInstruction, SEGMENTATION_SYSTEM_INSTRUCTION);
  assert.equal(request.responseSchema, SEGMENTATION_RESPONSE_SCHEMA);
});

test("segmentation response schema preserves the existing contract", () => {
  assert.equal(SEGMENTATION_RESPONSE_SCHEMA.type, "OBJECT");
  assert.deepEqual(
    Object.keys(SEGMENTATION_RESPONSE_SCHEMA.properties),
    SEGMENTATION_FIELDS,
  );
  assert.equal(
    Object.hasOwn(SEGMENTATION_RESPONSE_SCHEMA, "additionalProperties"),
    false,
  );

  for (const key of ["lead_score_gt", "lead_score_gte", "lead_score_lt", "lead_score_lte"]) {
    assert.deepEqual(SEGMENTATION_RESPONSE_SCHEMA.properties[key], {
      type: "NUMBER",
      minimum: 0,
      maximum: 100,
    });
  }

  assert.deepEqual(SEGMENTATION_RESPONSE_SCHEMA.properties.city, {
    type: "STRING",
  });
  assert.deepEqual(SEGMENTATION_RESPONSE_SCHEMA.properties.tags_contains, {
    type: "STRING",
  });
});

test("personalization prompt includes campaign, template, and only the provided contact data", () => {
  const prompt = buildPersonalizationPrompt({
    campaign: { name: "July VIP offer" },
    template: { bodyHtml: "<p>Hello there.</p>" },
    contact: {
      email: "an.nguyen@example.com",
      firstName: "An",
      lastName: "Nguyen",
      properties: { city: "HCM", lead_score: 92, tags: ["VIP"] },
    },
  });

  assert.match(prompt, /Campaign name: July VIP offer/);
  assert.match(prompt, /Email template HTML:\n<p>Hello there\.<\/p>/);
  assert.match(prompt, /Recipient contact data \(JSON\):/);
  assert.match(prompt, /"email":"an\.nguyen@example\.com"/);
  assert.match(prompt, /"first_name":"An"/);
  assert.match(prompt, /"last_name":"Nguyen"/);
  assert.match(prompt, /"lead_score":92/);
  assert.match(prompt, /"city":"HCM"/);
});

test("personalization prompt builder validates contact data without calling Gemini", () => {
  assert.throws(
    () =>
      buildPersonalizationPrompt({
        campaign: { name: "July VIP offer" },
        template: { bodyHtml: "<p>Hi</p>" },
        contact: {
          email: "an.nguyen@example.com",
          firstName: null,
          lastName: null,
          properties: "not-an-object",
        },
      }),
    PersonalizationInputError,
  );

  assert.throws(
    () =>
      buildPersonalizationPrompt({
        campaign: { name: "   " },
        template: { bodyHtml: "<p>Hi</p>" },
        contact: {
          email: "an.nguyen@example.com",
          firstName: null,
          lastName: null,
          properties: {},
        },
      }),
    /Campaign name is required/,
  );
});

test("personalization instruction keeps the no-hallucination rules", () => {
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Use only the campaign, template, and contact data provided in the prompt/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Never invent facts, offers, discounts, or personal details that are not present in the provided data/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /never reference other people or other customers/,
  );
});

test("personalization response schema preserves the existing contract", () => {
  assert.equal(PERSONALIZATION_RESPONSE_SCHEMA.type, "OBJECT");
  assert.deepEqual(Object.keys(PERSONALIZATION_RESPONSE_SCHEMA.properties), [
    "subject",
    "body_html",
    "body_text",
  ]);
  assert.deepEqual(PERSONALIZATION_RESPONSE_SCHEMA.required, [
    "subject",
    "body_html",
  ]);
});
