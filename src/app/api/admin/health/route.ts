import { NextResponse, type NextRequest } from "next/server";

import { loadAdminHealth, recordAdminAudit } from "@/lib/admin-data";
import { authorizeAdminRequest } from "@/lib/admin-session";
import { initializeDatabase } from "@/lib/db";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const authorization = await authorizeAdminRequest(request);

    if (!authorization.ok) {
      return NextResponse.json(
        { success: false, error: authorization.error },
        { status: authorization.status },
      );
    }

    const health = await loadAdminHealth();

    await recordAdminAudit({
      adminUserId: authorization.identity.userId,
      action: "admin.health.read",
      targetType: "system",
      targetId: null,
      metadata: {
        node_env: health.environment.node_env,
        database_reachable: health.database.reachable,
      },
    });

    return NextResponse.json({ success: true, data: health });
  } catch (error) {
    console.error("Admin health read failed:", error);
    return NextResponse.json(
      { success: false, error: sanitizeWorkerLogReason(error) },
      { status: 500 },
    );
  }
}
