import {
  parseCampaignAiContext,
  type CampaignAiContext,
} from "../campaign-ai-context.ts";
import {
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "../campaign-filters.ts";

import { generateGeminiJson, type GeminiJsonRequest } from "./gemini.ts";
import {
  buildCampaignBuilderRequest,
  type CampaignBuilderInput,
} from "./prompts/campaign-builder-prompt.ts";

export type { CampaignBuilderInput } from "./prompts/campaign-builder-prompt.ts";

const REQUIRED_INPUT_FIELDS = [
  "productOrService",
  "campaignGoal",
  "targetAudiencePrompt",
] as const;
const OPTIONAL_INPUT_FIELDS = [
  "tone",
  "offerOrCTA",
  "schedulePreference",
] as const;

export const CAMPAIGN_BUILDER_INPUT_LIMITS = {
  productOrService: 200,
  campaignGoal: 300,
  targetAudiencePrompt: 500,
  tone: 100,
  offerOrCTA: 300,
  schedulePreference: 200,
} as const;

const ALLOWED_INPUT_KEYS = new Set<string>([
  ...REQUIRED_INPUT_FIELDS,
  ...OPTIONAL_INPUT_FIELDS,
  "enablePersonalization",
]);

const ALLOWED_OUTPUT_KEYS = new Set<string>([
  "campaignName",
  "brief",
  "audienceExplanation",
  "targetFilters",
  "subjectIdeas",
  "emailHtml",
  "aiContext",
  "scheduleNotes",
  "warnings",
]);

const ALLOWED_BUILDER_FILTER_KEYS = new Set<string>([
  "city",
  "lead_score_gt",
  "lead_score_gte",
  "lead_score_lt",
  "lead_score_lte",
  "tags_contains",
]);

const CAMPAIGN_NAME_MAX_LENGTH = 150;
const BRIEF_MAX_LENGTH = 2_000;
const AUDIENCE_EXPLANATION_MAX_LENGTH = 1_500;
const SUBJECT_MAX_LENGTH = 200;
const MAX_SUBJECT_IDEAS = 6;
const EMAIL_HTML_MAX_LENGTH = 40_000;
const SCHEDULE_NOTES_MAX_LENGTH = 800;
const WARNING_MAX_LENGTH = 400;
const MAX_WARNINGS = 12;
const HTML_TAG_PATTERN = /<[a-z!/][\s\S]*>/i;
const DANGEROUS_HTML_TAG_PATTERN =
  /<(?:script|iframe|object|embed|form|input|button|meta|base|svg|math)\b/i;
const EVENT_HANDLER_ATTRIBUTE_PATTERN =
  /\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SRCDOC_ATTRIBUTE_PATTERN =
  /\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const QUOTED_URL_ATTRIBUTE_PATTERN =
  /\s+(href|src|background|action|formaction)\s*=\s*(["'])([\s\S]*?)\2/gi;
const UNQUOTED_URL_ATTRIBUTE_PATTERN =
  /\s+(href|src|background|action|formaction)\s*=\s*([^\s>]+)/gi;

export type CampaignBuilderPackage = {
  campaignName: string;
  brief: string;
  audienceExplanation: string;
  targetFilters: CampaignTargetFilters;
  filtersValid: boolean;
  subjectIdeas: string[];
  emailHtml: string;
  aiContext: CampaignAiContext;
  scheduleNotes: string;
  warnings: string[];
};

type GeminiJsonGenerator = (request: GeminiJsonRequest) => Promise<unknown>;

export class CampaignBuilderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignBuilderInputError";
  }
}

export class CampaignBuilderOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignBuilderOutputError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeRequiredInput(
  key: (typeof REQUIRED_INPUT_FIELDS)[number],
  value: unknown,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CampaignBuilderInputError(`${key} is required`);
  }

  const normalized = value.trim();
  const limit = CAMPAIGN_BUILDER_INPUT_LIMITS[key];

  if (normalized.length > limit) {
    throw new CampaignBuilderInputError(
      `${key} must be ${limit} characters or fewer`,
    );
  }

  return normalized;
}

function normalizeOptionalInput(
  key: (typeof OPTIONAL_INPUT_FIELDS)[number],
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CampaignBuilderInputError(`${key} must be a string`);
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return undefined;
  }

  const limit = CAMPAIGN_BUILDER_INPUT_LIMITS[key];

  if (normalized.length > limit) {
    throw new CampaignBuilderInputError(
      `${key} must be ${limit} characters or fewer`,
    );
  }

  return normalized;
}

export function parseCampaignBuilderInput(value: unknown): CampaignBuilderInput {
  if (!isPlainObject(value)) {
    throw new CampaignBuilderInputError("Request body must be a JSON object");
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      throw new CampaignBuilderInputError(
        `Unsupported request field: ${key}`,
      );
    }
  }

  const enablePersonalizationValue = value.enablePersonalization;

  if (
    enablePersonalizationValue !== undefined &&
    typeof enablePersonalizationValue !== "boolean"
  ) {
    throw new CampaignBuilderInputError(
      "enablePersonalization must be a boolean",
    );
  }

  const input: CampaignBuilderInput = {
    productOrService: normalizeRequiredInput(
      "productOrService",
      value.productOrService,
    ),
    campaignGoal: normalizeRequiredInput("campaignGoal", value.campaignGoal),
    targetAudiencePrompt: normalizeRequiredInput(
      "targetAudiencePrompt",
      value.targetAudiencePrompt,
    ),
    enablePersonalization: enablePersonalizationValue === true,
  };

  const tone = normalizeOptionalInput("tone", value.tone);
  const offerOrCTA = normalizeOptionalInput("offerOrCTA", value.offerOrCTA);
  const schedulePreference = normalizeOptionalInput(
    "schedulePreference",
    value.schedulePreference,
  );

  if (tone !== undefined) {
    input.tone = tone;
  }

  if (offerOrCTA !== undefined) {
    input.offerOrCTA = offerOrCTA;
  }

  if (schedulePreference !== undefined) {
    input.schedulePreference = schedulePreference;
  }

  return input;
}

function normalizeOutputText(
  key: string,
  value: unknown,
  limit: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CampaignBuilderOutputError(`Gemini returned an invalid ${key}`);
  }

  const normalized = value.trim();

  if (normalized.length > limit) {
    throw new CampaignBuilderOutputError(`Gemini returned an oversized ${key}`);
  }

  return normalized;
}

function parseSubjectIdeas(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CampaignBuilderOutputError(
      "Gemini returned no usable subject ideas",
    );
  }

  if (value.length > MAX_SUBJECT_IDEAS) {
    throw new CampaignBuilderOutputError(
      "Gemini returned too many subject ideas",
    );
  }

  return value.map((subject) =>
    normalizeOutputText("subject idea", subject, SUBJECT_MAX_LENGTH),
  );
}

function isUnsafeHtmlUrl(value: string): boolean {
  const normalized = value
    .replace(/&(?:#x0*3a|#0*58|colon);?/gi, ":")
    .replace(/[\u0000-\u0020]+/g, "")
    .toLowerCase();

  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html")
  );
}

function parseEmailHtml(value: unknown): {
  html: string;
  sanitized: boolean;
} {
  const html = normalizeOutputText("email HTML", value, EMAIL_HTML_MAX_LENGTH);

  if (!HTML_TAG_PATTERN.test(html)) {
    throw new CampaignBuilderOutputError(
      "Gemini returned email content that is not valid HTML",
    );
  }

  if (/<script[\s>]/i.test(html)) {
    throw new CampaignBuilderOutputError(
      "Gemini returned email HTML containing a script tag",
    );
  }

  if (DANGEROUS_HTML_TAG_PATTERN.test(html)) {
    throw new CampaignBuilderOutputError(
      "Gemini returned email HTML containing unsafe elements",
    );
  }

  let sanitized = html.replace(EVENT_HANDLER_ATTRIBUTE_PATTERN, "");
  sanitized = sanitized.replace(SRCDOC_ATTRIBUTE_PATTERN, "");
  sanitized = sanitized.replace(
    QUOTED_URL_ATTRIBUTE_PATTERN,
    (attribute, name: string, quote: string, url: string) =>
      isUnsafeHtmlUrl(url) ? "" : ` ${name}=${quote}${url}${quote}`,
  );
  sanitized = sanitized.replace(
    UNQUOTED_URL_ATTRIBUTE_PATTERN,
    (attribute, name: string, url: string) =>
      isUnsafeHtmlUrl(url) ? "" : ` ${name}=${url}`,
  );

  return { html: sanitized, sanitized: sanitized !== html };
}

function parseWarnings(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new CampaignBuilderOutputError(
      "Gemini returned warnings in an invalid shape",
    );
  }

  if (value.length > MAX_WARNINGS) {
    throw new CampaignBuilderOutputError("Gemini returned too many warnings");
  }

  return value.map((warning) =>
    normalizeOutputText("warning", warning, WARNING_MAX_LENGTH),
  );
}

function isSafeBuilderFilterValue(key: string, value: unknown): boolean {
  if (key === "city") {
    return typeof value === "string" && value.trim().length > 0;
  }

  if (key === "tags_contains") {
    return (
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= 40
    );
  }

  // Lead-score operators: a finite number constrained to the 0-100 contract.
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

/**
 * Keeps only the supported, individually valid audience filters. Unsupported
 * keys and invalid values are dropped and reported so the builder can return a
 * safe partial package instead of a silently altered audience.
 */
function sanitizeBuilderFilters(value: unknown): {
  filters: CampaignTargetFilters;
  droppedKeys: string[];
} {
  if (value === undefined || value === null) {
    return { filters: {}, droppedKeys: [] };
  }

  if (!isPlainObject(value)) {
    throw new CampaignBuilderOutputError(
      "Gemini returned target filters in an invalid shape",
    );
  }

  const safe: Record<string, unknown> = {};
  const droppedKeys: string[] = [];

  for (const [key, filterValue] of Object.entries(value)) {
    if (
      ALLOWED_BUILDER_FILTER_KEYS.has(key) &&
      isSafeBuilderFilterValue(key, filterValue)
    ) {
      safe[key] = filterValue;
      continue;
    }

    droppedKeys.push(key);
  }

  // Re-validate the retained subset through the canonical campaign filter
  // parser so the builder shares one contract with the campaigns API.
  return { filters: parseCampaignTargetFilters(safe), droppedKeys };
}

export function parseCampaignBuilderPackage(
  value: unknown,
): CampaignBuilderPackage {
  if (!isPlainObject(value)) {
    throw new CampaignBuilderOutputError(
      "Gemini returned an invalid campaign package",
    );
  }

  for (const key of Object.keys(value)) {
    if (!ALLOWED_OUTPUT_KEYS.has(key)) {
      throw new CampaignBuilderOutputError(
        `Gemini returned an unsupported field: ${key}`,
      );
    }
  }

  const campaignName = normalizeOutputText(
    "campaign name",
    value.campaignName,
    CAMPAIGN_NAME_MAX_LENGTH,
  );
  const brief = normalizeOutputText("brief", value.brief, BRIEF_MAX_LENGTH);
  const audienceExplanation = normalizeOutputText(
    "audience explanation",
    value.audienceExplanation,
    AUDIENCE_EXPLANATION_MAX_LENGTH,
  );
  const subjectIdeas = parseSubjectIdeas(value.subjectIdeas);
  const emailHtml = parseEmailHtml(value.emailHtml);
  const scheduleNotes = normalizeOutputText(
    "schedule notes",
    value.scheduleNotes,
    SCHEDULE_NOTES_MAX_LENGTH,
  );

  let aiContext: CampaignAiContext;
  try {
    aiContext = parseCampaignAiContext(value.aiContext);
  } catch (error) {
    throw new CampaignBuilderOutputError(
      error instanceof Error
        ? `Gemini returned an invalid ai_context: ${error.message}`
        : "Gemini returned an invalid ai_context",
    );
  }

  const warnings = parseWarnings(value.warnings);
  const { filters, droppedKeys } = sanitizeBuilderFilters(value.targetFilters);

  if (emailHtml.sanitized) {
    warnings.unshift(
      "Unsafe HTML attributes were removed from the generated email draft. Review all links before saving the template.",
    );
  }

  if (droppedKeys.length > 0) {
    warnings.push(
      `Some suggested audience filters were unsupported and removed (${droppedKeys.join(", ")}). Review and correct the audience before saving a campaign draft.`,
    );
  }

  return {
    campaignName,
    brief,
    audienceExplanation,
    targetFilters: filters,
    filtersValid: droppedKeys.length === 0,
    subjectIdeas,
    emailHtml: emailHtml.html,
    aiContext,
    scheduleNotes,
    warnings: warnings.slice(0, MAX_WARNINGS),
  };
}

export async function generateCampaignPackage(
  rawInput: unknown,
  generateJson: GeminiJsonGenerator = generateGeminiJson,
): Promise<CampaignBuilderPackage> {
  const input = parseCampaignBuilderInput(rawInput);
  const output = await generateJson(buildCampaignBuilderRequest(input));

  return parseCampaignBuilderPackage(output);
}
