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

export type TemplateRow = {
  id: number;
  workspace_id: number;
  name: string;
  body_html: string;
  body_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export function parseTemplate(value: unknown): TemplateRow {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    typeof value.workspace_id !== "number" ||
    typeof value.name !== "string" ||
    typeof value.body_html !== "string" ||
    !isRecord(value.body_json) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw new Error("The template response has an invalid shape.");
  }

  return {
    id: value.id,
    workspace_id: value.workspace_id,
    name: value.name,
    body_html: value.body_html,
    body_json: value.body_json,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function parseTemplates(value: unknown): TemplateRow[] {
  if (!Array.isArray(value)) {
    throw new Error("The templates response is not a list.");
  }

  return value.map(parseTemplate);
}

export function TemplatesManager() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<TemplateRow | null>(null);
  const [name, setName] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  const handleUnauthorized = useCallback(() => {
    router.push("/login");
    router.refresh();
  }, [router]);

  const loadTemplates = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await requestApi(
          "/api/templates",
          { method: "GET", signal },
          parseTemplates,
        );
        setTemplates(data);
        setLoadError(null);
      } catch (loadFailure) {
        if (loadFailure instanceof DOMException && loadFailure.name === "AbortError") {
          return;
        }

        if (loadFailure instanceof ApiRequestError && loadFailure.status === 401) {
          handleUnauthorized();
          return;
        }

        setLoadError(
          loadFailure instanceof Error ? loadFailure.message : "Unable to load templates.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [handleUnauthorized],
  );

  useEffect(() => {
    const controller = new AbortController();

    void requestApi(
      "/api/templates",
      { method: "GET", signal: controller.signal },
      parseTemplates,
    )
      .then(setTemplates)
      .catch((loadFailure: unknown) => {
        if (loadFailure instanceof DOMException && loadFailure.name === "AbortError") {
          return;
        }

        if (loadFailure instanceof ApiRequestError && loadFailure.status === 401) {
          handleUnauthorized();
          return;
        }

        setLoadError(
          loadFailure instanceof Error ? loadFailure.message : "Unable to load templates.",
        );
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [handleUnauthorized]);

  function resetForm() {
    setEditingTemplate(null);
    setName("");
    setBodyHtml("");
    setActionError(null);
  }

  function startEditing(template: TemplateRow) {
    setEditingTemplate(template);
    setName(template.name);
    setBodyHtml(template.body_html);
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
      setActionError("Template name is required.");
      return;
    }

    if (!bodyHtml.trim()) {
      setActionError("Template HTML content is required.");
      return;
    }

    setIsSubmitting(true);
    const editingId = editingTemplate?.id;

    try {
      const savedTemplate = await requestApi(
        editingId ? `/api/templates/${editingId}` : "/api/templates",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({ name: trimmedName, body_html: bodyHtml }),
        },
        parseTemplate,
      );

      setTemplates((current) =>
        editingId
          ? current.map((template) =>
              template.id === savedTemplate.id ? savedTemplate : template,
            )
          : [savedTemplate, ...current],
      );
      setSuccess(
        editingId ? "Template updated successfully." : "Template created successfully.",
      );
      resetForm();
    } catch (saveError) {
      if (saveError instanceof ApiRequestError && saveError.status === 401) {
        handleUnauthorized();
        return;
      }

      setActionError(
        saveError instanceof Error ? saveError.message : "Unable to save template.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteConfirmed(template: TemplateRow) {
    setActionError(null);
    setSuccess(null);
    setDeletingId(template.id);

    try {
      await requestApi(
        `/api/templates/${template.id}`,
        { method: "DELETE" },
        parseTemplate,
      );
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (editingTemplate?.id === template.id) {
        resetForm();
      }
      setSuccess("Template deleted successfully.");
      setConfirmingDeleteId(null);
    } catch (deleteError) {
      if (deleteError instanceof ApiRequestError && deleteError.status === 401) {
        handleUnauthorized();
        return;
      }

      setActionError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete template.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <article className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm xl:col-span-2">
        <h2 className="text-lg font-semibold text-zinc-50">Workspace templates</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Email templates returned by the authenticated tenant API.
        </p>
        <div className="mt-4">
          {isLoading ? <ResourceLoading label="Loading templates" /> : null}
          {!isLoading && loadError ? (
            <ResourceError
              message={loadError}
              onRetry={() => {
                setIsLoading(true);
                void loadTemplates();
              }}
            />
          ) : null}
          {!isLoading && !loadError && templates.length === 0 ? (
            <ResourceEmpty
              description="Create the first real email template using the form on this page."
              title="No templates found"
            />
          ) : null}
          {!isLoading && !loadError && templates.length > 0 ? (
            <div className="marekto-scrollbar overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Template</th>
                    <th className="py-3 pr-4">Content</th>
                    <th className="py-3 pr-4">Updated</th>
                    <th className="py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {templates.map((template) => (
                    <tr key={template.id}>
                      <td className="py-4 pr-4 font-medium text-zinc-100">
                        {template.name}
                      </td>
                      <td className="py-4 pr-4 text-zinc-400">
                        {template.body_html.trim() ? "HTML provided" : "No HTML content"}
                      </td>
                      <td className="py-4 pr-4 text-zinc-500">
                        {formatApiDate(template.updated_at)}
                      </td>
                      <td className="py-4">
                        {confirmingDeleteId === template.id ? (
                          <div className="flex flex-col items-end gap-2">
                            <p className="text-right text-xs font-medium text-red-300">
                              Delete this template?
                            </p>
                            <div className="flex justify-end gap-2">
                              <button
                                className="h-9 rounded-md border border-red-500/30 px-3 text-sm font-medium text-red-300 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400 disabled:border-zinc-800 disabled:text-zinc-600"
                                disabled={deletingId === template.id}
                                onClick={() => void handleDeleteConfirmed(template)}
                                type="button"
                              >
                                {deletingId === template.id ? "Deleting..." : "Confirm delete"}
                              </button>
                              <button
                                className="h-9 rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                                disabled={deletingId === template.id}
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
                              onClick={() => startEditing(template)}
                              type="button"
                            >
                              Edit
                            </button>
                            <button
                              className="h-9 rounded-md border border-red-500/30 px-3 text-sm font-medium text-red-300 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-400"
                              onClick={() => {
                                setActionError(null);
                                setSuccess(null);
                                setConfirmingDeleteId(template.id);
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
          {editingTemplate ? "Edit template" : "Create template"}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {editingTemplate
            ? "Update this workspace email template."
            : "Store real HTML content for future campaigns."}
        </p>
        <form className="mt-4 space-y-4" noValidate onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200" htmlFor="template-name">
              Name
            </label>
            <input
              className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              id="template-name"
              onChange={(event) => setName(event.target.value)}
              required
              type="text"
              value={name}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-zinc-200" htmlFor="template-html">
                HTML content
              </label>
              <span className="text-xs text-zinc-600">
                {bodyHtml.length.toLocaleString()} characters
              </span>
            </div>
            <textarea
              aria-describedby="template-html-help"
              className="min-h-64 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
              id="template-html"
              onChange={(event) => setBodyHtml(event.target.value)}
              placeholder="<!doctype html>..."
              value={bodyHtml}
            />
            <p className="text-xs leading-5 text-zinc-500" id="template-html-help">
              Include the real CTA URL plus unsubscribe, legal, and footer content.
              AI personalization is instructed to preserve those links.
            </p>
          </div>
          <section className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
            <div className="border-b border-zinc-800 px-3 py-2">
              <h3 className="text-sm font-medium text-zinc-200">Safe preview</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Scripts and browser privileges are disabled in this preview.
              </p>
            </div>
            {bodyHtml.trim() ? (
              <iframe
                className="h-72 w-full bg-white"
                referrerPolicy="no-referrer"
                sandbox=""
                srcDoc={bodyHtml}
                title="Email template preview"
              />
            ) : (
              <div className="flex h-40 items-center justify-center p-4 text-center text-sm text-zinc-500">
                Add HTML content to preview the email.
              </div>
            )}
          </section>
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
                ? editingTemplate
                  ? "Saving changes..."
                  : "Creating template..."
                : editingTemplate
                  ? "Save changes"
                  : "Create template"}
            </button>
            {editingTemplate ? (
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
