export const CAMPAIGN_AI_CONTEXT_LIMITS = {
  goal: 500,
  tone: 100,
  cta: 300,
  audience_description: 500,
  language: 50,
} as const;

export type CampaignAiContextKey = keyof typeof CAMPAIGN_AI_CONTEXT_LIMITS;

export type CampaignAiContext = Partial<Record<CampaignAiContextKey, string>>;

const CAMPAIGN_AI_CONTEXT_KEYS = Object.keys(
  CAMPAIGN_AI_CONTEXT_LIMITS,
) as CampaignAiContextKey[];
const ALLOWED_CAMPAIGN_AI_CONTEXT_KEYS = new Set<string>(
  CAMPAIGN_AI_CONTEXT_KEYS,
);

export class CampaignAiContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignAiContextError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseCampaignAiContext(value: unknown): CampaignAiContext {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new CampaignAiContextError("ai_context must be a JSON object");
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_CAMPAIGN_AI_CONTEXT_KEYS.has(key)) {
      throw new CampaignAiContextError(`ai_context contains unsupported key: ${key}`);
    }
  }

  const context: CampaignAiContext = {};

  for (const key of CAMPAIGN_AI_CONTEXT_KEYS) {
    const fieldValue = value[key];

    if (fieldValue === undefined) {
      continue;
    }

    if (typeof fieldValue !== "string") {
      throw new CampaignAiContextError(`ai_context.${key} must be a string`);
    }

    const normalized = fieldValue.trim();

    if (normalized.length === 0) {
      continue;
    }

    const limit = CAMPAIGN_AI_CONTEXT_LIMITS[key];

    if (normalized.length > limit) {
      throw new CampaignAiContextError(
        `ai_context.${key} must be ${limit} characters or fewer`,
      );
    }

    context[key] = normalized;
  }

  return context;
}
