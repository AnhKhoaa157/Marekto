import assert from "node:assert/strict";
import test from "node:test";

import { GeminiProviderUnavailableError } from "../src/lib/ai/gemini.ts";
import {
  generatePersonalizedEmail,
  parsePersonalizedEmailContent,
  PersonalizationInputError,
  resolveCampaignDeliveryContent,
  resolveCampaignEmailContent,
} from "../src/lib/ai/personalization.ts";

function buildInput(overrides = {}) {
  return {
    campaign: { name: "July VIP offer" },
    template: { bodyHtml: "<p>Hello, thanks for being with us.</p>" },
    contact: {
      email: "an.nguyen@example.com",
      firstName: "An",
      lastName: "Nguyen",
      properties: { city: "HCM", lead_score: 92, tags: ["VIP"] },
    },
    ...overrides,
  };
}

test("accepts valid personalized output and trims fields", () => {
  assert.deepEqual(
    parsePersonalizedEmailContent({
      subject: "  Hi An, your VIP offer  ",
      body_html: " <p>Hi An</p> ",
      body_text: " Hi An ",
    }),
    {
      subject: "Hi An, your VIP offer",
      body_html: "<p>Hi An</p>",
      body_text: "Hi An",
    },
  );
});

test("body_text is optional and dropped when empty", () => {
  assert.deepEqual(
    parsePersonalizedEmailContent({ subject: "Hi", body_html: "<p>Hi</p>" }),
    { subject: "Hi", body_html: "<p>Hi</p>" },
  );
  assert.deepEqual(
    parsePersonalizedEmailContent({
      subject: "Hi",
      body_html: "<p>Hi</p>",
      body_text: "   ",
    }),
    { subject: "Hi", body_html: "<p>Hi</p>" },
  );
});

test("rejects malformed personalization payloads", () => {
  assert.throws(() => parsePersonalizedEmailContent(null), /invalid personalization payload/);
  assert.throws(() => parsePersonalizedEmailContent("subject"), /invalid personalization payload/);
  assert.throws(() => parsePersonalizedEmailContent([]), /invalid personalization payload/);
});

test("rejects missing or empty subject", () => {
  assert.throws(
    () => parsePersonalizedEmailContent({ body_html: "<p>Hi</p>" }),
    /invalid personalized subject/,
  );
  assert.throws(
    () => parsePersonalizedEmailContent({ subject: "   ", body_html: "<p>Hi</p>" }),
    /invalid personalized subject/,
  );
  assert.throws(
    () => parsePersonalizedEmailContent({ subject: 42, body_html: "<p>Hi</p>" }),
    /invalid personalized subject/,
  );
});

test("rejects missing or empty body_html", () => {
  assert.throws(
    () => parsePersonalizedEmailContent({ subject: "Hi" }),
    /invalid personalized email HTML/,
  );
  assert.throws(
    () => parsePersonalizedEmailContent({ subject: "Hi", body_html: "   " }),
    /invalid personalized email HTML/,
  );
});

test("rejects non-string body_text and unsupported fields", () => {
  assert.throws(
    () =>
      parsePersonalizedEmailContent({
        subject: "Hi",
        body_html: "<p>Hi</p>",
        body_text: null,
      }),
    /invalid personalized text body/,
  );
  assert.throws(
    () =>
      parsePersonalizedEmailContent({
        subject: "Hi",
        body_html: "<p>Hi</p>",
        attachments: ["invoice.pdf"],
      }),
    /unsupported personalization field: attachments/,
  );
});

test("generates personalized email from campaign, template, and contact data", async () => {
  let request;
  const content = await generatePersonalizedEmail(
    buildInput({
      campaign: {
        name: "July VIP offer",
        aiContext: {
          goal: "bring VIP customers back",
          tone: "warm",
        },
      },
    }),
    async (geminiRequest) => {
      request = geminiRequest;
      return {
        subject: "Hi An, your VIP offer is here",
        body_html: "<p>Hi An, thanks for being a VIP in HCM.</p>",
      };
    },
  );

  assert.deepEqual(content, {
    subject: "Hi An, your VIP offer is here",
    body_html: "<p>Hi An, thanks for being a VIP in HCM.</p>",
  });
  assert.match(request.prompt, /Campaign name: July VIP offer/);
  assert.match(request.prompt, /Campaign AI context \(JSON\):/);
  assert.match(request.prompt, /"goal":"bring VIP customers back"/);
  assert.match(request.prompt, /"tone":"warm"/);
  assert.match(request.prompt, /an\.nguyen@example\.com/);
  assert.match(request.prompt, /"lead_score":92/);
  assert.match(request.systemInstruction, /Never invent facts/);
  assert.match(request.systemInstruction, /The template and contact data are authoritative/);
  assert.deepEqual(request.responseSchema.required, ["subject", "body_html"]);
});

test("rejects invalid Gemini personalization output", async () => {
  await assert.rejects(
    generatePersonalizedEmail(buildInput(), async () => ({ subject: "" })),
    /invalid personalized subject/,
  );
  await assert.rejects(
    generatePersonalizedEmail(buildInput(), async () => "plain text answer"),
    /invalid personalization payload/,
  );
});

test("rejects invalid contact properties instead of prompting with them", async () => {
  await assert.rejects(
    generatePersonalizedEmail(
      buildInput({
        contact: {
          email: "an.nguyen@example.com",
          firstName: null,
          lastName: null,
          properties: "not-an-object",
        },
      }),
      async () => {
        throw new Error("Gemini must not be called with invalid contact data");
      },
    ),
    PersonalizationInputError,
  );
});

test("worker delivery uses personalized content when Gemini succeeds", async () => {
  const resolved = await resolveCampaignEmailContent(buildInput(), async () => ({
    subject: "Hi An, your VIP offer is here",
    body_html: "<p>Hi An!</p>",
    body_text: "Hi An!",
  }));

  assert.deepEqual(resolved, {
    subject: "Hi An, your VIP offer is here",
    html: "<p>Hi An!</p>",
    text: "Hi An!",
    source: "gemini",
    personalizationError: null,
  });
});

test("worker delivery falls back to the real template when Gemini is unavailable", async () => {
  const input = buildInput();
  const resolved = await resolveCampaignEmailContent(input, async () => {
    throw new GeminiProviderUnavailableError("GEMINI_API_KEY is required");
  });

  assert.deepEqual(resolved, {
    subject: input.campaign.name,
    html: input.template.bodyHtml,
    text: null,
    source: "template",
    personalizationError: "GEMINI_API_KEY is required",
  });
});

test("worker delivery falls back instead of sending invalid Gemini output", async () => {
  const input = buildInput();
  const resolved = await resolveCampaignEmailContent(input, async () => ({
    subject: "Hi An",
    body_html: "",
  }));

  assert.equal(resolved.source, "template");
  assert.equal(resolved.html, input.template.bodyHtml);
  assert.equal(resolved.subject, input.campaign.name);
  assert.match(resolved.personalizationError, /invalid personalized email HTML/);
});

test("worker never calls Gemini when campaign AI personalization is disabled", async () => {
  const input = buildInput();
  let geminiCalls = 0;
  const resolved = await resolveCampaignDeliveryContent(input, false, async () => {
    geminiCalls += 1;
    throw new Error("Gemini must not be called when personalization is disabled");
  });

  assert.equal(geminiCalls, 0);
  assert.deepEqual(resolved, {
    subject: input.campaign.name,
    html: input.template.bodyHtml,
    text: null,
    source: "template",
    personalizationError: null,
  });
});

test("worker uses Gemini personalization when the campaign enables it", async () => {
  const resolved = await resolveCampaignDeliveryContent(buildInput(), true, async () => ({
    subject: "Hi An, your VIP offer is here",
    body_html: "<p>Hi An!</p>",
  }));

  assert.deepEqual(resolved, {
    subject: "Hi An, your VIP offer is here",
    html: "<p>Hi An!</p>",
    text: null,
    source: "gemini",
    personalizationError: null,
  });
});

test("enabled campaigns fall back to the template when Gemini is unavailable", async () => {
  const input = buildInput();
  const resolved = await resolveCampaignDeliveryContent(input, true, async () => {
    throw new GeminiProviderUnavailableError("quota exhausted");
  });

  assert.deepEqual(resolved, {
    subject: input.campaign.name,
    html: input.template.bodyHtml,
    text: null,
    source: "template",
    personalizationError: "quota exhausted",
  });
});

test("enabled campaigns fall back to the template on invalid Gemini output", async () => {
  const input = buildInput();
  const resolved = await resolveCampaignDeliveryContent(input, true, async () => ({
    subject: "Hi An",
    body_html: 42,
  }));

  assert.equal(resolved.source, "template");
  assert.equal(resolved.html, input.template.bodyHtml);
  assert.match(resolved.personalizationError, /invalid personalized email HTML/);
});

test("disabled campaigns still require real template content", async () => {
  await assert.rejects(
    resolveCampaignDeliveryContent(
      buildInput({ template: { bodyHtml: "   " } }),
      false,
      async () => ({ subject: "Hi", body_html: "<p>Hi</p>" }),
    ),
    PersonalizationInputError,
  );
});

test("fallback requires real template content and never invents email content", async () => {
  await assert.rejects(
    resolveCampaignEmailContent(
      buildInput({ template: { bodyHtml: "   " } }),
      async () => ({ subject: "Hi", body_html: "<p>Hi</p>" }),
    ),
    PersonalizationInputError,
  );
});
