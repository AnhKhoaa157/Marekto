import Link from "next/link";

import { InviteJoiner } from "@/features/workspace/components/invite-joiner";
import { getInvitePreview } from "@/lib/workspace-collaboration";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Workspace invite | Marekto",
  description: "Join a Marekto workspace invite.",
};

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const decodedToken = decodeURIComponent(token);
  let preview:
    | Awaited<ReturnType<typeof getInvitePreview>>
    | null = null;
  let error: string | null = null;

  try {
    preview = await getInvitePreview(decodedToken);
  } catch (previewError) {
    error =
      previewError instanceof Error
        ? previewError.message
        : "Invite link is invalid or expired";
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-10 text-zinc-50">
      <section className="mx-auto max-w-xl rounded-md border border-zinc-800 bg-zinc-900 p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
          Workspace invite
        </p>
        {preview ? (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Join {preview.workspace_name}
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              This workspace currently has {preview.member_count} member
              {preview.member_count === 1 ? "" : "s"}. Sign in or create an
              account, then confirm to join.
            </p>
            <InviteJoiner token={decodedToken} />
          </>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Invite unavailable
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">{error}</p>
            <Link
              className="mt-6 inline-flex h-10 items-center rounded-md border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 hover:border-zinc-500"
              href="/login"
            >
              Go to login
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
