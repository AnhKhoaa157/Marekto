import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import { signJWT } from "@/lib/auth";
import { assertUserCanUseWorkspace } from "@/lib/workspace-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SwitchWorkspaceBody = {
  workspaceId?: unknown;
};

function parseWorkspaceId(value: unknown): number {
  const workspaceId = Number(value);

  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error("Workspace id is invalid");
  }

  return workspaceId;
}

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
  if (message === "Workspace id is invalid") {
    return 400;
  }

  if (message.startsWith("Forbidden:")) {
    return 403;
  }

  return statusForAccountAuthError(message);
}

export async function POST(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const body = (await request.json()) as SwitchWorkspaceBody;
    const workspaceId = parseWorkspaceId(body.workspaceId);
    const workspace = await assertUserCanUseWorkspace(identity.userId, workspaceId);
    const token = await signJWT({ userId: identity.userId, workspaceId });
    const response = NextResponse.json({
      success: true,
      data: { workspace, token, workspaceId },
    });

    setAuthCookie(response, token);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to switch workspace";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
