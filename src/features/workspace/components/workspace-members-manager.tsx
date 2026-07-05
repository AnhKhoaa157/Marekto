"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  formatEntityCode,
  prefixForAuditTarget,
} from "@/lib/identifiers";
import {
  createMembersPageLoader,
  type WorkspaceAuditEvent,
  type WorkspaceInvite,
  type WorkspaceMember,
} from "@/features/workspace/lib/members-page-data";

type WorkspaceMembersManagerProps = {
  /**
   * Workspace id verified by the server session guard. The page only renders
   * this component after `requireServerWorkspaceSession()` succeeds, so the
   * first members request never fires before authentication and workspace
   * context are established.
   */
  workspaceId: string;
};

type CreateInviteResponse =
  | { success: true; data: { inviteUrl: string; invite: WorkspaceInvite } }
  | { success: false; error: string };

function getError(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }

  return fallback;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

async function clearInvalidSession(): Promise<void> {
  await fetch("/api/auth/logout", {
    credentials: "include",
    method: "POST",
  }).catch(() => undefined);

  window.location.replace("/login");
}

export function WorkspaceMembersManager({
  workspaceId,
}: Readonly<WorkspaceMembersManagerProps>) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [events, setEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);

  // Single-flight loader: concurrent triggers (mount + a mutation refresh)
  // join the same in-flight batch instead of duplicating API requests.
  const loadPageData = useMemo(() => createMembersPageLoader(), []);

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);

      try {
        const result = await loadPageData(signal ? { signal } : {});

        if (result.kind === "unauthorized") {
          // Remove stale pre-UUID or expired HttpOnly cookies before login so
          // subsequent requests cannot keep replaying the invalid session.
          await clearInvalidSession();
          return;
        }

        if (result.kind === "forbidden") {
          setForbidden(result.message);
          return;
        }

        if (result.kind === "error") {
          setError(result.message);
          return;
        }

        setForbidden(null);
        setMembers(result.data.members);
        setInvites(result.data.invites);
        setEvents(result.data.events);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load workspace members.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [loadPageData],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadData(controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadData]);

  async function mutate(endpoint: string, init: RequestInit, success: string) {
    setError(null);
    setNotice(null);
    setIsMutating(true);

    try {
      const response = await fetch(endpoint, {
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const body: unknown = await response.json().catch(() => null);

      if (response.status === 401) {
        await clearInvalidSession();
        return;
      }

      if (!response.ok) {
        setError(getError(body, "Request failed."));
        return;
      }

      setNotice(success);
      await loadData();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error ? mutationError.message : "Request failed.",
      );
    } finally {
      setIsMutating(false);
    }
  }

  async function createInvite() {
    setError(null);
    setNotice(null);
    setIsMutating(true);

    try {
      const response = await fetch("/api/workspace/invites", {
        credentials: "include",
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as
        | CreateInviteResponse
        | null;

      if (response.status === 401) {
        await clearInvalidSession();
        return;
      }

      if (!body?.success) {
        setError(getError(body, "Unable to create invite."));
        return;
      }

      setLatestInviteUrl(body.data.inviteUrl);
      setNotice("Invite link created.");
      await loadData();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Unable to create invite.");
    } finally {
      setIsMutating(false);
    }
  }

  async function copyInvite() {
    if (!latestInviteUrl) {
      return;
    }

    await navigator.clipboard.writeText(latestInviteUrl);
    setNotice("Invite link copied.");
  }

  if (forbidden) {
    return (
      <div className="rounded-md border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold text-zinc-50">Owner access required</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Only workspace owners can manage members, invites, and activity for{" "}
          {formatEntityCode("WS", workspaceId)}. Ask an owner for access or switch to a
          workspace you own.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">Invite link</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Owners can create short-lived invite links for workspace{" "}
              {formatEntityCode("WS", workspaceId)}.
            </p>
          </div>
          <button
            className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            disabled={isMutating}
            onClick={() => void createInvite()}
            type="button"
          >
            Create invite
          </button>
        </div>

        {latestInviteUrl ? (
          <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="break-all text-sm text-zinc-200">{latestInviteUrl}</p>
            <button
              className="mt-3 rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 hover:border-zinc-500"
              onClick={() => void copyInvite()}
              type="button"
            >
              Copy link
            </button>
          </div>
        ) : null}
      </section>

      {error || notice ? (
        <div
          className={`rounded-md border p-3 text-sm ${
            error
              ? "border-red-500/30 bg-red-500/10 text-red-100"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          }`}
          role={error ? "alert" : "status"}
        >
          {error ?? notice}
        </div>
      ) : null}

      <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-lg font-semibold text-zinc-50">Members</h2>
        {isLoading ? (
          <p className="mt-4 text-sm text-zinc-400">Loading members...</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="py-3 pr-4">ID</th>
                  <th className="py-3 pr-4">Email</th>
                  <th className="py-3 pr-4">Role</th>
                  <th className="py-3 pr-4">Joined</th>
                  <th className="py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {members.map((member) => (
                  <tr key={member.user_id}>
                    <td className="py-3 pr-4 font-mono text-xs text-zinc-400">
                      {formatEntityCode("US", member.user_id)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-zinc-100">
                      {member.email}
                    </td>
                    <td className="py-3 pr-4 text-zinc-300">{member.role}</td>
                    <td className="py-3 pr-4 text-zinc-400">
                      {formatDate(member.joined_at)}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-zinc-500 disabled:opacity-50"
                          disabled={isMutating}
                          onClick={() =>
                            void mutate(
                              `/api/workspace/members/${member.user_id}`,
                              {
                                body: JSON.stringify({
                                  role: member.role === "owner" ? "member" : "owner",
                                }),
                                method: "PATCH",
                              },
                              "Member role updated.",
                            )
                          }
                          type="button"
                        >
                          Make {member.role === "owner" ? "member" : "owner"}
                        </button>
                        <button
                          className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-100 hover:border-red-400 disabled:opacity-50"
                          disabled={isMutating}
                          onClick={() =>
                            void mutate(
                              `/api/workspace/members/${member.user_id}`,
                              { method: "DELETE" },
                              "Member removed.",
                            )
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-lg font-semibold text-zinc-50">Recent invites</h2>
        <div className="mt-4 space-y-3">
          {invites.length === 0 ? (
            <p className="text-sm text-zinc-400">No invite links yet.</p>
          ) : (
            invites.map((invite) => (
              <div
                className="flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3 sm:flex-row sm:items-center sm:justify-between"
                key={invite.id}
              >
                <div>
                  <p className="text-sm font-medium text-zinc-100">
                    {formatEntityCode("IV", invite.id)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Created {formatDate(invite.created_at)} by{" "}
                    {invite.created_by_email ?? "unknown"} · expires{" "}
                    {formatDate(invite.expires_at)}
                    {invite.revoked_at ? ` · revoked ${formatDate(invite.revoked_at)}` : ""}
                  </p>
                </div>
                {!invite.revoked_at ? (
                  <button
                    className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 hover:border-zinc-500 disabled:opacity-50"
                    disabled={isMutating}
                    onClick={() =>
                      void mutate(
                        `/api/workspace/invites/${invite.id}`,
                        { method: "DELETE" },
                        "Invite revoked.",
                      )
                    }
                    type="button"
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-lg font-semibold text-zinc-50">Workspace activity</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Recent member and invite changes recorded for owners.
        </p>
        <div className="mt-4 space-y-2">
          {events.length === 0 ? (
            <p className="text-sm text-zinc-400">No workspace activity yet.</p>
          ) : (
            events.map((event) => (
              <div
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2"
                key={event.id}
              >
                <p className="text-sm text-zinc-200">
                  <span className="font-medium">
                    {event.actor_email ?? "Deleted account"}
                  </span>{" "}
                  {event.action}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {event.target_type}
                  {event.target_id
                    ? ` ${formatEntityCode(prefixForAuditTarget(event.target_type), event.target_id)}`
                    : ""} ·{" "}
                  {formatDate(event.created_at)}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
