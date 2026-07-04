import Link from "next/link";

import { AdminGate } from "@/components/admin/admin-gate";
import { AdminShell } from "@/components/admin/admin-shell";
import { formatAdminDate } from "@/components/admin/admin-format";
import {
  AdminConfigPill,
  AdminInlineError,
  AdminSectionHeading,
} from "@/components/admin/admin-ui";
import { loadAdminHealth, recordAdminAudit } from "@/lib/admin-data";
import { getAdminSessionState } from "@/lib/admin-session";
import type { AdminHealthStatus } from "@/lib/admin-health";
import { sanitizeWorkerLogReason } from "@/lib/worker-log";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Admin Console | Marekto",
  description: "System administration overview.",
};

const QUICK_LINKS: ReadonlyArray<{
  href: string;
  title: string;
  description: string;
}> = [
  {
    href: "/admin/workspaces",
    title: "Workspaces",
    description: "Operational summaries for every tenant workspace.",
  },
  {
    href: "/admin/users",
    title: "Users",
    description: "Search accounts and review workspace membership.",
  },
  {
    href: "/admin/delivery-diagnostics",
    title: "Delivery diagnostics",
    description: "Recent delivery failures across all workspaces.",
  },
  {
    href: "/admin/health",
    title: "System health",
    description: "Configuration status for core integrations.",
  },
];

export default async function AdminOverviewPage() {
  const state = await getAdminSessionState();

  if (state.status === "unauthenticated") {
    return <AdminGate variant="unauthenticated" />;
  }

  if (state.status === "forbidden") {
    return <AdminGate variant="forbidden" />;
  }

  let health: AdminHealthStatus | null = null;
  let error: string | null = null;

  try {
    health = await loadAdminHealth();
    await recordAdminAudit({
      adminUserId: state.identity.userId,
      action: "admin.health.read",
      targetType: "system",
      targetId: null,
      metadata: { surface: "ui", node_env: health.environment.node_env },
    });
  } catch (loadError) {
    error = sanitizeWorkerLogReason(loadError);
  }

  return (
    <AdminShell
      activeRoute="/admin"
      adminEmail={state.identity.email}
      eyebrow="System administration"
      title="Admin overview"
    >
      <div className="space-y-8">
        <section aria-label="System health summary" className="space-y-4">
          <AdminSectionHeading
            title="System health"
            description="Configuration status for core integrations. No secret values are shown."
          />
          {error ? (
            <AdminInlineError message={error} />
          ) : health ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <HealthTile
                label="Database"
                ok={health.database.reachable}
                okLabel="Reachable"
                offLabel="Unreachable"
              />
              <HealthTile label="SMTP" ok={health.smtp.configured} />
              <HealthTile label="Gemini AI" ok={health.gemini.configured} />
              <HealthTile label="Cron" ok={health.cron.configured} />
            </div>
          ) : null}
          {health ? (
            <p className="text-xs text-zinc-500">
              Environment: {health.environment.node_env} · Generated{" "}
              {formatAdminDate(health.generated_at)}
            </p>
          ) : null}
        </section>

        <section aria-label="Admin sections" className="space-y-4">
          <AdminSectionHeading
            title="Sections"
            description="Read-only operational surfaces."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {QUICK_LINKS.map((link) => (
              <Link
                className="rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm outline-none transition-colors hover:border-indigo-500/40 hover:bg-zinc-900/80 focus-visible:ring-2 focus-visible:ring-indigo-400"
                href={link.href}
                key={link.href}
              >
                <p className="text-base font-semibold text-zinc-50">
                  {link.title}
                </p>
                <p className="mt-1 text-sm text-zinc-400">{link.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function HealthTile({
  label,
  ok,
  okLabel,
  offLabel,
}: Readonly<{
  label: string;
  ok: boolean;
  okLabel?: string;
  offLabel?: string;
}>) {
  return (
    <article className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
      <p className="text-sm text-zinc-400">{label}</p>
      <AdminConfigPill ok={ok} okLabel={okLabel} offLabel={offLabel} />
    </article>
  );
}
