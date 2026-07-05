"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type ApiResponse =
  | { success: true; data: { workspaceId: string } }
  | { success: false; error: string };

async function readApiResponse(response: Response): Promise<ApiResponse> {
  const body: unknown = await response.json().catch(() => null);

  if (
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    (body as { success: unknown }).success === true
  ) {
    return body as ApiResponse;
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return { success: false, error: (body as { error: string }).error };
  }

  return {
    success: false,
    error: response.ok ? "Request completed, but the response was invalid." : "Request failed.",
  };
}

export function WorkspaceOnboarding() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitJson(endpoint: string, payload: Record<string, string>) {
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(payload),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await readApiResponse(response);

      if (!result.success) {
        setError(result.error);
        return;
      }

      setNotice("Workspace ready. Redirecting...");
      router.push("/dashboard");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to finish workspace setup.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    await submitJson("/api/workspaces", { name });
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const token = String(formData.get("token") ?? "").trim();
    await submitJson("/api/workspace/invites/join", { token });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        className="rounded-md border border-zinc-800 bg-zinc-900 p-5"
        onSubmit={handleCreate}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
          Option 1
        </p>
        <h2 className="mt-2 text-lg font-semibold text-zinc-50">
          Create a new workspace
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Start your own workspace as owner. You can invite members after setup.
        </p>
        <label className="mt-5 block text-sm font-medium text-zinc-300">
          Workspace name
          <input
            className="mt-2 h-11 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            disabled={isSubmitting}
            name="name"
            placeholder="Acme Growth"
            required
            type="text"
          />
        </label>
        <button
          className="mt-4 h-10 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          disabled={isSubmitting}
          type="submit"
        >
          Create workspace
        </button>
      </form>

      <form
        className="rounded-md border border-zinc-800 bg-zinc-900 p-5"
        onSubmit={handleJoin}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-300">
          Option 2
        </p>
        <h2 className="mt-2 text-lg font-semibold text-zinc-50">
          Join by invite
        </h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Paste an invite token or open the invite link your teammate shared.
        </p>
        <label className="mt-5 block text-sm font-medium text-zinc-300">
          Invite token or link
          <input
            className="mt-2 h-11 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            disabled={isSubmitting}
            name="token"
            placeholder="Paste token or https://.../invite/..."
            required
            type="text"
          />
        </label>
        <button
          className="mt-4 h-10 rounded-md border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 hover:border-emerald-500/50 disabled:opacity-50"
          disabled={isSubmitting}
          type="submit"
        >
          Join workspace
        </button>
      </form>

      {error || notice ? (
        <div
          className={`lg:col-span-2 rounded-md border p-3 text-sm ${
            error
              ? "border-red-500/30 bg-red-500/10 text-red-100"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          }`}
        >
          {error ?? notice}
        </div>
      ) : null}
    </div>
  );
}
