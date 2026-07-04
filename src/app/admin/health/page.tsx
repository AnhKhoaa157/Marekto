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
  title: "System health | Admin Console",
  description: "Configuration status for core integrations.",
};

export default async function AdminHealthPage() {
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
      activeRoute="/admin/health"
      adminEmail={state.identity.email}
      eyebrow="System administration"
      title="System health"
    >
      <div className="space-y-6">
        <AdminSectionHeading
          title="Integration status"
          description="Whether each integration is configured/available. Secret values are never read or shown."
        />

        {error ? (
          <AdminInlineError message={error} />
        ) : health ? (
          <>
            <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 shadow-sm">
              <dl className="divide-y divide-zinc-800">
                <HealthRow
                  label="Database"
                  hint="PostgreSQL connection"
                  ok={health.database.reachable}
                  okLabel="Reachable"
                  offLabel="Unreachable"
                />
                <HealthRow
                  label="SMTP delivery"
                  hint="Campaign email transport"
                  ok={health.smtp.configured}
                />
                <HealthRow
                  label="Gemini AI"
                  hint="AI segmentation & personalization"
                  ok={health.gemini.configured}
                />
                <HealthRow
                  label="Cron worker"
                  hint="Scheduled delivery authorization"
                  ok={health.cron.configured}
                />
              </dl>
            </div>
            <p className="text-xs text-zinc-500">
              Environment: {health.environment.node_env} · Generated{" "}
              {formatAdminDate(health.generated_at)}
            </p>
          </>
        ) : null}
      </div>
    </AdminShell>
  );
}

function HealthRow({
  label,
  hint,
  ok,
  okLabel,
  offLabel,
}: Readonly<{
  label: string;
  hint: string;
  ok: boolean;
  okLabel?: string;
  offLabel?: string;
}>) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div>
        <p className="text-sm font-medium text-zinc-100">{label}</p>
        <p className="text-xs text-zinc-500">{hint}</p>
      </div>
      <AdminConfigPill ok={ok} okLabel={okLabel} offLabel={offLabel} />
    </div>
  );
}
