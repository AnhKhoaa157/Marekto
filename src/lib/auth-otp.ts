import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

const OTP_LENGTH = 6;
const OTP_MIN = 10 ** (OTP_LENGTH - 1);
const OTP_MAX = 10 ** OTP_LENGTH;

export const REGISTRATION_OTP_TTL_SECONDS = 10 * 60;
export const MAX_REGISTRATION_OTP_ATTEMPTS = 5;
export const PASSWORD_RESET_OTP_TTL_SECONDS = 10 * 60;
export const MAX_PASSWORD_RESET_OTP_ATTEMPTS = 5;

export function resolveDevelopmentRegistrationOtp(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.NODE_ENV === "production") {
    return null;
  }

  const otp = env.REGISTRATION_DEV_OTP?.trim();

  if (!otp) {
    return null;
  }

  if (!/^\d{6}$/.test(otp)) {
    throw new Error("REGISTRATION_DEV_OTP must be a 6-digit code");
  }

  return otp;
}

export function resolveDevelopmentPasswordResetOtp(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.NODE_ENV === "production") {
    return null;
  }

  const otp = env.PASSWORD_RESET_DEV_OTP?.trim();

  if (!otp) {
    return null;
  }

  if (!/^\d{6}$/.test(otp)) {
    throw new Error("PASSWORD_RESET_DEV_OTP must be a 6-digit code");
  }

  return otp;
}

export function generateRegistrationOtp(): string {
  return String(randomInt(OTP_MIN, OTP_MAX));
}

export function hashOtp(otp: string): string {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(otp, salt, 64);

  return `${salt}:${derivedKey.toString("hex")}`;
}

export function verifyOtp(otp: string, storedHash: string): boolean {
  const [salt, derivedKeyHex] = storedHash.split(":");

  if (!salt || !derivedKeyHex) {
    return false;
  }

  try {
    const expectedKey = Buffer.from(derivedKeyHex, "hex");
    const actualKey = scryptSync(otp, salt, expectedKey.length);

    return (
      actualKey.length === expectedKey.length &&
      timingSafeEqual(actualKey, expectedKey)
    );
  } catch {
    return false;
  }
}

export function normalizeOtp(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("OTP is required");
  }

  const otp = value.trim();

  if (!/^\d{6}$/.test(otp)) {
    throw new Error("OTP must be a 6-digit code");
  }

  return otp;
}
