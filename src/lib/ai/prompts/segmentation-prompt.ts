import type { GeminiJsonRequest } from "../gemini.ts";

export const SEGMENTATION_PROMPT_NAME = "segmentation_v1";
export const SEGMENTATION_PROMPT_VERSION = "1.1.0";

export const SEGMENTATION_SYSTEM_INSTRUCTION =
  "Convert the user's audience description into one JSON object for a marketing " +
  "contact filter. Use only city, lead_score_gt, lead_score_gte, lead_score_lt, " +
  "lead_score_lte, and tags_contains. Conditions are combined with AND.\n\n" +
  "Allowed fields:\n" +
  "- city: a city string. Map HCM, Ho Chi Minh, and Saigon to HCM.\n" +
  "- lead_score_gt: lead score strictly above or over a number from 0 to 100.\n" +
  "- lead_score_gte: lead score at least a number from 0 to 100.\n" +
  "- lead_score_lt: lead score strictly below a number from 0 to 100.\n" +
  "- lead_score_lte: lead score at most a number from 0 to 100.\n" +
  "- tags_contains: one short tag value, not the full audience request.\n\n" +
  "Examples:\n" +
  "- VIP customers -> {\"tags_contains\":\"VIP\"}\n" +
  "- customers in HCM -> {\"city\":\"HCM\"}\n" +
  "- lead score over 80 -> {\"lead_score_gt\":80}\n" +
  "- high intent customers -> {} because high intent has no supported field.\n\n" +
  "Ignore unsupported concepts when supported filters remain. If no supported " +
  "filter remains, return {} so the application can reject the request. Prefer " +
  "fewer, safer filters over guessed filters. Never invent fields such as revenue, " +
  "last_purchase_date, or industry. Never add explanations, SQL, contact records, " +
  "or unsupported keys.";

export const SEGMENTATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    city: { type: "STRING" },
    lead_score_gt: { type: "NUMBER", minimum: 0, maximum: 100 },
    lead_score_gte: { type: "NUMBER", minimum: 0, maximum: 100 },
    lead_score_lt: { type: "NUMBER", minimum: 0, maximum: 100 },
    lead_score_lte: { type: "NUMBER", minimum: 0, maximum: 100 },
    tags_contains: { type: "STRING" },
  },
};

export function buildSegmentationRequest(prompt: string): GeminiJsonRequest {
  return {
    prompt,
    systemInstruction: SEGMENTATION_SYSTEM_INSTRUCTION,
    responseSchema: SEGMENTATION_RESPONSE_SCHEMA,
  };
}
