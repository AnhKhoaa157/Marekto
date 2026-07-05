"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type InviteJoinerProps = {
  token: string;
};

type JoinResponse =
  | { success: true; data: { workspaceId: string } }
  | { success: false; error: string };

async function readJoinResponse(response: Response): Promise<JoinResponse> {
  const body: unknown = await response.json().catch(() => null);

  if (
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    (body as { success: unknown }).success === true
  ) {
    return body as JoinResponse;
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return { success: false, error: (body as { error: string }).error };
  }

  return { success: false, error: "Unable to join this workspace." };
}

export function InviteJoiner({ token }: Readonly<InviteJoinerProps>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  async function joinInvite() {
    setError(null);
    setIsJoining(true);

    try {
      const response = await fetch("/api/workspace/invites/join", {
        body: JSON.stringify({ token }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await readJoinResponse(response);

      if (!result.success) {
        if (response.status === 401) {
          router.push(`/login?next=/invite/${encodeURIComponent(token)}`);
          return;
        }

        setError(result.error);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to join.");
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <button
        className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        disabled={isJoining}
        onClick={joinInvite}
        type="button"
      >
        {isJoining ? "Joining..." : "Join workspace"}
      </button>
      <Link
        className="inline-flex h-10 items-center rounded-md border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 hover:border-zinc-500"
        href="/onboarding/workspace"
      >
        Use another invite
      </Link>
      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}
