import Link from "next/link";

import { CampaignEmailLogs } from "@/components/resources/campaign-email-logs";

type CampaignDetailProps = {
  campaignId: number;
};

export function CampaignDetail({ campaignId }: Readonly<CampaignDetailProps>) {
  return (
    <section className="min-w-0 space-y-6">
      <Link
        className="inline-flex text-sm font-medium text-zinc-400 outline-none transition-colors hover:text-zinc-50 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-indigo-400"
        href="/campaigns"
      >
        Back to campaigns
      </Link>
      <CampaignEmailLogs campaignId={campaignId} />
    </section>
  );
}
