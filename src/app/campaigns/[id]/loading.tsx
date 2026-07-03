import { AppShell } from "@/components/layout/app-shell";
import { CampaignDetailSkeleton } from "@/features/campaigns/components/campaign-detail-skeleton";

export default function CampaignDetailLoading() {
  return (
    <AppShell
      activeRoute="/campaigns"
      authenticated
      eyebrow="Campaign delivery"
      title="Campaign details"
    >
      <CampaignDetailSkeleton />
    </AppShell>
  );
}
