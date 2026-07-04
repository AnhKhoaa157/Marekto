import { NextResponse, type NextRequest } from "next/server";

import { parseAdminDiagnosticsLimit } from "@/lib/admin-console";
import {
  loadAdminDeliveryDiagnostics,
  recordAdminAudit,
} from "@/lib/admin-data";
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

    const url = new URL(request.url);
    const limit = parseAdminDiagnosticsLimit(url.searchParams.get("limit"));
    const result = await loadAdminDeliveryDiagnostics(limit);

    await recordAdminAudit({
      adminUserId: authorization.identity.userId,
      action: "admin.delivery_diagnostics.list",
      targetType: "delivery_diagnostics",
      targetId: null,
      metadata: {
        limit,
        result_count: result.items.length,
        total: result.total,
      },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Admin delivery diagnostics read failed:", error);
    return NextResponse.json(
      { success: false, error: sanitizeWorkerLogReason(error) },
      { status: 500 },
    );
  }
}
