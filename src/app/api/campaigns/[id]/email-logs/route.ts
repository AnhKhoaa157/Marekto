import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";
import {
  buildEmailLogSelection,
  parseEmailLogCursor,
  parseEmailLogLimit,
  SELECT_CAMPAIGN_DELIVERY_SQL,
  SELECT_EMAIL_LOG_SUMMARY_SQL,
  toCampaignDeliveryCampaign,
  toCampaignDeliverySummary,
  toCampaignEmailLogItem,
  type CampaignDeliveryRow,
  type CampaignEmailLogsData,
  type EmailLogListRow,
  type EmailLogSummaryRow,
} from "@/lib/email-logs";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = {
  params: Promise<{ id: string }>;
};

async function getCampaignId({ params }: RouteParams): Promise<number> {
  const { id } = await params;
  const campaignId = Number(id);

  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    throw new Error("Invalid campaign id");
  }

  return campaignId;
}

function statusForError(message: string): number {
  const knownValidationError =
    [
      "Missing workspace context",
      "Invalid workspace id",
      "Invalid campaign id",
    ].includes(message) ||
    message.startsWith("limit must be") ||
    message.startsWith("cursor must be");

  return knownValidationError ? 400 : 500;
}

export async function GET(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const campaignId = await getCampaignId(context);
    const searchParams = request.nextUrl.searchParams;
    const limit = parseEmailLogLimit(searchParams.get("limit"));
    const cursor = parseEmailLogCursor(searchParams.get("cursor"));

    const data = await withWorkspace(
      workspaceId,
      async (client): Promise<CampaignEmailLogsData | null> => {
        const campaignResult = await client.query<CampaignDeliveryRow>(
          SELECT_CAMPAIGN_DELIVERY_SQL,
          [campaignId, workspaceId],
        );
        const campaign = campaignResult.rows[0];

        if (!campaign) {
          return null;
        }

        const summaryResult = await client.query<EmailLogSummaryRow>(
          SELECT_EMAIL_LOG_SUMMARY_SQL,
          [workspaceId, campaignId],
        );
        const logsSelection = buildEmailLogSelection(
          workspaceId,
          campaignId,
          limit,
          cursor,
        );
        const logsResult = await client.query<EmailLogListRow>(
          logsSelection.text,
          logsSelection.params,
        );

        return {
          campaign: toCampaignDeliveryCampaign(campaign),
          summary: toCampaignDeliverySummary(summaryResult.rows[0]),
          logs: logsResult.rows.map(toCampaignEmailLogItem),
        };
      },
    );

    if (!data) {
      return NextResponse.json(
        { success: false, error: "Campaign not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("Failed to fetch campaign email logs:", error);

    const message =
      error instanceof Error ? error.message : "Failed to fetch campaign email logs";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
