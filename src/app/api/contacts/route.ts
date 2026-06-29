import { NextResponse, type NextRequest } from "next/server";

import { initializeDatabase, withWorkspace } from "@/lib/db";
import { getWorkspaceIdFromHeaders } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INSERT_CONTACT_SQL =
  'INSERT INTO "Contacts" (workspace_id, email, first_name, last_name, phone, properties) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *';
const SELECT_CONTACTS_SQL =
  'SELECT * FROM "Contacts" WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC';

type ContactRow = {
  id: number;
  workspace_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  properties: Record<string, unknown>;
  created_at: Date;
};

type CreateContactBody = {
  email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  properties?: unknown;
};

function asOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Optional contact fields must be strings");
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function parseCreateContactBody(body: CreateContactBody) {
  if (typeof body.email !== "string" || body.email.trim().length === 0) {
    throw new Error("Email is required");
  }

  const properties = body.properties ?? {};

  if (
    typeof properties !== "object" ||
    properties === null ||
    Array.isArray(properties)
  ) {
    throw new Error("Properties must be a JSON object");
  }

  return {
    email: body.email.trim().toLowerCase(),
    firstName: asOptionalString(body.first_name),
    lastName: asOptionalString(body.last_name),
    phone: asOptionalString(body.phone),
    properties: properties as Record<string, unknown>,
  };
}

function statusForError(message: string): number {
  return [
    "Missing workspace context",
    "Invalid workspace id",
    "Email is required",
    "Optional contact fields must be strings",
    "Properties must be a JSON object",
  ].includes(message)
    ? 400
    : 500;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const contacts = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ContactRow>(SELECT_CONTACTS_SQL, [workspaceId]);
      return result.rows;
    });

    return NextResponse.json({
      success: true,
      data: contacts,
    });
  } catch (error) {
    console.error("Failed to fetch contacts:", error);

    const message = error instanceof Error ? error.message : "Failed to fetch contacts";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: statusForError(message) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();

    const workspaceId = getWorkspaceIdFromHeaders(request.headers);
    const body = (await request.json()) as CreateContactBody;
    const contact = parseCreateContactBody(body);

    const createdContact = await withWorkspace(workspaceId, async (client) => {
      const result = await client.query<ContactRow>(INSERT_CONTACT_SQL, [
        workspaceId,
        contact.email,
        contact.firstName,
        contact.lastName,
        contact.phone,
        JSON.stringify(contact.properties),
      ]);

      return result.rows[0];
    });

    return NextResponse.json(
      {
        success: true,
        data: createdContact,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create contact:", error);

    const message = isUniqueViolation(error)
      ? "Email already exists in this workspace"
      : error instanceof Error
        ? error.message
        : "Failed to create contact";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: isUniqueViolation(error) ? 400 : statusForError(message) },
    );
  }
}
