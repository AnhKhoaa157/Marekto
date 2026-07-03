import type { GeminiJsonRequest } from "../gemini.ts";

export const SEGMENTATION_PROMPT_NAME = "segmentation_v1";
export const SEGMENTATION_PROMPT_VERSION = "1.0.0";

export const SEGMENTATION_SYSTEM_INSTRUCTION =
  "Convert the user's audience description into one JSON object for a marketing " +
  "contact filter. Use only city, lead_score_gt, lead_score_gte, lead_score_lt, " +
  "lead_score_lte, and tags_contains. Conditions are combined with AND. " +
  "Map HCM, Ho Chi Minh, and Saigon to city HCM. Map VIP wording to " +
  "tags_contains VIP instead of copying the full sentence. Map above or over " +
  "a lead score to lead_score_gt, at least to lead_score_gte, below to " +
  "lead_score_lt, and at most to lead_score_lte. tags_contains must be a short " +
  "tag value, not the full audience request. Never add explanations, SQL, " +
  "contact records, or unsupported keys.";

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
