import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";

export async function POST() {
  try {
    const response = NextResponse.json(
      { success: true, data: { authenticated: false } },
      { status: 200 },
    );

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("Failed to sign out:", error);

    const message = error instanceof Error ? error.message : "Failed to sign out";

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
