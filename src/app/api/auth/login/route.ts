import { scryptSync, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { signJWT } from "@/lib/auth";
import { initializeDatabase, query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, aligned with JWT expiry.

// Resolve the user's primary workspace without a tenant context. Login happens
// before any workspace is known, so this runs through the cross-tenant pool
// helper (requires a BYPASSRLS / superuser role). Membership takes precedence,
// falling back to an owned workspace.
const SELECT_USER_WORKSPACE_SQL =
  'SELECT u.id AS user_id, u.password_hash, ' +
  '       COALESCE(wm.workspace_id, w.id) AS workspace_id ' +
  'FROM "Users" u ' +
  'LEFT JOIN "Workspace_members" wm ON wm.user_id = u.id ' +
  'LEFT JOIN "Workspaces" w ON w.owner_id = u.id ' +
  "WHERE u.email = $1 " +
  "ORDER BY wm.joined_at ASC NULLS LAST, w.id ASC " +
  "LIMIT 1";

type UserWorkspaceRow = {
  user_id: number;
  password_hash: string;
  workspace_id: number | null;
};

type LoginBody = {
  email?: unknown;
  username?: unknown;
  password?: unknown;
};

type ParsedCredentials = {
  identifier: string;
  password: string;
};

function parseLoginBody(body: LoginBody): ParsedCredentials {
  const rawIdentifier = body.email ?? body.username;

  if (typeof rawIdentifier !== "string" || rawIdentifier.trim().length === 0) {
    throw new Error("Email or username is required");
  }

  if (typeof body.password !== "string" || body.password.length === 0) {
    throw new Error("Password is required");
  }

  return {
    identifier: rawIdentifier.trim().toLowerCase(),
    password: body.password,
  };
}

function statusForError(message: string): number {
  if (["Email or username is required", "Password is required"].includes(message)) {
    return 400;
  }

  if (message === "Invalid credentials") {
    return 401;
  }

  return 500;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, derivedKeyHex] = storedHash.split(":");

  if (!saltHex || !derivedKeyHex) {
    return false;
  }

  try {
    const expectedKey = Buffer.from(derivedKeyHex, "hex");
    const actualKey = scryptSync(password, Buffer.from(saltHex, "hex"), expectedKey.length);

    return (
      actualKey.length === expectedKey.length &&
      timingSafeEqual(actualKey, expectedKey)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();

    const body = (await request.json()) as LoginBody;
    const credentials = parseLoginBody(body);

    // Fetch the real integer ids backing this user and verify the password hash
    // produced by the registration route.
    const result = await query<UserWorkspaceRow>(SELECT_USER_WORKSPACE_SQL, [
      credentials.identifier,
    ]);
    const row = result.rows[0];

    if (!row || !row.workspace_id || !verifyPassword(credentials.password, row.password_hash)) {
      throw new Error("Invalid credentials");
    }

    const userId = row.user_id;
    const workspaceId = row.workspace_id;

    const token = await signJWT({ userId, workspaceId });

    const response = NextResponse.json(
      { success: true, data: { token, userId, workspaceId } },
      { status: 200 },
    );

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    console.error("Failed to authenticate:", error);

    const message = error instanceof Error ? error.message : "Failed to authenticate";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
