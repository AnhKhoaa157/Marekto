import { SignJWT, jwtVerify } from "jose";

import { isUuid, type EntityId } from "./identifiers.ts";

/**
 * Lightweight JWT utilities built on `jose` so they run in both the Node.js
 * runtime (route handlers) and the Edge runtime (Next.js proxy). Tokens
 * carry the UUID tenant context used throughout the multi-tenant platform.
 */

const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "marekto";
const JWT_AUDIENCE = "marekto-app";
const JWT_EXPIRATION = "7d";

export type AuthTokenPayload = {
  userId: EntityId;
  workspaceId: EntityId | null;
};

let cachedSecretKey: Uint8Array | null = null;

function getSecretKey(): Uint8Array {
  if (cachedSecretKey) {
    return cachedSecretKey;
  }

  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length === 0) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }

  cachedSecretKey = new TextEncoder().encode(secret);
  return cachedSecretKey;
}

function isValidWorkspaceId(value: unknown): value is EntityId | null {
  return value === null || isUuid(value);
}

/**
 * Sign a JWT embedding the UUID tenant context. Throws if `JWT_SECRET` is not
 * configured or either payload identifier is invalid.
 */
export async function signJWT(payload: AuthTokenPayload): Promise<string> {
  if (!isUuid(payload.userId) || !isValidWorkspaceId(payload.workspaceId)) {
    throw new Error(
      "Invalid JWT payload: userId must be a UUID and workspaceId must be a UUID or null",
    );
  }

  return new SignJWT({ userId: payload.userId, workspaceId: payload.workspaceId })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(getSecretKey());
}

/**
 * Verify and decode a JWT, returning the typed payload when the signature and
 * claims are valid, or `null` when the token is missing, malformed, expired,
 * or carries an invalid tenant context.
 */
export async function verifyJWT(token: string): Promise<AuthTokenPayload | null> {
  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const { userId, workspaceId } = payload as Record<string, unknown>;

    if (!isUuid(userId) || !isValidWorkspaceId(workspaceId)) {
      return null;
    }

    return { userId, workspaceId };
  } catch {
    return null;
  }
}
