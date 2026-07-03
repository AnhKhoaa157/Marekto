import { AppRouteLoading } from "@/components/layout/app-route-loading";

export default function ProfileLoading() {
  return (
    <AppRouteLoading
      activeRoute="/profile"
      eyebrow="Account settings"
      title="Profile"
    />
  );
}
