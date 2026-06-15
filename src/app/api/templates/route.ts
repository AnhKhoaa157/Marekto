import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT_TEMPLATES_SQL =
  'SELECT id, workspace_id, name, body_html, body_json, created_at, updated_at FROM "Templates" WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC';
const INSERT_TEMPLATE_SQL =
  'INSERT INTO "Templates" (workspace_id, name, body_html, body_json) VALUES ($1, $2, $3, $4::jsonb) RETURNING id, workspace_id, name, body_html, body_json, created_at, updated_at';

type TemplateRow = {
  id: number;
  workspace_id: number;
  name: string;
  body_html: string;
  body_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

type CreateTemplateBody = {
  name?: unknown;
  body_html?: unknown;
  body_json?: unknown;
};

function getWorkspaceId(request: NextRequest): number {
  const headerValue = request.headers.get("x-workspace-id");
  const workspaceId = headerValue ? Number(headerValue) : 1;

  if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error("Invalid workspace id");
  }

  return workspaceId;
}

function parseCreateTemplateBody(body: CreateTemplateBody) {
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new Error("Name is required");
  }

  if (body.body_html !== undefined && typeof body.body_html !== "string") {
    throw new Error("body_html must be a string");
  }

  const bodyJson = body.body_json ?? {};

  if (
    typeof bodyJson !== "object" ||
    bodyJson === null ||
    Array.isArray(bodyJson)
  ) {
    throw new Error("body_json must be a JSON object");
  }

  return {
    name: body.name.trim(),
    bodyHtml: typeof body.body_html === "string" ? body.body_html : "",
    bodyJson: bodyJson as Record<string, unknown>,
  };
}

function statusForError(message: string): number {
  return [
    "Invalid workspace id",
    "Name is required",
    "body_html must be a string",
    "body_json must be a JSON object",
  ].includes(message)
    ? 400
    : 500;
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceId(request);
    const templates = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<TemplateRow>(SELECT_TEMPLATES_SQL, [workspaceId]);
      return result.rows;
    });

    return NextResponse.json({ success: true, data: templates });
  } catch (error) {
    console.error("Failed to fetch templates:", error);

    const message = error instanceof Error ? error.message : "Failed to fetch templates";

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
    const body = (await request.json()) as CreateTemplateBody;
    const template = parseCreateTemplateBody(body);

    const createdTemplate = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<TemplateRow>(INSERT_TEMPLATE_SQL, [
        workspaceId,
        template.name,
        template.bodyHtml,
        JSON.stringify(template.bodyJson),
      ]);

      return result.rows[0];
    });

    return NextResponse.json({ success: true, data: createdTemplate }, { status: 201 });
  } catch (error) {
    console.error("Failed to create template:", error);

    const message = error instanceof Error ? error.message : "Failed to create template";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
