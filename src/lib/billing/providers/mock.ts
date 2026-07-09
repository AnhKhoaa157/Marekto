import { BillingError } from "../errors.ts";
import { isUuid } from "../../identifiers.ts";
import type {
  NormalizedWebhookEvent,
  ProviderCheckout,
  ProviderCheckoutInput,
} from "./types.ts";

/**
 * Local development mock provider. Never used in production (see
 * `isMockConfigured`). It fabricates no business data — it only wires the same
 * order/webhook plumbing the real providers use so the billing flow can be
 * smoke-tested without a payment gateway.
 */

export function isMockConfigured(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

export function buildMockCheckout(input: ProviderCheckoutInput): ProviderCheckout {
  const providerOrderId = `mock_${input.orderId}`;
  const checkoutUrl = `${input.appBaseUrl}/settings/billing?mock_order=${input.orderId}`;

  return {
    redirect: { kind: "url", url: checkoutUrl },
    providerOrderId,
    checkoutUrl,
    environment: null,
    safeMetadata: { mock_order_id: providerOrderId },
  };
}

function assertMockWebhookSignature(headers: Headers): void {
  const expected =
    process.env.BILLING_MOCK_WEBHOOK_SECRET ?? "marekto-mock-billing-secret";
  const actual = headers.get("x-marekto-billing-signature");

  if (!actual || actual !== expected) {
    throw new BillingError("Invalid billing webhook signature", 401);
  }
}

export function verifyAndParseMockWebhook(
  headers: Headers,
  bodyText: string,
): NormalizedWebhookEvent {
  assertMockWebhookSignature(headers);

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new BillingError("Webhook payload is invalid", 400);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BillingError("Webhook payload is invalid", 400);
  }

  const payload = parsed as Record<string, unknown>;
  const eventId = typeof payload.event_id === "string" ? payload.event_id.trim() : "";
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const orderId = typeof payload.order_id === "string" ? payload.order_id : "";

  if (eventId.length === 0) {
    throw new BillingError("Webhook event id is required", 400);
  }

  if (eventType !== "payment_order.paid" && eventType !== "payment_order.failed") {
    throw new BillingError("Webhook event type is unsupported", 400);
  }

  if (!isUuid(orderId)) {
    throw new BillingError("Webhook order id is invalid", 400);
  }

  return {
    providerEventId: eventId,
    eventType,
    outcome: eventType === "payment_order.paid" ? "paid" : "failed",
    orderMatch: { by: "id", value: orderId },
    expectedAmountCents: null,
    expectedCurrency: null,
    sanitizedPayload: { event_id: eventId, type: eventType, order_id: orderId },
  };
}
