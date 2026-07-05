const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EntityId = string;

export function isUuid(value: unknown): value is EntityId {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function parseUuid(value: unknown, label = "ID"): EntityId {
  if (!isUuid(value)) {
    throw new Error(`Invalid ${label.toLowerCase()}`);
  }

  return value.toLowerCase();
}

export type EntityCodePrefix =
  | "US"
  | "WS"
  | "CT"
  | "LS"
  | "TP"
  | "CP"
  | "EL"
  | "AI"
  | "IV"
  | "AL";

export function formatEntityCode(prefix: EntityCodePrefix, id: EntityId): string {
  return `${prefix}-${id.replaceAll("-", "").slice(-4).toUpperCase()}`;
}

export function prefixForAuditTarget(targetType: string): EntityCodePrefix {
  if (targetType === "workspace") return "WS";
  if (targetType === "member" || targetType === "user") return "US";
  if (targetType === "invite") return "IV";
  if (targetType === "campaign") return "CP";
  if (targetType === "contact") return "CT";
  return "AL";
}
