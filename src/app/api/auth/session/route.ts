import { NextResponse, type NextRequest } from "next/server";

import { verifySessionToken } from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";

function clearAuthCookie(response: NextResponse): void {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.json({ success: true, data: { authenticated: false } });
  }

  const verification = await verifySessionToken(token);

  if (verification.ok) {
    return NextResponse.json({
      success: true,
      data: { authenticated: true },
    });
  }

  if (verification.reason === "replaced") {
    return NextResponse.json(
      {
        success: false,
        code: "session_replaced",
        error: "This account was signed in on another device.",
      },
      { status: 409 },
    );
  }

  if (verification.reason === "unavailable") {
    return NextResponse.json(
      {
        success: false,
        code: "session_unavailable",
        error: "Authentication service is temporarily unavailable.",
      },
      { status: 503 },
    );
  }

  const response = NextResponse.json(
    { success: false, code: "invalid_session", error: "Session expired." },
    { status: 401 },
  );
  clearAuthCookie(response);
  return response;
}
