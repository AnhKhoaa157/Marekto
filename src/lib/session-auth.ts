import "server-only";

import { type AuthTokenPayload, verifyJWT } from "./auth.ts";
import { isActiveSession } from "./session-store.ts";

export type SessionFailureReason = "invalid" | "replaced" | "unavailable";

export type SessionVerification =
  | { ok: true; identity: AuthTokenPayload }
  | { ok: false; reason: SessionFailureReason };

export async function verifySessionToken(token: string): Promise<SessionVerification> {
  const identity = await verifyJWT(token);

  if (!identity) {
    return { ok: false, reason: "invalid" };
  }

  try {
    return (await isActiveSession(identity.userId, identity.sessionId))
      ? { ok: true, identity }
      : { ok: false, reason: "replaced" };
  } catch (error) {
    console.error(
      "Failed to verify active authentication session:",
      error instanceof Error ? error.message : "unknown Redis error",
    );
    return { ok: false, reason: "unavailable" };
  }
}

export async function verifyActiveJWT(token: string): Promise<AuthTokenPayload | null> {
  const result = await verifySessionToken(token);
  return result.ok ? result.identity : null;
}
