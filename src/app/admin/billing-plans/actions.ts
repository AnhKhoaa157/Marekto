"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  parseBillingPlanUpdateForm,
  updateAdminBillingPlan,
} from "@/lib/admin-billing-plans";
import { recordAdminAudit } from "@/lib/admin-data";
import { getAdminSessionState } from "@/lib/admin-session";

export async function updateBillingPlanAction(formData: FormData): Promise<void> {
  const state = await getAdminSessionState();

  if (state.status !== "authorized") {
    throw new Error("Administrator access required");
  }

  const input = parseBillingPlanUpdateForm(formData);
  await updateAdminBillingPlan(input);
  await recordAdminAudit({
    adminUserId: state.identity.userId,
    action: "admin.billing_plans.update",
    targetType: "billing_plan",
    targetId: null,
    metadata: {
      plan_code: input.code,
      monthly_amount_cents: input.monthlyAmountCents,
      currency: input.currency,
      checkout_enabled: input.checkoutEnabled,
    },
  });

  revalidatePath("/");
  revalidatePath("/admin/billing-plans");
  revalidatePath("/settings/billing");
  redirect(`/admin/billing-plans?updated=${input.code}`);
}
