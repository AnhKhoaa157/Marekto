import Link from "next/link";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import type {
  CampaignRow,
  RecentDeliveryFailureRow,
  ReadyDashboardData,
} from "@/lib/dashboard";
import { getServerAuthSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard | Marekto",
  description: "Multi-tenant marketing automation workspace overview.",
};

type DashboardData =
  | {
      status: "unauthenticated";
      metrics: null;
      campaigns: CampaignRow[];
      recentDeliveryFailures: RecentDeliveryFailureRow[];
      error: null;
    }
  | ReadyDashboardData
  | {
      status: "error";
      metrics: null;
      campaigns: CampaignRow[];
      recentDeliveryFailures: RecentDeliveryFailureRow[];
      error: string;
    };

type DashboardProps = {
  searchParams?: Promise<{
    q?: string | string[];
  }>;
};

const metricLabels = {
  contacts: "Active contacts",
  campaigns: "Campaign records",
  lists: "Contact lists",
  templates: "Email templates",
};

const UNAVAILABLE_REASON = "Requires an authenticated tenant session.";

function parseSearchQuery(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}

async function getDashboardData(searchQuery: string): Promise<DashboardData> {
  const payload = await getServerAuthSession();

  if (!payload) {
    return {
      status: "unauthenticated",
      metrics: null,
      campaigns: [],
      recentDeliveryFailures: [],
      error: null,
    };
  }

  try {
    const { loadDashboardData } = await import("@/lib/dashboard");
    return await loadDashboardData(payload.workspaceId, searchQuery);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load dashboard data";

    return {
      status: "error",
      metrics: null,
      campaigns: [],
      recentDeliveryFailures: [],
      error: message,
    };
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatSchedule(campaign: CampaignRow): string {
  const dateValue = campaign.scheduled_at ?? campaign.run_at;

  if (!dateValue) {
    return "Not scheduled";
  }

  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Schedule unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDeliveryFailureTime(value: Date | string | null): string {
  if (!value) {
    return "Time unavailable";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusClassName(status: string): string {
  const normalizedStatus = status.trim().toLowerCase();

  if (normalizedStatus === "sent") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }

  if (normalizedStatus === "pending") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-300";
  }

  if (normalizedStatus === "draft") {
    return "border-zinc-700 bg-zinc-800 text-zinc-300";
  }

  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function SectionHeading({
  title,
  description,
}: Readonly<{
  title: string;
  description: string;
}>) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  valueClassName = "text-zinc-50",
}: Readonly<{
  title: string;
  value: string;
  description: string;
  valueClassName?: string;
}>) {
  return (
    <article className="flex flex-col rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <p className="text-sm text-zinc-400">{title}</p>
      <p
        className={`mt-3 text-3xl font-semibold tracking-tight ${valueClassName}`}
      >
        {value}
      </p>
      <p className="mt-2 text-xs font-medium text-zinc-500">{description}</p>
    </article>
  );
}

function UnavailableMetricCard({
  title,
  description = UNAVAILABLE_REASON,
}: Readonly<{
  title: string;
  description?: string;
}>) {
  return (
    <article className="flex flex-col rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-600">
        —
      </p>
      <p className="mt-2 text-xs font-medium text-zinc-500">{description}</p>
    </article>
  );
}

function DashboardStatus({ data }: Readonly<{ data: DashboardData }>) {
  if (data.status === "ready") {
    return (
      <section
        aria-label="Dashboard data status"
        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4"
      >
        <h3 className="text-base font-semibold text-emerald-200">
          Live tenant data connected
        </h3>
        <p className="mt-1 text-sm text-emerald-100/80">
          Metrics and campaign records below are loaded from your authenticated
          workspace.
        </p>
      </section>
    );
  }

  if (data.status === "error") {
    return (
      <section
        aria-label="Dashboard data error"
        className="rounded-md border border-red-500/30 bg-red-500/10 p-4"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-red-200">
              Dashboard data could not be loaded
            </h3>
            <p className="mt-1 text-sm text-red-100/80">
              Something interrupted the workspace data request. Retry, and if it
              keeps failing, check the workspace connection.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-red-400/40 px-3 text-sm font-medium text-red-100 outline-none transition-colors hover:bg-red-400/10 focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Dashboard data status"
      className="rounded-md border border-blue-500/30 bg-blue-500/10 p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-blue-200">
            Sign in to load live dashboard data
          </h3>
          <p className="mt-1 text-sm text-blue-100/80">
            Metrics, campaign rows, audience panels, and workspace records stay
            empty until an authenticated tenant session is available.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href="/login"
            className="inline-flex h-9 items-center justify-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white outline-none transition-colors hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex h-9 items-center justify-center rounded-md border border-blue-400/40 px-3 text-sm font-medium text-blue-100 outline-none transition-colors hover:bg-blue-400/10 focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            Create account
          </Link>
        </div>
      </div>
    </section>
  );
}

function WorkspaceMetrics({ data }: Readonly<{ data: DashboardData }>) {
  return (
    <section aria-label="Workspace overview" className="space-y-4">
      <SectionHeading
        title="Workspace overview"
        description="Record counts across the authenticated workspace."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.status === "ready" ? (
          <>
            <MetricCard
              title={metricLabels.contacts}
              value={formatCount(data.metrics.contacts)}
              description="Loaded from Contacts"
            />
            <MetricCard
              title={metricLabels.campaigns}
              value={formatCount(data.metrics.campaigns)}
              description="Loaded from Campaigns"
            />
            <MetricCard
              title={metricLabels.lists}
              value={formatCount(data.metrics.lists)}
              description="Loaded from Lists"
            />
            <MetricCard
              title={metricLabels.templates}
              value={formatCount(data.metrics.templates)}
              description="Loaded from Templates"
            />
          </>
        ) : (
          <>
            <UnavailableMetricCard title={metricLabels.contacts} />
            <UnavailableMetricCard title={metricLabels.campaigns} />
            <UnavailableMetricCard title={metricLabels.lists} />
            <UnavailableMetricCard title={metricLabels.templates} />
          </>
        )}
      </div>
    </section>
  );
}

function DeliveryMetrics({ data }: Readonly<{ data: DashboardData }>) {
  const hasFailures =
    data.status === "ready" && data.metrics.failedEmails > 0;

  return (
    <section aria-label="Email delivery" className="space-y-4">
      <SectionHeading
        title="Email delivery"
        description="Send outcomes derived from workspace email logs."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data.status === "ready" ? (
          <>
            <MetricCard
              title="Emails sent"
              value={formatCount(data.metrics.sentEmails)}
              description="Derived from Email_logs"
            />
            <MetricCard
              title="Emails failed"
              value={formatCount(data.metrics.failedEmails)}
              description="Derived from Email_logs"
              valueClassName={
                hasFailures ? "text-red-300" : "text-zinc-50"
              }
            />
          </>
        ) : (
          <>
            <UnavailableMetricCard
              title="Emails sent"
              description="Requires authenticated email log data."
            />
            <UnavailableMetricCard
              title="Emails failed"
              description="Requires authenticated email log data."
            />
          </>
        )}
      </div>

      <RecentFailuresCard data={data} />
    </section>
  );
}

function RecentFailuresCard({ data }: Readonly<{ data: DashboardData }>) {
  return (
    <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <h3 className="text-sm font-medium text-zinc-300">
        Recent delivery failures
      </h3>

      {data.status !== "ready" ? (
        <div className="mt-3 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-4 text-center">
          <p className="text-sm font-medium text-zinc-200">
            Delivery failures unavailable
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Requires authenticated email log data.
          </p>
        </div>
      ) : data.recentDeliveryFailures.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-4 text-center">
          <p className="text-sm font-medium text-zinc-200">
            No failed email logs yet
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Failed recipient outcomes will appear here when the worker records
            them.
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-800">
          {data.recentDeliveryFailures.map((failure) => (
            <li
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              key={failure.campaign_id}
            >
              <div className="min-w-0">
                <Link
                  className="block truncate text-sm font-medium text-zinc-100 outline-none transition-colors hover:text-indigo-300 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
                  href={`/campaigns/${failure.campaign_id}`}
                >
                  {failure.campaign_name}
                </Link>
                <p className="mt-1 text-xs text-zinc-500">
                  Last failed {formatDeliveryFailureTime(failure.last_failed_at)}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 sm:self-auto">
                {formatCount(failure.failed_count)} failed
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function CampaignFilterForm({
  searchQuery,
  hasSession,
}: Readonly<{
  searchQuery: string;
  hasSession: boolean;
}>) {
  return (
    <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <form
        action="/dashboard"
        className="flex flex-col gap-3 lg:flex-row lg:items-end"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <label
            className="text-xs font-medium uppercase tracking-wide text-zinc-500"
            htmlFor="dashboard-campaign-filter"
          >
            Filter campaign names
          </label>
          <input
            className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:text-zinc-500"
            defaultValue={searchQuery}
            disabled={!hasSession}
            id="dashboard-campaign-filter"
            name="q"
            placeholder={
              hasSession
                ? "Search by campaign name"
                : "Sign in to filter campaigns"
            }
            type="search"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className={
              hasSession
                ? "h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
                : "h-10 rounded-md border border-zinc-800 bg-zinc-900 px-4 text-sm font-medium text-zinc-500 outline-none"
            }
            disabled={!hasSession}
            title={
              hasSession
                ? undefined
                : "Sign in to filter campaign records."
            }
            type="submit"
          >
            Filter
          </button>
          {searchQuery ? (
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/dashboard"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>
      {searchQuery ? (
        <p className="mt-2 text-xs text-zinc-500">
          Showing campaigns matching{" "}
          <span className="font-medium text-zinc-300">“{searchQuery}”</span>.
        </p>
      ) : null}
    </div>
  );
}

function CampaignTable({
  campaigns,
  searchQuery,
}: Readonly<{
  campaigns: CampaignRow[];
  searchQuery: string;
}>) {
  if (campaigns.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-6 text-center">
        <p className="text-sm font-medium text-zinc-200">
          {searchQuery
            ? "No campaigns match this filter"
            : "No campaign records yet"}
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          {searchQuery
            ? "No campaign name matches the current filter. Clear the filter or try a different name."
            : "Create your first campaign to start scheduling and sending from this workspace."}
        </p>
        <div className="mt-4 flex justify-center">
          {searchQuery ? (
            <Link
              className="inline-flex h-9 items-center justify-center rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-200 outline-none transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/dashboard"
            >
              Clear filter
            </Link>
          ) : (
            <Link
              className="inline-flex h-9 items-center justify-center rounded-md bg-indigo-600 px-3 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/campaigns"
            >
              Create campaign
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="marekto-scrollbar mt-4 overflow-x-auto">
      <table className="w-full min-w-full text-left text-sm">
        <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-3 pr-4">Campaign</th>
            <th className="py-3 pr-4">Status</th>
            <th className="py-3">Schedule</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="text-zinc-300">
              <td className="py-4 pr-4 font-medium text-zinc-50">
                {campaign.name}
              </td>
              <td className="py-4 pr-4">
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusClassName(campaign.status)}`}
                >
                  {campaign.status}
                </span>
              </td>
              <td className="whitespace-nowrap py-4 text-zinc-400">
                {formatSchedule(campaign)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignPipelineCard({
  data,
  searchQuery,
  hasSession,
}: Readonly<{
  data: DashboardData;
  searchQuery: string;
  hasSession: boolean;
}>) {
  return (
    <article className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm xl:col-span-2">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">
            Campaign pipeline
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Real campaign records from the authenticated workspace.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link
            className="inline-flex h-9 items-center justify-center rounded-md bg-indigo-600 px-3 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
            href="/campaigns"
          >
            New campaign
          </Link>
          <button
            className="h-9 rounded-md border border-zinc-800 px-3 text-sm font-medium text-zinc-500 outline-none"
            disabled
            title="Report export is not available yet — no export API exists for this workspace."
            type="button"
          >
            Export report
          </button>
        </div>
      </div>

      <CampaignFilterForm searchQuery={searchQuery} hasSession={hasSession} />

      <CampaignTable
        campaigns={data.status === "ready" ? data.campaigns : []}
        searchQuery={searchQuery}
      />
    </article>
  );
}

function SupportingCards({ data }: Readonly<{ data: DashboardData }>) {
  return (
    <aside className="min-w-0 space-y-6">
      <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-50">Audience data</h2>
        {data.status === "ready" ? (
          <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-sm font-medium text-zinc-200">
              Contacts and lists are connected.
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">Contacts</dt>
                <dd className="font-medium text-zinc-100">
                  {formatCount(data.metrics.contacts)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-zinc-500">Lists</dt>
                <dd className="font-medium text-zinc-100">
                  {formatCount(data.metrics.lists)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-4 text-center">
            <p className="text-sm font-medium text-zinc-200">
              Audience data unavailable
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Sign in before showing contact and list data.
            </p>
          </div>
        )}
      </article>

      <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-50">
            Automation experiments
          </h2>
          <span className="shrink-0 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-400">
            Coming soon
          </span>
        </div>
        <div className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-4">
          <p className="text-sm font-medium text-zinc-200">
            Automation is not available yet
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Experiment planning will appear here once an automation backend is
            connected. Nothing is scheduled from this panel today.
          </p>
        </div>
      </article>
    </aside>
  );
}

function DashboardBody({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <div className="space-y-8">{children}</div>;
}

export default async function DashboardPage({ searchParams }: DashboardProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const searchQuery = parseSearchQuery(resolvedSearchParams.q);
  const data = await getDashboardData(searchQuery);
  const hasSession = data.status === "ready";

  return (
    <AppShell
      activeRoute="/dashboard"
      authenticated={hasSession}
      eyebrow="Marketing command center"
      title="Dashboard overview"
    >
      <DashboardBody>
        <DashboardStatus data={data} />
        <WorkspaceMetrics data={data} />
        <DeliveryMetrics data={data} />

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <CampaignPipelineCard
            data={data}
            searchQuery={searchQuery}
            hasSession={hasSession}
          />
          <SupportingCards data={data} />
        </section>
      </DashboardBody>
    </AppShell>
  );
}
