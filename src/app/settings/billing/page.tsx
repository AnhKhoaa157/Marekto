import { AppShell } from "@/components/layout/app-shell";
import {
  getWorkspaceUsageOverview,
  PLAN_ENTITLEMENTS,
  type LimitDetails,
} from "@/lib/entitlements";
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

export default async function BillingSettingsPage() {
  const session = await requireServerWorkspaceSession();
  const workspace = await assertUserCanUseWorkspace(
    session.userId,
    session.workspaceId,
  );

  const isOwner = workspace.role === "owner";
  const overview = isOwner
    ? await getWorkspaceUsageOverview({
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
          <section className="rounded-md border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Current plan
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-zinc-50">
                  {PLAN_ENTITLEMENTS[overview.workspacePlan].name}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Usage is measured from real workspace activity. Billing is not
                  connected yet, so upgrades are shown as placeholders.
                </p>
              </div>
              <button
                className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-300"
                disabled
                type="button"
              >
                Upgrade placeholder
              </button>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <UsageCard
              description="Owned workspaces available to this account."
              details={overview.ownedWorkspaces}
              label="Owned workspaces"
            />
            <UsageCard
              description="Members currently joined to this workspace."
              details={overview.workspaceMembers}
              label="Workspace members"
            />
            <UsageCard
              description="AI Campaign Builder generations this month."
              details={overview.usage["ai.campaign_builder"]}
              label="Campaign Builder"
            />
            <UsageCard
              description="AI audience segmentation generations this month."
              details={overview.usage["ai.segmentation"]}
              label="Segmentation"
            />
            <UsageCard
              description="Recipient-level AI personalizations this month."
              details={overview.usage["ai.personalization_recipients"]}
              label="Personalization recipients"
            />
            <UsageCard
              description="Contact rows normalized or scored this month."
              details={overview.usage["contact_intelligence.rows"]}
              label="Contact intelligence rows"
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}
