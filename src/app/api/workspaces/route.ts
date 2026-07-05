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
  createWorkspaceForUser,
  listUserWorkspaces,
  parseWorkspaceName,
} from "@/lib/workspace-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type CreateWorkspaceBody = {
  name?: unknown;
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
  if (message.includes("required") || message.includes("characters")) {
    return 400;
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

export async function GET(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const workspaces = await listUserWorkspaces(identity.userId);

    return NextResponse.json({
      success: true,
      data: { workspaces, currentWorkspaceId: identity.workspaceId },
    });
  } catch (error) {
    return errorResponse(error, "Failed to load workspaces");
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const body = (await request.json()) as CreateWorkspaceBody;
    const workspace = await createWorkspaceForUser(
      identity.userId,
      parseWorkspaceName(body.name),
    );
    const token = await signJWT({
      userId: identity.userId,
      workspaceId: workspace.id,
    });

    const response = NextResponse.json(
      { success: true, data: { workspace, token, workspaceId: workspace.id } },
      { status: 201 },
    );
    setAuthCookie(response, token);
    return response;
  } catch (error) {
    return errorResponse(error, "Failed to create workspace");
  }
}
