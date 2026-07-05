import { redirect } from "next/navigation";

import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { WorkspaceOnboarding } from "@/features/workspace/components/workspace-onboarding";
import { requireServerUserSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace setup | Marekto",
  description: "Create or join a Marekto workspace.",
};

export default async function WorkspaceOnboardingPage() {
  const session = await requireServerUserSession();

  if (session.workspaceId) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-50 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-col gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Workspace setup
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Create or join a workspace
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              Your account is ready. Choose whether this account owns a new
              workspace or joins an existing team through an invite.
            </p>
          </div>
          <SignOutButton />
        </header>

        <section className="mt-6">
          <WorkspaceOnboarding />
        </section>
      </div>
    </main>
  );
}
