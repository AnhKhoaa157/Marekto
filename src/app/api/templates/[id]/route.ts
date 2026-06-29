import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPDATE_TEMPLATE_SQL =
  'UPDATE "Templates" SET name = COALESCE($1, name), ' +
  "body_html = COALESCE($2, body_html), " +
  "body_json = COALESCE($3::jsonb, body_json), updated_at = NOW() " +
  "WHERE id = $4 AND workspace_id = $5 " +
  "RETURNING id, workspace_id, name, body_html, body_json, created_at, updated_at";
const DELETE_TEMPLATE_SQL =
  'DELETE FROM "Templates" WHERE id = $1 AND workspace_id = $2 ' +
  "RETURNING id, workspace_id, name, body_html, body_json, created_at, updated_at";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type TemplateRow = {
  id: number;
  workspace_id: number;
  name: string;
  body_html: string;
  body_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type UpdateTemplateBody = {
  name?: unknown;
  body_html?: unknown;
  body_json?: unknown;
};

async function getTemplateId({ params }: RouteParams): Promise<number> {
  const { id } = await params;
  const templateId = Number(id);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error("Invalid template id");
  }

  return templateId;
}

function parseUpdateBody(body: UpdateTemplateBody) {
  let name: string | null = null;
  let bodyHtml: string | null = null;
  let bodyJson: Record<string, unknown> | null = null;

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new Error("Name must be a non-empty string");
    }
    name = body.name.trim();
  }

  if (body.body_html !== undefined) {
    if (typeof body.body_html !== "string") {
      throw new Error("body_html must be a string");
    }
    bodyHtml = body.body_html;
  }

  if (body.body_json !== undefined) {
    if (
      typeof body.body_json !== "object" ||
      body.body_json === null ||
      Array.isArray(body.body_json)
    ) {
      throw new Error("body_json must be a JSON object");
    }
    bodyJson = body.body_json as Record<string, unknown>;
  }

  if (name === null && bodyHtml === null && bodyJson === null) {
    throw new Error("At least one field is required");
  }

  return { name, bodyHtml, bodyJson };
}

function statusForError(message: string): number {
  return [
    "Missing workspace context",
    "Invalid workspace id",
    "Invalid template id",
    "Name must be a non-empty string",
    "body_html must be a string",
    "body_json must be a JSON object",
    "At least one field is required",
  ].includes(message)
    ? 400
    : 500;
}

export async function PUT(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const templateId = await getTemplateId(context);
    const body = (await request.json()) as UpdateTemplateBody;
    const template = parseUpdateBody(body);

    const updatedTemplate = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<TemplateRow>(UPDATE_TEMPLATE_SQL, [
        template.name,
        template.bodyHtml,
        template.bodyJson ? JSON.stringify(template.bodyJson) : null,
        templateId,
        workspaceId,
      ]);
      return result.rows[0];
    });

    if (!updatedTemplate) {
      return NextResponse.json(
        { success: false, error: "Template not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: updatedTemplate });
  } catch (error) {
    console.error("Failed to update template:", error);
    const message = error instanceof Error ? error.message : "Failed to update template";

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
    const templateId = await getTemplateId(context);
    const deletedTemplate = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<TemplateRow>(DELETE_TEMPLATE_SQL, [
        templateId,
        workspaceId,
      ]);
      return result.rows[0];
    });

    if (!deletedTemplate) {
      return NextResponse.json(
        { success: false, error: "Template not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: deletedTemplate });
  } catch (error) {
    console.error("Failed to delete template:", error);
    const message = error instanceof Error ? error.message : "Failed to delete template";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
