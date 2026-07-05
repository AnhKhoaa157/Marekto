import { AppShell } from "@/components/layout/app-shell";
import { ListsManager } from "@/features/lists/components/lists-manager";
import { requireServerUserSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lists | Marekto",
  description: "Manage workspace contact lists in Marekto.",
};

export default async function ListsPage() {
  await requireServerUserSession();

  return (
    <AppShell
      activeRoute="/lists"
      authenticated
      eyebrow="Audience"
      title="Contact lists"
    >
      <ListsManager />
    </AppShell>
  );
}
