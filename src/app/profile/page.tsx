import { AppShell } from "@/components/dashboard/app-shell";
import { ProfileManager } from "@/components/resources/profile-manager";
import { requireServerAuthSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profile | Marekto",
  description: "Manage your Marekto account profile.",
};

export default async function ProfilePage() {
  await requireServerAuthSession();

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
