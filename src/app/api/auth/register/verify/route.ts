import { NextResponse, type NextRequest } from "next/server";

import {
  MAX_REGISTRATION_OTP_ATTEMPTS,
  normalizeOtp,
  verifyOtp,
} from "@/lib/auth-otp";
import { signJWT } from "@/lib/auth";
import { initializeDatabase, query } from "@/lib/db";
import {
  EMAIL_TAKEN_ERROR,
  runRegistrationTransaction,
} from "@/lib/registration";
import { createActiveSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE_NAME = "auth_token";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SELECT_REGISTRATION_OTP_SQL =
  'SELECT email, password_hash, workspace_name, otp_hash, attempts, expires_at FROM "Registration_otps" WHERE email = $1';
const INCREMENT_REGISTRATION_OTP_ATTEMPTS_SQL =
  'UPDATE "Registration_otps" SET attempts = attempts + 1, updated_at = NOW() WHERE email = $1';
const DELETE_REGISTRATION_OTP_SQL =
  'DELETE FROM "Registration_otps" WHERE email = $1';

type VerifyRegistrationBody = {
  email?: unknown;
  otp?: unknown;
};

type PendingRegistrationRow = {
  email: string;
  password_hash: string;
  workspace_name: string | null;
  otp_hash: string;
  attempts: number;
  expires_at: Date;
};

function parseEmail(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Email is required");
  }

  const email = value.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    throw new Error("Email is invalid");
  }

  return email;
}

function statusForError(message: string): number {
  if (
    [
      "Email is required",
      "Email is invalid",
      "OTP is required",
      "OTP must be a 6-digit code",
      "OTP is invalid or expired",
      EMAIL_TAKEN_ERROR,
    ].includes(message)
  ) {
    return 400;
  }

  return 500;
}

async function getPendingRegistration(
  email: string,
): Promise<PendingRegistrationRow | null> {
  const result = await query<PendingRegistrationRow>(SELECT_REGISTRATION_OTP_SQL, [
    email,
  ]);

  return result.rows[0] ?? null;
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();

    const body = (await request.json()) as VerifyRegistrationBody;
    const email = parseEmail(body.email);
    const otp = normalizeOtp(body.otp);
    const pendingRegistration = await getPendingRegistration(email);

    if (
      !pendingRegistration ||
      pendingRegistration.expires_at.getTime() <= Date.now() ||
      pendingRegistration.attempts >= MAX_REGISTRATION_OTP_ATTEMPTS
    ) {
      if (pendingRegistration) {
        await query(DELETE_REGISTRATION_OTP_SQL, [email]);
      }

      throw new Error("OTP is invalid or expired");
    }

    if (!verifyOtp(otp, pendingRegistration.otp_hash)) {
      await query(INCREMENT_REGISTRATION_OTP_ATTEMPTS_SQL, [email]);
      throw new Error("OTP is invalid or expired");
    }

    const { userId, workspaceId } = await runRegistrationTransaction({
      email,
      passwordHash: pendingRegistration.password_hash,
      workspaceName: pendingRegistration.workspace_name,
    });

    await query(DELETE_REGISTRATION_OTP_SQL, [email]).catch((cleanupError) => {
      console.error("Failed to clean verified registration OTP:", cleanupError);
    });

    const sessionId = await createActiveSession(userId);
    const token = await signJWT({ userId, workspaceId, sessionId });
    const nextPath = workspaceId ? "/dashboard" : "/onboarding/workspace";

    const response = NextResponse.json(
      { success: true, data: { token, userId, workspaceId, nextPath } },
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
    console.error("Failed to verify registration:", error);

    const message =
      error instanceof Error ? error.message : "Failed to verify registration";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
