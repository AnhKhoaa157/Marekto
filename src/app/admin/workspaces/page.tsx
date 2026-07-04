import Link from "next/link";

import { AdminGate } from "@/components/admin/admin-gate";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  formatAdminCount,
  formatAdminDate,
} from "@/components/admin/admin-format";
import {
  AdminEmpty,
  AdminInlineError,
  AdminPagination,
  AdminSearchForm,
  AdminSectionHeading,
  AdminTableScroll,
} from "@/components/admin/admin-ui";
import {
  parseAdminPage,
  parseAdminPageSize,
  parseAdminSearch,
} from "@/lib/admin-console";
import {
  loadAdminWorkspaces,
  recordAdminAudit,
  type AdminPaginatedResult,
} from "@/lib/admin-data";
import { getAdminSessionState } from "@/lib/admin-session";
import type { AdminWorkspaceSummary } from "@/lib/admin-console";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspaces | Admin Console",
  description: "Operational summaries for tenant workspaces.",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default async function AdminWorkspacesPage({ searchParams }: PageProps) {
  const state = await getAdminSessionState();

  if (state.status === "unauthenticated") {
    return <AdminGate variant="unauthenticated" />;
  }

  if (state.status === "forbidden") {
    return <AdminGate variant="forbidden" />;
  }

  const resolved = searchParams ? await searchParams : {};
  const params = {
    search: parseAdminSearch(firstParam(resolved.search)),
    page: parseAdminPage(firstParam(resolved.page)),
    pageSize: parseAdminPageSize(firstParam(resolved.pageSize)),
  };

  let result: AdminPaginatedResult<AdminWorkspaceSummary> | null = null;
  let error: string | null = null;

  try {
    result = await loadAdminWorkspaces(params);
    await recordAdminAudit({
      adminUserId: state.identity.userId,
      action: "admin.workspaces.list",
      targetType: "workspace_list",
      targetId: null,
      metadata: {
        surface: "ui",
        search: params.search,
        page: params.page,
        result_count: result.items.length,
        total: result.total,
      },
    });
  } catch (loadError) {
    error = sanitizeWorkerLogReason(loadError);
  }

  return (
    <AdminShell
      activeRoute="/admin/workspaces"
      adminEmail={state.identity.email}
      eyebrow="System administration"
      title="Workspaces"
    >
      <div className="space-y-6">
        <AdminSectionHeading
          title="Tenant workspaces"
          description="Live operational summaries. Counts are read per workspace under tenant isolation."
        />

        <AdminSearchForm
          action="/admin/workspaces"
          defaultValue={params.search}
          label="Search workspace names"
          placeholder="Search by workspace name"
        />

        {error ? (
          <AdminInlineError message={error} />
        ) : result && result.items.length === 0 ? (
          <AdminEmpty
            title={
              params.search
                ? "No workspaces match this search"
                : "No workspaces yet"
            }
            description={
              params.search
                ? "Clear the search or try a different workspace name."
                : "Workspaces will appear here once tenants are provisioned."
            }
          />
        ) : result ? (
          <>
            <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <AdminTableScroll>
                <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Workspace</th>
                    <th className="py-3 pr-4">Owner</th>
                    <th className="py-3 pr-4">Members</th>
                    <th className="py-3 pr-4">Contacts</th>
                    <th className="py-3 pr-4">Campaigns</th>
                    <th className="py-3">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {result.items.map((workspace) => (
                    <tr className="text-zinc-300" key={workspace.id}>
                      <td className="py-4 pr-4">
                        <Link
                          className="font-medium text-zinc-50 outline-none transition-colors hover:text-indigo-300 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
                          href={`/admin/workspaces/${workspace.id}`}
                        >
                          {workspace.name}
                        </Link>
                        <p className="text-xs text-zinc-500">ID {workspace.id}</p>
                      </td>
                      <td className="py-4 pr-4 text-zinc-400">
                        {workspace.owner_email ?? "—"}
                      </td>
                      <td className="py-4 pr-4 tabular-nums">
                        {formatAdminCount(workspace.member_count)}
                      </td>
                      <td className="py-4 pr-4 tabular-nums">
                        {formatAdminCount(workspace.contact_count)}
                      </td>
                      <td className="py-4 pr-4 tabular-nums">
                        {formatAdminCount(workspace.campaign_count)}
                      </td>
                      <td className="whitespace-nowrap py-4 text-zinc-400">
                        {formatAdminDate(workspace.latest_campaign_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AdminTableScroll>
            </article>

            <AdminPagination
              basePath="/admin/workspaces"
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              search={params.search}
            />
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
