import { AppShell } from "@/components/layout/app-shell";
import { CampaignBuilderManager } from "@/features/campaign-builder/components/campaign-builder-manager";
import { requireServerUserSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campaign Builder | Marekto",
  description:
    "Generate a reviewable AI campaign package and save it as Template and Campaign drafts.",
};

export default async function CampaignBuilderPage() {
  await requireServerUserSession();

  return (
    <AppShell
      activeRoute="/campaign-builder"
      authenticated
      eyebrow="AI marketing workspace"
      title="Campaign Builder"
    >
      <CampaignBuilderManager />
    </AppShell>
  );
}
