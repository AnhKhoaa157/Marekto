import { AppShell } from "@/components/layout/app-shell";
import {
  BillingCheckoutButton,
  BillingPortalButton,
} from "@/app/settings/billing/billing-actions";
import { getBillingOverview, type BillingPlan } from "@/lib/billing";
import type { LimitDetails, PlanCode } from "@/lib/entitlements";
import { formatEntityCode } from "@/lib/identifiers";
import { requireServerWorkspaceSession } from "@/lib/server-auth";
import { assertUserCanUseWorkspace } from "@/lib/workspace-collaboration";

export const metadata = {
  title: "Billing & Usage | Marekto",
};

function formatLimit(limit: number | null): string {
  return limit === null ? "Unlimited" : String(limit);
}

function usageText(details: LimitDetails): string {
  return `${details.used} / ${formatLimit(details.limit)}`;
}

function resolvePlanName(plans: BillingPlan[], planCode: PlanCode): string {
  return plans.find((plan) => plan.code === planCode)?.name ?? planCode;
}

function formatMoney(amountCents: number, currency: string): string {
  if (amountCents === 0) {
    return "Free";
  }

  const normalizedCurrency = currency.toUpperCase();
  const amount = normalizedCurrency === "VND" ? amountCents : amountCents / 100;

  return new Intl.NumberFormat("en-US", {
    currency: normalizedCurrency,
    style: "currency",
  }).format(amount);
}

function UsageCard({
  description,
  details,
  label,
}: Readonly<{
  description: string;
  details: LimitDetails;
  label: string;
}>) {
  const percent =
    details.limit === null || details.limit === 0
      ? 0
      : Math.min(100, Math.round((details.used / details.limit) * 100));

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{label}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p>
        </div>
        <p className="whitespace-nowrap font-mono text-sm text-zinc-200">
          {usageText(details)}
        </p>
      </div>
      {details.limit !== null ? (
        <div className="mt-4 h-2 rounded-full bg-zinc-800">
          <div
            className="h-2 rounded-full bg-indigo-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function PlanCard({
  currentPlan,
  plan,
  providerConfigured,
}: Readonly<{
  currentPlan: string;
  plan: BillingPlan;
  providerConfigured: boolean;
}>) {
  const isCurrent = currentPlan === plan.code;
  const memberLimit = plan.limits["workspace.members"];
  const builderLimit = plan.limits["ai.campaign_builder"];

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">{plan.name}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            {plan.description}
          </p>
        </div>
        {isCurrent ? (
          <span className="rounded-md border border-emerald-700 bg-emerald-950 px-2 py-1 text-xs font-semibold text-emerald-200">
            Current
          </span>
        ) : null}
      </div>

      <p className="mt-5 text-2xl font-semibold text-zinc-50">
        {formatMoney(plan.monthlyAmountCents, plan.currency)}
        {plan.monthlyAmountCents > 0 ? (
          <span className="text-sm font-normal text-zinc-500"> / month</span>
        ) : null}
      </p>

      <ul className="mt-4 space-y-2 text-sm text-zinc-400">
        <li>Members: {formatLimit(memberLimit)}</li>
        <li>Campaign Builder runs: {formatLimit(builderLimit)}</li>
      </ul>

      <div className="mt-5">
        {plan.code === "free" ? (
          <button
            className="w-full rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-500"
            disabled
            type="button"
          >
            Included
          </button>
        ) : (
          <BillingCheckoutButton
            disabled={isCurrent || !providerConfigured}
            plan={plan.code}
          />
        )}
      </div>
    </div>
  );
}

function sepayReturnMessage(value: string | undefined): string | null {
  if (value === "success") {
    return "Thanks — we received your return from SePay. Your plan activates only after SePay confirms the payment, which can take a moment. This page reflects the verified status.";
  }
  if (value === "cancel") {
    return "You canceled the SePay checkout. No payment was taken and your plan is unchanged.";
  }
  if (value === "error") {
    return "The SePay checkout reported an error. No plan change was made. You can try upgrading again.";
  }
  return null;
}

export default async function BillingSettingsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  const sepayReturn = typeof params.sepay === "string" ? params.sepay : undefined;
  const returnMessage = sepayReturnMessage(sepayReturn);
  const session = await requireServerWorkspaceSession();
  const workspace = await assertUserCanUseWorkspace(
    session.userId,
    session.workspaceId,
  );

  const isOwner = workspace.role === "owner";
  const overview = isOwner
    ? await getBillingOverview({
        userId: session.userId,
        workspaceId: session.workspaceId,
      })
    : null;

  return (
    <AppShell
      activeRoute="/settings/billing"
      authenticated
      eyebrow="Workspace settings"
      title="Billing & Usage"
    >
      {!isOwner || !overview ? (
        <section className="rounded-md border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold text-zinc-50">
            Owner access required
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            Only workspace owners can view plan limits and usage for{" "}
            {formatEntityCode("WS", session.workspaceId)}.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
          {returnMessage ? (
            <section
              className="rounded-md border border-sky-900 bg-sky-950/40 p-4"
              role="status"
            >
              <p className="text-sm leading-6 text-sky-200">{returnMessage}</p>
            </section>
          ) : null}

          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Current plan
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-zinc-50">
                  {resolvePlanName(overview.plans, overview.subscription.plan_code)}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Usage is measured from real workspace activity. Provider:{" "}
                  <span className="font-medium text-zinc-200">
                    {overview.provider === "sepay" &&
                    overview.providerEnvironment === "sandbox"
                      ? "SePay Sandbox"
                      : overview.provider}
                  </span>
                  .
                </p>
                {!overview.providerConfigured ? (
                  <p className="mt-2 text-sm leading-6 text-amber-300">
                    Billing provider is not configured, so checkout actions are
                    disabled.
                  </p>
                ) : null}
              </div>
              <BillingPortalButton disabled={overview.provider !== "stripe"} />
            </div>
          </section>

          {overview.pendingOrders.length > 0 ? (
            <section className="rounded-md border border-amber-900 bg-amber-950/40 p-5">
              <h2 className="text-sm font-semibold text-amber-100">
                Pending payment
              </h2>
              <div className="mt-3 space-y-2">
                {overview.pendingOrders.map((order) => (
                  <p className="text-sm leading-6 text-amber-200" key={order.id}>
                    {resolvePlanName(overview.plans, order.plan_code)} order{" "}
                    {formatEntityCode("PO", order.id)} is awaiting payment
                    confirmation via {order.provider}. Your plan activates only
                    after the payment is verified; refresh this page to check the
                    latest status.
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-3">
            {overview.plans.map((plan) => (
              <PlanCard
                currentPlan={overview.subscription.plan_code}
                key={plan.code}
                plan={plan}
                providerConfigured={overview.providerConfigured}
              />
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <UsageCard
              description="Owned workspaces available to this account."
              details={overview.usage.ownedWorkspaces}
              label="Owned workspaces"
            />
            <UsageCard
              description="Members currently joined to this workspace."
              details={overview.usage.workspaceMembers}
              label="Workspace members"
            />
            <UsageCard
              description="AI Campaign Builder generations this month."
              details={overview.usage.usage["ai.campaign_builder"]}
              label="Campaign Builder"
            />
            <UsageCard
              description="AI audience segmentation generations this month."
              details={overview.usage.usage["ai.segmentation"]}
              label="Segmentation"
            />
            <UsageCard
              description="Recipient-level AI personalizations this month."
              details={overview.usage.usage["ai.personalization_recipients"]}
              label="Personalization recipients"
            />
            <UsageCard
              description="Contact rows normalized or scored this month."
              details={overview.usage.usage["contact_intelligence.rows"]}
              label="Contact intelligence rows"
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}
