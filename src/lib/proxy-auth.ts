const AUTH_COOKIE_NAME = "auth_token";
const BEARER_PREFIX = "Bearer ";

type TenantIdentity = {
  userId: number;
  workspaceId: number | null;
};

type VerifyToken = (token: string) => Promise<TenantIdentity | null>;

export type TenantAuthenticationResult =
  | {
      ok: true;
      headers: Headers;
      identity: TenantIdentity;
    }
  | {
      ok: false;
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
    return { ok: false, error: "Unauthorized: Missing token" };
  }

  const identity = await verifyToken(token);

  if (!identity) {
    return { ok: false, error: "Unauthorized: Invalid or expired token" };
  }

  if (!identity.workspaceId) {
    return { ok: false, error: "Unauthorized: Workspace required" };
  }

  const forwardedHeaders = new Headers(headers);
  forwardedHeaders.set("x-workspace-id", identity.workspaceId.toString());

  return { ok: true, headers: forwardedHeaders, identity };
}
