import { NextResponse } from "next/server";

import { openApiSpec } from "@/lib/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(openApiSpec);
}
