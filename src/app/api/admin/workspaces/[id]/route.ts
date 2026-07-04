import { NextResponse, type NextRequest } from "next/server";

import { parseWorkspaceIdParam } from "@/lib/admin-console";
import {
  loadAdminWorkspaceDetail,
  recordAdminAudit,
} from "@/lib/admin-data";
import { authorizeAdminRequest } from "@/lib/admin-session";
import { initializeDatabase } from "@/lib/db";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

function statusForError(message: string): number {
  if (message === "Invalid workspace id") {
    return 400;
  }

  if (message === "Workspace not found") {
    return 404;
  }

  return 500;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await initializeDatabase();

    const authorization = await authorizeAdminRequest(request);

    if (!authorization.ok) {
      return NextResponse.json(
        { success: false, error: authorization.error },
        { status: authorization.status },
      );
    }

    const { id } = await params;
    const workspaceId = parseWorkspaceIdParam(id);
    const detail = await loadAdminWorkspaceDetail(workspaceId);

    if (!detail) {
      throw new Error("Workspace not found");
    }

    await recordAdminAudit({
      adminUserId: authorization.identity.userId,
      action: "admin.workspaces.read",
      targetType: "workspace",
      targetId: workspaceId,
      metadata: { workspace_id: workspaceId },
    });

    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    console.error("Admin workspace detail read failed:", error);
    const message = sanitizeWorkerLogReason(error);
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
