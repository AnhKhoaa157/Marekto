import { NextResponse, type NextRequest } from "next/server";

import { authenticateTenantRequest } from "@/lib/proxy-auth";
import { verifySessionToken } from "@/lib/session-auth";

/**
 * Intercepts tenant-scoped API routes, authenticates the caller via JWT, and
 * injects the verified UUID workspace context as the `x-workspace-id`
 * header so downstream route handlers resolve the correct tenant. The
 * `/api/auth/*` routes are intentionally excluded to avoid an auth loop.
 *
 * Next.js 16 renamed the `middleware` file/function convention to `proxy`;
 * this is the migrated equivalent of the former `src/middleware.ts`.
 */
export const config = {
  matcher: [
    "/api/ai/:path*",
    "/api/lists/:path*",
    "/api/templates/:path*",
    "/api/campaigns/:path*",
    "/api/contacts/:path*",
  ],
};

export default async function proxy(request: NextRequest) {
  const authentication = await authenticateTenantRequest(
    request.headers,
    request.cookies,
    verifySessionToken,
  );

  if (!authentication.ok) {
    return NextResponse.json(
      { success: false, error: authentication.error, code: authentication.code },
      {
        status:
          authentication.code === "session_replaced"
            ? 409
            : authentication.code === "session_unavailable"
              ? 503
              : 401,
      },
    );
  }

  // Forward the request with the verified tenant context injected. Cloning the
  // incoming headers prevents a spoofed `x-workspace-id` from the client from
  // surviving past the proxy boundary.
  return NextResponse.next({ request: { headers: authentication.headers } });
}
