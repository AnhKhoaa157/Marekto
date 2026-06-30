import { NextResponse, type NextRequest } from "next/server";

import { verifyJWT } from "@/lib/auth";
import { authenticateTenantRequest } from "@/lib/proxy-auth";

/**
 * Intercepts tenant-scoped API routes, authenticates the caller via JWT, and
 * injects the verified integer workspace context as the `x-workspace-id`
 * header so downstream route handlers resolve the correct tenant. The
 * `/api/auth/*` routes are intentionally excluded to avoid an auth loop.
 *
 * Next.js 16 renamed the `middleware` file/function convention to `proxy`;
 * this is the migrated equivalent of the former `src/middleware.ts`.
 */
export const config = {
  matcher: [
    "/api/lists/:path*",
    "/api/templates/:path*",
    "/api/campaigns/:path*",
    "/api/contacts/:path*",
    "/api/profile/:path*",
  ],
};

export default async function proxy(request: NextRequest) {
  const authentication = await authenticateTenantRequest(
    request.headers,
    request.cookies,
    verifyJWT,
  );

  if (!authentication.ok) {
    return NextResponse.json(
      { success: false, error: authentication.error },
      { status: 401 },
    );
  }

  // Forward the request with the verified tenant context injected. Cloning the
  // incoming headers prevents a spoofed `x-workspace-id` from the client from
  // surviving past the proxy boundary.
  return NextResponse.next({ request: { headers: authentication.headers } });
}
