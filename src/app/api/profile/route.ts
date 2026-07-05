import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
  type AccountIdentity,
} from "@/lib/account-auth";
import { initializeDatabase, query } from "@/lib/db";
import {
  isProfileValidationError,
  parseProfileUpdateBody,
} from "@/lib/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT_PROFILE_SQL =
  'SELECT id, email, role, first_name, last_name, phone, created_at FROM "Users" WHERE id = $1';
const UPDATE_PROFILE_SQL =
  'UPDATE "Users" SET first_name = $1, last_name = $2, phone = $3 WHERE id = $4 RETURNING id, email, role, first_name, last_name, phone, created_at';

type ProfileRow = {
  id: string;
  email: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: Date;
};

function statusForError(message: string): number {
  if (message === "Unauthorized") {
    return 401;
  }

  if (message === "Profile not found") {
    return 404;
  }

  if (isProfileValidationError(message)) {
    return 400;
  }

  return statusForAccountAuthError(message);
}

async function requireApiSession(
  request: NextRequest,
): Promise<AccountIdentity> {
  return authenticateAccountRequest(request);
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();

    const session = await requireApiSession(request);
    const result = await query<ProfileRow>(SELECT_PROFILE_SQL, [session.userId]);
    const profile = result.rows[0];

    if (!profile) {
      throw new Error("Profile not found");
    }

    return NextResponse.json({ success: true, data: profile });
  } catch (error) {
    console.error("Failed to fetch profile:", error);

    const message = error instanceof Error ? error.message : "Failed to fetch profile";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await initializeDatabase();

    const session = await requireApiSession(request);
    const requestBody = await request.json().catch(() => {
      throw new Error("Profile payload must be a JSON object");
    });
    const profileUpdate = parseProfileUpdateBody(requestBody);

    const result = await query<ProfileRow>(UPDATE_PROFILE_SQL, [
      profileUpdate.firstName,
      profileUpdate.lastName,
      profileUpdate.phone,
      session.userId,
    ]);
    const profile = result.rows[0];

    if (!profile) {
      throw new Error("Profile not found");
    }

    return NextResponse.json({ success: true, data: profile }, { status: 200 });
  } catch (error) {
    console.error("Failed to update profile:", error);

    const message = error instanceof Error ? error.message : "Failed to update profile";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
