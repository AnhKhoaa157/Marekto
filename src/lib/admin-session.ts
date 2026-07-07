import "server-only";

import type { NextRequest } from "next/server";

import {
  ADMIN_ROLE,
  resolveAdminAuthorization,
  SELECT_ADMIN_USER_SQL,
  type AdminAuthorization,
  type AdminIdentity,
  type AdminSessionContext,
  type AdminUserRecord,
} from "@/lib/admin-auth";
import { initializeDatabase, query } from "@/lib/db";
import { authenticateTenantRequest } from "@/lib/proxy-auth";
import { getServerAuthSession } from "@/lib/server-auth";
import { verifySessionToken } from "@/lib/session-auth";

/**
 * Server-side wiring for admin authorization. Reads the verified session, looks
 * up the real `"Users"` row (safe columns only — never `password_hash`), and
 * defers the decision to the pure `resolveAdminAuthorization`.
 */

async function readApiSession(
  request: NextRequest,
): Promise<AdminSessionContext | null> {
  const cookieSession = await getServerAuthSession();

  if (cookieSession?.workspaceId) {
    return { userId: cookieSession.userId, workspaceId: cookieSession.workspaceId };
  }

  const authentication = await authenticateTenantRequest(
    request.headers,
    request.cookies,
    verifySessionToken,
  );

  if (!authentication.ok || !authentication.identity.workspaceId) {
    return null;
  }

  return {
    userId: authentication.identity.userId,
    workspaceId: authentication.identity.workspaceId,
  };
}

async function lookupUser(userId: string): Promise<AdminUserRecord | null> {
  // Ensure the schema exists before the lookup so admin surfaces work even on a
  // process whose first request is an admin page (idempotent after init).
  await initializeDatabase();
  const result = await query<AdminUserRecord>(SELECT_ADMIN_USER_SQL, [userId]);
  return result.rows[0] ?? null;
}

/**
 * Authorize an admin API request. Supports both the auth cookie (browser) and a
 * bearer token (tooling). Returns a 401 for unauthenticated callers and a 403
 * for authenticated non-admins.
 */
export async function authorizeAdminRequest(
  request: NextRequest,
): Promise<AdminAuthorization> {
  const session = await readApiSession(request);

  if (!session) {
    return resolveAdminAuthorization(null, null);
  }

  const user = await lookupUser(session.userId);
  return resolveAdminAuthorization(session, user);
}

export type AdminSessionState =
  | { status: "authorized"; identity: AdminIdentity }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

/**
 * Resolve the admin session for a server component (cookie only). Distinguishes
 * unauthenticated from authenticated-but-forbidden so the UI can render the
 * correct state.
 */
export async function getAdminSessionState(): Promise<AdminSessionState> {
  const session = await getServerAuthSession();

  if (!session) {
    return { status: "unauthenticated" };
  }

  if (!session.workspaceId) {
    return { status: "unauthenticated" };
  }

  const user = await lookupUser(session.userId);
  const authorization = resolveAdminAuthorization(
    { userId: session.userId, workspaceId: session.workspaceId },
    user,
  );

  if (authorization.ok) {
    return { status: "authorized", identity: authorization.identity };
  }

  return authorization.status === 401
    ? { status: "unauthenticated" }
    : { status: "forbidden" };
}

/**
 * Lightweight admin check used to decide whether to surface the admin entry
 * point in the tenant navigation. Reads only the role column.
 */
export async function isAdminUserId(userId: string): Promise<boolean> {
  const user = await lookupUser(userId);
  return (user?.role ?? "") === ADMIN_ROLE;
}
