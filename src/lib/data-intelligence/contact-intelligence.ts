import {
  isDataIntelligenceUnavailableError,
  normalizeContacts,
  scoreLead,
  type DataIntelligenceDependencies,
  type RawContactRow,
} from "./client.ts";

/**
 * Server-only contact enrichment through the internal data-intelligence
 * service.
 *
 * Contract for intelligence keys merged into `"Contacts".properties`:
 *   - city, tags: normalized values (set only when present)
 *   - lead_score, lead_score_labels, lead_score_factors, lead_score_version:
 *     the deterministic rule-based score from the Python service
 *   - normalization_warnings: set only when non-empty
 *   - data_intelligence_status: "scored" | "unavailable"
 *
 * Safety:
 *   - `enrichContactRecord` never throws. Any configuration, network,
 *     timeout, or invalid-payload failure returns the record unchanged with
 *     only `data_intelligence_status: "unavailable"` added, so contact CRUD
 *     keeps working when the Python service is down.
 *   - Service output is re-validated here before it is persisted.
 *   - User-submitted properties are preserved; only the contract keys above
 *     are written.
 *   - Only the fields needed for normalization and scoring are sent to the
 *     service; free-form user properties are not.
 */

const MAX_TAG_HINTS = 50;

export type ContactRecordInput = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  properties: Record<string, unknown>;
};

export type ContactIntelligenceStatus = "scored" | "unavailable";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function extractCityHint(properties: Record<string, unknown>): string | undefined {
  const city = properties.city;

  if (typeof city !== "string") {
    return undefined;
  }

  const trimmed = city.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractTagHints(properties: Record<string, unknown>): string[] {
  const tags = properties.tags;

  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    .slice(0, MAX_TAG_HINTS);
}

function extractLeadScoreHint(properties: Record<string, unknown>): number | undefined {
  const leadScore = properties.lead_score;

  if (typeof leadScore === "number" && Number.isInteger(leadScore) && leadScore >= 0 && leadScore <= 100) {
    return leadScore;
  }

  return undefined;
}

type ValidatedNormalizedRow = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  city: string | null;
  tags: string[];
  warnings: string[];
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validateNormalizedRow(row: unknown): ValidatedNormalizedRow {
  if (typeof row !== "object" || row === null) {
    throw new Error("Data intelligence returned an invalid normalized row");
  }

  const candidate = row as Record<string, unknown>;

  if (
    typeof candidate.email !== "string" ||
    candidate.email.trim().length === 0 ||
    !isNullableString(candidate.first_name) ||
    !isNullableString(candidate.last_name) ||
    !isNullableString(candidate.phone) ||
    !isNullableString(candidate.city) ||
    !isStringArray(candidate.tags) ||
    !isStringArray(candidate.warnings)
  ) {
    throw new Error("Data intelligence returned an invalid normalized row");
  }

  return {
    email: candidate.email,
    firstName: candidate.first_name,
    lastName: candidate.last_name,
    phone: candidate.phone,
    city: candidate.city,
    tags: candidate.tags,
    warnings: candidate.warnings,
  };
}

type ValidatedLeadScore = {
  score: number;
  labels: string[];
  factors: Array<{ name: string; impact: number; reason: string }>;
  modelVersion: string;
};

function validateLeadScore(result: unknown): ValidatedLeadScore {
  if (typeof result !== "object" || result === null) {
    throw new Error("Data intelligence returned an invalid lead score");
  }

  const candidate = result as Record<string, unknown>;

  if (
    typeof candidate.score !== "number" ||
    !Number.isInteger(candidate.score) ||
    candidate.score < 0 ||
    candidate.score > 100 ||
    !isStringArray(candidate.labels) ||
    !Array.isArray(candidate.factors) ||
    typeof candidate.model_version !== "string" ||
    candidate.model_version.trim().length === 0
  ) {
    throw new Error("Data intelligence returned an invalid lead score");
  }

  const factors = candidate.factors.map((factor) => {
    if (typeof factor !== "object" || factor === null) {
      throw new Error("Data intelligence returned an invalid lead score factor");
    }

    const { name, impact, reason } = factor as Record<string, unknown>;

    if (
      typeof name !== "string" ||
      typeof impact !== "number" ||
      !Number.isFinite(impact) ||
      typeof reason !== "string"
    ) {
      throw new Error("Data intelligence returned an invalid lead score factor");
    }

    return { name, impact, reason };
  });

  return {
    score: candidate.score,
    labels: candidate.labels,
    factors,
    modelVersion: candidate.model_version,
  };
}

function markUnavailable(record: ContactRecordInput): ContactRecordInput {
  return {
    ...record,
    properties: {
      ...record.properties,
      data_intelligence_status: "unavailable" satisfies ContactIntelligenceStatus,
    },
  };
}

export async function enrichContactRecord(
  record: ContactRecordInput,
  dependencies: DataIntelligenceDependencies = {},
): Promise<ContactRecordInput> {
  try {
    const cityHint = extractCityHint(record.properties);
    const tagHints = extractTagHints(record.properties);
    const leadScoreHint = extractLeadScoreHint(record.properties);

    const row: RawContactRow = {
      row_number: 1,
      email: record.email,
      first_name: record.firstName,
      last_name: record.lastName,
      phone: record.phone,
      ...(cityHint !== undefined ? { city: cityHint } : {}),
      ...(tagHints.length > 0 ? { tags: tagHints } : {}),
      ...(leadScoreHint !== undefined ? { lead_score: leadScoreHint } : {}),
    };

    const normalization = await normalizeContacts({ rows: [row] }, dependencies);

    let normalized: ValidatedNormalizedRow | null = null;
    let warnings: string[] = [];

    if (normalization.accepted.length === 1) {
      normalized = validateNormalizedRow(normalization.accepted[0]);
      warnings = normalized.warnings;
    } else if (normalization.rejected.length === 1) {
      // The service rejects rows it cannot trust (e.g. invalid email). The
      // contact is still saved with user-submitted values; the rejection
      // reasons become warnings and reachability scores accordingly.
      const reasons = (normalization.rejected[0] as { reasons?: unknown }).reasons;
      warnings = isStringArray(reasons) ? reasons : [];
    } else {
      throw new Error("Data intelligence returned an unexpected normalization result");
    }

    const city = normalized ? normalized.city : (cityHint ?? null);
    const tags = normalized ? normalized.tags : tagHints;
    const phone = normalized ? normalized.phone : record.phone;

    const score = validateLeadScore(
      await scoreLead(
        {
          email_valid: normalized !== null,
          has_phone: phone !== null,
          ...(city !== null ? { city } : {}),
          ...(tags.length > 0 ? { tags } : {}),
        },
        dependencies,
      ),
    );

    const properties: Record<string, unknown> = { ...record.properties };

    if (city !== null) {
      properties.city = city;
    }

    if (tags.length > 0) {
      properties.tags = tags;
    }

    if (warnings.length > 0) {
      properties.normalization_warnings = warnings;
    }

    properties.lead_score = score.score;
    properties.lead_score_labels = score.labels;
    properties.lead_score_factors = score.factors;
    properties.lead_score_version = score.modelVersion;
    properties.data_intelligence_status = "scored" satisfies ContactIntelligenceStatus;

    return {
      email: normalized ? normalized.email : record.email,
      firstName: normalized ? normalized.firstName : record.firstName,
      lastName: normalized ? normalized.lastName : record.lastName,
      phone,
      properties,
    };
  } catch (error) {
    if (!isDataIntelligenceUnavailableError(error)) {
      console.error(
        "Contact intelligence failed:",
        error instanceof Error ? error.message : "unknown error",
      );
    }

    return markUnavailable(record);
  }
}
