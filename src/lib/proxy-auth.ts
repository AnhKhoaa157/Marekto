const AUTH_COOKIE_NAME = "auth_token";
const BEARER_PREFIX = "Bearer ";

type TenantIdentity = {
  userId: string;
  workspaceId: string | null;
  sessionId: string;
};

type VerifyToken = (token: string) => Promise<
  | { ok: true; identity: TenantIdentity }
  | { ok: false; reason: "invalid" | "replaced" | "unavailable" }
>;

export type TenantAuthenticationResult =
  | {
      ok: true;
      headers: Headers;
      identity: TenantIdentity;
    }
  | {
      ok: false;
      code: "missing_token" | "invalid_token" | "session_replaced" | "session_unavailable" | "workspace_required";
      error: string;
    };

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

function extractToken(headers: Headers, cookies: CookieReader): string | null {
  const authorization = headers.get("authorization");

  if (authorization?.startsWith(BEARER_PREFIX)) {
    const token = authorization.slice(BEARER_PREFIX.length).trim();

    if (token.length > 0) {
      return token;
    }
  }

  const cookieToken = cookies.get(AUTH_COOKIE_NAME)?.value;
  return cookieToken && cookieToken.length > 0 ? cookieToken : null;
}

export async function authenticateTenantRequest(
  headers: Headers,
  cookies: CookieReader,
  verifyToken: VerifyToken,
): Promise<TenantAuthenticationResult> {
  const token = extractToken(headers, cookies);

  if (!token) {
    return { ok: false, code: "missing_token", error: "Unauthorized: Missing token" };
  }

  const verification = await verifyToken(token);

  if (!verification.ok) {
    if (verification.reason === "replaced") {
      return { ok: false, code: "session_replaced", error: "Session replaced" };
    }

    if (verification.reason === "unavailable") {
      return {
        ok: false,
        code: "session_unavailable",
        error: "Authentication service unavailable",
      };
    }

    return {
      ok: false,
      code: "invalid_token",
      error: "Unauthorized: Invalid or expired token",
    };
  }

  const identity = verification.identity;

  if (!identity.workspaceId) {
    return {
      ok: false,
      code: "workspace_required",
      error: "Unauthorized: Workspace required",
    };
  }

  const forwardedHeaders = new Headers(headers);
  forwardedHeaders.set("x-workspace-id", identity.workspaceId);

  return { ok: true, headers: forwardedHeaders, identity };
}
