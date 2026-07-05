import { AppShell } from "@/components/layout/app-shell";
import { ContactsManager } from "@/features/contacts/components/contacts-manager";
import { requireServerWorkspaceSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contacts | Marekto",
  description: "Manage workspace contacts in Marekto.",
};

export default async function ContactsPage() {
  await requireServerWorkspaceSession();

  return (
    <AppShell
      activeRoute="/contacts"
      authenticated
      eyebrow="Audience"
      title="Contacts"
    >
      <ContactsManager />
    </AppShell>
  );
}
