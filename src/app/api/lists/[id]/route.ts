import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";
import { parseUuid } from "@/lib/identifiers";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPDATE_LIST_SQL =
  'UPDATE "Lists" SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 AND workspace_id = $4 RETURNING id, workspace_id, name, description, created_at';
const DELETE_LIST_SQL =
  'DELETE FROM "Lists" WHERE id = $1 AND workspace_id = $2 RETURNING id, workspace_id, name, description, created_at';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type ListRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: Date;
};

type UpdateListBody = {
  name?: unknown;
  description?: unknown;
};

async function getListId({ params }: RouteParams): Promise<string> {
  const { id } = await params;
  return parseUuid(id, "List id");
}

function parseUpdateListBody(body: UpdateListBody) {
  let name: string | null = null;
  let description: string | null = null;

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      throw new Error("Name must be a non-empty string");
    }

    name = body.name.trim();
  }

  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== "string") {
      throw new Error("Description must be a string or null");
    }

    description = body.description === null ? null : body.description.trim();
  }

  if (name === null && description === null && body.description !== null) {
    throw new Error("At least one field is required");
  }

  return { name, description };
}

function statusForError(message: string): number {
  return [
    "Missing workspace context",
    "Invalid workspace id",
    "Invalid list id",
    "Name must be a non-empty string",
    "Description must be a string or null",
    "At least one field is required",
  ].includes(message)
    ? 400
    : 500;
}

export async function PUT(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const listId = await getListId(context);
    const body = (await request.json()) as UpdateListBody;
    const list = parseUpdateListBody(body);

    const updatedList = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ListRow>(UPDATE_LIST_SQL, [
        list.name,
        list.description,
        listId,
        workspaceId,
      ]);

      return result.rows[0];
    });

    if (!updatedList) {
      return NextResponse.json(
        { success: false, error: "List not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: updatedList });
  } catch (error) {
    console.error("Failed to update list:", error);

    const message = error instanceof Error ? error.message : "Failed to update list";

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
    const listId = await getListId(context);

    const deletedList = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ListRow>(DELETE_LIST_SQL, [listId, workspaceId]);
      return result.rows[0];
    });

    if (!deletedList) {
      return NextResponse.json(
        { success: false, error: "List not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: deletedList });
  } catch (error) {
    console.error("Failed to delete list:", error);

    const message = error instanceof Error ? error.message : "Failed to delete list";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
