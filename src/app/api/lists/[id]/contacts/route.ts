import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT_LIST_CONTACTS_SQL =
  'SELECT c.id, c.workspace_id, c.email, c.first_name, c.last_name, c.phone, c.properties, c.created_at, clr.added_at FROM "Contacts" c INNER JOIN "Contact_list_relation" clr ON clr.contact_id = c.id AND clr.workspace_id = c.workspace_id INNER JOIN "Lists" l ON l.id = clr.list_id AND clr.workspace_id = l.workspace_id WHERE clr.list_id = $1 AND clr.workspace_id = $2 ORDER BY clr.added_at DESC, c.id DESC';
const INSERT_LIST_CONTACT_SQL =
  'INSERT INTO "Contact_list_relation" (workspace_id, contact_id, list_id) SELECT $3, $1, $2 WHERE EXISTS (SELECT 1 FROM "Contacts" WHERE id = $1 AND workspace_id = $3) AND EXISTS (SELECT 1 FROM "Lists" WHERE id = $2 AND workspace_id = $3) ON CONFLICT (contact_id, list_id) DO UPDATE SET added_at = "Contact_list_relation".added_at RETURNING contact_id, list_id, added_at';
const DELETE_LIST_CONTACT_SQL =
  'DELETE FROM "Contact_list_relation" WHERE contact_id = $1 AND list_id = $2 AND workspace_id = $3 RETURNING contact_id, list_id, added_at';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type ContactRow = {
  id: number;
  workspace_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  properties: Record<string, unknown>;
  created_at: Date;
  added_at: Date;
};

type ListContactRelationRow = {
  contact_id: number;
  list_id: number;
  added_at: Date;
};

type ContactRelationBody = {
  contact_id?: unknown;
};

async function getListId({ params }: RouteParams): Promise<number> {
  const { id } = await params;
  const listId = Number(id);

  if (!Number.isInteger(listId) || listId <= 0) {
    throw new Error("Invalid list id");
  }

  return listId;
}

function parseContactId(value: unknown): number {
  const contactId = Number(value);

  if (!Number.isInteger(contactId) || contactId <= 0) {
    throw new Error("Invalid contact id");
  }

  return contactId;
}

async function getContactIdFromRequest(request: NextRequest): Promise<number> {
  const queryContactId = request.nextUrl.searchParams.get("contact_id");

  if (queryContactId) {
    return parseContactId(queryContactId);
  }

  const body = (await request.json()) as ContactRelationBody;
  return parseContactId(body.contact_id);
}

function statusForError(message: string): number {
  return [
    "Missing workspace context",
    "Invalid workspace id",
    "Invalid list id",
    "Invalid contact id",
  ].includes(message)
    ? 400
    : 500;
}

export async function GET(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const listId = await getListId(context);

    const contacts = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ContactRow>(SELECT_LIST_CONTACTS_SQL, [
        listId,
        workspaceId,
      ]);

      return result.rows;
    });

    return NextResponse.json({ success: true, data: contacts });
  } catch (error) {
    console.error("Failed to fetch list contacts:", error);

    const message = error instanceof Error ? error.message : "Failed to fetch list contacts";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}

export async function POST(request: NextRequest, context: RouteParams) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const listId = await getListId(context);
    const body = (await request.json()) as ContactRelationBody;
    const contactId = parseContactId(body.contact_id);

    const relation = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ListContactRelationRow>(INSERT_LIST_CONTACT_SQL, [
        contactId,
        listId,
        workspaceId,
      ]);

      return result.rows[0];
    });

    if (!relation) {
      return NextResponse.json(
        { success: false, error: "List or contact not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: relation }, { status: 201 });
  } catch (error) {
    console.error("Failed to add contact to list:", error);

    const message = error instanceof Error ? error.message : "Failed to add contact to list";

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
    const contactId = await getContactIdFromRequest(request);

    const removedRelation = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ListContactRelationRow>(DELETE_LIST_CONTACT_SQL, [
        contactId,
        listId,
        workspaceId,
      ]);

      return result.rows[0];
    });

    if (!removedRelation) {
      return NextResponse.json(
        { success: false, error: "List contact relation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, data: removedRelation });
  } catch (error) {
    console.error("Failed to remove contact from list:", error);

    const message = error instanceof Error ? error.message : "Failed to remove contact from list";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
