import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT_LISTS_SQL =
  'SELECT id, workspace_id, name, description, created_at FROM "Lists" WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC';
const INSERT_LIST_SQL =
  'INSERT INTO "Lists" (workspace_id, name, description) VALUES ($1, $2, $3) RETURNING id, workspace_id, name, description, created_at';

type ListRow = {
  id: number;
  workspace_id: number;
  name: string;
  description: string | null;
  created_at: Date;
};

type CreateListBody = {
  name?: unknown;
  description?: unknown;
};

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Description must be a string");
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function parseCreateListBody(body: CreateListBody) {
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    throw new Error("Name is required");
  }

  return {
    name: body.name.trim(),
    description: asOptionalString(body.description),
  };
}

function statusForError(message: string): number {
  return [
    "Missing workspace context",
    "Invalid workspace id",
    "Name is required",
    "Description must be a string",
  ].includes(message)
    ? 400
    : 500;
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const lists = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ListRow>(SELECT_LISTS_SQL, [workspaceId]);
      return result.rows;
    });

    return NextResponse.json({ success: true, data: lists });
  } catch (error) {
    console.error("Failed to fetch lists:", error);

    const message = error instanceof Error ? error.message : "Failed to fetch lists";

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
    const body = (await request.json()) as CreateListBody;
    const list = parseCreateListBody(body);

    const createdList = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ListRow>(INSERT_LIST_SQL, [
        workspaceId,
        list.name,
        list.description,
      ]);

      return result.rows[0];
    });

    return NextResponse.json({ success: true, data: createdList }, { status: 201 });
  } catch (error) {
    console.error("Failed to create list:", error);

    const message = error instanceof Error ? error.message : "Failed to create list";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
