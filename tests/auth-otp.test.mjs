import assert from "node:assert/strict";
import test from "node:test";

import {
  generateRegistrationOtp,
  hashOtp,
  normalizeOtp,
  verifyOtp,
} from "../src/lib/auth-otp.ts";

test("generates and verifies 6-digit registration OTPs", () => {
  const otp = generateRegistrationOtp();
  const hash = hashOtp(otp);

  assert.match(otp, /^\d{6}$/);
  assert.equal(verifyOtp(otp, hash), true);
  assert.equal(verifyOtp("000000", hash), false);
});

test("normalizes only 6-digit OTP strings", () => {
  assert.equal(normalizeOtp(" 123456 "), "123456");
  assert.throws(() => normalizeOtp("12345"), /6-digit/);
  assert.throws(() => normalizeOtp(null), /OTP is required/);
});
