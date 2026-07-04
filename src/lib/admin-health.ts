/**
 * Admin system-health reporting (pure config derivation).
 *
 * Reports whether production-critical integrations are *configured* by shape and
 * presence only. It reads environment variable NAMES but never returns, logs, or
 * echoes their VALUES. Database reachability (a live probe) is layered on top in
 * `@/lib/admin-data`; this module stays pure and unit-testable.
 */

export type HealthEnv = Record<string, string | undefined>;

export type AdminHealthConfig = {
  database: { configured: boolean };
  smtp: { configured: boolean };
  gemini: { configured: boolean };
  cron: { configured: boolean };
  environment: {
    node_env: string;
    is_production: boolean;
  };
};

const REQUIRED_SMTP_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
] as const;

function hasValue(env: HealthEnv, key: string): boolean {
  return (env[key]?.trim() ?? "") !== "";
}

/**
 * Derive the configured/available status of each integration from the
 * environment. Only booleans and the NODE_ENV label are returned.
 */
export function buildAdminHealthConfig(
  env: HealthEnv = process.env,
): AdminHealthConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "development";

  return {
    database: { configured: hasValue(env, "DATABASE_URL") },
    smtp: { configured: REQUIRED_SMTP_KEYS.every((key) => hasValue(env, key)) },
    gemini: { configured: hasValue(env, "GEMINI_API_KEY") },
    cron: { configured: hasValue(env, "CRON_SECRET") },
    environment: {
      node_env: nodeEnv,
      is_production: nodeEnv === "production",
    },
  };
}

export type AdminHealthStatus = AdminHealthConfig & {
  database: { configured: boolean; reachable: boolean };
  generated_at: string;
};
