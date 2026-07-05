import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import {
  parseWorkspaceRole,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/lib/workspace-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ userId: string }>;
};

type UpdateMemberBody = {
  role?: unknown;
};

function parseUserId(value: string): number {
  const userId = Number(value);

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("User id is invalid");
  }

  return userId;
}

function getCurrentWorkspaceId(workspaceId: number | null): number {
  if (!workspaceId) {
    throw new Error("Workspace context is required");
  }

  return workspaceId;
}

function statusForError(message: string): number {
  if (
    [
      "User id is invalid",
      "Workspace context is required",
      "Workspace role is invalid",
    ].includes(message)
  ) {
    return 400;
  }

  if (message.startsWith("Forbidden:")) {
    return 403;
  }

  if (message.includes("not found")) {
    return 404;
  }

  if (message.includes("last workspace owner")) {
    return 409;
  }

  return statusForAccountAuthError(message);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const identity = await authenticateAccountRequest(request);
    const { userId: userIdParam } = await params;
    const targetUserId = parseUserId(userIdParam);
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);
    const body = (await request.json()) as UpdateMemberBody;
    const role = parseWorkspaceRole(body.role);
    const member = await updateWorkspaceMemberRole({
      actorUserId: identity.userId,
      workspaceId,
      targetUserId,
      role,
    });

    return NextResponse.json({ success: true, data: { member } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update member";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const identity = await authenticateAccountRequest(_request);
    const { userId: userIdParam } = await params;
    const targetUserId = parseUserId(userIdParam);
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);

    await removeWorkspaceMember({
      actorUserId: identity.userId,
      workspaceId,
      targetUserId,
    });

    return NextResponse.json({ success: true, data: { removed: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove member";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
