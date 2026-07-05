import { NextResponse, type NextRequest } from "next/server";

import {
  REGISTRATION_OTP_TTL_SECONDS,
  generateRegistrationOtp,
  hashOtp,
} from "@/lib/auth-otp";
import { initializeDatabase, query } from "@/lib/db";
import { sendRegistrationOtpEmail } from "@/lib/mail/auth";
import { sanitizeMailError } from "@/lib/mail/nodemailer";
import { hashPassword } from "@/lib/password";
import { EMAIL_TAKEN_ERROR } from "@/lib/registration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHECK_USER_EXISTS_SQL = 'SELECT 1 FROM "Users" WHERE email = $1';
const UPSERT_REGISTRATION_OTP_SQL =
  'INSERT INTO "Registration_otps" (email, password_hash, workspace_name, otp_hash, attempts, expires_at) ' +
  "VALUES ($1, $2, $3, $4, 0, NOW() + ($5 * INTERVAL '1 second')) " +
  "ON CONFLICT (email) DO UPDATE SET " +
  "password_hash = EXCLUDED.password_hash, workspace_name = EXCLUDED.workspace_name, " +
  "otp_hash = EXCLUDED.otp_hash, attempts = 0, expires_at = EXCLUDED.expires_at, updated_at = NOW()";
const DELETE_REGISTRATION_OTP_SQL =
  'DELETE FROM "Registration_otps" WHERE email = $1';

type RegisterBody = {
  email?: unknown;
  password?: unknown;
  workspaceName?: unknown;
};

type ParsedRegistration = {
  email: string;
  password: string;
  workspaceName: string | null;
};

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
      : null;

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

async function assertEmailIsAvailable(email: string): Promise<void> {
  const existing = await query(CHECK_USER_EXISTS_SQL, [email]);

  if (existing.rowCount && existing.rowCount > 0) {
    throw new Error(EMAIL_TAKEN_ERROR);
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();

    const body = (await request.json()) as RegisterBody;
    const registration = parseRegisterBody(body);
    const otp = generateRegistrationOtp();

    await assertEmailIsAvailable(registration.email);

    await query(UPSERT_REGISTRATION_OTP_SQL, [
      registration.email,
      hashPassword(registration.password),
      registration.workspaceName,
      hashOtp(otp),
      REGISTRATION_OTP_TTL_SECONDS,
    ]);

    try {
      await sendRegistrationOtpEmail({
        email: registration.email,
        otp,
        expiresInMinutes: REGISTRATION_OTP_TTL_SECONDS / 60,
      });
    } catch (mailError) {
      await query(DELETE_REGISTRATION_OTP_SQL, [registration.email]).catch(
        (cleanupError) => {
          console.error("Failed to clean pending registration OTP:", cleanupError);
        },
      );
      throw new Error(sanitizeMailError(mailError));
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          verificationRequired: true,
          email: registration.email,
          expiresInSeconds: REGISTRATION_OTP_TTL_SECONDS,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Failed to start registration:", error);

    const message =
      error instanceof Error ? error.message : "Failed to start registration";

    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
