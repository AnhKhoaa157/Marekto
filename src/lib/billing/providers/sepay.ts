import crypto from "node:crypto";

import { BillingError } from "../errors.ts";
import type { SepayConfig } from "./config.ts";
import type {
  NormalizedWebhookEvent,
  NormalizedWebhookOutcome,
  ProviderCheckout,
  ProviderCheckoutInput,
} from "./types.ts";

/**
 * Official SePay Payment Gateway adapter (sandbox for Phase 18.1A).
 *
 * References:
 *   - Checkout form + signature: developer.sepay.vn .../API/don-hang/form-thanh-toan
 *   - IPN contract:               developer.sepay.vn .../cong-thanh-toan/IPN
 *   - REST API overview:          developer.sepay.vn .../API/tong-quan
 *
 * This module NEVER persists or returns the secret key, the raw Authorization
 * header, or unsanitized provider payloads.
 */

/**
 * Fields eligible for the checkout signature, in the exact order SePay's
 * documented `signFields()` reference uses. Only fields actually present in the
 * request are included, joined as `key=value` with commas, then
 * base64(HMAC-SHA256(signingString, secretKey)).
 */
const CHECKOUT_SIGN_FIELDS = [
  "order_amount",
  "merchant",
  "currency",
  "operation",
  "order_description",
  "order_invoice_number",
  "customer_id",
  "payment_method",
  "success_url",
  "error_url",
  "cancel_url",
] as const;

/** SePay currently only supports VND. Stored currency is lowercase. */
const SEPAY_CURRENCY = "VND";

export function signCheckoutFields(
  fields: Record<string, string>,
  secretKey: string,
): string {
  const signingString = CHECKOUT_SIGN_FIELDS.filter(
    (field) => fields[field] !== undefined,
  )
    .map((field) => `${field}=${fields[field]}`)
    .join(",");

  return crypto.createHmac("sha256", secretKey).update(signingString).digest("base64");
}

function returnUrl(appBaseUrl: string, result: "success" | "error" | "cancel"): string {
  return `${appBaseUrl}/settings/billing?sepay=${result}`;
}

/**
 * Build the official SePay Sandbox checkout as an auto-submitting HTML form POST
 * to the sandbox checkout init endpoint. The signature is included in the form
 * fields (safe to expose); the secret key is not.
 */
export function buildSepayCheckout(
  input: ProviderCheckoutInput,
  config: SepayConfig,
): ProviderCheckout {
  if (config.env !== "sandbox") {
    throw new BillingError(
      "SePay production checkout is not enabled in this phase; set SEPAY_ENV=sandbox",
      503,
    );
  }

  if (input.currency.toLowerCase() !== "vnd") {
    throw new BillingError("SePay checkout only supports VND", 400);
  }

  const fields: Record<string, string> = {
    merchant: config.merchantId,
    operation: "PURCHASE",
    order_invoice_number: input.invoiceNumber,
    order_amount: String(input.amountCents),
    currency: SEPAY_CURRENCY,
    order_description: input.description,
    success_url: returnUrl(input.appBaseUrl, "success"),
    error_url: returnUrl(input.appBaseUrl, "error"),
    cancel_url: returnUrl(input.appBaseUrl, "cancel"),
  };

  const signedFields: Record<string, string> = {
    ...fields,
    signature: signCheckoutFields(fields, config.secretKey),
  };

  return {
    redirect: {
      kind: "form",
      method: "POST",
      action: config.checkoutInitUrl,
      fields: signedFields,
    },
    providerOrderId: input.invoiceNumber,
    checkoutUrl: config.checkoutInitUrl,
    environment: config.env,
    safeMetadata: {
      provider_environment: config.env,
      invoice_number: input.invoiceNumber,
      operation: "PURCHASE",
    },
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Parse a SePay decimal-string or numeric amount into the smallest unit (đồng). */
function parseAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  return Number.NaN;
}

function resolveOutcome(
  notificationType: string,
  orderStatus: string,
  transactionStatus: string,
): NormalizedWebhookOutcome {
  if (
    notificationType === "ORDER_PAID" &&
    orderStatus === "CAPTURED" &&
    transactionStatus === "APPROVED"
  ) {
    return "paid";
  }
  if (notificationType === "TRANSACTION_VOID") return "canceled";
  return "ignored";
}

/**
 * Authenticate (constant-time X-Secret-Key) and parse an official SePay IPN into
 * a normalized, secret-free event. Throws BillingError(401) on auth failure and
 * BillingError(400) on a malformed payload. Never activates anything itself.
 */
export function verifyAndParseSepayWebhook(
  headers: Headers,
  bodyText: string,
  config: SepayConfig,
): NormalizedWebhookEvent {
  const providedSecret = headers.get("x-secret-key")?.trim() ?? "";
  if (!providedSecret || !constantTimeEquals(providedSecret, config.ipnSecret)) {
    throw new BillingError("Invalid SePay IPN secret", 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new BillingError("SePay IPN payload is invalid", 400);
  }

  const payload = asRecord(parsed);
  const notificationType = asString(payload.notification_type);
  const order = asRecord(payload.order);
  const transaction = asRecord(payload.transaction);

  const invoiceNumber = asString(order.order_invoice_number);
  const orderStatus = asString(order.order_status);
  const orderCurrency = asString(order.order_currency);
  const transactionStatus = asString(transaction.transaction_status);
  const transactionId = asString(transaction.id) || asString(transaction.transaction_id);

  if (!notificationType) {
    throw new BillingError("SePay IPN notification_type is required", 400);
  }
  if (!invoiceNumber) {
    throw new BillingError("SePay IPN order_invoice_number is required", 400);
  }

  const providerEventId = transactionId
    ? `sepay_${transactionId}`
    : `sepay_${notificationType}_${asString(order.id) || invoiceNumber}`;

  const expectedAmountCents = parseAmount(order.order_amount);
  if (!Number.isInteger(expectedAmountCents) || expectedAmountCents < 0) {
    throw new BillingError("SePay IPN order_amount is invalid", 400);
  }

  const outcome = resolveOutcome(notificationType, orderStatus, transactionStatus);

  return {
    providerEventId,
    eventType: `sepay.${notificationType.toLowerCase()}`,
    outcome,
    orderMatch: { by: "provider_order_id", value: invoiceNumber },
    expectedAmountCents,
    expectedCurrency: orderCurrency ? orderCurrency.toLowerCase() : null,
    sanitizedPayload: {
      timestamp: typeof payload.timestamp === "number" ? payload.timestamp : null,
      notification_type: notificationType,
      order: {
        id: asString(order.id) || null,
        order_id: asString(order.order_id) || null,
        order_invoice_number: invoiceNumber,
        order_status: orderStatus || null,
        order_amount: asString(order.order_amount) || null,
        order_currency: orderCurrency || null,
        order_description: asString(order.order_description) || null,
      },
      transaction: {
        id: asString(transaction.id) || null,
        transaction_id: asString(transaction.transaction_id) || null,
        transaction_type: asString(transaction.transaction_type) || null,
        transaction_status: transactionStatus || null,
        transaction_date: asString(transaction.transaction_date) || null,
        transaction_amount: asString(transaction.transaction_amount) || null,
        transaction_currency: asString(transaction.transaction_currency) || null,
        payment_method: asString(transaction.payment_method) || null,
      },
    },
  };
}

export type SepayOrderLookup = {
  found: boolean;
  orderStatus: string | null;
  amountCents: number | null;
  currency: string | null;
  invoiceNumber: string | null;
};

/**
 * Pure parser for a SePay "retrieve order" REST response. Handles both a bare
 * order object and a `{ data: {...} }` envelope. Kept pure for unit testing.
 */
export function parseSepayOrderResponse(value: unknown): SepayOrderLookup {
  const root = asRecord(value);
  const order = asRecord(root.data ?? root);
  const invoiceNumber = asString(order.order_invoice_number);

  if (!invoiceNumber && !asString(order.order_status)) {
    return {
      found: false,
      orderStatus: null,
      amountCents: null,
      currency: null,
      invoiceNumber: null,
    };
  }

  const amount = parseAmount(order.order_amount);
  const currency = asString(order.order_currency);

  return {
    found: true,
    orderStatus: asString(order.order_status) || null,
    amountCents: Number.isInteger(amount) ? amount : null,
    currency: currency ? currency.toLowerCase() : null,
    invoiceNumber: invoiceNumber || null,
  };
}

/**
 * Server-only reconciliation query. Fetches an order from the SePay REST API
 * using Basic Auth (base64(merchant_id:secret_key)). Never exposed to browsers.
 */
export async function querySepayOrder(
  invoiceNumber: string,
  config: SepayConfig,
): Promise<SepayOrderLookup> {
  const credentials = Buffer.from(
    `${config.merchantId}:${config.secretKey}`,
    "utf8",
  ).toString("base64");
  const url = `${config.apiBaseUrl}/v1/orders/${encodeURIComponent(invoiceNumber)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });

  if (response.status === 404) {
    return {
      found: false,
      orderStatus: null,
      amountCents: null,
      currency: null,
      invoiceNumber: null,
    };
  }

  if (!response.ok) {
    throw new BillingError(
      `SePay order lookup failed with status ${response.status}`,
      502,
    );
  }

  const json = (await response.json()) as unknown;
  return parseSepayOrderResponse(json);
}
