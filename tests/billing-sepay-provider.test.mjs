import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSepayConfig,
  tryParseSepayConfig,
  isSepayConfigured,
} from "../src/lib/billing/providers/config.ts";
import {
  buildSepayCheckout,
  signCheckoutFields,
  parseSepayOrderResponse,
  verifyAndParseSepayWebhook,
} from "../src/lib/billing/providers/sepay.ts";

const VALID_SANDBOX_ENV = {
  NODE_ENV: "test",
  SEPAY_ENV: "sandbox",
  SEPAY_MERCHANT_ID: "MERCHANT_TEST",
  SEPAY_SECRET_KEY: "secret-key-test",
  SEPAY_IPN_SECRET: "ipn-secret-test",
  SEPAY_REQUEST_TIMEOUT_MS: "10000",
};

const CHECKOUT_INPUT = {
  orderId: "12345678-1234-4abc-8def-123456789abc",
  planCode: "pro",
  amountCents: 99000,
  currency: "vnd",
  invoiceNumber: "MKT123456789ABCDEF0123456789ABCDE",
  description: "Marekto Pro plan (monthly)",
  appBaseUrl: "http://localhost:3000",
};

function ipnPayload(overrides = {}) {
  return JSON.stringify({
    timestamp: 1757058220,
    notification_type: "ORDER_PAID",
    order: {
      id: "e2c195be-c721-47eb-b323-99ab24e52d85",
      order_id: "NPSETVI00101000042R",
      order_status: "CAPTURED",
      order_currency: "VND",
      order_amount: "99000.00",
      order_invoice_number: CHECKOUT_INPUT.invoiceNumber,
      order_description: "Marekto Pro plan (monthly)",
      ...overrides.order,
    },
    transaction: {
      id: "384c66dd-41e6-4316-a544-b4141682595c",
      transaction_id: "68ba94ac80123",
      transaction_type: "PAYMENT",
      transaction_status: "APPROVED",
      transaction_amount: "99000",
      transaction_currency: "VND",
      payment_method: "CARD",
      card_number: "4111XXXXXXXX1111",
      card_holder_name: "NGUYEN VAN A",
      ...overrides.transaction,
    },
    ...overrides.root,
  });
}

// ── Config parsing ──────────────────────────────────────────────────────────

test("parseSepayConfig accepts a valid sandbox configuration", () => {
  const config = parseSepayConfig(VALID_SANDBOX_ENV);
  assert.equal(config.env, "sandbox");
  assert.equal(config.merchantId, "MERCHANT_TEST");
  assert.equal(config.requestTimeoutMs, 10000);
  assert.equal(config.checkoutInitUrl, "https://pay-sandbox.sepay.vn/v1/checkout/init");
  assert.equal(config.apiBaseUrl, "https://pgapi-sandbox.sepay.vn");
});

test("parseSepayConfig rejects missing credentials", () => {
  assert.throws(
    () => parseSepayConfig({ ...VALID_SANDBOX_ENV, SEPAY_SECRET_KEY: "" }),
    /SEPAY_SECRET_KEY/,
  );
  assert.equal(
    tryParseSepayConfig({ ...VALID_SANDBOX_ENV, SEPAY_IPN_SECRET: "" }),
    null,
  );
  assert.equal(isSepayConfigured({ ...VALID_SANDBOX_ENV, SEPAY_MERCHANT_ID: "" }), false);
});

test("parseSepayConfig rejects an invalid SEPAY_ENV", () => {
  assert.throws(() => parseSepayConfig({ ...VALID_SANDBOX_ENV, SEPAY_ENV: "staging" }), /SEPAY_ENV/);
});

test("parseSepayConfig rejects an out-of-range timeout", () => {
  assert.throws(
    () => parseSepayConfig({ ...VALID_SANDBOX_ENV, SEPAY_REQUEST_TIMEOUT_MS: "50" }),
    /SEPAY_REQUEST_TIMEOUT_MS/,
  );
});

test("parseSepayConfig honors endpoint overrides only outside production", () => {
  const dev = parseSepayConfig({
    ...VALID_SANDBOX_ENV,
    SEPAY_CHECKOUT_INIT_URL: "http://localhost:4010/v1/checkout/init",
    SEPAY_API_BASE_URL: "http://localhost:4010",
  });
  assert.equal(dev.checkoutInitUrl, "http://localhost:4010/v1/checkout/init");

  const prod = parseSepayConfig({
    ...VALID_SANDBOX_ENV,
    NODE_ENV: "production",
    SEPAY_CHECKOUT_INIT_URL: "http://evil.example/checkout",
  });
  assert.equal(prod.checkoutInitUrl, "https://pay-sandbox.sepay.vn/v1/checkout/init");
});

// ── Checkout signing ────────────────────────────────────────────────────────

test("signCheckoutFields is deterministic and matches the documented allowlist order", () => {
  const fields = {
    order_amount: "100000",
    merchant: "MERCHANT_123",
    currency: "VND",
    operation: "PURCHASE",
    order_description: "Payment for order #12345",
    order_invoice_number: "INV_20231201_001",
    success_url: "https://yoursite.com/payment/success",
    error_url: "https://yoursite.com/payment/error",
    cancel_url: "https://yoursite.com/payment/cancel",
  };
  const first = signCheckoutFields(fields, "secret-key-test");
  const second = signCheckoutFields(fields, "secret-key-test");
  assert.equal(first, second);
  // base64 of a 32-byte HMAC-SHA256 digest is 44 chars.
  assert.equal(first.length, 44);
  // A different secret produces a different signature.
  assert.notEqual(first, signCheckoutFields(fields, "other-secret"));
});

test("buildSepayCheckout targets the sandbox endpoint and never leaks the secret", () => {
  const config = parseSepayConfig(VALID_SANDBOX_ENV);
  const checkout = buildSepayCheckout(CHECKOUT_INPUT, config);

  assert.equal(checkout.redirect.kind, "form");
  assert.equal(checkout.redirect.action, "https://pay-sandbox.sepay.vn/v1/checkout/init");
  assert.equal(checkout.redirect.fields.merchant, "MERCHANT_TEST");
  assert.equal(checkout.redirect.fields.order_amount, "99000");
  assert.equal(checkout.redirect.fields.currency, "VND");
  assert.equal(checkout.redirect.fields.order_invoice_number, CHECKOUT_INPUT.invoiceNumber);
  assert.equal(typeof checkout.redirect.fields.signature, "string");
  assert.equal(checkout.providerOrderId, CHECKOUT_INPUT.invoiceNumber);
  assert.equal(checkout.environment, "sandbox");

  const serialized = JSON.stringify({
    fields: checkout.redirect.fields,
    metadata: checkout.safeMetadata,
    checkoutUrl: checkout.checkoutUrl,
  });
  assert.equal(serialized.includes("secret-key-test"), false);
  assert.equal(serialized.includes(config.secretKey), false);
});

test("buildSepayCheckout refuses production checkout in this phase", () => {
  const config = parseSepayConfig({ ...VALID_SANDBOX_ENV, SEPAY_ENV: "production" });
  assert.throws(() => buildSepayCheckout(CHECKOUT_INPUT, config), /production checkout is not enabled/);
});

// ── IPN verification ────────────────────────────────────────────────────────

function ipnHeaders(secret) {
  return new Headers(secret === undefined ? {} : { "x-secret-key": secret });
}

test("verifyAndParseSepayWebhook rejects a missing or wrong secret", () => {
  const config = parseSepayConfig(VALID_SANDBOX_ENV);
  assert.throws(
    () => verifyAndParseSepayWebhook(ipnHeaders(undefined), ipnPayload(), config),
    /Invalid SePay IPN secret/,
  );
  assert.throws(
    () => verifyAndParseSepayWebhook(ipnHeaders("wrong-secret"), ipnPayload(), config),
    /Invalid SePay IPN secret/,
  );
});

test("verifyAndParseSepayWebhook normalizes a valid ORDER_PAID event without leaking PII", () => {
  const config = parseSepayConfig(VALID_SANDBOX_ENV);
  const event = verifyAndParseSepayWebhook(ipnHeaders("ipn-secret-test"), ipnPayload(), config);

  assert.equal(event.outcome, "paid");
  assert.equal(event.providerEventId, "sepay_384c66dd-41e6-4316-a544-b4141682595c");
  assert.deepEqual(event.orderMatch, {
    by: "provider_order_id",
    value: CHECKOUT_INPUT.invoiceNumber,
  });
  assert.equal(event.expectedAmountCents, 99000);
  assert.equal(event.expectedCurrency, "vnd");

  const serialized = JSON.stringify(event.sanitizedPayload);
  assert.equal(serialized.includes("card_number"), false);
  assert.equal(serialized.includes("NGUYEN VAN A"), false);
});

test("verifyAndParseSepayWebhook does not mark paid without CAPTURED/APPROVED state", () => {
  const config = parseSepayConfig(VALID_SANDBOX_ENV);
  const pending = verifyAndParseSepayWebhook(
    ipnHeaders("ipn-secret-test"),
    ipnPayload({ order: { order_status: "PENDING" } }),
    config,
  );
  assert.equal(pending.outcome, "ignored");

  const voided = verifyAndParseSepayWebhook(
    ipnHeaders("ipn-secret-test"),
    ipnPayload({ root: { notification_type: "TRANSACTION_VOID" } }),
    config,
  );
  assert.equal(voided.outcome, "canceled");
});

test("verifyAndParseSepayWebhook rejects malformed payloads", () => {
  const config = parseSepayConfig(VALID_SANDBOX_ENV);
  assert.throws(
    () => verifyAndParseSepayWebhook(ipnHeaders("ipn-secret-test"), "not-json", config),
    /payload is invalid/,
  );
});

// ── Reconciliation parsing ──────────────────────────────────────────────────

test("parseSepayOrderResponse reads a captured order from either envelope", () => {
  const bare = parseSepayOrderResponse({
    order_invoice_number: "MKTABC",
    order_status: "CAPTURED",
    order_amount: "99000.00",
    order_currency: "VND",
  });
  assert.deepEqual(bare, {
    found: true,
    orderStatus: "CAPTURED",
    amountCents: 99000,
    currency: "vnd",
    invoiceNumber: "MKTABC",
  });

  const wrapped = parseSepayOrderResponse({
    data: { order_invoice_number: "MKTABC", order_status: "PENDING", order_amount: "99000" },
  });
  assert.equal(wrapped.found, true);
  assert.equal(wrapped.orderStatus, "PENDING");

  assert.equal(parseSepayOrderResponse({}).found, false);
});
