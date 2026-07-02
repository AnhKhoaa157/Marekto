const CONTACT_FILTER_COLUMNS = new Set([
  "email",
  "first_name",
  "last_name",
  "phone",
]);
const JSONB_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNSUPPORTED_OPERATOR_PATTERN = /_(?:gt|gte|lt|lte|contains)$/;

const NUMERIC_OPERATORS = {
  lead_score_gt: ">",
  lead_score_gte: ">=",
  lead_score_lt: "<",
  lead_score_lte: "<=",
} as const;

type FilterScalar = string | number | boolean | null;
export type CampaignTargetFilters = Record<string, FilterScalar>;

export type ContactSelection = {
  text: string;
  params: unknown[];
};

function assertFilterScalar(key: string, value: unknown): asserts value is FilterScalar {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new Error(`Unsupported filter value for ${key}`);
  }

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Unsupported filter value for ${key}`);
  }
}

export function parseCampaignTargetFilters(value: unknown): CampaignTargetFilters {
  const rawFilters = value ?? {};

  if (
    typeof rawFilters !== "object" ||
    rawFilters === null ||
    Array.isArray(rawFilters)
  ) {
    throw new Error("target_filters must be a JSON object");
  }

  const filters: CampaignTargetFilters = {};

  for (const [key, rawValue] of Object.entries(rawFilters)) {
    if (!JSONB_KEY_PATTERN.test(key)) {
      throw new Error(`Unsupported filter key: ${key}`);
    }

    if (Object.hasOwn(NUMERIC_OPERATORS, key)) {
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
        throw new Error(`${key} must be a finite number`);
      }
    } else if (key === "tags_contains") {
      if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
        throw new Error("tags_contains must be a non-empty string");
      }
    } else if (UNSUPPORTED_OPERATOR_PATTERN.test(key)) {
      throw new Error(`Unsupported filter operator: ${key}`);
    } else {
      assertFilterScalar(key, rawValue);

      if (CONTACT_FILTER_COLUMNS.has(key) && rawValue !== null && typeof rawValue !== "string") {
        throw new Error(`${key} must be a string or null`);
      }
    }

    filters[key] =
      key === "tags_contains" && typeof rawValue === "string"
        ? rawValue.trim()
        : (rawValue as FilterScalar);
  }

  return filters;
}

export function buildContactSelection(
  workspaceId: number,
  targetFilters: CampaignTargetFilters,
): ContactSelection {
  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error("Invalid workspace id");
  }

  const params: unknown[] = [workspaceId];
  const conditions: string[] = ["workspace_id = $1"];

  for (const [key, value] of Object.entries(targetFilters)) {
    if (Object.hasOwn(NUMERIC_OPERATORS, key)) {
      params.push("lead_score");
      const keyIndex = params.length;
      params.push(value);
      const valueIndex = params.length;
      const operator = NUMERIC_OPERATORS[key as keyof typeof NUMERIC_OPERATORS];

      conditions.push(
        `(CASE WHEN jsonb_typeof(properties->$${keyIndex}) = 'number' ` +
          `THEN (properties->>$${keyIndex})::numeric END) ${operator} $${valueIndex}`,
      );
      continue;
    }

    if (key === "tags_contains") {
      params.push(value);
      conditions.push(
        `properties @> jsonb_build_object('tags', to_jsonb(ARRAY[$${params.length}]::text[]))`,
      );
      continue;
    }

    if (CONTACT_FILTER_COLUMNS.has(key)) {
      if (value === null) {
        conditions.push(`"${key}" IS NULL`);
      } else {
        params.push(value);
        conditions.push(`"${key}" = $${params.length}`);
      }
      continue;
    }

    params.push(key);
    const keyIndex = params.length;
    params.push(JSON.stringify(value));
    conditions.push(`properties->$${keyIndex} = $${params.length}::jsonb`);
  }

  return {
    text:
      'SELECT id, email, first_name, last_name, properties FROM "Contacts" WHERE ' +
      conditions.join(" AND ") +
      " ORDER BY id ASC",
    params,
  };
}
