import { AppShell } from "@/components/layout/app-shell";
import { ProfileManager } from "@/features/profile/components/profile-manager";
import { requireServerUserSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profile | Marekto",
  description: "Manage your Marekto account profile.",
};

export default async function ProfilePage() {
  await requireServerUserSession();

  return (
    <AppShell
      activeRoute="/profile"
      authenticated
      eyebrow="Account settings"
      title="Profile"
    >
      <ProfileManager />
    </AppShell>
  );
}
