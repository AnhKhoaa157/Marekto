"use client";

import { useState } from "react";

import { ApiRequestError, requestApi } from "@/lib/client-api";
import type { CheckoutPlanCode, PaymentOrder } from "@/lib/billing";

type CheckoutResponse = {
  url: string;
  order: PaymentOrder;
};

type PortalResponse = {
  url: string;
};

function parseCheckoutResponse(value: unknown): CheckoutResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid checkout response");
  }

  const data = value as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url : "";

  if (!url) {
    throw new Error("Invalid checkout response");
  }

  return data as CheckoutResponse;
}

function parsePortalResponse(value: unknown): PortalResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid portal response");
  }

  const data = value as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url : "";

  if (!url) {
    throw new Error("Invalid portal response");
  }

  return { url };
}

export function BillingCheckoutButton({
  disabled,
  plan,
}: Readonly<{
  disabled?: boolean;
  plan: CheckoutPlanCode;
}>) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function startCheckout() {
    setError(null);
    setIsPending(true);

    try {
      const checkout = await requestApi<CheckoutResponse>(
        "/api/billing/checkout",
        {
          method: "POST",
          body: JSON.stringify({ plan }),
        },
        parseCheckoutResponse,
      );
      window.location.href = checkout.url;
    } catch (checkoutError) {
      const message =
        checkoutError instanceof ApiRequestError ||
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not start checkout.";
      setError(message);
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        className="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        disabled={disabled || isPending}
        onClick={startCheckout}
        type="button"
      >
        {isPending ? "Starting checkout..." : `Upgrade to ${plan}`}
      </button>
      {error ? <p className="text-xs leading-5 text-red-300">{error}</p> : null}
    </div>
  );
}

export function BillingPortalButton({
  disabled,
}: Readonly<{ disabled?: boolean }>) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function openPortal() {
    setError(null);
    setIsPending(true);

    try {
      const portal = await requestApi<PortalResponse>(
        "/api/billing/portal",
        { method: "POST" },
        parsePortalResponse,
      );
      window.location.href = portal.url;
    } catch (portalError) {
      const message =
        portalError instanceof ApiRequestError || portalError instanceof Error
          ? portalError.message
          : "Could not open billing portal.";
      setError(message);
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:text-zinc-500"
        disabled={disabled || isPending}
        onClick={openPortal}
        type="button"
      >
        {isPending ? "Opening..." : "Manage billing"}
      </button>
      {error ? <p className="text-xs leading-5 text-red-300">{error}</p> : null}
    </div>
  );
}
