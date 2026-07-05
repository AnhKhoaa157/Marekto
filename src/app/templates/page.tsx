import { AppShell } from "@/components/layout/app-shell";
import { TemplatesManager } from "@/features/templates/components/templates-manager";
import { requireServerWorkspaceSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Templates | Marekto",
  description: "Manage workspace email templates in Marekto.",
};

export default async function TemplatesPage() {
  await requireServerWorkspaceSession();

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
