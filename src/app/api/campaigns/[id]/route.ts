import { NextResponse, type NextRequest } from "next/server";

import {
  parseCampaignTargetFilters,
  type CampaignTargetFilters,
} from "@/lib/campaign-filters";
import {
  assertCampaignSchedule,
  assertUserCampaignIsEditable,
  isCampaignStatus,
  parseAiPersonalizationEnabled,
  parseUserCampaignStatus,
  type CampaignStatus,
  type UserCampaignStatus,
} from "@/lib/campaign-status";
import { initializeDatabase, withWorkspace } from "@/lib/db";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPDATE_CAMPAIGN_SQL =
  'UPDATE "Campaigns" SET name = $1, status = $2, target_filters = $3::jsonb, ' +
  "scheduled_at = $4::timestamptz, run_at = $4::timestamptz, template_id = $5::int, " +
  "ai_personalization_enabled = $6, updated_at = CURRENT_TIMESTAMP " +
  "WHERE id = $7 AND workspace_id = $8 " +
  "RETURNING id, workspace_id, template_id, name, status, target_filters, ai_personalization_enabled, scheduled_at, run_at, created_at, updated_at";
const SELECT_CAMPAIGN_FOR_UPDATE_SQL =
  'SELECT id, workspace_id, template_id, name, status, target_filters, ai_personalization_enabled, scheduled_at, run_at, created_at, updated_at FROM "Campaigns" WHERE id = $1 AND workspace_id = $2 FOR UPDATE';
const DELETE_CAMPAIGN_SQL =
  'DELETE FROM "Campaigns" WHERE id = $1 AND workspace_id = $2 RETURNING id, workspace_id, template_id, name, status, target_filters, ai_personalization_enabled, scheduled_at, run_at, created_at, updated_at';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type CampaignRow = {
  id: number;
  workspace_id: number;
  template_id: number | null;
  name: string;
  status: CampaignStatus;
  target_filters: CampaignTargetFilters;
  ai_personalization_enabled: boolean;
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
  ai_personalization_enabled?: unknown;
  scheduled_at?: unknown;
};

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

function parseStatus(value: unknown): UserCampaignStatus | null {
  if (value === undefined) {
    return null;
  }

  return parseUserCampaignStatus(value, "draft");
}

function parseTargetFilters(value: unknown): CampaignTargetFilters | null {
  if (value === undefined) {
    return null;
  }

  return parseCampaignTargetFilters(value);
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

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function statusForError(message: string): number {
  const knownValidationError = [
    "Missing workspace context",
    "Invalid workspace id",
    "Invalid campaign id",
    "Name must be a non-empty string",
    "Invalid status",
    "Only draft or pending status can be set by users",
    "Processing or sent campaigns cannot be edited",
    "target_filters must be a JSON object",
    "ai_personalization_enabled must be a boolean",
    "Invalid scheduled_at",
    "Invalid template id",
    "At least one field is required",
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

export async function PUT(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const campaignId = await getCampaignId(context);
    const body = (await request.json()) as UpdateCampaignBody;

    const name = parseName(body.name);
    const status = parseStatus(body.status);
    const targetFilters = parseTargetFilters(body.target_filters);
    const scheduledAt = parseScheduledAt(body.scheduled_at);
    const templateId = parseTemplateId(body.template_id);
    const aiPersonalizationProvided = body.ai_personalization_enabled !== undefined;

    if (
      name === null &&
      status === null &&
      targetFilters === null &&
      !scheduledAt.provided &&
      !templateId.provided &&
      !aiPersonalizationProvided
    ) {
      throw new Error("At least one field is required");
    }

    const updatedCampaign = await withWorkspace(workspaceId, async (client) => {
      const currentResult = await client.query<CampaignRow>(
        SELECT_CAMPAIGN_FOR_UPDATE_SQL,
        [campaignId, workspaceId],
      );
      const currentCampaign = currentResult.rows[0];

      if (!currentCampaign) {
        return null;
      }

      if (!isCampaignStatus(currentCampaign.status)) {
        throw new Error("Campaign has an unsupported stored status");
      }

      assertUserCampaignIsEditable(currentCampaign.status);

      if (templateId.provided && templateId.value !== null) {
        const templateCheck = await client.query(
          'SELECT 1 FROM "Templates" WHERE id = $1 AND workspace_id = $2',
          [templateId.value, workspaceId],
        );

        if (templateCheck.rowCount === 0) {
          throw new Error("Template not found");
        }
      }

      const nextStatus = status ?? currentCampaign.status;
      const requestedSchedule = scheduledAt.provided
        ? scheduledAt.value
        : toIsoString(currentCampaign.scheduled_at);
      const nextScheduledAt =
        nextStatus === "draft" || nextStatus === "failed" ? null : requestedSchedule;

      assertCampaignSchedule(nextStatus, nextScheduledAt);

      const result = await client.query<CampaignRow>(UPDATE_CAMPAIGN_SQL, [
        name ?? currentCampaign.name,
        nextStatus,
        JSON.stringify(
          targetFilters ?? parseCampaignTargetFilters(currentCampaign.target_filters),
        ),
        nextScheduledAt,
        templateId.provided ? templateId.value : currentCampaign.template_id,
        parseAiPersonalizationEnabled(
          body.ai_personalization_enabled,
          currentCampaign.ai_personalization_enabled,
        ),
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

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
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
