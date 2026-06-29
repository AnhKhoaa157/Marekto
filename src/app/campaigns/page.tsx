import { AppShell } from "@/components/dashboard/app-shell";
import { CampaignsManager } from "@/components/resources/campaigns-manager";
import { requireServerAuthSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campaigns | Marekto",
  description: "Manage workspace campaigns in Marekto.",
};

export default async function CampaignsPage() {
  await requireServerAuthSession();

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
