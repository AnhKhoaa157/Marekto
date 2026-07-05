import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceMembersManager } from "@/features/workspace/components/workspace-members-manager";
import { requireServerWorkspaceSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace members | Marekto",
  description: "Manage workspace members and invite links.",
};

export default async function WorkspaceMembersPage() {
  await requireServerWorkspaceSession();

  return (
    <AppShell
      activeRoute="/settings/workspace/members"
      authenticated
      eyebrow="Workspace settings"
      title="Members"
    >
      <WorkspaceMembersManager />
    </AppShell>
  );
}
