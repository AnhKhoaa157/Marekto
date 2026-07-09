import { BillingError } from "../errors.ts";
import type { SepayEnv } from "./types.ts";

/**
 * SePay Payment Gateway configuration parsing.
 *
 * Env contract (secrets live in env only, never committed):
 *   BILLING_PROVIDER=sepay
 *   SEPAY_ENV=sandbox            # only "sandbox" | "production"
 *   SEPAY_MERCHANT_ID=...
 *   SEPAY_SECRET_KEY=...         # checkout HMAC + REST Basic Auth
 *   SEPAY_IPN_SECRET=...         # X-Secret-Key on incoming IPN
 *   SEPAY_REQUEST_TIMEOUT_MS=10000
 *
 * This phase (18.1A) enables SANDBOX checkout only. Production hostnames are
 * defined for future use but production checkout is refused by the adapter.
 */

export type SepayConfig = {
  env: SepayEnv;
  merchantId: string;
  secretKey: string;
  ipnSecret: string;
  requestTimeoutMs: number;
  /** Full checkout init endpoint, e.g. https://pay-sandbox.sepay.vn/v1/checkout/init */
  checkoutInitUrl: string;
  /** REST API base, e.g. https://pgapi-sandbox.sepay.vn */
  apiBaseUrl: string;
};

type SepayEndpoints = { checkoutInitUrl: string; apiBaseUrl: string };

const SEPAY_ENDPOINTS: Record<SepayEnv, SepayEndpoints> = {
  sandbox: {
    checkoutInitUrl: "https://pay-sandbox.sepay.vn/v1/checkout/init",
    apiBaseUrl: "https://pgapi-sandbox.sepay.vn",
  },
  production: {
    checkoutInitUrl: "https://pay.sepay.vn/v1/checkout/init",
    apiBaseUrl: "https://pgapi.sepay.vn",
  },
};

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

export type SepayEnvSource = Record<string, string | undefined>;

function parseTimeout(raw: string | undefined): number {
  if (!raw || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new BillingError(
      `SEPAY_REQUEST_TIMEOUT_MS must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
      503,
    );
  }
  return value;
}

function parseEnv(raw: string | undefined): SepayEnv {
  const value = raw?.trim().toLowerCase();
  if (value === "sandbox" || value === "production") return value;
  throw new BillingError(
    'SEPAY_ENV is invalid; expected "sandbox" or "production"',
    503,
  );
}

/**
 * Optional endpoint overrides are honored ONLY in non-production environments
 * (useful for pointing tests at a local mock server). Production always uses the
 * canonical SePay hostnames.
 */
function resolveEndpoints(env: SepayEnv, source: SepayEnvSource): SepayEndpoints {
  const base = SEPAY_ENDPOINTS[env];
  const isProduction = source.NODE_ENV === "production";
  if (isProduction) return base;

  const checkoutOverride = source.SEPAY_CHECKOUT_INIT_URL?.trim();
  const apiOverride = source.SEPAY_API_BASE_URL?.trim();
  return {
    checkoutInitUrl:
      checkoutOverride && /^https?:\/\//i.test(checkoutOverride)
        ? checkoutOverride
        : base.checkoutInitUrl,
    apiBaseUrl:
      apiOverride && /^https?:\/\//i.test(apiOverride)
        ? apiOverride.replace(/\/+$/, "")
        : base.apiBaseUrl,
  };
}

/**
 * Parse and validate the SePay configuration. Throws a secret-free BillingError
 * (503) listing missing/invalid fields so a misconfigured deployment fails
 * closed instead of running with partial credentials.
 */
export function parseSepayConfig(source: SepayEnvSource = process.env): SepayConfig {
  const env = parseEnv(source.SEPAY_ENV);
  const merchantId = source.SEPAY_MERCHANT_ID?.trim() ?? "";
  const secretKey = source.SEPAY_SECRET_KEY?.trim() ?? "";
  const ipnSecret = source.SEPAY_IPN_SECRET?.trim() ?? "";

  const missing: string[] = [];
  if (!merchantId) missing.push("SEPAY_MERCHANT_ID");
  if (!secretKey) missing.push("SEPAY_SECRET_KEY");
  if (!ipnSecret) missing.push("SEPAY_IPN_SECRET");

  if (missing.length > 0) {
    throw new BillingError(
      `SePay billing is selected but required credentials are missing: ${missing.join(", ")}`,
      503,
    );
  }

  const endpoints = resolveEndpoints(env, source);

  return {
    env,
    merchantId,
    secretKey,
    ipnSecret,
    requestTimeoutMs: parseTimeout(source.SEPAY_REQUEST_TIMEOUT_MS),
    checkoutInitUrl: endpoints.checkoutInitUrl,
    apiBaseUrl: endpoints.apiBaseUrl,
  };
}

/** Non-throwing configuration probe used by billing status/provider-readiness UI. */
export function tryParseSepayConfig(
  source: SepayEnvSource = process.env,
): SepayConfig | null {
  try {
    return parseSepayConfig(source);
  } catch {
    return null;
  }
}

export function isSepayConfigured(source: SepayEnvSource = process.env): boolean {
  return tryParseSepayConfig(source) !== null;
}
