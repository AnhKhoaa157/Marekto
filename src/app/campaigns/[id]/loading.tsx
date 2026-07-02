import { AppShell } from "@/components/dashboard/app-shell";
import { CampaignDetailSkeleton } from "@/components/resources/campaign-detail-skeleton";

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
