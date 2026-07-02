import { NextResponse, type NextRequest } from "next/server";

import {
  generateAudienceFiltersWithCache,
  SegmentationInputError,
  SegmentationUnavailableError,
} from "@/lib/ai/segmentation";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SegmentationRequestBody = {
  prompt?: unknown;
};

async function parseRequestBody(request: NextRequest): Promise<SegmentationRequestBody> {
  try {
    const body: unknown = await request.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new SegmentationInputError("Request body must be a JSON object");
    }

    return body as SegmentationRequestBody;
  } catch (error) {
    if (error instanceof SegmentationInputError) {
      throw error;
    }

    throw new SegmentationInputError("Request body must contain valid JSON");
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = getWorkspaceIdFromHeaders(request.headers);

    const body = await parseRequestBody(request);
    const result = await generateAudienceFiltersWithCache(workspaceId, body.prompt);

    return NextResponse.json({
      success: true,
      data: {
        target_filters: result.targetFilters,
        source: result.source,
      },
    });
  } catch (error) {
    console.error("Failed to generate audience filters:", error);

    if (error instanceof SegmentationInputError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }

    if (error instanceof SegmentationUnavailableError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown AI provider error";

    if (message === "Missing workspace context" || message === "Invalid workspace id") {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "AI audience builder is temporarily unavailable",
      },
      { status: 500 },
    );
  }
}
