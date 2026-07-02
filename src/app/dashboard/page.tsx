import Link from "next/link";

import { AppShell } from "@/components/dashboard/app-shell";
import type {
  CampaignRow,
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
      error: null;
    }
  | ReadyDashboardData
  | {
      status: "error";
      metrics: null;
      campaigns: CampaignRow[];
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

function MetricCard({
  title,
  value,
  description,
}: Readonly<{
  title: string;
  value: string;
  description: string;
}>) {
  return (
    <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">
        {value}
      </p>
      <p className="mt-2 text-xs font-medium text-zinc-500">{description}</p>
    </article>
  );
}

function DataUnavailableCard({
  title,
  description,
}: Readonly<{
  title: string;
  description: string;
}>) {
  return (
    <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <p className="text-sm text-zinc-400">{title}</p>
      <p className="mt-3 text-lg font-semibold text-zinc-50">Data unavailable</p>
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
          Metrics and campaign records are loaded from the authenticated
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
            <p className="mt-1 text-sm text-red-100/80">{data.error}</p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center justify-center rounded-md border border-red-400/40 px-3 text-sm font-medium text-red-100 outline-none transition-colors hover:bg-red-400/10 focus-visible:ring-2 focus-visible:ring-red-300"
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

function MetricsSection({ data }: Readonly<{ data: DashboardData }>) {
  if (data.status !== "ready") {
    return (
      <section
        aria-label="Dashboard metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <DataUnavailableCard
          title={metricLabels.contacts}
          description="Requires an authenticated tenant session."
        />
        <DataUnavailableCard
          title={metricLabels.campaigns}
          description="Requires an authenticated tenant session."
        />
        <DataUnavailableCard
          title={metricLabels.lists}
          description="Requires an authenticated tenant session."
        />
        <DataUnavailableCard
          title={metricLabels.templates}
          description="Requires an authenticated tenant session."
        />
      </section>
    );
  }

  return (
    <section
      aria-label="Dashboard metrics"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
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
    </section>
  );
}

function CampaignTable({
  campaigns,
  searchQuery,
}: Readonly<{
  campaigns: CampaignRow[];
  searchQuery: string;
}>) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-full text-left text-sm">
        <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="py-3 pr-4">Campaign</th>
            <th className="py-3 pr-4">Status</th>
            <th className="py-3">Schedule</th>
          </tr>
        </thead>
        <tbody className={campaigns.length > 0 ? "divide-y divide-zinc-800" : undefined}>
          {campaigns.length > 0 ? (
            campaigns.map((campaign) => (
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
                <td className="py-4 text-zinc-400">{formatSchedule(campaign)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="py-10">
                <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-6 text-center">
                  <p className="text-sm font-medium text-zinc-200">
                    No campaign data available
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    {searchQuery
                      ? "No real campaign records match the current search."
                      : "Create real campaign records through the backend before this table is populated."}
                  </p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
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
      headerActions={
        <form action="/dashboard" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="dashboard-search">
            Search campaigns
          </label>
          <input
            className="h-10 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:text-zinc-500 sm:w-72"
            defaultValue={searchQuery}
            disabled={!hasSession}
            id="dashboard-search"
            name="q"
            placeholder={
              hasSession ? "Search real campaigns" : "Search after signing in"
            }
            type="search"
          />
          <button
            className={
              hasSession
                ? "h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
                : "h-10 rounded-md border border-zinc-800 bg-zinc-900 px-4 text-sm font-medium text-zinc-500 outline-none"
            }
            disabled={!hasSession}
            type="submit"
          >
            Search
          </button>
        </form>
      }
      title="Dashboard overview"
    >
      <DashboardStatus data={data} />
      <MetricsSection data={data} />

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <article className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm xl:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">
                Campaign pipeline
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Real campaign records from the authenticated workspace.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                className="inline-flex h-9 items-center justify-center rounded-md bg-indigo-600 px-3 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href="/campaigns"
              >
                New campaign
              </Link>
              <button
                className="h-9 rounded-md border border-zinc-800 px-3 text-sm font-medium text-zinc-500 outline-none"
                disabled
                title="No report export API is available."
                type="button"
              >
                Export report
              </button>
            </div>
          </div>

          <CampaignTable
            campaigns={data.status === "ready" ? data.campaigns : []}
            searchQuery={searchQuery}
          />
        </article>

        <aside className="min-w-0 space-y-6">
          <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-zinc-50">Audience data</h2>
            {data.status === "ready" ? (
              <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm font-medium text-zinc-200">
                  Contacts and lists are connected.
                </p>
                <p className="mt-2 text-sm text-zinc-500">
                  Contact count: {formatCount(data.metrics.contacts)}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  List count: {formatCount(data.metrics.lists)}
                </p>
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
            <h2 className="text-lg font-semibold text-zinc-50">
              Automation experiments
            </h2>
            <div className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-4 text-center">
              <p className="text-sm font-medium text-zinc-200">
                No automation data available
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                No experiment route or backend API exists yet for this dashboard
                action.
              </p>
              <button
                className="mt-4 h-9 rounded-md border border-zinc-800 px-3 text-sm font-medium text-zinc-500 outline-none"
                disabled
                title="No automation API is available."
                type="button"
              >
                Plan experiment
              </button>
            </div>
          </article>
        </aside>
      </section>
    </AppShell>
  );
}
