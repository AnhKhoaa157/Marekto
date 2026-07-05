import { sanitizeWorkerLogReason } from "./worker-log.ts";

/**
 * Admin audit logging (pure helpers).
 *
 * Successful admin reads are recorded in `"Admin_audit_logs"`. This module
 * builds and sanitizes the record without touching the database so the shape,
 * bounding, and secret redaction are unit-testable. The actual INSERT is issued
 * by `recordAdminAudit` in `@/lib/admin-data`.
 *
 * Guarantees:
 *   - metadata values are coerced to primitives (string/number/boolean) only;
 *   - string values pass through `sanitizeWorkerLogReason` (strips tokens,
 *     bearer headers, connection strings, API keys, etc.) and are length-bounded;
 *   - the number of metadata keys is bounded;
 *   - raw request headers and secrets are never accepted here.
 */

export type AdminAuditAction =
  | "admin.health.read"
  | "admin.workspaces.list"
  | "admin.workspaces.read"
  | "admin.users.list"
  | "admin.delivery_diagnostics.list";

export type AdminAuditTargetType =
  | "system"
  | "workspace_list"
  | "workspace"
  | "user_list"
  | "delivery_diagnostics";

export type AdminAuditMetadata = Record<string, string | number | boolean>;

export type AdminAuditEntry = {
  adminUserId: string;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string | null;
  metadata?: Record<string, unknown>;
};

const MAX_METADATA_KEYS = 12;
const MAX_METADATA_STRING_LENGTH = 200;

export const ADMIN_AUDIT_INSERT_SQL =
  'INSERT INTO "Admin_audit_logs" ' +
  "(admin_user_id, action, target_type, target_id, metadata) " +
  "VALUES ($1, $2, $3, $4, $5::jsonb)";

/**
 * Reduce an arbitrary metadata object to a bounded, secret-free record of
 * primitive values. Non-primitive values are dropped; strings are redacted and
 * truncated; the key count is capped.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): AdminAuditMetadata {
  if (!metadata) {
    return {};
  }

  const sanitized: AdminAuditMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (Object.keys(sanitized).length >= MAX_METADATA_KEYS) {
      break;
    }

    if (typeof value === "string") {
      const redacted = sanitizeWorkerLogReason(value);
      sanitized[key] =
        redacted.length > MAX_METADATA_STRING_LENGTH
          ? `${redacted.slice(0, MAX_METADATA_STRING_LENGTH - 3)}...`
          : redacted;
      continue;
    }

    if (typeof value === "boolean") {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
      continue;
    }

    // Anything else (objects, arrays, null, undefined, functions) is dropped so
    // structured secrets or unbounded payloads can never be persisted.
  }

  return sanitized;
}

/**
 * Build the parameterized INSERT for an audit entry. The metadata is sanitized
 * and serialized to a JSON string ready for the `$5::jsonb` placeholder.
 */
export function buildAdminAuditInsert(entry: AdminAuditEntry): {
  text: string;
  params: [string, AdminAuditAction, AdminAuditTargetType, string | null, string];
} {
  const metadata = sanitizeAuditMetadata(entry.metadata);

  return {
    text: ADMIN_AUDIT_INSERT_SQL,
    params: [
      entry.adminUserId,
      entry.action,
      entry.targetType,
      entry.targetId,
      JSON.stringify(metadata),
    ],
  };
}
