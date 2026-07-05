import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import {
  limitErrorResponse,
  PlanLimitExceededError,
  statusForPlanLimitError,
} from "@/lib/entitlements";
import {
  createWorkspaceInvite,
  listWorkspaceInvites,
} from "@/lib/workspace-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCurrentWorkspaceId(workspaceId: string | null): string {
  if (!workspaceId) {
    throw new Error("Workspace context is required");
  }

  return workspaceId;
}

function statusForError(message: string): number {
  if (message === "Workspace context is required") {
    return 400;
  }

  if (message.startsWith("Forbidden:")) {
    return 403;
  }

  return statusForAccountAuthError(message);
}

function buildInviteUrl(request: NextRequest, token: string): string {
  return new URL(`/invite/${encodeURIComponent(token)}`, request.url).toString();
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
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);
    const invites = await listWorkspaceInvites({
      actorUserId: identity.userId,
      workspaceId,
    });

    return NextResponse.json({ success: true, data: { invites } });
  } catch (error) {
    return errorResponse(error, "Failed to load invites");
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);
    const { invite, token } = await createWorkspaceInvite({
      actorUserId: identity.userId,
      workspaceId,
    });

    return NextResponse.json(
      {
        success: true,
        data: { invite, token, inviteUrl: buildInviteUrl(request, token) },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, "Failed to create invite");
  }
}
