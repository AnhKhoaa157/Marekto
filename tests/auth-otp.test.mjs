import assert from "node:assert/strict";
import test from "node:test";

import {
  generateRegistrationOtp,
  hashOtp,
  normalizeOtp,
  resolveDevelopmentPasswordResetOtp,
  resolveDevelopmentRegistrationOtp,
  verifyOtp,
} from "../src/lib/auth-otp.ts";

test("generates and verifies 6-digit registration OTPs", () => {
  const otp = generateRegistrationOtp();
  const hash = hashOtp(otp);

  assert.match(otp, /^\d{6}$/);
  assert.equal(verifyOtp(otp, hash), true);
  assert.equal(verifyOtp("000000", hash), false);
});

test("development password reset OTP is disabled in production", () => {
  assert.equal(
    resolveDevelopmentPasswordResetOtp({
      NODE_ENV: "development",
      PASSWORD_RESET_DEV_OTP: " 654321 ",
    }),
    "654321",
  );
  assert.equal(
    resolveDevelopmentPasswordResetOtp({
      NODE_ENV: "production",
      PASSWORD_RESET_DEV_OTP: "654321",
    }),
    null,
  );
});

test("uses a configured registration OTP outside production only", () => {
  assert.equal(
    resolveDevelopmentRegistrationOtp({
      NODE_ENV: "development",
      REGISTRATION_DEV_OTP: " 123456 ",
    }),
    "123456",
  );
  assert.equal(
    resolveDevelopmentRegistrationOtp({
      NODE_ENV: "production",
      REGISTRATION_DEV_OTP: "123456",
    }),
    null,
  );
  assert.equal(resolveDevelopmentRegistrationOtp({ NODE_ENV: "development" }), null);
  assert.throws(
    () =>
      resolveDevelopmentRegistrationOtp({
        NODE_ENV: "development",
        REGISTRATION_DEV_OTP: "12345",
      }),
    /6-digit/,
  );
});

test("normalizes only 6-digit OTP strings", () => {
  assert.equal(normalizeOtp(" 123456 "), "123456");
  assert.throws(() => normalizeOtp("12345"), /6-digit/);
  assert.throws(() => normalizeOtp(null), /OTP is required/);
});
