import { NextResponse, type NextRequest } from "next/server";

import {
  authenticateAccountRequest,
  statusForAccountAuthError,
} from "@/lib/account-auth";
import { BillingError, createBillingCheckout } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  plan?: unknown;
};

function getCurrentWorkspaceId(workspaceId: string | null): string {
  if (!workspaceId) {
    throw new BillingError("Workspace context is required", 400);
  }

  return workspaceId;
}

function statusForError(error: unknown): number {
  if (error instanceof BillingError) {
    return error.status;
  }

  const message = error instanceof Error ? error.message : "";
  return statusForAccountAuthError(message);
}

export async function POST(request: NextRequest) {
  try {
    const identity = await authenticateAccountRequest(request);
    const workspaceId = getCurrentWorkspaceId(identity.workspaceId);
    const body = (await request.json()) as CheckoutBody;
    const checkout = await createBillingCheckout({
      userId: identity.userId,
      workspaceId,
      plan: body.plan,
    });

    return NextResponse.json({
      success: true,
      data: {
        url: checkout.checkoutUrl,
        order: checkout.order,
        // Present when the provider requires a signed HTML form POST (SePay).
        // The browser auto-submits it; only the signature (safe to expose) and
        // public order fields are included — never the secret key.
        form:
          checkout.redirect.kind === "form"
            ? {
                action: checkout.redirect.action,
                method: checkout.redirect.method,
                fields: checkout.redirect.fields,
              }
            : null,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create checkout";
    return NextResponse.json(
      { success: false, error: message },
      { status: statusForError(error) },
    );
  }
}
