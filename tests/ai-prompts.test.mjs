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
  assert.equal(SEGMENTATION_PROMPT_VERSION, "1.1.0");
});

test("personalization prompt exposes an explicit name and version", () => {
  assert.equal(PERSONALIZATION_PROMPT_NAME, "email_personalization_v1");
  assert.equal(PERSONALIZATION_PROMPT_VERSION, "1.1.0");
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

test("segmentation instruction defines the meaning of every allowed field", () => {
  assert.match(SEGMENTATION_SYSTEM_INSTRUCTION, /Allowed fields:/);

  for (const field of SEGMENTATION_FIELDS) {
    assert.match(SEGMENTATION_SYSTEM_INSTRUCTION, new RegExp(`- ${field}:`));
  }

  assert.match(SEGMENTATION_SYSTEM_INSTRUCTION, /Conditions are combined with AND/);
});

test("segmentation instruction maps common marketing phrases to safe filters", () => {
  assert.match(
    SEGMENTATION_SYSTEM_INSTRUCTION,
    /VIP customers -> \{\"tags_contains\":\"VIP\"\}/,
  );
  assert.match(
    SEGMENTATION_SYSTEM_INSTRUCTION,
    /customers in HCM -> \{\"city\":\"HCM\"\}/,
  );
  assert.match(
    SEGMENTATION_SYSTEM_INSTRUCTION,
    /lead score over 80 -> \{\"lead_score_gt\":80\}/,
  );
});

test("segmentation instruction rejects unsupported concepts without guessing", () => {
  assert.match(
    SEGMENTATION_SYSTEM_INSTRUCTION,
    /high intent customers -> \{\} because high intent has no supported field/,
  );
  assert.match(
    SEGMENTATION_SYSTEM_INSTRUCTION,
    /If no supported filter remains, return \{\} so the application can reject the request/,
  );
  assert.match(
    SEGMENTATION_SYSTEM_INSTRUCTION,
    /Prefer fewer, safer filters over guessed filters/,
  );

  for (const unsupportedField of ["revenue", "last_purchase_date", "industry"]) {
    assert.ok(SEGMENTATION_SYSTEM_INSTRUCTION.includes(unsupportedField));
  }
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

  const contactMarker = "Recipient contact data (JSON):\n";
  const contactJson = JSON.parse(
    prompt.slice(prompt.indexOf(contactMarker) + contactMarker.length),
  );
  assert.deepEqual(Object.keys(contactJson), [
    "email",
    "first_name",
    "last_name",
    "properties",
  ]);
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

test("personalization instruction defines the senior lifecycle marketing role", () => {
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /senior lifecycle marketing copywriter/,
  );
  assert.match(PERSONALIZATION_SYSTEM_INSTRUCTION, /conversion-focused/);
});

test("personalization instruction keeps the complete no-hallucination rules", () => {
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Use only the campaign, template, and contact data provided in the prompt/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Never invent facts, offers, discounts, deadlines, revenue, purchase history, identities, analytics, or personal details that are not present in the provided data/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /never reference other people or other customers/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Use only the provided contact properties/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /When information is missing, write naturally without guessing/,
  );
});

test("personalization instruction preserves links, CTA, legal, footer, and unsubscribe", () => {
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Preserve every URL and link from the template/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Preserve unsubscribe, legal, compliance, and footer content/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Keep the template's existing call to action/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /never create or replace a CTA URL/,
  );
  assert.match(PERSONALIZATION_SYSTEM_INSTRUCTION, /Do not change legal links/);
});

test("personalization instruction sets personalization-depth rules", () => {
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /first name only when it is available/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Mention city, tags, or lead_score only when present and relevant/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Do not expose raw JSON or property names/,
  );
});

test("personalization instruction preserves template language and forbids spam", () => {
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Preserve the template's language; do not translate/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Avoid spammy wording, excessive punctuation, and misleading urgency/,
  );
});

test("personalization instruction still requires complete HTML output", () => {
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /Return one JSON object with subject, body_html, and optional body_text/,
  );
  assert.match(
    PERSONALIZATION_SYSTEM_INSTRUCTION,
    /body_html must be complete HTML email content/,
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
