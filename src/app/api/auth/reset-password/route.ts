import { NextResponse, type NextRequest } from "next/server";

import {
  MAX_PASSWORD_RESET_OTP_ATTEMPTS,
  normalizeOtp,
  verifyOtp,
} from "@/lib/auth-otp";
import { initializeDatabase, withTransaction } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { invalidateAllUserSessions } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELECT_RESET_SQL =
  'SELECT email, user_id, otp_hash, attempts, expires_at FROM "Password_reset_otps" WHERE email = $1 FOR UPDATE';
const INCREMENT_ATTEMPTS_SQL =
  'UPDATE "Password_reset_otps" SET attempts = attempts + 1, updated_at = NOW() WHERE email = $1';
const DELETE_RESET_SQL = 'DELETE FROM "Password_reset_otps" WHERE email = $1';

type ResetPasswordBody = {
  email?: unknown;
  otp?: unknown;
  password?: unknown;
};

type PasswordResetRow = {
  email: string;
  user_id: string;
  otp_hash: string;
  attempts: number;
  expires_at: Date;
};

function parseEmail(value: unknown): string {
  if (typeof value !== "string" || !EMAIL_PATTERN.test(value.trim())) {
    throw new Error("Email is invalid");
  }

  return value.trim().toLowerCase();
}

function parsePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 6 || value.length > 128) {
    throw new Error("Password must be between 6 and 128 characters");
  }

  return value;
}

function statusForError(message: string): number {
  if (
    message === "Email is invalid" ||
    message === "OTP is required" ||
    message === "OTP must be a 6-digit code" ||
    message === "OTP is invalid or expired" ||
    message === "Password must be between 6 and 128 characters"
  ) {
    return 400;
  }

  return 500;
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const body = (await request.json()) as ResetPasswordBody;
    const email = parseEmail(body.email);
    const otp = normalizeOtp(body.otp);
    const password = parsePassword(body.password);

    const resetSucceeded = await withTransaction(async (client) => {
      const result = await client.query<PasswordResetRow>(SELECT_RESET_SQL, [email]);
      const reset = result.rows[0];

      if (
        !reset ||
        reset.expires_at.getTime() <= Date.now() ||
        reset.attempts >= MAX_PASSWORD_RESET_OTP_ATTEMPTS
      ) {
        if (reset) {
          await client.query(DELETE_RESET_SQL, [email]);
        }
        return false;
      }

      if (!verifyOtp(otp, reset.otp_hash)) {
        await client.query(INCREMENT_ATTEMPTS_SQL, [email]);
        return false;
      }

      await invalidateAllUserSessions(reset.user_id);
      await client.query(
        'UPDATE "Users" SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [hashPassword(password), reset.user_id],
      );
      await client.query(DELETE_RESET_SQL, [email]);
      return true;
    });

    if (!resetSucceeded) {
      throw new Error("OTP is invalid or expired");
    }

    return NextResponse.json({
      success: true,
      data: { passwordReset: true },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Password reset failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(message) },
    );
  }
}
