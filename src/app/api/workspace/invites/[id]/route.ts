import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import { revokeWorkspaceInvite } from "@/lib/workspace-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

function parseInviteId(value: string): number {
  const inviteId = Number(value);

  if (!Number.isInteger(inviteId) || inviteId <= 0) {
    throw new Error("Invite id is invalid");
  }

  return inviteId;
}

function getCurrentWorkspaceId(workspaceId: number | null): number {
  if (!workspaceId) {
    throw new Error("Workspace context is required");
  }

  return workspaceId;
}

function statusForError(message: string): number {
  if (message === "Invite id is invalid" || message === "Workspace context is required") {
    return 400;
  }

  if (message.startsWith("Forbidden:")) {
    return 403;
  }

  if (message.includes("not found")) {
    return 404;
  }

  return statusForAccountAuthError(message);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const identity = await authenticateAccountRequest(request);
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);
    const { id } = await params;
    const inviteId = parseInviteId(id);

    await revokeWorkspaceInvite({
      actorUserId: identity.userId,
      workspaceId,
      inviteId,
    });

    return NextResponse.json({ success: true, data: { revoked: true } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke invite";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
