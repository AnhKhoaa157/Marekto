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
  AdminSectionHeading,
  AdminStatCard,
} from "@/components/admin/admin-ui";
import { parseWorkspaceIdParam } from "@/lib/admin-console";
import {
  loadAdminWorkspaceDetail,
  recordAdminAudit,
} from "@/lib/admin-data";
import { getAdminSessionState } from "@/lib/admin-session";
import type { AdminWorkspaceDetail } from "@/lib/admin-console";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace detail | Admin Console",
  description: "Safe operational detail for a tenant workspace.",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function AdminWorkspaceDetailPage({ params }: PageProps) {
  const state = await getAdminSessionState();

  if (state.status === "unauthenticated") {
    return <AdminGate variant="unauthenticated" />;
  }

  if (state.status === "forbidden") {
    return <AdminGate variant="forbidden" />;
  }

  const { id } = await params;

  let workspaceId: number;
  try {
    workspaceId = parseWorkspaceIdParam(id);
  } catch {
    return (
      <AdminGate variant="error" message="That workspace id is not valid." />
    );
  }

  let detail: AdminWorkspaceDetail | null = null;
  let error: string | null = null;
  let notFound = false;

  try {
    detail = await loadAdminWorkspaceDetail(workspaceId);
    if (!detail) {
      notFound = true;
    } else {
      await recordAdminAudit({
        adminUserId: state.identity.userId,
        action: "admin.workspaces.read",
        targetType: "workspace",
        targetId: workspaceId,
        metadata: { surface: "ui", workspace_id: workspaceId },
      });
    }
  } catch (loadError) {
    error = sanitizeWorkerLogReason(loadError);
  }

  return (
    <AdminShell
      activeRoute="/admin/workspaces"
      adminEmail={state.identity.email}
      eyebrow="System administration"
      title={detail ? detail.name : `Workspace ${workspaceId}`}
    >
      <div className="space-y-6">
        <Link
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 outline-none transition-colors hover:text-zinc-100 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
          href="/admin/workspaces"
        >
          ← All workspaces
        </Link>

        {error ? (
          <AdminInlineError message={error} />
        ) : notFound ? (
          <AdminEmpty
            title="Workspace not found"
            description="No workspace exists for that id. It may have been deleted."
          />
        ) : detail ? (
          <>
            <article className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-500">
                    Owner
                  </dt>
                  <dd className="mt-1 text-sm text-zinc-100">
                    {detail.owner_email ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-500">
                    Members
                  </dt>
                  <dd className="mt-1 text-sm text-zinc-100 tabular-nums">
                    {formatAdminCount(detail.member_count)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-500">
                    Created
                  </dt>
                  <dd className="mt-1 text-sm text-zinc-100">
                    {formatAdminDate(detail.created_at)}
                  </dd>
                </div>
              </dl>
            </article>

            <section aria-label="Workspace metrics" className="space-y-4">
              <AdminSectionHeading
                title="Record counts"
                description="Aggregate counts read under this workspace's tenant isolation."
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <AdminStatCard
                  title="Contacts"
                  value={formatAdminCount(detail.metrics.contacts)}
                  description="From Contacts"
                />
                <AdminStatCard
                  title="Campaigns"
                  value={formatAdminCount(detail.metrics.campaigns)}
                  description="From Campaigns"
                />
                <AdminStatCard
                  title="Lists"
                  value={formatAdminCount(detail.metrics.lists)}
                  description="From Lists"
                />
                <AdminStatCard
                  title="Templates"
                  value={formatAdminCount(detail.metrics.templates)}
                  description="From Templates"
                />
              </div>
              <p className="text-xs text-zinc-500">
                Last campaign activity:{" "}
                {formatAdminDate(detail.metrics.latest_campaign_at)}
              </p>
            </section>

            <section aria-label="Recent delivery failures" className="space-y-4">
              <AdminSectionHeading
                title="Recent delivery failures"
                description="Most recent failed campaigns in this workspace."
              />
              {detail.recent_delivery_failures.length === 0 ? (
                <AdminEmpty
                  title="No delivery failures"
                  description="No failed email logs are recorded for this workspace."
                />
              ) : (
                <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800 bg-zinc-900">
                  {detail.recent_delivery_failures.map((failure) => (
                    <li
                      className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between"
                      key={`${failure.campaign_id}-${failure.last_failed_at}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {failure.campaign_name ?? "Unknown campaign"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Last failed {formatAdminDate(failure.last_failed_at)}
                        </p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 sm:self-auto">
                        {formatAdminCount(failure.failed_count)} failed
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}
