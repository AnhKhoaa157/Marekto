import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = ["draft", "pending", "sent"] as const;

const UPDATE_CAMPAIGN_SQL =
  'UPDATE "Campaigns" SET ' +
  "name = COALESCE($1, name), " +
  "status = COALESCE($2, status), " +
  "target_filters = COALESCE($3::jsonb, target_filters), " +
  "scheduled_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE scheduled_at END, " +
  "run_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE run_at END, " +
  "template_id = CASE WHEN $6::boolean THEN $7::int ELSE template_id END, " +
  "updated_at = CURRENT_TIMESTAMP " +
  "WHERE id = $8 AND workspace_id = $9 " +
  "RETURNING id, workspace_id, template_id, name, status, target_filters, scheduled_at, run_at, created_at, updated_at";
const DELETE_CAMPAIGN_SQL =
  'DELETE FROM "Campaigns" WHERE id = $1 AND workspace_id = $2 RETURNING id, workspace_id, template_id, name, status, target_filters, scheduled_at, run_at, created_at, updated_at';

type RouteParams = {
  params: Promise<{ id: string }>;
};

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

type UpdateCampaignBody = {
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

async function getCampaignId({ params }: RouteParams): Promise<number> {
  const { id } = await params;
  const campaignId = Number(id);

  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    throw new Error("Invalid campaign id");
  }

  return campaignId;
}

function parseName(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Name must be a non-empty string");
  }

  return value.trim();
}

function parseStatus(value: unknown): string | null {
  if (value === undefined) {
    return null;
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

function parseTargetFilters(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("target_filters must be a JSON object");
  }

  return JSON.stringify(value);
}

function parseScheduledAt(value: unknown): { provided: boolean; value: string | null } {
  if (value === undefined) {
    return { provided: false, value: null };
  }

  if (value === null) {
    return { provided: true, value: null };
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Invalid scheduled_at");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid scheduled_at");
  }

  return { provided: true, value: date.toISOString() };
}

function parseTemplateId(value: unknown): { provided: boolean; value: number | null } {
  if (value === undefined) {
    return { provided: false, value: null };
  }

  if (value === null) {
    return { provided: true, value: null };
  }

  const templateId = Number(value);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error("Invalid template id");
  }

  return { provided: true, value: templateId };
}

function statusForError(message: string): number {
  return [
    "Invalid workspace id",
    "Invalid campaign id",
    "Name must be a non-empty string",
    "Invalid status",
    "target_filters must be a JSON object",
    "Invalid scheduled_at",
    "Invalid template id",
    "At least one field is required",
  ].includes(message)
    ? 400
    : 500;
}

export async function PUT(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceId(request);
    const campaignId = await getCampaignId(context);
    const body = (await request.json()) as UpdateCampaignBody;

    const name = parseName(body.name);
    const status = parseStatus(body.status);
    const targetFilters = parseTargetFilters(body.target_filters);
    const scheduledAt = parseScheduledAt(body.scheduled_at);
    const templateId = parseTemplateId(body.template_id);

    if (
      name === null &&
      status === null &&
      targetFilters === null &&
      !scheduledAt.provided &&
      !templateId.provided
    ) {
      throw new Error("At least one field is required");
    }

    const updatedCampaign = await withWorkspace(workspaceId, async (client) => {
      if (templateId.provided && templateId.value !== null) {
        const templateCheck = await client.query(
          'SELECT 1 FROM "Templates" WHERE id = $1 AND workspace_id = $2',
          [templateId.value, workspaceId],
        );

        if (templateCheck.rowCount === 0) {
          throw new Error("Template not found");
        }
      }

      const result = await client.query<CampaignRow>(UPDATE_CAMPAIGN_SQL, [
        name,
        status,
        targetFilters,
        scheduledAt.provided,
        scheduledAt.value,
        templateId.provided,
        templateId.value,
        campaignId,
        workspaceId,
      ]);

      return result.rows[0];
    });

    if (!updatedCampaign) {
      return NextResponse.json(
        { success: false, error: "Campaign not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: updatedCampaign });
  } catch (error) {
    console.error("Failed to update campaign:", error);

    const message = error instanceof Error ? error.message : "Failed to update campaign";

    if (message === "Template not found") {
      return NextResponse.json({ success: false, error: message }, { status: 404 });
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceId(request);
    const campaignId = await getCampaignId(context);

    const deletedCampaign = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<CampaignRow>(DELETE_CAMPAIGN_SQL, [
        campaignId,
        workspaceId,
      ]);

      return result.rows[0];
    });

    if (!deletedCampaign) {
      return NextResponse.json(
        { success: false, error: "Campaign not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: deletedCampaign });
  } catch (error) {
    console.error("Failed to delete campaign:", error);

    const message = error instanceof Error ? error.message : "Failed to delete campaign";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
