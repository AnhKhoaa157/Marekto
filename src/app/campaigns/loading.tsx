import { AppRouteLoading } from "@/components/layout/app-route-loading";

export default function CampaignsLoading() {
  return (
    <AppRouteLoading
      activeRoute="/campaigns"
      eyebrow="Campaign delivery"
      title="Campaigns"
    />
  );
}
