import {
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "../campaign-filters.ts";
import { isUuid } from "../identifiers.ts";

import {
  getCachedAiOutput,
  saveAiOutput,
  type CachedAiOutput,
} from "./cache.ts";
import {
  generateGeminiJson,
  GEMINI_MODEL,
  isGeminiProviderUnavailableError,
  type GeminiJsonRequest,
} from "./gemini.ts";
import { buildSegmentationRequest } from "./prompts/segmentation-prompt.ts";

const MAX_SEGMENTATION_PROMPT_LENGTH = 500;
const MAX_AI_TAG_FILTER_LENGTH = 40;
const AI_TAG_FILTER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;
const AI_TAG_FILTER_FORBIDDEN_WORDS_PATTERN =
  /\b(?:city|lead|score|recognized|recognised|customer|customers|condition|conditions|rule|rules)\b/i;
const SEGMENTATION_CACHE_FEATURE = "segmentation";
const SEGMENTATION_PROVIDER = "gemini";
const ALLOWED_SEGMENTATION_KEYS = new Set([
  "city",
  "lead_score_gt",
  "lead_score_gte",
  "lead_score_lt",
  "lead_score_lte",
  "tags_contains",
]);
const LEAD_SCORE_KEYS = new Set([
  "lead_score_gt",
  "lead_score_gte",
  "lead_score_lt",
  "lead_score_lte",
]);
const LEAD_SCORE_PATTERNS = [
  {
    key: "lead_score_gte",
    pattern: /\blead\s+score(?:\s+is)?\s+(?:at\s+least|greater\s+than\s+or\s+equal\s+to|gte|>=)\s*(\d+(?:\.\d+)?)\b/i,
  },
  {
    key: "lead_score_lte",
    pattern: /\blead\s+score(?:\s+is)?\s+(?:at\s+most|less\s+than\s+or\s+equal\s+to|lte|<=)\s*(\d+(?:\.\d+)?)\b/i,
  },
  {
    key: "lead_score_gt",
    pattern: /\blead\s+score(?:\s+is)?\s+(?:above|over|greater\s+than|gt|>)\s*(\d+(?:\.\d+)?)\b/i,
  },
  {
    key: "lead_score_lt",
    pattern: /\blead\s+score(?:\s+is)?\s+(?:below|under|less\s+than|lt|<)\s*(\d+(?:\.\d+)?)\b/i,
  },
] as const;

type GeminiJsonGenerator = (request: GeminiJsonRequest) => Promise<unknown>;
type SegmentationSource = "gemini" | "cache";

type SegmentationCacheReader = (
  workspaceId: string,
  feature: typeof SEGMENTATION_CACHE_FEATURE,
  inputText: string,
) => Promise<CachedAiOutput | null>;

type SegmentationCacheWriter = (input: {
  workspaceId: string;
  feature: typeof SEGMENTATION_CACHE_FEATURE;
  inputText: string;
  outputJson: CampaignTargetFilters;
  provider: typeof SEGMENTATION_PROVIDER;
  model: typeof GEMINI_MODEL;
}) => Promise<unknown>;

type GenerateAudienceWithCacheDependencies = {
  generateJson?: GeminiJsonGenerator;
  readCache?: SegmentationCacheReader;
  writeCache?: SegmentationCacheWriter;
};

export type AudienceGenerationResult = {
  targetFilters: CampaignTargetFilters;
  source: SegmentationSource;
};

export class SegmentationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentationInputError";
  }
}

export class SegmentationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SegmentationUnavailableError";
  }
}

export function parseSegmentationPrompt(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SegmentationInputError("Audience description is required");
  }

  const prompt = value.trim();

  if (prompt.length > MAX_SEGMENTATION_PROMPT_LENGTH) {
    throw new SegmentationInputError(
      `Audience description must be ${MAX_SEGMENTATION_PROMPT_LENGTH} characters or fewer`,
    );
  }

  return prompt;
}

function normalizeExplicitTag(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(customers?|contacts?|users?|audience)\b.*$/i, "")
    .trim();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_AI_TAG_FILTER_LENGTH ||
    !AI_TAG_FILTER_PATTERN.test(normalized) ||
    AI_TAG_FILTER_FORBIDDEN_WORDS_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function parseLeadScore(value: string): number | null {
  const leadScore = Number(value);

  if (!Number.isFinite(leadScore) || leadScore < 0 || leadScore > 100) {
    return null;
  }

  return leadScore;
}

function extractExplicitSegmentationFilters(prompt: string): CampaignTargetFilters {
  const filters: CampaignTargetFilters = {};
  const explicitTag = prompt.match(
    /\btag(?:s)?\s*(?:is|are|=|:|contains?)\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,39})(?=\.|,|;|\band\b|\bwith\b|$)/i,
  )?.[1];

  if (explicitTag) {
    const tag = normalizeExplicitTag(explicitTag);

    if (tag) {
      filters.tags_contains = tag;
    }
  } else if (/\bVIP\b/i.test(prompt)) {
    filters.tags_contains = "VIP";
  }

  if (
    /\b(?:city\s*(?:is|=|:)?\s*|in\s+)(?:HCM|Ho\s+Chi\s+Minh|Saigon)\b/i.test(
      prompt,
    )
  ) {
    filters.city = "HCM";
  }

  for (const { key, pattern } of LEAD_SCORE_PATTERNS) {
    const leadScoreValue = prompt.match(pattern)?.[1];

    if (!leadScoreValue) {
      continue;
    }

    const leadScore = parseLeadScore(leadScoreValue);

    if (leadScore !== null) {
      filters[key] = leadScore;
    }

    break;
  }

  return filters;
}

export function parseAiSegmentationFilters(
  value: unknown,
  promptValue?: string,
): CampaignTargetFilters {
  const filters = parseCampaignTargetFilters(value);
  const explicitFilters =
    typeof promptValue === "string"
      ? extractExplicitSegmentationFilters(promptValue)
      : {};

  Object.assign(filters, explicitFilters);

  const entries = Object.entries(filters);

  if (entries.length === 0) {
    throw new Error("Gemini returned an empty audience filter");
  }

  for (const [key, filterValue] of entries) {
    if (!ALLOWED_SEGMENTATION_KEYS.has(key)) {
      throw new Error(`Gemini returned an unsupported audience filter: ${key}`);
    }

    if (key === "city") {
      if (typeof filterValue !== "string" || filterValue.trim().length === 0) {
        throw new Error("Gemini returned an invalid city filter");
      }

      filters[key] = filterValue.trim();
    }

    if (key === "tags_contains") {
      if (typeof filterValue !== "string") {
        throw new Error("Gemini returned an invalid tag filter");
      }

      const tag = filterValue.trim();

      if (
        tag.length === 0 ||
        tag.length > MAX_AI_TAG_FILTER_LENGTH ||
        !AI_TAG_FILTER_PATTERN.test(tag) ||
        AI_TAG_FILTER_FORBIDDEN_WORDS_PATTERN.test(tag)
      ) {
        throw new Error("Gemini returned an invalid tag filter");
      }

      filters[key] = tag;
    }

    if (
      LEAD_SCORE_KEYS.has(key) &&
      (typeof filterValue !== "number" || filterValue < 0 || filterValue > 100)
    ) {
      throw new Error("Gemini returned a lead score outside the 0-100 range");
    }
  }

  return filters;
}

export async function generateAudienceFilters(
  promptValue: unknown,
  generateJson: GeminiJsonGenerator = generateGeminiJson,
): Promise<CampaignTargetFilters> {
  const prompt = parseSegmentationPrompt(promptValue);
  const output = await generateJson(buildSegmentationRequest(prompt));

  return parseAiSegmentationFilters(output, prompt);
}

export async function generateAudienceFiltersWithCache(
  workspaceId: string,
  promptValue: unknown,
  dependencies: GenerateAudienceWithCacheDependencies = {},
): Promise<AudienceGenerationResult> {
  if (!isUuid(workspaceId)) {
    throw new SegmentationInputError("Invalid workspace id");
  }

  const prompt = parseSegmentationPrompt(promptValue);
  const generateJson = dependencies.generateJson ?? generateGeminiJson;
  const readCache = dependencies.readCache ?? getCachedAiOutput;
  const writeCache = dependencies.writeCache ?? saveAiOutput;

  try {
    const output = await generateJson(buildSegmentationRequest(prompt));
    const targetFilters = parseAiSegmentationFilters(output, prompt);

    await writeCache({
      workspaceId,
      feature: SEGMENTATION_CACHE_FEATURE,
      inputText: prompt,
      outputJson: targetFilters,
      provider: SEGMENTATION_PROVIDER,
      model: GEMINI_MODEL,
    });

    return { targetFilters, source: "gemini" };
  } catch (error) {
    if (!isGeminiProviderUnavailableError(error)) {
      throw error;
    }

    const cached = await readCache(workspaceId, SEGMENTATION_CACHE_FEATURE, prompt);

    if (!cached) {
      throw new SegmentationUnavailableError(
        "AI audience builder is unavailable and no saved rules match this prompt",
      );
    }

    return {
      targetFilters: parseAiSegmentationFilters(cached.outputJson, prompt),
      source: "cache",
    };
  }
}
