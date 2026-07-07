import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import { BillingError, getBillingOverview } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCurrentWorkspaceId(workspaceId: string | null): string {
  if (!workspaceId) {
    throw new BillingError("Workspace context is required", 400);
  }

  return workspaceId;
}

function statusForError(error: unknown): number {
  if (error instanceof BillingError) {
    return error.status;
  }

  const message = error instanceof Error ? error.message : "";
  return statusForAccountAuthError(message);
}

export async function GET(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);
    const overview = await getBillingOverview({
      userId: identity.userId,
      workspaceId,
    });

    return NextResponse.json({ success: true, data: overview });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load billing status";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(error) },
    );
  }
}
