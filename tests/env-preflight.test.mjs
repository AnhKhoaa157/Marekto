import assert from "node:assert/strict";
import test from "node:test";

import { assertEnvironment, checkEnvironment } from "../src/lib/env-preflight.ts";

const STRONG_JWT = "n3wR4nd0m_JWT_secret_value_at_least_32_chars!!";
const STRONG_CRON = "cron_secret_16plus_chars_ok";

function validProductionEnv(overrides = {}) {
  return {
    NODE_ENV: "production",
    JWT_SECRET: STRONG_JWT,
    CRON_SECRET: STRONG_CRON,
    DATABASE_URL: "postgres://app:pw@db.internal:5432/marekto",
    DATABASE_SSL: "require",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "mailer-pw",
    SMTP_FROM: "Marekto <no-reply@example.com>",
    SMTP_SECURE: "false",
    GEMINI_API_KEY: "gemini-key-abc123",
    ...overrides,
  };
}

test("a complete, secure production configuration passes preflight", () => {
  const result = checkEnvironment(validProductionEnv(), true);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.errors.length, 0);
});

test("missing JWT_SECRET always fails", () => {
  const result = checkEnvironment(validProductionEnv({ JWT_SECRET: undefined }), true);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("JWT_SECRET is required")));
});

test("a short JWT_SECRET fails in production but not in development", () => {
  const prod = checkEnvironment(validProductionEnv({ JWT_SECRET: "short" }), true);
  assert.equal(prod.ok, false);
  assert.ok(prod.errors.some((e) => e.includes("JWT_SECRET must be at least")));

  const dev = checkEnvironment({ JWT_SECRET: "short", DATABASE_URL: "postgres://localhost:5432/dev" }, false);
  assert.ok(!dev.errors.some((e) => e.includes("JWT_SECRET must be at least")));
});

test("a known-insecure default JWT_SECRET fails in production even when long enough", () => {
  // A blocklisted placeholder that is well over the length threshold.
  const blocked = checkEnvironment(
    validProductionEnv({ JWT_SECRET: "e2e-smoke-only-jwt-secret-not-for-production-use" }),
    true,
  );
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((e) => e.includes("known-insecure")));
});

test("missing CRON_SECRET fails closed in production, warns in development", () => {
  const prod = checkEnvironment(validProductionEnv({ CRON_SECRET: undefined }), true);
  assert.equal(prod.ok, false);
  assert.ok(prod.errors.some((e) => e.includes("CRON_SECRET is required in production")));

  const dev = checkEnvironment(
    { JWT_SECRET: STRONG_JWT, DATABASE_URL: "postgres://localhost:5432/dev" },
    false,
  );
  assert.ok(dev.warnings.some((w) => w.includes("CRON_SECRET is not set")));
});

test("a malformed DATABASE_URL fails", () => {
  const result = checkEnvironment(validProductionEnv({ DATABASE_URL: "not a url" }), true);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("DATABASE_URL is not a valid")));
});

test("disabling SSL for a remote production database fails", () => {
  const result = checkEnvironment(
    validProductionEnv({ DATABASE_SSL: "disable" }),
    true,
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("DATABASE_SSL is disabled")));
});

test("invalid SMTP configuration fails", () => {
  const result = checkEnvironment(validProductionEnv({ SMTP_PORT: "0" }), true);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("SMTP configuration is invalid")));
});

test("unconfigured SMTP warns rather than crashing", () => {
  const env = validProductionEnv();
  for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]) {
    delete env[key];
  }
  const result = checkEnvironment(env, true);
  assert.ok(result.warnings.some((w) => w.includes("SMTP is not configured")));
});

test("out-of-bounds GEMINI_TIMEOUT_MS fails", () => {
  const result = checkEnvironment(validProductionEnv({ GEMINI_TIMEOUT_MS: "500" }), true);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("GEMINI_TIMEOUT_MS")));
});

test("a missing Gemini key warns without failing", () => {
  const result = checkEnvironment(validProductionEnv({ GEMINI_API_KEY: undefined }), true);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.includes("GEMINI_API_KEY is not set")));
});

test("assertEnvironment throws a secret-free error listing every problem", () => {
  assert.throws(
    () =>
      assertEnvironment(
        validProductionEnv({ JWT_SECRET: "short", CRON_SECRET: undefined }),
        true,
      ),
    (error) => {
      assert.match(error.message, /Environment preflight failed/);
      // Never leak the actual secret value.
      assert.ok(!error.message.includes(STRONG_JWT));
      return true;
    },
  );
});
