import { AppShell } from "@/components/layout/app-shell";
import { CampaignsManager } from "@/features/campaigns/components/campaigns-manager";
import { requireServerWorkspaceSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campaigns | Marekto",
  description: "Manage workspace campaigns in Marekto.",
};

export default async function CampaignsPage() {
  await requireServerWorkspaceSession();

  return (
    <AppShell
      activeRoute="/campaigns"
      authenticated
      eyebrow="Campaign delivery"
      title="Campaigns"
    >
      <CampaignsManager />
    </AppShell>
  );
}
