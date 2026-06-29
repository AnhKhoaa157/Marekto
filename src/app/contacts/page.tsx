import { AppShell } from "@/components/dashboard/app-shell";
import { ContactsManager } from "@/components/resources/contacts-manager";
import { requireServerAuthSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contacts | Marekto",
  description: "Manage workspace contacts in Marekto.",
};

export default async function ContactsPage() {
  await requireServerAuthSession();

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
