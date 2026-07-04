import { NextResponse, type NextRequest } from "next/server";

import {
  parseAdminPage,
  parseAdminPageSize,
  parseAdminSearch,
} from "@/lib/admin-console";
import { loadAdminUsers, recordAdminAudit } from "@/lib/admin-data";
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
    const params = {
      search: parseAdminSearch(url.searchParams.get("search")),
      page: parseAdminPage(url.searchParams.get("page")),
      pageSize: parseAdminPageSize(url.searchParams.get("pageSize")),
    };

    const result = await loadAdminUsers(params);

    await recordAdminAudit({
      adminUserId: authorization.identity.userId,
      action: "admin.users.list",
      targetType: "user_list",
      targetId: null,
      metadata: {
        search: params.search,
        page: params.page,
        page_size: params.pageSize,
        result_count: result.items.length,
        total: result.total,
      },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Admin users list failed:", error);
    return NextResponse.json(
      { success: false, error: sanitizeWorkerLogReason(error) },
      { status: 500 },
    );
  }
}
