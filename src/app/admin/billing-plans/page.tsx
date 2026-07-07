import { updateBillingPlanAction } from "@/app/admin/billing-plans/actions";
import { AdminGate } from "@/components/admin/admin-gate";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  AdminInlineError,
  AdminSectionHeading,
} from "@/components/admin/admin-ui";
import { loadAdminBillingPlans } from "@/lib/admin-billing-plans";
import { recordAdminAudit } from "@/lib/admin-data";
import { getAdminSessionState } from "@/lib/admin-session";
import { LIMIT_KEYS, type LimitKey } from "@/lib/entitlements";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";
import type { BillingPlan } from "@/lib/billing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Billing plans | Admin Console",
  description: "Manage public pricing, plan features, and enforced limits.",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const limitLabels: Record<LimitKey, string> = {
  "user.owned_workspaces": "Owned workspaces",
  "workspace.members": "Workspace members",
  "ai.campaign_builder": "AI campaign builder runs / month",
  "ai.segmentation": "AI segmentation runs / month",
  "ai.personalization_recipients": "AI personalized recipients / month",
  "contact_intelligence.rows": "Contact intelligence rows / month",
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function formatAmount(amount: number, currency: string): string {
  if (currency.toLowerCase() === "vnd") {
    return `${new Intl.NumberFormat("vi-VN").format(amount)} VND`;
  }

  return new Intl.NumberFormat("en-US", {
    currency: currency.toUpperCase(),
    style: "currency",
  }).format(amount / 100);
}

function PlanEditor({ plan }: Readonly<{ plan: BillingPlan }>) {
  return (
    <form
      action={updateBillingPlanAction}
      className="rounded-md border border-zinc-800 bg-zinc-900 p-5 shadow-sm"
    >
      <input name="planCode" type="hidden" value={plan.code} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {plan.code}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-50">
            {plan.name}
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Current price: {formatAmount(plan.monthlyAmountCents, plan.currency)}
          </p>
        </div>

        <label className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300">
          <input
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600"
            defaultChecked={plan.checkoutEnabled}
            name="checkoutEnabled"
            type="checkbox"
          />
          Checkout enabled
        </label>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Name
          </span>
          <input
            className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            defaultValue={plan.name}
            name="name"
            required
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Amount / month
          </span>
          <input
            className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            defaultValue={plan.monthlyAmountCents}
            min={0}
            name="monthlyAmountCents"
            required
            step={1}
            type="number"
          />
        </label>

        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Currency
          </span>
          <input
            className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm uppercase text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            defaultValue={plan.currency}
            maxLength={3}
            minLength={3}
            name="currency"
            required
          />
        </label>
      </div>

      <label className="mt-4 block space-y-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Description
        </span>
        <textarea
          className="min-h-20 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          defaultValue={plan.description}
          name="description"
          required
        />
      </label>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-zinc-200">Enforced limits</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Leave a limit blank to make it unlimited for that plan.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {LIMIT_KEYS.map((limitKey) => (
            <label className="space-y-2" key={`${plan.code}-${limitKey}`}>
              <span className="text-xs font-medium text-zinc-500">
                {limitLabels[limitKey]}
              </span>
              <input
                className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                defaultValue={plan.limits[limitKey] ?? ""}
                min={0}
                name={`limit:${limitKey}`}
                placeholder="Unlimited"
                step={1}
                type="number"
              />
            </label>
          ))}
        </div>
      </div>

      <label className="mt-5 block space-y-2">
        <span className="text-sm font-semibold text-zinc-200">
          Public feature bullets
        </span>
        <textarea
          className="min-h-36 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          defaultValue={plan.features.join("\n")}
          name="features"
          required
        />
      </label>

      <div className="mt-5 flex justify-end">
        <button
          className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
          type="submit"
        >
          Save {plan.name}
        </button>
      </div>
    </form>
  );
}

export default async function AdminBillingPlansPage({ searchParams }: PageProps) {
  const state = await getAdminSessionState();

  if (state.status === "unauthenticated") {
    return <AdminGate variant="unauthenticated" />;
  }

  if (state.status === "forbidden") {
    return <AdminGate variant="forbidden" />;
  }

  const resolved = searchParams ? await searchParams : {};
  const updated = firstParam(resolved.updated);
  let plans: BillingPlan[] = [];
  let error: string | null = null;

  try {
    plans = await loadAdminBillingPlans();
    await recordAdminAudit({
      adminUserId: state.identity.userId,
      action: "admin.billing_plans.read",
      targetType: "billing_plan_list",
      targetId: null,
      metadata: { surface: "ui", plan_count: plans.length },
    });
  } catch (loadError) {
    error = sanitizeWorkerLogReason(loadError);
  }

  return (
    <AdminShell
      activeRoute="/admin/billing-plans"
      adminEmail={state.identity.email}
      eyebrow="System administration"
      title="Billing plans"
    >
      <div className="space-y-6">
        <AdminSectionHeading
          title="Plan pricing and gates"
          description="Edit the public price, feature bullets, and enforced quota limits for each workspace plan."
        />

        {updated ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm font-medium text-emerald-200">
            Saved {updated} plan.
          </div>
        ) : null}

        {error ? (
          <AdminInlineError message={error} />
        ) : (
          <div className="space-y-5">
            {plans.map((plan) => (
              <PlanEditor key={plan.code} plan={plan} />
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
