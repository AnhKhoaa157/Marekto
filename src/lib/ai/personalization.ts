import {
  generateGeminiJson,
  type GeminiJsonRequest,
} from "./gemini.ts";

const ALLOWED_PERSONALIZATION_OUTPUT_KEYS = new Set([
  "subject",
  "body_html",
  "body_text",
]);

const PERSONALIZATION_SYSTEM_INSTRUCTION =
  "You personalize one marketing email for one recipient. Use only the " +
  "campaign, template, and contact data provided in the prompt; the contact " +
  "JSON is the only recipient data that exists. Rewrite the template HTML " +
  "into a personalized email for this contact. Keep the template's core " +
  "message, structure, links, and any legal or unsubscribe content intact. " +
  "Personalize the greeting, tone, and relevant details using the contact's " +
  "name, email, and properties. Never invent facts, offers, discounts, or " +
  "personal details that are not present in the provided data, and never " +
  "reference other people or other customers. Return one JSON object with " +
  "subject, body_html, and optional body_text. subject must be a short " +
  "subject line and body_html must be complete HTML email content.";

const PERSONALIZATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    subject: { type: "STRING" },
    body_html: { type: "STRING" },
    body_text: { type: "STRING" },
  },
  required: ["subject", "body_html"],
};

type GeminiJsonGenerator = (request: GeminiJsonRequest) => Promise<unknown>;

export type PersonalizationCampaign = {
  name: string;
};

export type PersonalizationTemplate = {
  bodyHtml: string;
};

export type PersonalizationContact = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  properties: unknown;
};

export type PersonalizationInput = {
  campaign: PersonalizationCampaign;
  template: PersonalizationTemplate;
  contact: PersonalizationContact;
};

export type PersonalizedEmailContent = {
  subject: string;
  body_html: string;
  body_text?: string;
};

export type CampaignEmailContentSource = "gemini" | "template";

export type ResolvedCampaignEmailContent = {
  subject: string;
  html: string;
  text: string | null;
  source: CampaignEmailContentSource;
  personalizationError: string | null;
};

export class PersonalizationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalizationInputError";
  }
}

function normalizeRequiredText(name: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PersonalizationInputError(`${name} is required`);
  }

  return value.trim();
}

function normalizeOptionalName(name: string, value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new PersonalizationInputError(`${name} must be a string or null`);
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function normalizeContactProperties(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new PersonalizationInputError(
      "Contact properties must be a JSON object",
    );
  }

  return value as Record<string, unknown>;
}

function buildPersonalizationPrompt(input: PersonalizationInput): string {
  const campaignName = normalizeRequiredText("Campaign name", input.campaign.name);
  const templateHtml = normalizeRequiredText(
    "Template HTML",
    input.template.bodyHtml,
  );
  const contactJson = JSON.stringify({
    email: normalizeRequiredText("Contact email", input.contact.email),
    first_name: normalizeOptionalName(
      "Contact first name",
      input.contact.firstName,
    ),
    last_name: normalizeOptionalName("Contact last name", input.contact.lastName),
    properties: normalizeContactProperties(input.contact.properties),
  });

  return (
    `Campaign name: ${campaignName}\n\n` +
    `Email template HTML:\n${templateHtml}\n\n` +
    `Recipient contact data (JSON):\n${contactJson}`
  );
}

export function parsePersonalizedEmailContent(
  value: unknown,
): PersonalizedEmailContent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Gemini returned an invalid personalization payload");
  }

  const payload = value as Record<string, unknown>;

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_PERSONALIZATION_OUTPUT_KEYS.has(key)) {
      throw new Error(
        `Gemini returned an unsupported personalization field: ${key}`,
      );
    }
  }

  if (typeof payload.subject !== "string" || payload.subject.trim().length === 0) {
    throw new Error("Gemini returned an invalid personalized subject");
  }

  if (
    typeof payload.body_html !== "string" ||
    payload.body_html.trim().length === 0
  ) {
    throw new Error("Gemini returned invalid personalized email HTML");
  }

  const content: PersonalizedEmailContent = {
    subject: payload.subject.trim(),
    body_html: payload.body_html.trim(),
  };

  if (payload.body_text !== undefined) {
    if (typeof payload.body_text !== "string") {
      throw new Error("Gemini returned an invalid personalized text body");
    }

    const bodyText = payload.body_text.trim();

    if (bodyText.length > 0) {
      content.body_text = bodyText;
    }
  }

  return content;
}

export async function generatePersonalizedEmail(
  input: PersonalizationInput,
  generateJson: GeminiJsonGenerator = generateGeminiJson,
): Promise<PersonalizedEmailContent> {
  const prompt = buildPersonalizationPrompt(input);
  const output = await generateJson({
    prompt,
    systemInstruction: PERSONALIZATION_SYSTEM_INSTRUCTION,
    responseSchema: PERSONALIZATION_RESPONSE_SCHEMA,
  });

  return parsePersonalizedEmailContent(output);
}

export async function resolveCampaignDeliveryContent(
  input: PersonalizationInput,
  aiPersonalizationEnabled: boolean,
  generateJson: GeminiJsonGenerator = generateGeminiJson,
): Promise<ResolvedCampaignEmailContent> {
  if (!aiPersonalizationEnabled) {
    return {
      subject: normalizeRequiredText("Campaign name", input.campaign.name),
      html: normalizeRequiredText("Template HTML", input.template.bodyHtml),
      text: null,
      source: "template",
      personalizationError: null,
    };
  }

  return resolveCampaignEmailContent(input, generateJson);
}

export async function resolveCampaignEmailContent(
  input: PersonalizationInput,
  generateJson: GeminiJsonGenerator = generateGeminiJson,
): Promise<ResolvedCampaignEmailContent> {
  const fallbackSubject = normalizeRequiredText(
    "Campaign name",
    input.campaign.name,
  );
  const fallbackHtml = normalizeRequiredText(
    "Template HTML",
    input.template.bodyHtml,
  );

  normalizeRequiredText("Contact email", input.contact.email);

  try {
    const personalized = await generatePersonalizedEmail(input, generateJson);

    return {
      subject: personalized.subject,
      html: personalized.body_html,
      text: personalized.body_text ?? null,
      source: "gemini",
      personalizationError: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI personalization failed";

    return {
      subject: fallbackSubject,
      html: fallbackHtml,
      text: null,
      source: "template",
      personalizationError: message,
    };
  }
}
