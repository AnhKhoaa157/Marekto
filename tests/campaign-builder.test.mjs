import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_BUILDER_PROMPT_NAME,
  CAMPAIGN_BUILDER_PROMPT_VERSION,
  CAMPAIGN_BUILDER_RESPONSE_SCHEMA,
  CAMPAIGN_BUILDER_SYSTEM_INSTRUCTION,
  buildCampaignBuilderRequest,
} from "../src/lib/ai/prompts/campaign-builder-prompt.ts";
import {
  CampaignBuilderInputError,
  CampaignBuilderOutputError,
  generateCampaignPackage,
  parseCampaignBuilderInput,
  parseCampaignBuilderPackage,
} from "../src/lib/ai/campaign-builder.ts";
import {
  CampaignBuilderDraftError,
  buildCampaignDraftRequest,
  buildTemplateDraftRequest,
} from "../src/lib/campaign-builder-draft.ts";
import { TEMPLATE_ID } from "./test-ids.mjs";

const VALID_INPUT = {
  productOrService: "Online English course for beginners",
  campaignGoal: "Increase signups for the July cohort",
  targetAudiencePrompt:
    "Contacts in HCM with lead score over 70 and interested in education",
  tone: "Friendly, motivating, professional",
  offerOrCTA: "Register now to get 20% off",
  schedulePreference: "Send this Friday morning",
  enablePersonalization: true,
};

function validOutput(overrides = {}) {
  return {
    campaignName: "July Beginner English Signup Push",
    brief:
      "Promote the July beginner English cohort to high-intent education contacts.",
    audienceExplanation:
      "Targets HCM contacts with lead score above 70 and an education interest tag.",
    targetFilters: { city: "HCM", lead_score_gt: 70, tags_contains: "education" },
    subjectIdeas: [
      "Start speaking English this July",
      "Save 20% on your beginner English course",
    ],
    emailHtml: "<!doctype html><html><body><p>Hi {{first_name}}</p></body></html>",
    aiContext: {
      goal: "Increase signups for the July cohort",
      tone: "Friendly, motivating, professional",
      cta: "Register now to get 20% off",
      audience_description: "HCM education contacts",
      language: "English",
    },
    scheduleNotes: "Recommended: Friday morning. Save as draft first.",
    warnings: [],
    ...overrides,
  };
}

// --- Prompt module ---------------------------------------------------------

test("campaign builder prompt exposes an explicit name and version", () => {
  assert.equal(CAMPAIGN_BUILDER_PROMPT_NAME, "campaign_builder_v1");
  assert.equal(CAMPAIGN_BUILDER_PROMPT_VERSION, "1.0.0");
});

test("campaign builder instruction keeps the required safety rules", () => {
  const rules = [
    /draft for the user to review and edit/,
    /Never claim that the email was sent or scheduled/,
    /Do not auto-send or auto-schedule/,
    /must not request contact records/,
    /Never invent delivery results, metrics, revenue, customer behavior, analytics, purchase history, or personal data/,
    /Never invent legal guarantees/,
    /never invent a call-to-action URL when none is supplied/,
    /Never create hidden tracking pixels or unsafe scripts/,
    /emailHtml must be complete, valid, and editable/,
    /Use warnings to explain any unsupported or uncertain request/,
  ];

  for (const rule of rules) {
    assert.match(CAMPAIGN_BUILDER_SYSTEM_INSTRUCTION, rule);
  }

  for (const field of [
    "city",
    "lead_score_gt",
    "lead_score_gte",
    "lead_score_lt",
    "lead_score_lte",
    "tags_contains",
  ]) {
    assert.ok(CAMPAIGN_BUILDER_SYSTEM_INSTRUCTION.includes(field));
  }
});

test("campaign builder response schema declares the package contract", () => {
  assert.equal(CAMPAIGN_BUILDER_RESPONSE_SCHEMA.type, "OBJECT");
  assert.deepEqual(CAMPAIGN_BUILDER_RESPONSE_SCHEMA.required, [
    "campaignName",
    "brief",
    "audienceExplanation",
    "subjectIdeas",
    "emailHtml",
    "scheduleNotes",
  ]);
  assert.deepEqual(Object.keys(CAMPAIGN_BUILDER_RESPONSE_SCHEMA.properties), [
    "campaignName",
    "brief",
    "audienceExplanation",
    "targetFilters",
    "subjectIdeas",
    "emailHtml",
    "aiContext",
    "scheduleNotes",
    "warnings",
  ]);
});

test("campaign builder request builder embeds inputs and never contact rows", () => {
  const request = buildCampaignBuilderRequest(parseCampaignBuilderInput(VALID_INPUT));

  assert.equal(request.systemInstruction, CAMPAIGN_BUILDER_SYSTEM_INSTRUCTION);
  assert.equal(request.responseSchema, CAMPAIGN_BUILDER_RESPONSE_SCHEMA);
  assert.match(request.prompt, /Online English course for beginners/);
  assert.match(request.prompt, /Increase signups for the July cohort/);
  assert.match(request.prompt, /AI personalization enabled at delivery: yes/);
  assert.doesNotMatch(request.prompt, /"email"|"properties"|contact record/i);
});

test("campaign builder request omits empty optional fields", () => {
  const request = buildCampaignBuilderRequest(
    parseCampaignBuilderInput({
      productOrService: "A",
      campaignGoal: "B",
      targetAudiencePrompt: "C",
    }),
  );

  assert.doesNotMatch(request.prompt, /Tone:/);
  assert.doesNotMatch(request.prompt, /Offer or call to action:/);
  assert.match(request.prompt, /AI personalization enabled at delivery: no/);
});

// --- Input validation ------------------------------------------------------

test("parseCampaignBuilderInput normalizes a full valid request", () => {
  const parsed = parseCampaignBuilderInput({
    ...VALID_INPUT,
    productOrService: "  Online English course  ",
  });

  assert.equal(parsed.productOrService, "Online English course");
  assert.equal(parsed.enablePersonalization, true);
  assert.equal(parsed.tone, "Friendly, motivating, professional");
});

test("parseCampaignBuilderInput accepts a minimal request", () => {
  const parsed = parseCampaignBuilderInput({
    productOrService: "A",
    campaignGoal: "B",
    targetAudiencePrompt: "C",
  });

  assert.equal(parsed.enablePersonalization, false);
  assert.equal(Object.hasOwn(parsed, "tone"), false);
  assert.equal(Object.hasOwn(parsed, "offerOrCTA"), false);
});

test("parseCampaignBuilderInput rejects missing required fields", () => {
  for (const key of ["productOrService", "campaignGoal", "targetAudiencePrompt"]) {
    assert.throws(
      () => parseCampaignBuilderInput({ ...VALID_INPUT, [key]: "   " }),
      CampaignBuilderInputError,
    );
  }
});

test("parseCampaignBuilderInput rejects arrays and non-objects", () => {
  assert.throws(() => parseCampaignBuilderInput([]), CampaignBuilderInputError);
  assert.throws(() => parseCampaignBuilderInput("nope"), CampaignBuilderInputError);
  assert.throws(() => parseCampaignBuilderInput(null), CampaignBuilderInputError);
});

test("parseCampaignBuilderInput rejects unsupported keys including workspace_id", () => {
  assert.throws(
    () => parseCampaignBuilderInput({ ...VALID_INPUT, workspace_id: 9 }),
    /Unsupported request field: workspace_id/,
  );
});

test("parseCampaignBuilderInput enforces booleans and length limits", () => {
  assert.throws(
    () => parseCampaignBuilderInput({ ...VALID_INPUT, enablePersonalization: "yes" }),
    /enablePersonalization must be a boolean/,
  );
  assert.throws(
    () =>
      parseCampaignBuilderInput({
        ...VALID_INPUT,
        productOrService: "x".repeat(201),
      }),
    /productOrService must be 200 characters or fewer/,
  );
});

// --- Output validation -----------------------------------------------------

test("parseCampaignBuilderPackage accepts a valid package", () => {
  const result = parseCampaignBuilderPackage(validOutput());

  assert.equal(result.campaignName, "July Beginner English Signup Push");
  assert.equal(result.filtersValid, true);
  assert.deepEqual(result.targetFilters, {
    city: "HCM",
    lead_score_gt: 70,
    tags_contains: "education",
  });
  assert.equal(result.subjectIdeas.length, 2);
  assert.deepEqual(result.warnings, []);
});

test("parseCampaignBuilderPackage rejects unsupported output keys", () => {
  assert.throws(
    () => parseCampaignBuilderPackage(validOutput({ tracking_pixel: "x" })),
    /unsupported field: tracking_pixel/,
  );
});

test("parseCampaignBuilderPackage rejects malformed required fields", () => {
  assert.throws(
    () => parseCampaignBuilderPackage(validOutput({ campaignName: "   " })),
    CampaignBuilderOutputError,
  );
  assert.throws(
    () => parseCampaignBuilderPackage("not an object"),
    CampaignBuilderOutputError,
  );
});

test("parseCampaignBuilderPackage bounds and validates subject ideas", () => {
  assert.throws(
    () => parseCampaignBuilderPackage(validOutput({ subjectIdeas: [] })),
    /no usable subject ideas/,
  );
  assert.throws(
    () =>
      parseCampaignBuilderPackage(
        validOutput({ subjectIdeas: ["a", "b", "c", "d", "e", "f", "g"] }),
      ),
    /too many subject ideas/,
  );
  assert.throws(
    () => parseCampaignBuilderPackage(validOutput({ subjectIdeas: ["ok", 5] })),
    CampaignBuilderOutputError,
  );
});

test("parseCampaignBuilderPackage enforces HTML requirements", () => {
  assert.throws(
    () => parseCampaignBuilderPackage(validOutput({ emailHtml: "no tags here" })),
    /not valid HTML/,
  );
  assert.throws(
    () =>
      parseCampaignBuilderPackage(
        validOutput({ emailHtml: "<p>hi</p><script>alert(1)</script>" }),
      ),
    /script tag/,
  );
});

test("parseCampaignBuilderPackage sanitizes unsafe HTML attributes", () => {
  const result = parseCampaignBuilderPackage(
    validOutput({
      emailHtml:
        '<html><body onload="steal()"><a href="javascript:steal()" onclick="steal()">Join</a><p>Safe</p></body></html>',
    }),
  );

  assert.doesNotMatch(result.emailHtml, /onload|onclick|javascript:/i);
  assert.match(result.emailHtml, /<p>Safe<\/p>/);
  assert.match(result.warnings[0], /Unsafe HTML attributes were removed/);
});

test("parseCampaignBuilderPackage rejects dangerous HTML elements", () => {
  assert.throws(
    () =>
      parseCampaignBuilderPackage(
        validOutput({
          emailHtml:
            '<html><body><iframe src="https://example.com"></iframe></body></html>',
        }),
      ),
    /unsafe elements/,
  );
});

test("parseCampaignBuilderPackage bounds warnings", () => {
  assert.throws(
    () =>
      parseCampaignBuilderPackage(
        validOutput({ warnings: Array.from({ length: 13 }, () => "w") }),
      ),
    /too many warnings/,
  );
  assert.throws(
    () => parseCampaignBuilderPackage(validOutput({ warnings: ["ok", 3] })),
    CampaignBuilderOutputError,
  );
});

test("parseCampaignBuilderPackage validates ai_context with the shared parser", () => {
  assert.throws(
    () =>
      parseCampaignBuilderPackage(validOutput({ aiContext: { unsupported: "x" } })),
    /invalid ai_context/,
  );
  const empty = parseCampaignBuilderPackage(validOutput({ aiContext: undefined }));
  assert.deepEqual(empty.aiContext, {});
});

test("parseCampaignBuilderPackage keeps a safe partial package with a filter warning", () => {
  const result = parseCampaignBuilderPackage(
    validOutput({
      targetFilters: {
        city: "HCM",
        revenue_gt: 1000,
        industry: "education",
        lead_score_gt: 200,
      },
    }),
  );

  assert.deepEqual(result.targetFilters, { city: "HCM" });
  assert.equal(result.filtersValid, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /unsupported and removed/);
  // The useful package survives even though filters need review.
  assert.equal(result.emailHtml.length > 0, true);
  assert.equal(result.campaignName, "July Beginner English Signup Push");
});

test("parseCampaignBuilderPackage drops unsafe tag arrays but keeps valid filters", () => {
  const result = parseCampaignBuilderPackage(
    validOutput({ targetFilters: { tags_contains: ["a", "b"], city: "HCM" } }),
  );

  assert.deepEqual(result.targetFilters, { city: "HCM" });
  assert.equal(result.filtersValid, false);
});

test("parseCampaignBuilderPackage treats missing filters as all contacts", () => {
  const result = parseCampaignBuilderPackage(validOutput({ targetFilters: undefined }));

  assert.deepEqual(result.targetFilters, {});
  assert.equal(result.filtersValid, true);
});

// --- generateCampaignPackage -----------------------------------------------

test("generateCampaignPackage validates input, calls the provider, and parses output", async () => {
  let calls = 0;
  let capturedRequest;
  const result = await generateCampaignPackage(VALID_INPUT, async (request) => {
    calls += 1;
    capturedRequest = request;
    return validOutput();
  });

  assert.equal(calls, 1);
  assert.equal(result.campaignName, "July Beginner English Signup Push");
  assert.match(capturedRequest.prompt, /Online English course for beginners/);
});

test("generateCampaignPackage rejects invalid input before calling the provider", async () => {
  let called = false;
  await assert.rejects(
    generateCampaignPackage({ campaignGoal: "only goal" }, async () => {
      called = true;
      return validOutput();
    }),
    CampaignBuilderInputError,
  );
  assert.equal(called, false);
});

// --- Draft mapping ---------------------------------------------------------

test("buildTemplateDraftRequest maps reviewed name, HTML, and metadata", () => {
  const request = buildTemplateDraftRequest({
    name: "  July push  ",
    emailHtml: "<p>Hello</p>",
    brief: "Promote July cohort",
    selectedSubject: "Start speaking English",
  });

  assert.equal(request.name, "July push");
  assert.equal(request.body_html, "<p>Hello</p>");
  assert.deepEqual(request.body_json, {
    source: "campaign-builder",
    brief: "Promote July cohort",
    subject: "Start speaking English",
  });
});

test("buildTemplateDraftRequest requires a name and HTML", () => {
  assert.throws(
    () => buildTemplateDraftRequest({ name: "  ", emailHtml: "<p>x</p>" }),
    CampaignBuilderDraftError,
  );
  assert.throws(
    () => buildTemplateDraftRequest({ name: "x", emailHtml: "   " }),
    CampaignBuilderDraftError,
  );
});

test("buildCampaignDraftRequest always produces a draft with no schedule", () => {
  const request = buildCampaignDraftRequest({
    name: "July push",
    templateId: TEMPLATE_ID,
    useAllContacts: false,
    filtersValid: true,
    targetFilters: { city: "HCM", lead_score_gt: 70 },
    enablePersonalization: true,
    aiContext: { goal: "Increase signups", tone: "Friendly" },
  });

  assert.equal(request.status, "draft");
  assert.equal(request.scheduled_at, null);
  assert.equal(request.template_id, TEMPLATE_ID);
  assert.equal(request.ai_personalization_enabled, true);
  assert.deepEqual(request.target_filters, { city: "HCM", lead_score_gt: 70 });
  assert.deepEqual(request.ai_context, { goal: "Increase signups", tone: "Friendly" });
});

test("buildCampaignDraftRequest supports an explicit all-contacts choice", () => {
  const request = buildCampaignDraftRequest({
    name: "Broadcast",
    templateId: null,
    useAllContacts: true,
    filtersValid: false,
    targetFilters: { city: "HCM" },
    enablePersonalization: false,
    aiContext: {},
  });

  assert.deepEqual(request.target_filters, {});
  assert.equal(request.template_id, null);
});

test("buildCampaignDraftRequest blocks unsafe or empty audiences", () => {
  assert.throws(
    () =>
      buildCampaignDraftRequest({
        name: "x",
        templateId: null,
        useAllContacts: false,
        filtersValid: false,
        targetFilters: { city: "HCM" },
        enablePersonalization: false,
        aiContext: {},
      }),
    /Correct the flagged audience filters/,
  );
  assert.throws(
    () =>
      buildCampaignDraftRequest({
        name: "x",
        templateId: null,
        useAllContacts: false,
        filtersValid: true,
        targetFilters: {},
        enablePersonalization: false,
        aiContext: {},
      }),
    /Choose an audience or explicitly send to all contacts/,
  );
});

test("buildCampaignDraftRequest rejects invalid template ids", () => {
  assert.throws(
    () =>
      buildCampaignDraftRequest({
        name: "x",
        templateId: 0,
        useAllContacts: true,
        filtersValid: true,
        targetFilters: {},
        enablePersonalization: false,
        aiContext: {},
      }),
    /Invalid template id/,
  );
});
