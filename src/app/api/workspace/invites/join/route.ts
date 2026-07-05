import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import { signJWT } from "@/lib/auth";
import {
  limitErrorResponse,
  PlanLimitExceededError,
  statusForPlanLimitError,
} from "@/lib/entitlements";
import {
  joinWorkspaceInvite,
  parseWorkspaceInviteToken,
} from "@/lib/workspace-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type JoinInviteBody = {
  token?: unknown;
};

function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

function statusForError(message: string): number {
  if (message === "Invite token is required") {
    return 400;
  }

  if (message.includes("invalid or expired")) {
    return 404;
  }

  return statusForAccountAuthError(message);
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof PlanLimitExceededError) {
    return NextResponse.json(limitErrorResponse(error), {
      status: statusForPlanLimitError(error) ?? 402,
    });
  }

  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json(
    { success: false, error: message },
    { status: statusForError(message) },
  );
}

export async function POST(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const body = (await request.json()) as JoinInviteBody;
    const workspace = await joinWorkspaceInvite({
      userId: identity.userId,
      token: parseWorkspaceInviteToken(body.token),
    });
    const token = await signJWT({
      userId: identity.userId,
      workspaceId: workspace.id,
    });
    const response = NextResponse.json({
      success: true,
      data: { workspace, token, workspaceId: workspace.id },
    });

    setAuthCookie(response, token);
    return response;
  } catch (error) {
    return errorResponse(error, "Failed to join workspace");
  }
}
