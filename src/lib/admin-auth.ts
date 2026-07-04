/**
 * Admin authorization contract (pure, framework-free).
 *
 * The system-admin marker is `"Users".role = 'admin'`. Tenant registration only
 * ever assigns the `'owner'` role, so no self-service path can mint an admin;
 * admins are provisioned out-of-band by a trusted operator. This module holds
 * only the pure decision logic so it can be unit-tested without a database or
 * the Next.js runtime. The server-side wiring (session read + `"Users"` lookup)
 * lives in `@/lib/admin-session`.
 */

export const ADMIN_ROLE = "admin";

/** Minimal verified session shape derived from the JWT. */
export type AdminSessionContext = {
  userId: number;
  workspaceId: number;
};

/**
 * The safe subset of a `"Users"` row admin authorization is allowed to read.
 * `password_hash` is intentionally absent — it must never be selected or
 * returned by any admin code path.
 */
export type AdminUserRecord = {
  id: number;
  email: string;
  role: string;
};

/** Sanitized admin identity returned to callers. Carries no secrets. */
export type AdminIdentity = {
  userId: number;
  email: string;
  role: string;
  workspaceId: number;
};

export type AdminAuthorization =
  | { ok: true; identity: AdminIdentity }
  | { ok: false; status: 401 | 403; error: string };

export const ADMIN_UNAUTHENTICATED_ERROR = "Unauthorized: authentication required";
export const ADMIN_FORBIDDEN_ERROR = "Forbidden: administrator access required";

/**
 * Decide whether a verified session belongs to a system administrator.
 *
 * - No session (or no matching user row) → 401 unauthenticated.
 * - Authenticated but role !== 'admin'   → 403 forbidden.
 * - Authenticated admin                  → sanitized identity.
 *
 * The `user` argument must already be the safe projection (`id`, `email`,
 * `role`); this function never handles password hashes or other secrets.
 */
export function resolveAdminAuthorization(
  session: AdminSessionContext | null,
  user: AdminUserRecord | null,
): AdminAuthorization {
  if (!session || !user) {
    return { ok: false, status: 401, error: ADMIN_UNAUTHENTICATED_ERROR };
  }

  if (user.role !== ADMIN_ROLE) {
    return { ok: false, status: 403, error: ADMIN_FORBIDDEN_ERROR };
  }

  return {
    ok: true,
    identity: {
      userId: user.id,
      email: user.email,
      role: user.role,
      workspaceId: session.workspaceId,
    },
  };
}

/** Column projection for the admin user lookup — never includes secrets. */
export const SELECT_ADMIN_USER_SQL =
  'SELECT id, email, role FROM "Users" WHERE id = $1';
