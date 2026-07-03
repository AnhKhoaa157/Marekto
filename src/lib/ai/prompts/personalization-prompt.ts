export const PERSONALIZATION_PROMPT_NAME = "email_personalization_v1";
export const PERSONALIZATION_PROMPT_VERSION = "1.0.0";

export const PERSONALIZATION_SYSTEM_INSTRUCTION =
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

export const PERSONALIZATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    subject: { type: "STRING" },
    body_html: { type: "STRING" },
    body_text: { type: "STRING" },
  },
  required: ["subject", "body_html"],
};

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

export class PersonalizationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalizationInputError";
  }
}

export function normalizeRequiredText(name: string, value: unknown): string {
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

export function buildPersonalizationPrompt(input: PersonalizationInput): string {
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
