import { AppRouteLoading } from "@/components/dashboard/app-route-loading";

export default function CampaignsLoading() {
  return (
    <AppRouteLoading
      activeRoute="/campaigns"
      eyebrow="Campaign delivery"
      title="Campaigns"
    />
  );
}
