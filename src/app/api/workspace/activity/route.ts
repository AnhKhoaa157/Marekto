import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import { listWorkspaceAuditEvents } from "@/lib/workspace-collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCurrentWorkspaceId(workspaceId: number | null): number {
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

export async function GET(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);
    const events = await listWorkspaceAuditEvents(
      identity.userId,
      workspaceId,
      50,
    );

    return NextResponse.json({ success: true, data: { events } });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load workspace activity";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
