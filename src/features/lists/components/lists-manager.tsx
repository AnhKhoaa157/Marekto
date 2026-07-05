"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ResourceEmpty,
  ResourceError,
  ResourceLoading,
} from "@/components/shared/resource-states";
import {
  ApiRequestError,
  formatApiDate,
  isRecord,
  requestApi,
} from "@/lib/client-api";
import { formatEntityCode } from "@/lib/identifiers";

type ListRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

function parseList(value: unknown): ListRow {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.workspace_id !== "string" ||
    typeof value.name !== "string" ||
    (value.description !== null && typeof value.description !== "string") ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("The list response has an invalid shape.");
  }

  return {
    id: value.id,
    workspace_id: value.workspace_id,
    name: value.name,
    description: value.description,
    created_at: value.created_at,
  };
}

function parseLists(value: unknown): ListRow[] {
  if (!Array.isArray(value)) {
    throw new Error("The lists response is not a list.");
  }

  return value.map(parseList);
}

export function ListsManager() {
  const router = useRouter();
  const [lists, setLists] = useState<ListRow[]>([]);
  const [editingList, setEditingList] = useState<ListRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => {
    router.push("/login");
    router.refresh();
  }, [router]);

  const loadLists = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await requestApi("/api/lists", { method: "GET", signal }, parseLists);
        setLists(data);
      } catch (loadFailure) {
        if (loadFailure instanceof DOMException && loadFailure.name === "AbortError") {
          return;
        }

        if (loadFailure instanceof ApiRequestError && loadFailure.status === 401) {
          handleUnauthorized();
          return;
        }

        setLoadError(loadFailure instanceof Error ? loadFailure.message : "Unable to load lists.");
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();

    void requestApi(
      "/api/lists",
      { method: "GET", signal: controller.signal },
      parseLists,
    )
      .then(setLists)
      .catch((loadFailure: unknown) => {
        if (loadFailure instanceof DOMException && loadFailure.name === "AbortError") {
          return;
        }

        if (loadFailure instanceof ApiRequestError && loadFailure.status === 401) {
          handleUnauthorized();
          return;
        }

        setLoadError(
          loadFailure instanceof Error ? loadFailure.message : "Unable to load lists.",
        );
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [handleUnauthorized]);

  function resetForm() {
    setEditingList(null);
    setName("");
    setDescription("");
    setActionError(null);
  }

  function startEditing(list: ListRow) {
    setEditingList(list);
    setName(list.name);
    setDescription(list.description ?? "");
    setActionError(null);
    setSuccess(null);
    setConfirmingDeleteId(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setSuccess(null);

    const trimmedName = name.trim();

    if (!trimmedName) {
      setActionError("List name is required.");
      return;
    }

    setIsSubmitting(true);

    const editingId = editingList?.id;

    try {
      const savedList = await requestApi(
        editingId ? `/api/lists/${editingId}` : "/api/lists",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({ name: trimmedName, description }),
        },
        parseList,
      );

      setLists((current) =>
        editingId
          ? current.map((list) => (list.id === savedList.id ? savedList : list))
          : [savedList, ...current],
      );
      setSuccess(editingId ? "List updated successfully." : "List created successfully.");
      resetForm();
    } catch (saveError) {
      if (saveError instanceof ApiRequestError && saveError.status === 401) {
        handleUnauthorized();
        return;
      }

      setActionError(saveError instanceof Error ? saveError.message : "Unable to save list.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteConfirmed(list: ListRow) {
    setActionError(null);
    setSuccess(null);
    setDeletingId(list.id);

    try {
      await requestApi(`/api/lists/${list.id}`, { method: "DELETE" }, parseList);
      setLists((current) => current.filter((item) => item.id !== list.id));
      if (editingList?.id === list.id) {
        resetForm();
      }
      setSuccess("List deleted successfully.");
      setConfirmingDeleteId(null);
    } catch (deleteError) {
      if (deleteError instanceof ApiRequestError && deleteError.status === 401) {
        handleUnauthorized();
        return;
      }

      setActionError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete list.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <article className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm xl:col-span-2">
        <h2 className="text-lg font-semibold text-zinc-50">Workspace lists</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Contact lists returned by the authenticated tenant API.
        </p>
        <div className="mt-4">
          {isLoading ? <ResourceLoading label="Loading contact lists" /> : null}
          {!isLoading && loadError ? (
            <ResourceError
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                setIsLoading(true);
                void loadLists();
              }}
            />
          ) : null}
          {!isLoading && !loadError && lists.length === 0 ? (
            <ResourceEmpty
              description="Create the first real contact list using the form on this page."
              title="No contact lists found"
            />
          ) : null}
          {!isLoading && !loadError && lists.length > 0 ? (
            <div className="marekto-scrollbar overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">ID</th>
                    <th className="py-3 pr-4">List</th>
                    <th className="py-3 pr-4">Created</th>
                    <th className="py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {lists.map((list) => (
                    <tr key={list.id}>
                      <td className="py-4 pr-4 font-mono text-xs text-zinc-400">
                        {formatEntityCode("LS", list.id)}
                      </td>
                      <td className="py-4 pr-4">
                        <p className="font-medium text-zinc-100">{list.name}</p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {list.description || "No description"}
                        </p>
                      </td>
                      <td className="py-4 pr-4 text-zinc-500">
                        {formatApiDate(list.created_at)}
                      </td>
                      <td className="py-4">
                        {confirmingDeleteId === list.id ? (
                          <div className="flex flex-col items-end gap-2">
                            <p className="text-right text-xs font-medium text-red-300">
                              Delete this list?
                            </p>
                            <div className="flex justify-end gap-2">
                              <button
                                className="h-9 rounded-md border border-red-500/30 px-3 text-sm font-medium text-red-300 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400 disabled:border-zinc-800 disabled:text-zinc-600"
                                disabled={deletingId === list.id}
                                onClick={() => void handleDeleteConfirmed(list)}
                                type="button"
                              >
                                {deletingId === list.id ? "Deleting..." : "Confirm delete"}
                              </button>
                              <button
                                className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                                disabled={deletingId === list.id}
                                onClick={() => setConfirmingDeleteId(null)}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400"
                              onClick={() => startEditing(list)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="h-9 rounded-md border border-red-500/30 px-3 text-sm font-medium text-red-300 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400"
                              onClick={() => {
                                setActionError(null);
                                setSuccess(null);
                                setConfirmingDeleteId(list.id);
                              }}
                              type="button"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </article>

      <aside className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-50">
          {editingList ? "Edit list" : "Create list"}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {editingList ? "Update this workspace list." : "Add a contact list to this workspace."}
        </p>
        <form className="mt-4 space-y-4" noValidate onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200" htmlFor="list-name">
              Name
            </label>
            <input
              className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              id="list-name"
              onChange={(event) => setName(event.target.value)}
              required
              type="text"
              value={name}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200" htmlFor="list-description">
              Description
            </label>
            <textarea
              aria-describedby="list-description-help"
              className="min-h-24 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              id="list-description"
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Who belongs in this list and how it will be used"
              value={description}
            />
            <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
              <p id="list-description-help">Optional workspace-facing description.</p>
              <span>{description.length}/500</span>
            </div>
          </div>
          {actionError ? (
            <p className="text-sm text-red-300" role="alert">
              {actionError}
            </p>
          ) : null}
          {success ? (
            <p aria-live="polite" className="text-sm text-emerald-300">
              {success}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="h-10 flex-1 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-500"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting
                ? editingList
                  ? "Saving changes..."
                  : "Creating list..."
                : editingList
                  ? "Save changes"
                  : "Create list"}
            </button>
            {editingList ? (
              <button
                className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={resetForm}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </aside>
    </section>
  );
}
