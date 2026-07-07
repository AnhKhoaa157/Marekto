import { NextResponse, type NextRequest } from "next/server";

import { BillingError, processBillingWebhook } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const result = await processBillingWebhook({
      headers: request.headers,
      bodyText: await request.text(),
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process billing webhook";
    const status = error instanceof BillingError ? error.status : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}
