import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { CampaignDetail } from "@/features/campaigns/components/campaign-detail";
import { requireServerAuthSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campaign details | Marekto",
  description: "Inspect campaign delivery activity in Marekto.",
};

type CampaignDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function CampaignDetailPage({
  params,
}: Readonly<CampaignDetailPageProps>) {
  await requireServerAuthSession();

  const { id } = await params;
  const campaignId = Number(id);

  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    notFound();
  }

  return (
    <AppShell
      activeRoute="/campaigns"
      authenticated
      eyebrow="Campaign delivery"
      title="Campaign details"
    >
      <CampaignDetail campaignId={campaignId} />
    </AppShell>
  );
}
