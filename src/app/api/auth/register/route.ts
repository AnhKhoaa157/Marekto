import { randomBytes, scryptSync } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { signJWT } from "@/lib/auth";
import { getDbClient, initializeDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days, aligned with JWT expiry.
const OWNER_ROLE = "owner";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INSERT_WORKSPACE_SQL =
  'INSERT INTO "Workspaces" (name) VALUES ($1) RETURNING id';
const CHECK_USER_EXISTS_SQL = 'SELECT 1 FROM "Users" WHERE email = $1';
const INSERT_USER_SQL =
  'INSERT INTO "Users" (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id';
const UPDATE_WORKSPACE_OWNER_SQL =
  'UPDATE "Workspaces" SET owner_id = $1 WHERE id = $2';
const INSERT_MEMBERSHIP_SQL =
  'INSERT INTO "Workspace_members" (workspace_id, user_id, role) VALUES ($1, $2, $3)';

// Sentinel message mapped to a 400 by statusForError.
const EMAIL_TAKEN_ERROR = "Email already registered";

type RegisterBody = {
  email?: unknown;
  password?: unknown;
  workspaceName?: unknown;
};

type ParsedRegistration = {
  email: string;
  password: string;
  workspaceName: string;
};

/**
 * Hash a password for local/dev storage using Node's scrypt with a random salt.
 * Stored as `salt:derivedKey` (hex). Replace with a managed identity provider
 * before production.
 */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

function parseRegisterBody(body: RegisterBody): ParsedRegistration {
  if (typeof body.email !== "string" || body.email.trim().length === 0) {
    throw new Error("Email is required");
  }

  const email = body.email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Email is invalid");
  }

  if (typeof body.password !== "string" || body.password.length === 0) {
    throw new Error("Password is required");
  }

  const workspaceName =
    typeof body.workspaceName === "string" && body.workspaceName.trim().length > 0
      ? body.workspaceName.trim()
      : `Workspace of ${email}`;

  return { email, password: body.password, workspaceName };
}

function statusForError(message: string): number {
  if (
    ["Email is required", "Email is invalid", "Password is required"].includes(
      message,
    )
  ) {
    return 400;
  }

  if (message === EMAIL_TAKEN_ERROR) {
    return 400;
  }

  return 500;
}

type RegistrationResult = {
  userId: number;
  workspaceId: number;
};

/**
 * Provision a workspace + owner user + membership inside a single transaction.
 *
 * The pooled client is acquired here and ALWAYS released in `finally`: a normal
 * `release()` on success/handled rollback, or `release(true)` to destroy the
 * connection when it is left in an unknown state (a failed ROLLBACK), which
 * prevents a poisoned connection from being reused and exhausting the pool.
 */
async function runRegistrationTransaction(
  registration: ParsedRegistration,
): Promise<RegistrationResult> {
  const client = await getDbClient();
  let connectionIsBroken = false;

  try {
    await client.query("BEGIN");

    // Step 1: create the workspace and capture its integer id.
    const workspaceResult = await client.query<{ id: number }>(
      INSERT_WORKSPACE_SQL,
      [registration.workspaceName],
    );
    const newWorkspaceId = workspaceResult.rows[0].id;

    // Step 2: reject duplicate emails (rolls back via thrown sentinel), then
    // create the user with a securely hashed password.
    const existing = await client.query(CHECK_USER_EXISTS_SQL, [
      registration.email,
    ]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error(EMAIL_TAKEN_ERROR);
    }

    const userResult = await client.query<{ id: number }>(INSERT_USER_SQL, [
      registration.email,
      hashPassword(registration.password),
      OWNER_ROLE,
    ]);
    const newUserId = userResult.rows[0].id;

    // Link the workspace back to its owner now that the user id exists.
    await client.query(UPDATE_WORKSPACE_OWNER_SQL, [newUserId, newWorkspaceId]);

    // Step 3: bind the user to the workspace as its owner.
    await client.query(INSERT_MEMBERSHIP_SQL, [
      newWorkspaceId,
      newUserId,
      OWNER_ROLE,
    ]);

    await client.query("COMMIT");

    return { userId: newUserId, workspaceId: newWorkspaceId };
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      // A failing ROLLBACK means the connection is no longer trustworthy.
      connectionIsBroken = true;
      console.error("Rollback failed:", rollbackError);
    });

    throw error; // rethrow to be handled by the outer API error handler.
  } finally {
    client.release(connectionIsBroken);
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();

    const body = (await request.json()) as RegisterBody;
    const registration = parseRegisterBody(body);

    // Atomic, system-level provisioning across "Workspaces", "Users" and
    // "Workspace_members". The client is owned explicitly here so its release
    // back to the pool is guaranteed by the `finally` block below, regardless
    // of how the transaction resolves.
    const { userId, workspaceId } = await runRegistrationTransaction(registration);

    const token = await signJWT({ userId, workspaceId });

    const response = NextResponse.json(
      { success: true, data: { token, userId, workspaceId } },
      { status: 201 },
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
    console.error("Failed to register:", error);

    const message = error instanceof Error ? error.message : "Failed to register";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
