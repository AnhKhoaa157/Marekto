"use client";

import { useCallback, useEffect, useState } from "react";

type WorkspaceMember = {
  user_id: number;
  email: string;
  role: "owner" | "member";
  joined_at: string | null;
};

type WorkspaceInvite = {
  id: number;
  workspace_name: string;
  created_by_email: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
};

type WorkspaceAuditEvent = {
  id: number;
  actor_email: string | null;
  target_type: string;
  target_id: number | null;
  action: string;
  created_at: string;
};

type MemberResponse =
  | { success: true; data: { members: WorkspaceMember[] } }
  | { success: false; error: string };

type InviteResponse =
  | { success: true; data: { invites: WorkspaceInvite[] } }
  | { success: false; error: string };

type CreateInviteResponse =
  | { success: true; data: { inviteUrl: string; invite: WorkspaceInvite } }
  | { success: false; error: string };

type ActivityResponse =
  | { success: true; data: { events: WorkspaceAuditEvent[] } }
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

export function WorkspaceMembersManager() {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [events, setEvents] = useState<WorkspaceAuditEvent[]>([]);
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);

  const loadData = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    try {
      const [memberResponse, inviteResponse, activityResponse] = await Promise.all([
        fetch("/api/workspace/members", { credentials: "include" }),
        fetch("/api/workspace/invites", { credentials: "include" }),
        fetch("/api/workspace/activity", { credentials: "include" }),
      ]);
      const memberBody = (await memberResponse.json().catch(() => null)) as
        | MemberResponse
        | null;
      const inviteBody = (await inviteResponse.json().catch(() => null)) as
        | InviteResponse
        | null;
      const activityBody = (await activityResponse.json().catch(() => null)) as
        | ActivityResponse
        | null;

      if (!memberBody?.success) {
        setError(getError(memberBody, "Unable to load members."));
        return;
      }

      if (!inviteBody?.success) {
        setError(getError(inviteBody, "Unable to load invites."));
        return;
      }

      if (!activityBody?.success) {
        setError(getError(activityBody, "Unable to load workspace activity."));
        return;
      }

      setMembers(memberBody.data.members);
      setInvites(inviteBody.data.invites);
      setEvents(activityBody.data.events);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load members.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
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

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-50">Invite link</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Owners can create short-lived invite links for this workspace.
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
                  <th className="py-3 pr-4">Email</th>
                  <th className="py-3 pr-4">Role</th>
                  <th className="py-3 pr-4">Joined</th>
                  <th className="py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {members.map((member) => (
                  <tr key={member.user_id}>
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
                    Invite #{invite.id}
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
                  {event.target_id ? ` #${event.target_id}` : ""} ·{" "}
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
