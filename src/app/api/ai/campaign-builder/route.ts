import { NextResponse, type NextRequest } from "next/server";

import {
  CampaignBuilderInputError,
  generateCampaignPackage,
  parseCampaignBuilderInput,
} from "@/lib/ai/campaign-builder";
import { isGeminiProviderUnavailableError } from "@/lib/ai/gemini";
import { initializeDatabase } from "@/lib/db";
import {
  assertWorkspaceUsageAvailable,
  consumeWorkspaceUsage,
  limitErrorResponse,
  PlanLimitExceededError,
  statusForPlanLimitError,
} from "@/lib/entitlements";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function parseRequestBody(request: NextRequest): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new CampaignBuilderInputError("Request body must contain valid JSON");
  }
}

export async function POST(request: NextRequest) {
  try {
    // Trusted workspace context from the proxy/JWT. The builder never reads a
    // workspace id from the request body, and its input parser rejects any
    // workspace_id field outright.
    await initializeDatabase();
    const workspaceId = getWorkspaceIdFromHeaders(request.headers);

    const body = await parseRequestBody(request);
    const input = parseCampaignBuilderInput(body);
    await assertWorkspaceUsageAvailable({
      workspaceId,
      usageKey: "ai.campaign_builder",
    });

    const campaignPackage = await generateCampaignPackage(input);
    await consumeWorkspaceUsage({
      workspaceId,
      usageKey: "ai.campaign_builder",
    });

    return NextResponse.json({ success: true, data: campaignPackage });
  } catch (error) {
    console.error("Failed to generate campaign package:", error);

    if (error instanceof CampaignBuilderInputError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    if (error instanceof PlanLimitExceededError) {
      return NextResponse.json(limitErrorResponse(error), {
        status: statusForPlanLimitError(error) ?? 402,
      });
    }

    const message =
      error instanceof Error ? error.message : "Unknown AI provider error";

    if (
      message === "Missing workspace context" ||
      message === "Invalid workspace id"
    ) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 },
      );
    }

    if (isGeminiProviderUnavailableError(error)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "AI campaign builder is temporarily unavailable. Try again shortly.",
        },
        { status: 503 },
      );
    }

    // Invalid provider output and any other failure map to a safe 500 without
    // leaking provider text or stack traces into the primary UI message.
    return NextResponse.json(
      {
        success: false,
        error: "AI campaign builder could not produce a valid draft.",
      },
      { status: 500 },
    );
  }
}
