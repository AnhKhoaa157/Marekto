import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  PASSWORD_RESET_OTP_TTL_SECONDS,
  generateRegistrationOtp,
  hashOtp,
  resolveDevelopmentPasswordResetOtp,
} from "@/lib/auth-otp";
import { initializeDatabase, query } from "@/lib/db";
import { sendPasswordResetOtpEmail } from "@/lib/mail/auth";
import { sanitizeMailError } from "@/lib/mail/nodemailer";
import { consumeRateLimit } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELECT_USER_SQL =
  'SELECT id FROM "Users" WHERE LOWER(email) = $1 LIMIT 1';
const UPSERT_RESET_SQL =
  'INSERT INTO "Password_reset_otps" (email, user_id, otp_hash, attempts, expires_at) ' +
  "VALUES ($1, $2, $3, 0, NOW() + ($4 * INTERVAL '1 second')) " +
  "ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, " +
  "otp_hash = EXCLUDED.otp_hash, attempts = 0, expires_at = EXCLUDED.expires_at, updated_at = NOW()";
const DELETE_RESET_SQL = 'DELETE FROM "Password_reset_otps" WHERE email = $1';

type ForgotPasswordBody = { email?: unknown };
type UserRow = { id: string };

function parseEmail(value: unknown): string {
  if (typeof value !== "string" || !EMAIL_PATTERN.test(value.trim())) {
    throw new Error("Email is invalid");
  }

  return value.trim().toLowerCase();
}

function rateLimitKey(email: string): string {
  return `forgot-password:${createHash("sha256").update(email).digest("hex")}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ForgotPasswordBody;
    const email = parseEmail(body.email);
    const allowed = await consumeRateLimit({
      key: rateLimitKey(email),
      limit: 3,
      windowSeconds: 15 * 60,
    });

    if (!allowed) {
      return NextResponse.json(
        { success: false, error: "Too many reset requests. Try again later." },
        { status: 429 },
      );
    }

    await initializeDatabase();
    const userResult = await query<UserRow>(SELECT_USER_SQL, [email]);
    const user = userResult.rows[0];
    const developmentOtp = resolveDevelopmentPasswordResetOtp();

    if (user) {
      const otp = developmentOtp ?? generateRegistrationOtp();
      await query(UPSERT_RESET_SQL, [
        email,
        user.id,
        hashOtp(otp),
        PASSWORD_RESET_OTP_TTL_SECONDS,
      ]);

      if (!developmentOtp) {
        try {
          await sendPasswordResetOtpEmail({
            email,
            otp,
            expiresInMinutes: PASSWORD_RESET_OTP_TTL_SECONDS / 60,
          });
        } catch (error) {
          await query(DELETE_RESET_SQL, [email]).catch(() => undefined);
          console.error("Failed to send password reset email:", sanitizeMailError(error));
        }
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          accepted: true,
          expiresInSeconds: PASSWORD_RESET_OTP_TTL_SECONDS,
          ...(user && developmentOtp ? { developmentOtp } : {}),
        },
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reset request failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: message === "Email is invalid" ? 400 : 500 },
    );
  }
}
