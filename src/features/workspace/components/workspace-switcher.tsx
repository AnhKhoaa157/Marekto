"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type WorkspaceSummary = {
  id: number;
  name: string;
  role: "owner" | "member";
};

type WorkspacesResponse =
  | {
      success: true;
      data: {
        workspaces: WorkspaceSummary[];
        currentWorkspaceId: number | null;
      };
    }
  | { success: false; error: string };

function isWorkspacesResponse(value: unknown): value is WorkspacesResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as { success: unknown }).success === "boolean"
  );
}

export function WorkspaceSwitcher() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadWorkspaces() {
      const response = await fetch("/api/workspaces", { credentials: "include" });
      const body: unknown = await response.json().catch(() => null);

      if (ignore) {
        return;
      }

      if (isWorkspacesResponse(body) && body.success) {
        setWorkspaces(body.data.workspaces);
        setCurrentWorkspaceId(body.data.currentWorkspaceId);
      }
    }

    void loadWorkspaces().catch((loadError) => {
      if (!ignore) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load workspaces.");
      }
    });

    return () => {
      ignore = true;
    };
  }, []);

  async function switchWorkspace(workspaceId: number) {
    if (workspaceId === currentWorkspaceId) {
      return;
    }

    setError(null);
    setIsSwitching(true);

    try {
      const response = await fetch("/api/workspaces/switch", {
        body: JSON.stringify({ workspaceId }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!isWorkspacesResponse(body) || !body.success) {
        setError(
          isWorkspacesResponse(body) && !body.success
            ? body.error
            : "Unable to switch workspace.",
        );
        return;
      }

      setCurrentWorkspaceId(workspaceId);
      router.refresh();
    } catch (switchError) {
      setError(
        switchError instanceof Error ? switchError.message : "Unable to switch workspace.",
      );
    } finally {
      setIsSwitching(false);
    }
  }

  if (workspaces.length <= 1) {
    return error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null;
  }

  return (
    <div className="mt-3">
      <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Switch workspace
        <select
          className="mt-1 h-9 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm normal-case tracking-normal text-zinc-100 outline-none focus:border-indigo-500"
          disabled={isSwitching}
          onChange={(event) => void switchWorkspace(Number(event.target.value))}
          value={currentWorkspaceId ?? ""}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} ({workspace.role})
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
