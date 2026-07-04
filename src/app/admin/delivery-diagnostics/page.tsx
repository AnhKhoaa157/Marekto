import Link from "next/link";

import { AdminGate } from "@/components/admin/admin-gate";
import { AdminShell } from "@/components/admin/admin-shell";
import { formatAdminDate } from "@/components/admin/admin-format";
import {
  AdminEmpty,
  AdminInlineError,
  AdminSectionHeading,
} from "@/components/admin/admin-ui";
import {
  DEFAULT_DIAGNOSTICS_LIMIT,
  type AdminDeliveryDiagnostic,
} from "@/lib/admin-console";
import {
  loadAdminDeliveryDiagnostics,
  recordAdminAudit,
} from "@/lib/admin-data";
import { getAdminSessionState } from "@/lib/admin-session";
import { getEmailLogErrorCategoryLabel } from "@/lib/email-log-display";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Delivery diagnostics | Admin Console",
  description: "Recent delivery failures across all workspaces.",
};

export default async function AdminDeliveryDiagnosticsPage() {
  const state = await getAdminSessionState();

  if (state.status === "unauthenticated") {
    return <AdminGate variant="unauthenticated" />;
  }

  if (state.status === "forbidden") {
    return <AdminGate variant="forbidden" />;
  }

  let items: AdminDeliveryDiagnostic[] | null = null;
  let error: string | null = null;

  try {
    const result = await loadAdminDeliveryDiagnostics(DEFAULT_DIAGNOSTICS_LIMIT);
    items = result.items;
    await recordAdminAudit({
      adminUserId: state.identity.userId,
      action: "admin.delivery_diagnostics.list",
      targetType: "delivery_diagnostics",
      targetId: null,
      metadata: {
        surface: "ui",
        limit: DEFAULT_DIAGNOSTICS_LIMIT,
        result_count: result.items.length,
        total: result.total,
      },
    });
  } catch (loadError) {
    error = sanitizeWorkerLogReason(loadError);
  }

  return (
    <AdminShell
      activeRoute="/admin/delivery-diagnostics"
      adminEmail={state.identity.email}
      eyebrow="System administration"
      title="Delivery diagnostics"
    >
      <div className="space-y-6">
        <AdminSectionHeading
          title="Recent delivery failures"
          description="Sanitized failure category and message only. Provider payloads, stack traces, and secrets are stripped."
        />

        {error ? (
          <AdminInlineError message={error} />
        ) : items && items.length === 0 ? (
          <AdminEmpty
            title="No delivery failures"
            description="No failed email logs are recorded across any workspace."
          />
        ) : items ? (
          <ul className="space-y-3">
            {items.map((diagnostic, index) => (
              <li
                className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm"
                key={`${diagnostic.workspace_id}-${diagnostic.campaign_id}-${index}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">
                      {diagnostic.campaign_name ?? "Unknown campaign"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      <Link
                        className="outline-none transition-colors hover:text-indigo-300 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
                        href={`/admin/workspaces/${diagnostic.workspace_id}`}
                      >
                        {diagnostic.workspace_name}
                      </Link>{" "}
                      · {formatAdminDate(diagnostic.occurred_at)}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 self-start rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300 sm:self-auto">
                    {getEmailLogErrorCategoryLabel(diagnostic.category)}
                  </span>
                </div>
                {diagnostic.message ? (
                  <p className="mt-3 break-words rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                    {diagnostic.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </AdminShell>
  );
}
