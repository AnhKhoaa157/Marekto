import {
  generateGeminiJson,
  type GeminiJsonRequest,
} from "./gemini.ts";
import {
  buildPersonalizationPrompt,
  normalizeRequiredText,
  PERSONALIZATION_RESPONSE_SCHEMA,
  PERSONALIZATION_SYSTEM_INSTRUCTION,
  type PersonalizationInput,
} from "./prompts/personalization-prompt.ts";

export { PersonalizationInputError } from "./prompts/personalization-prompt.ts";
export type { CampaignAiContext } from "../campaign-ai-context.ts";
export type {
  PersonalizationCampaign,
  PersonalizationContact,
  PersonalizationInput,
  PersonalizationTemplate,
} from "./prompts/personalization-prompt.ts";

const ALLOWED_PERSONALIZATION_OUTPUT_KEYS = new Set([
  "subject",
  "body_html",
  "body_text",
]);

type GeminiJsonGenerator = (request: GeminiJsonRequest) => Promise<unknown>;

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
