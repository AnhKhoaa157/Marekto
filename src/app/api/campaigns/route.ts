import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["draft", "pending", "sent"] as const;

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

function getWorkspaceId(request: NextRequest): number {
  const headerValue = request.headers.get("x-workspace-id");
  const workspaceId = headerValue ? Number(headerValue) : 1;

  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error("Invalid workspace id");
  }

  return workspaceId;
}

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

function parseStatus(value: unknown): string {
  if (value === undefined || value === null) {
    return "draft";
  }

  if (typeof value !== "string") {
    throw new Error("Invalid status");
  }

  const normalized = value.trim().toLowerCase();

  if (!VALID_STATUSES.includes(normalized as (typeof VALID_STATUSES)[number])) {
    throw new Error("Invalid status");
  }

  return normalized;
}

function parseTargetFilters(value: unknown): Record<string, unknown> {
  const filters = value ?? {};

  if (typeof filters !== "object" || filters === null || Array.isArray(filters)) {
    throw new Error("target_filters must be a JSON object");
  }

  return filters as Record<string, unknown>;
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

  return {
    name: body.name.trim(),
    templateId: parseOptionalTemplateId(body.template_id),
    status: parseStatus(body.status),
    targetFilters: parseTargetFilters(body.target_filters),
    scheduledAt: parseScheduledAt(body.scheduled_at),
  };
}

function statusForError(message: string): number {
  return [
    "Invalid workspace id",
    "Name is required",
    "Invalid template id",
    "Invalid status",
    "target_filters must be a JSON object",
    "Invalid scheduled_at",
  ].includes(message)
    ? 400
    : 500;
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceId(request);
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

    const workspaceId = getWorkspaceId(request);
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
