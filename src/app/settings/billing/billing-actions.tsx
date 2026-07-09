"use client";

import { useState } from "react";

import { ApiRequestError, requestApi } from "@/lib/client-api";
import type { CheckoutPlanCode, PaymentOrder } from "@/lib/billing";

type CheckoutForm = {
  action: string;
  method: "POST";
  fields: Record<string, string>;
};

type CheckoutResponse = {
  url: string;
  order: PaymentOrder;
  form: CheckoutForm | null;
};

type PortalResponse = {
  url: string;
};

function parseCheckoutForm(value: unknown): CheckoutForm | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const action = typeof data.action === "string" ? data.action : "";
  const fields = data.fields;

  if (!action || typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return null;
  }

  const stringFields: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof fieldValue === "string") stringFields[key] = fieldValue;
  }

  return { action, method: "POST", fields: stringFields };
}

function parseCheckoutResponse(value: unknown): CheckoutResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid checkout response");
  }

  const data = value as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url : "";

  if (!url) {
    throw new Error("Invalid checkout response");
  }

  return {
    url,
    order: data.order as PaymentOrder,
    form: parseCheckoutForm(data.form),
  };
}

/**
 * SePay hosted checkout requires a signed HTML form POST. Build a transient
 * off-DOM form and submit it so the browser navigates to SePay's checkout page.
 */
function submitCheckoutForm(form: CheckoutForm): void {
  const element = document.createElement("form");
  element.method = form.method;
  element.action = form.action;

  for (const [key, value] of Object.entries(form.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    element.appendChild(input);
  }

  document.body.appendChild(element);
  element.submit();
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
      if (checkout.form) {
        submitCheckoutForm(checkout.form);
        return;
      }
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
