/**
 * Provider boundary types.
 *
 * A billing provider adapter is responsible for exactly four things and nothing
 * else (no database access, no entitlement logic):
 *   1. Build the checkout redirect target (URL or signed form) for an order.
 *   2. Authenticate and parse an incoming webhook/IPN into a safe internal shape.
 *   3. Normalize provider event data (never leaking secrets).
 *   4. Map provider errors without leaking secrets.
 *
 * The orchestration module `src/lib/billing.ts` owns order persistence, amount
 * validation against the trusted stored order, and entitlement activation.
 */

export type SepayEnv = "sandbox" | "production";

/** Server-resolved checkout inputs. The browser never supplies any of these. */
export type ProviderCheckoutInput = {
  /** Marekto payment order UUID. */
  orderId: string;
  /** Paid plan code ("pro" | "team"). */
  planCode: string;
  /** Amount in the currency's smallest billable unit (VND has none, so = đồng). */
  amountCents: number;
  /** Lowercase currency code as stored, e.g. "vnd". */
  currency: string;
  /** Stable unique invoice/order number derived from the order UUID. */
  invoiceNumber: string;
  /** Human-readable order description sent to the provider. */
  description: string;
  /** Absolute app base URL, e.g. "http://localhost:3000". */
  appBaseUrl: string;
};

/**
 * How the browser should reach the provider checkout:
 *   - `url`: a plain top-level navigation (mock provider, local URL).
 *   - `form`: an auto-submitted HTML form POST (official SePay checkout).
 * For the form variant, `fields` includes the HMAC signature; that signature is
 * derived from the secret key but is itself safe to expose to the browser —
 * only the raw `SEPAY_SECRET_KEY` must never leave the server.
 */
export type ProviderCheckoutRedirect =
  | { kind: "url"; url: string }
  | { kind: "form"; method: "POST"; action: string; fields: Record<string, string> };

export type ProviderCheckout = {
  redirect: ProviderCheckoutRedirect;
  /** Value stored in Payment_orders.provider_order_id (the invoice number for SePay). */
  providerOrderId: string;
  /** Safe checkout URL for storage/display. */
  checkoutUrl: string;
  /** Provider environment ("sandbox") or null for providers without one (mock). */
  environment: string | null;
  /** Non-sensitive metadata to merge into Payment_orders.metadata. */
  safeMetadata: Record<string, unknown>;
};

export type NormalizedWebhookOutcome = "paid" | "failed" | "canceled" | "ignored";

/**
 * A provider webhook normalized into a safe internal event. The orchestration
 * layer looks up the matching order, validates amount/currency against the
 * trusted stored order, records the event idempotently, and only then acts on
 * `outcome`.
 */
export type NormalizedWebhookEvent = {
  /** Globally unique per provider; drives idempotency. */
  providerEventId: string;
  /** Stored on the Billing_events row. */
  eventType: string;
  outcome: NormalizedWebhookOutcome;
  /** How to find the Marekto order this event refers to. */
  orderMatch: { by: "id" | "provider_order_id"; value: string };
  /**
   * Amount the provider claims was paid, in the currency's smallest unit. When
   * non-null the orchestration layer requires an EXACT match with the stored
   * order before activating. Null means "trust the stored order" (mock only).
   */
  expectedAmountCents: number | null;
  /** Currency the provider claims, lowercased, or null to skip the check. */
  expectedCurrency: string | null;
  /** Sanitized, secret-free payload safe to persist on Billing_events. */
  sanitizedPayload: Record<string, unknown>;
};
