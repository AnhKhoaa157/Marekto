import { createHmac } from "node:crypto";

/**
 * Server-only client for the internal Python data-intelligence service.
 *
 * Contract:
 *   - This module MUST only be imported from server code (route handlers,
 *     workers, server components). It reads secrets from the environment and
 *     never returns or logs their values, request signatures, or signed
 *     payloads.
 *   - Requests are authenticated with HMAC-SHA256 over
 *     `<unix-seconds>.<raw JSON body>` using the shared internal secret,
 *     matching `services/data-intelligence/app/security.py`.
 *   - Missing configuration, network failures, timeouts, and gateway errors
 *     surface as `DataIntelligenceUnavailableError` so callers can fall back
 *     to safe non-intelligence behavior instead of failing the request.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const UNAVAILABLE_STATUS_CODES = new Set([502, 503, 504]);

type DataIntelligenceEnvironment = Record<string, string | undefined>;

export type DataIntelligenceConfig = {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
};

export type DataIntelligenceDependencies = {
  env?: DataIntelligenceEnvironment;
  fetchImpl?: typeof fetch;
};

export class DataIntelligenceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataIntelligenceUnavailableError";
  }
}

export function isDataIntelligenceUnavailableError(
  error: unknown,
): error is DataIntelligenceUnavailableError {
  return error instanceof DataIntelligenceUnavailableError;
}

export type RawContactRow = {
  row_number: number;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  city?: string | null;
  tags?: string[];
  lead_score?: number | null;
  properties?: Record<string, unknown>;
};

export type NormalizeContactsInput = {
  rows: RawContactRow[];
};

export type NormalizedContactRow = {
  row_number: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  tags: string[];
  lead_score: number | null;
  properties: Record<string, unknown>;
  warnings: string[];
};

export type RejectedContactRow = {
  row_number: number;
  reasons: string[];
};

export type NormalizeContactsResult = {
  accepted: NormalizedContactRow[];
  rejected: RejectedContactRow[];
  duplicate_emails: string[];
  total_rows: number;
};

export type LeadScoreInput = {
  email_valid?: boolean | null;
  has_phone?: boolean | null;
  city?: string | null;
  tags?: string[];
  prior_sent_count?: number;
  prior_failed_count?: number;
};

export type LeadScoreFactor = {
  name: string;
  impact: number;
  reason: string;
};

export type LeadScoreResult = {
  score: number;
  labels: string[];
  factors: LeadScoreFactor[];
  model_version: string;
};

export type SegmentDimension = "city" | "tag" | "lead_score_band";

export type SegmentOutcomeInput = {
  dimension: SegmentDimension;
  label: string;
  sent_count: number;
  failed_count: number;
};

export type CampaignAnalyticsInput = {
  sent_count: number;
  failed_count: number;
  segments?: SegmentOutcomeInput[];
  min_sample_size?: number;
  high_failure_threshold?: number;
};

export type SegmentInsight = {
  dimension: SegmentDimension;
  label: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  failure_rate: number;
  sufficient_sample: boolean;
};

export type CampaignRecommendation = {
  type: string;
  message: string;
  evidence: Record<string, string | number>;
};

export type CampaignAnalyticsResult = {
  total_count: number;
  sent_count: number;
  failed_count: number;
  failure_rate: number;
  insufficient_data: boolean;
  segments: SegmentInsight[];
  high_failure_segments: SegmentInsight[];
  recommendations: CampaignRecommendation[];
};

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeoutMs = Number(value);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error(
      "DATA_INTELLIGENCE_TIMEOUT_MS must be an integer between 1000 and 120000",
    );
  }

  return timeoutMs;
}

export function resolveDataIntelligenceConfig(
  env: DataIntelligenceEnvironment = process.env,
): DataIntelligenceConfig {
  const baseUrlRaw = env.DATA_INTELLIGENCE_BASE_URL?.trim();

  if (!baseUrlRaw) {
    throw new DataIntelligenceUnavailableError(
      "DATA_INTELLIGENCE_BASE_URL is required",
    );
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrlRaw);
  } catch {
    throw new DataIntelligenceUnavailableError(
      "DATA_INTELLIGENCE_BASE_URL is not a valid URL",
    );
  }

  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new DataIntelligenceUnavailableError(
      "DATA_INTELLIGENCE_BASE_URL must use http or https",
    );
  }

  const secret = env.DATA_INTELLIGENCE_INTERNAL_SECRET?.trim();

  if (!secret) {
    throw new DataIntelligenceUnavailableError(
      "DATA_INTELLIGENCE_INTERNAL_SECRET is required",
    );
  }

  return {
    baseUrl: baseUrlRaw.replace(/\/+$/, ""),
    secret,
    timeoutMs: parseTimeout(env.DATA_INTELLIGENCE_TIMEOUT_MS),
  };
}

export function buildDataIntelligenceSignature(
  secret: string,
  timestamp: string,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${digest}`;
}

function sanitizeDataIntelligenceError(message: string, secret: string): string {
  return message.replaceAll(secret, "***");
}

async function readErrorMessage(path: string, response: Response): Promise<string> {
  const body = (await response.text()).trim();

  if (body.length === 0) {
    return `Data intelligence ${path} failed with status ${response.status}`;
  }

  return `Data intelligence ${path} failed with status ${response.status}: ${body.slice(0, 500)}`;
}

async function postDataIntelligenceJson(
  path: string,
  payload: unknown,
  dependencies: DataIntelligenceDependencies,
): Promise<unknown> {
  const config = resolveDataIntelligenceConfig(dependencies.env);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-marekto-timestamp": timestamp,
        "x-marekto-signature": buildDataIntelligenceSignature(
          config.secret,
          timestamp,
          body,
        ),
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorMessage = sanitizeDataIntelligenceError(
        await readErrorMessage(path, response),
        config.secret,
      );

      if (UNAVAILABLE_STATUS_CODES.has(response.status)) {
        throw new DataIntelligenceUnavailableError(errorMessage);
      }

      throw new Error(errorMessage);
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error(`Data intelligence ${path} returned invalid JSON`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new DataIntelligenceUnavailableError(
        `Data intelligence request timed out after ${config.timeoutMs}ms`,
      );
    }

    if (error instanceof DataIntelligenceUnavailableError) {
      throw error;
    }

    const message = sanitizeDataIntelligenceError(
      error instanceof Error ? error.message : "Data intelligence request failed",
      config.secret,
    );

    if (error instanceof TypeError) {
      throw new DataIntelligenceUnavailableError(message);
    }

    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

function expectResponseObject(
  payload: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`Data intelligence ${path} returned an invalid response`);
  }

  return payload as Record<string, unknown>;
}

export async function normalizeContacts(
  input: NormalizeContactsInput,
  dependencies: DataIntelligenceDependencies = {},
): Promise<NormalizeContactsResult> {
  const path = "/v1/contacts/normalize";
  const payload = expectResponseObject(
    await postDataIntelligenceJson(path, input, dependencies),
    path,
  );

  if (
    !Array.isArray(payload.accepted) ||
    !Array.isArray(payload.rejected) ||
    !Array.isArray(payload.duplicate_emails) ||
    typeof payload.total_rows !== "number"
  ) {
    throw new Error(`Data intelligence ${path} returned an invalid response`);
  }

  return payload as unknown as NormalizeContactsResult;
}

export async function scoreLead(
  input: LeadScoreInput,
  dependencies: DataIntelligenceDependencies = {},
): Promise<LeadScoreResult> {
  const path = "/v1/leads/score";
  const payload = expectResponseObject(
    await postDataIntelligenceJson(path, input, dependencies),
    path,
  );

  if (
    typeof payload.score !== "number" ||
    !Array.isArray(payload.labels) ||
    !Array.isArray(payload.factors) ||
    typeof payload.model_version !== "string"
  ) {
    throw new Error(`Data intelligence ${path} returned an invalid response`);
  }

  return payload as unknown as LeadScoreResult;
}

export async function analyzeCampaign(
  input: CampaignAnalyticsInput,
  dependencies: DataIntelligenceDependencies = {},
): Promise<CampaignAnalyticsResult> {
  const path = "/v1/campaigns/analyze";
  const payload = expectResponseObject(
    await postDataIntelligenceJson(path, input, dependencies),
    path,
  );

  if (
    typeof payload.total_count !== "number" ||
    typeof payload.failure_rate !== "number" ||
    typeof payload.insufficient_data !== "boolean" ||
    !Array.isArray(payload.segments) ||
    !Array.isArray(payload.recommendations)
  ) {
    throw new Error(`Data intelligence ${path} returned an invalid response`);
  }

  return payload as unknown as CampaignAnalyticsResult;
}
