import { NextResponse, type NextRequest } from "next/server";

import { parseCampaignTargetFilters } from "@/lib/campaign-filters";
import {
  assertCampaignSchedule,
  parseUserCampaignStatus,
} from "@/lib/campaign-status";
import { initializeDatabase, withWorkspace } from "@/lib/db";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT_CAMPAIGNS_SQL =
  'SELECT id, workspace_id, template_id, name, status, target_filters, scheduled_at, run_at, created_at, updated_at FROM "Campaigns" WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC';
const INSERT_CAMPAIGN_SQL =
  'INSERT INTO "Campaigns" (workspace_id, template_id, name, status, target_filters, scheduled_at, run_at) ' +
  'SELECT $1, $2, $3, $4, $5::jsonb, $6, $6 ' +
  'WHERE $2::int IS NULL OR EXISTS (SELECT 1 FROM "Templates" WHERE id = $2 AND workspace_id = $1) ' +
  'RETURNING id, workspace_id, template_id, name, status, target_filters, scheduled_at, run_at, created_at, updated_at';

type CampaignRow = {
  id: number;
  workspace_id: number;
  template_id: number | null;
  name: string;
  status: string;
  target_filters: Record<string, unknown>;
  scheduled_at: Date | null;
  run_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type CreateCampaignBody = {
  name?: unknown;
  template_id?: unknown;
  status?: unknown;
  target_filters?: unknown;
  scheduled_at?: unknown;
};

function parseOptionalTemplateId(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const templateId = Number(value);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error("Invalid template id");
  }

  return templateId;
}

function parseScheduledAt(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Invalid scheduled_at");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid scheduled_at");
  }

  return date.toISOString();
}

function parseCreateCampaignBody(body: CreateCampaignBody) {
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new Error("Name is required");
  }

  const status = parseUserCampaignStatus(body.status, "draft");
  const scheduledAt = parseScheduledAt(body.scheduled_at);
  assertCampaignSchedule(status, scheduledAt);

  return {
    name: body.name.trim(),
    templateId: parseOptionalTemplateId(body.template_id),
    status,
    targetFilters: parseCampaignTargetFilters(body.target_filters),
    scheduledAt: status === "pending" ? scheduledAt : null,
  };
}

function statusForError(message: string): number {
  const knownValidationError = [
    "Missing workspace context",
    "Invalid workspace id",
    "Name is required",
    "Invalid template id",
    "Invalid status",
    "Only draft or pending status can be set by users",
    "target_filters must be a JSON object",
    "Invalid scheduled_at",
    "Scheduled campaigns require a delivery time",
  ].includes(message);
  const filterValidationError =
    message.startsWith("Unsupported filter") ||
    message.endsWith("must be a finite number") ||
    message.endsWith("must be a string or null") ||
    message === "tags_contains must be a non-empty string";

  return knownValidationError || filterValidationError
    ? 400
    : 500;
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const campaigns = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<CampaignRow>(SELECT_CAMPAIGNS_SQL, [workspaceId]);
      return result.rows;
    });

    return NextResponse.json({ success: true, data: campaigns });
  } catch (error) {
    console.error("Failed to fetch campaigns:", error);

    const message = error instanceof Error ? error.message : "Failed to fetch campaigns";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const body = (await request.json()) as CreateCampaignBody;
    const campaign = parseCreateCampaignBody(body);

    const createdCampaign = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<CampaignRow>(INSERT_CAMPAIGN_SQL, [
        workspaceId,
        campaign.templateId,
        campaign.name,
        campaign.status,
        JSON.stringify(campaign.targetFilters),
        campaign.scheduledAt,
      ]);

      return result.rows[0];
    });

    if (!createdCampaign) {
      return NextResponse.json(
        { success: false, error: "Template not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: createdCampaign }, { status: 201 });
  } catch (error) {
    console.error("Failed to create campaign:", error);

    const message = error instanceof Error ? error.message : "Failed to create campaign";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
