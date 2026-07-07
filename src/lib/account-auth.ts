import { type NextRequest } from "next/server";

import { type AuthTokenPayload } from "@/lib/auth";
import { initializeDatabase, query } from "@/lib/db";
import { verifySessionToken } from "@/lib/session-auth";

const AUTH_COOKIE_NAME = "auth_token";
const BEARER_PREFIX = "Bearer ";
const ADMIN_ROLE = "admin";
const SELECT_USER_ROLE_SQL = 'SELECT role FROM "Users" WHERE id = $1';

type UserRoleRow = {
  role: string;
};

export type AccountIdentity = AuthTokenPayload;

function extractToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith(BEARER_PREFIX)) {
    const token = authorization.slice(BEARER_PREFIX.length).trim();
    if (token.length > 0) {
      return token;
    }
  }

  return request.cookies.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function authenticateAccountRequest(
  request: NextRequest,
): Promise<AccountIdentity> {
  const token = extractToken(request);

  if (!token) {
    throw new Error("Unauthorized: Missing token");
  }

  const verification = await verifySessionToken(token);

  if (!verification.ok && verification.reason === "replaced") {
    throw new Error("Session replaced");
  }

  if (!verification.ok && verification.reason === "unavailable") {
    throw new Error("Authentication service unavailable");
  }

  if (!verification.ok) {
    throw new Error("Unauthorized: Invalid or expired token");
  }

  const identity = verification.identity;

  await initializeDatabase();

  const result = await query<UserRoleRow>(SELECT_USER_ROLE_SQL, [identity.userId]);
  const role = result.rows[0]?.role ?? null;

  if (!role) {
    throw new Error("Unauthorized: Invalid account");
  }

  if (role === ADMIN_ROLE) {
    throw new Error("Forbidden: use the admin console");
  }

  return identity;
}

export function statusForAccountAuthError(message: string): number {
  if (message === "Session replaced") {
    return 409;
  }

  if (message === "Authentication service unavailable") {
    return 503;
  }

  if (message.startsWith("Unauthorized:")) {
    return 401;
  }

  if (message.startsWith("Forbidden:")) {
    return 403;
  }

  return 500;
}
