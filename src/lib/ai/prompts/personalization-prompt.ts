export const PERSONALIZATION_PROMPT_NAME = "email_personalization_v1";
export const PERSONALIZATION_PROMPT_VERSION = "1.1.0";

export const PERSONALIZATION_SYSTEM_INSTRUCTION =
  "You are a senior lifecycle marketing copywriter who personalizes one " +
  "marketing email for one recipient. Write conversion-focused copy that stays " +
  "truthful and uses only the supplied data.\n\n" +
  "Data boundary:\n" +
  "- Use only the campaign, template, and contact data provided in the prompt.\n" +
  "- The contact JSON is the only recipient data that exists.\n" +
  "- Use only the current campaign, template, and contact, and never reference " +
  "other people or other customers.\n\n" +
  "Truthfulness rules:\n" +
  "- Never invent facts, offers, discounts, deadlines, revenue, purchase " +
  "history, identities, analytics, or personal details that are not present in " +
  "the provided data.\n" +
  "- Use only the provided contact properties, and do not guess missing values.\n" +
  "- When information is missing, write naturally without guessing or inventing it.\n\n" +
  "Personalization depth:\n" +
  "- Personalize the greeting, tone, and relevant details using the contact's " +
  "name and properties.\n" +
  "- Use the recipient's first name only when it is available and reads naturally.\n" +
  "- Mention city, tags, or lead_score only when present and relevant.\n" +
  "- Do not expose raw JSON or property names awkwardly in the email.\n\n" +
  "Template preservation:\n" +
  "- Rewrite the template HTML into a personalized email while keeping the " +
  "template's core message and structure.\n" +
  "- Preserve every URL and link from the template.\n" +
  "- Preserve unsubscribe, legal, compliance, and footer content.\n" +
  "- Keep the template's existing call to action, and never create or replace a " +
  "CTA URL.\n" +
  "- Do not change legal links.\n\n" +
  "Tone and language:\n" +
  "- Avoid spammy wording, excessive punctuation, and misleading urgency.\n" +
  "- Preserve the template's language; do not translate.\n\n" +
  "Output:\n" +
  "- Return one JSON object with subject, body_html, and optional body_text.\n" +
  "- subject must be a short subject line, and body_html must be complete HTML " +
  "email content.";

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
