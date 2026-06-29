import { AppShell } from "@/components/dashboard/app-shell";
import { TemplatesManager } from "@/components/resources/templates-manager";
import { requireServerAuthSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Templates | Marekto",
  description: "Manage workspace email templates in Marekto.",
};

export default async function TemplatesPage() {
  await requireServerAuthSession();

  return (
    <AppShell
      activeRoute="/templates"
      authenticated
      eyebrow="Content"
      title="Email templates"
    >
      <TemplatesManager />
    </AppShell>
  );
}
