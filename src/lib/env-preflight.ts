import { resolveSmtpConfig } from "./mail/nodemailer.ts";

/**
 * Server-only environment preflight. Validates production-critical configuration
 * and fails closed for insecure or missing values in production.
 *
 * Contract:
 *   - This module MUST only be imported from server code. It reads secrets from
 *     the environment but never returns or logs their VALUES — only their names,
 *     shapes, and pass/fail status.
 *   - Pure and dependency-light so it is unit-testable with an injected `env`.
 *
 * Grouping mirrors `.env.example`: runtime, database, authentication, cron,
 * Gemini, SMTP.
 */

export type PreflightEnv = Record<string, string | undefined>;

export type PreflightResult = {
  ok: boolean;
  isProduction: boolean;
  errors: string[];
  warnings: string[];
};

// Obviously-insecure placeholder secrets that must never reach production.
const INSECURE_SECRET_VALUES = new Set([
  "changeme",
  "change-me",
  "secret",
  "password",
  "default",
  "dev",
  "development",
  "test",
  "example",
  "your-secret-here",
  "e2e-smoke-only-jwt-secret-not-for-production-use",
  "e2e-smoke-only-cron-secret",
]);

const MIN_JWT_SECRET_LENGTH = 32;
const MIN_CRON_SECRET_LENGTH = 16;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isInsecureSecret(value: string): boolean {
  return INSECURE_SECRET_VALUES.has(value.trim().toLowerCase());
}

function checkAuth(env: PreflightEnv, isProduction: boolean, result: PreflightResult): void {
  const jwtSecret = env.JWT_SECRET?.trim();

  if (!jwtSecret) {
    result.errors.push("JWT_SECRET is required. Authentication cannot run without it.");
    return;
  }

  if (isProduction) {
    if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      result.errors.push(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production.`,
      );
    }
    if (isInsecureSecret(jwtSecret)) {
      result.errors.push("JWT_SECRET is a known-insecure/default value; set a random secret.");
    }
  }
}

function checkCron(env: PreflightEnv, isProduction: boolean, result: PreflightResult): void {
  const cronSecret = env.CRON_SECRET?.trim();

  if (!cronSecret) {
    // The cron route fails closed (503) without a secret in production, but a
    // deployment without it means the worker can never run — surface it.
    if (isProduction) {
      result.errors.push(
        "CRON_SECRET is required in production; the cron worker fails closed without it.",
      );
    } else {
      result.warnings.push(
        "CRON_SECRET is not set; the cron worker is unauthenticated in development only.",
      );
    }
    return;
  }

  if (isProduction) {
    if (cronSecret.length < MIN_CRON_SECRET_LENGTH) {
      result.errors.push(
        `CRON_SECRET must be at least ${MIN_CRON_SECRET_LENGTH} characters in production.`,
      );
    }
    if (isInsecureSecret(cronSecret)) {
      result.errors.push("CRON_SECRET is a known-insecure/default value; set a random secret.");
    }
  }
}

function checkDatabase(env: PreflightEnv, isProduction: boolean, result: PreflightResult): void {
  const rawUrl = env.DATABASE_URL?.trim();

  if (!rawUrl) {
    result.errors.push("DATABASE_URL is required.");
    return;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    result.errors.push("DATABASE_URL is not a valid connection URL.");
    return;
  }

  if (!url.pathname.replace(/^\//, "")) {
    result.errors.push("DATABASE_URL must include a database name.");
  }

  // SSL intent — described without ever logging the URL or credentials.
  const explicitSsl = (env.DATABASE_SSL ?? env.PGSSLMODE ?? "").trim().toLowerCase();
  const sslDisabled = ["0", "false", "off", "no", "disable", "disabled"].includes(explicitSsl);
  const isRemote = !LOCAL_HOSTS.has(url.hostname);

  if (isProduction && isRemote && sslDisabled) {
    result.errors.push(
      "DATABASE_SSL is disabled for a remote production database; enable TLS to protect credentials in transit.",
    );
  } else if (isProduction && isRemote && !explicitSsl) {
    result.warnings.push(
      "DATABASE_SSL is unset for a remote production database; TLS defaults to enabled (rejectUnauthorized=true).",
    );
  }
}

function checkSmtp(env: PreflightEnv, isProduction: boolean, result: PreflightResult): void {
  const smtpConnectionKeys = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
  const anySet = smtpConnectionKeys.some(
    (key) => (env[key]?.trim() ?? "") !== "",
  );

  if (!anySet) {
    const message = "SMTP is not configured; campaign delivery will fail until it is set.";
    if (isProduction) {
      result.warnings.push(message);
    } else {
      result.warnings.push(message);
    }
    return;
  }

  // Reuse the real SMTP config parser so validation stays in one place. It
  // throws a descriptive, secret-free Error listing missing/invalid fields.
  try {
    resolveSmtpConfig(env as unknown as NodeJS.ProcessEnv);
  } catch (error) {
    result.errors.push(
      `SMTP configuration is invalid: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function checkGemini(env: PreflightEnv, isProduction: boolean, result: PreflightResult): void {
  const primary = env.GEMINI_API_KEY?.trim();

  if (!primary) {
    result.warnings.push(
      "GEMINI_API_KEY is not set; AI segmentation, builder, and personalization fall back to safe non-AI behavior.",
    );
  }

  const timeoutRaw = env.GEMINI_TIMEOUT_MS?.trim();
  if (timeoutRaw) {
    const timeout = Number(timeoutRaw);
    if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
      result.errors.push("GEMINI_TIMEOUT_MS must be an integer between 1000 and 120000.");
    }
  }

  // Fallback keys must be non-empty when the variable is present.
  const fallback = env.GEMINI_FALLBACK_API_KEYS?.trim();
  if (fallback && fallback.split(/[;,\r\n]+/).map((k) => k.trim()).filter(Boolean).length === 0) {
    result.warnings.push("GEMINI_FALLBACK_API_KEYS is set but contains no usable keys.");
  }

  void isProduction;
}

/**
 * Run the full preflight against an environment map. `isProduction` defaults to
 * NODE_ENV === "production".
 */
export function checkEnvironment(
  env: PreflightEnv = process.env,
  isProduction: boolean = env.NODE_ENV === "production",
): PreflightResult {
  const result: PreflightResult = { ok: true, isProduction, errors: [], warnings: [] };

  checkAuth(env, isProduction, result);
  checkCron(env, isProduction, result);
  checkDatabase(env, isProduction, result);
  checkSmtp(env, isProduction, result);
  checkGemini(env, isProduction, result);

  result.ok = result.errors.length === 0;
  return result;
}

/**
 * Assert a valid production configuration. Throws a single, secret-free Error
 * enumerating every problem so a misconfigured deployment fails closed at
 * startup instead of running with insecure defaults.
 */
export function assertEnvironment(
  env: PreflightEnv = process.env,
  isProduction: boolean = env.NODE_ENV === "production",
): PreflightResult {
  const result = checkEnvironment(env, isProduction);

  if (!result.ok) {
    throw new Error(
      `Environment preflight failed with ${result.errors.length} error(s):\n- ${result.errors.join("\n- ")}`,
    );
  }

  return result;
}
