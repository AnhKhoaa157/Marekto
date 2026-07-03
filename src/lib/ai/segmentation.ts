import {
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "../campaign-filters.ts";

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

type GeminiJsonGenerator = (request: GeminiJsonRequest) => Promise<unknown>;
type SegmentationSource = "gemini" | "cache";

type SegmentationCacheReader = (
  workspaceId: number,
  feature: typeof SEGMENTATION_CACHE_FEATURE,
  inputText: string,
) => Promise<CachedAiOutput | null>;

type SegmentationCacheWriter = (input: {
  workspaceId: number;
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

export function parseAiSegmentationFilters(value: unknown): CampaignTargetFilters {
  const filters = parseCampaignTargetFilters(value);
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

  return parseAiSegmentationFilters(output);
}

export async function generateAudienceFiltersWithCache(
  workspaceId: number,
  promptValue: unknown,
  dependencies: GenerateAudienceWithCacheDependencies = {},
): Promise<AudienceGenerationResult> {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new SegmentationInputError("Invalid workspace id");
  }

  const prompt = parseSegmentationPrompt(promptValue);
  const generateJson = dependencies.generateJson ?? generateGeminiJson;
  const readCache = dependencies.readCache ?? getCachedAiOutput;
  const writeCache = dependencies.writeCache ?? saveAiOutput;

  try {
    const output = await generateJson(buildSegmentationRequest(prompt));
    const targetFilters = parseAiSegmentationFilters(output);

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
      targetFilters: parseAiSegmentationFilters(cached.outputJson),
      source: "cache",
    };
  }
}
