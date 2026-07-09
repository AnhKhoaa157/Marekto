/**
 * Shared billing error type. Lives in its own module so provider adapters under
 * `src/lib/billing/providers/*` can throw typed billing errors without importing
 * the orchestration module `src/lib/billing.ts` (which would create a cycle).
 * `src/lib/billing.ts` re-exports `BillingError` for existing importers.
 */
export class BillingError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "BillingError";
    this.status = status;
  }
}
