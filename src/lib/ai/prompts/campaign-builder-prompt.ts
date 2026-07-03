import type { GeminiJsonRequest } from "../gemini.ts";

export const CAMPAIGN_BUILDER_PROMPT_NAME = "campaign_builder_v1";
export const CAMPAIGN_BUILDER_PROMPT_VERSION = "1.0.0";

/**
 * Fields the builder accepts from the authenticated user. These are the only
 * inputs sent to the AI provider; no workspace contact records are ever
 * included in the prompt.
 */
export type CampaignBuilderInput = {
  productOrService: string;
  campaignGoal: string;
  targetAudiencePrompt: string;
  tone?: string;
  offerOrCTA?: string;
  schedulePreference?: string;
  enablePersonalization: boolean;
};

export const CAMPAIGN_BUILDER_SYSTEM_INSTRUCTION =
  "You are a senior marketing strategist and email copywriter. Turn one " +
  "marketing campaign idea into a single JSON campaign package that a human " +
  "will review and edit before anything is saved or sent.\n\n" +
  "Draft-only boundary:\n" +
  "- The generated campaign package is a draft for the user to review and edit.\n" +
  "- Never claim that the email was sent or scheduled.\n" +
  "- Do not auto-send or auto-schedule; the user saves drafts and schedules " +
  "delivery manually later.\n\n" +
  "Data boundary:\n" +
  "- Use only the builder inputs provided in this request.\n" +
  "- You do not receive and must not request contact records, contact rows, or " +
  "any workspace data.\n" +
  "- The audience field is a description only; it never contains real contacts.\n\n" +
  "Truthfulness rules:\n" +
  "- Never invent delivery results, metrics, revenue, customer behavior, " +
  "analytics, purchase history, or personal data.\n" +
  "- Never invent legal guarantees, compliance claims, or certifications.\n" +
  "- You may use the user's offer or call-to-action text, but never invent a " +
  "call-to-action URL when none is supplied.\n" +
  "- Never create hidden tracking pixels or unsafe scripts, and never add " +
  "<script> tags.\n\n" +
  "Audience filters:\n" +
  "- targetFilters may only use city, lead_score_gt, lead_score_gte, " +
  "lead_score_lt, lead_score_lte, and tags_contains. Conditions are combined " +
  "with AND.\n" +
  "- city is a city string; map HCM, Ho Chi Minh, and Saigon to HCM.\n" +
  "- lead_score_gt, lead_score_gte, lead_score_lt, and lead_score_lte are " +
  "numbers from 0 to 100.\n" +
  "- tags_contains is one short literal tag value only, such as VIP.\n" +
  "- If the described audience has no supported filter, return an empty " +
  "targetFilters object and explain the limitation in warnings. Never invent " +
  "unsupported fields such as revenue, industry, or last_purchase_date.\n\n" +
  "Email HTML:\n" +
  "- emailHtml must be complete, valid, and editable HTML email content.\n" +
  "- Keep the structure simple and safe: no scripts, no external tracking, no " +
  "hidden pixels.\n\n" +
  "Warnings:\n" +
  "- Use warnings to explain any unsupported or uncertain request, such as an " +
  "audience concept that cannot become a supported filter.\n\n" +
  "Output:\n" +
  "- Return one JSON object with campaignName, brief, audienceExplanation, " +
  "targetFilters, subjectIdeas, emailHtml, aiContext, scheduleNotes, and " +
  "warnings. Never add explanations outside the JSON or unsupported keys.";

export const CAMPAIGN_BUILDER_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    campaignName: { type: "STRING" },
    brief: { type: "STRING" },
    audienceExplanation: { type: "STRING" },
    targetFilters: {
      type: "OBJECT",
      properties: {
        city: { type: "STRING" },
        lead_score_gt: { type: "NUMBER", minimum: 0, maximum: 100 },
        lead_score_gte: { type: "NUMBER", minimum: 0, maximum: 100 },
        lead_score_lt: { type: "NUMBER", minimum: 0, maximum: 100 },
        lead_score_lte: { type: "NUMBER", minimum: 0, maximum: 100 },
        tags_contains: { type: "STRING" },
      },
    },
    subjectIdeas: { type: "ARRAY", items: { type: "STRING" } },
    emailHtml: { type: "STRING" },
    aiContext: {
      type: "OBJECT",
      properties: {
        goal: { type: "STRING" },
        tone: { type: "STRING" },
        cta: { type: "STRING" },
        audience_description: { type: "STRING" },
        language: { type: "STRING" },
      },
    },
    scheduleNotes: { type: "STRING" },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: [
    "campaignName",
    "brief",
    "audienceExplanation",
    "subjectIdeas",
    "emailHtml",
    "scheduleNotes",
  ],
};

function formatOptional(label: string, value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? `${label}: ${normalized}\n` : "";
}

export function buildCampaignBuilderRequest(
  input: CampaignBuilderInput,
): GeminiJsonRequest {
  const prompt =
    `Product or service: ${input.productOrService}\n` +
    `Campaign goal: ${input.campaignGoal}\n` +
    `Target audience description: ${input.targetAudiencePrompt}\n` +
    formatOptional("Tone", input.tone) +
    formatOptional("Offer or call to action", input.offerOrCTA) +
    formatOptional("Schedule preference", input.schedulePreference) +
    `AI personalization enabled at delivery: ${input.enablePersonalization ? "yes" : "no"}\n\n` +
    "Generate the reviewable campaign package as one JSON object using only the " +
    "information above.";

  return {
    prompt,
    systemInstruction: CAMPAIGN_BUILDER_SYSTEM_INSTRUCTION,
    responseSchema: CAMPAIGN_BUILDER_RESPONSE_SCHEMA,
  };
}
