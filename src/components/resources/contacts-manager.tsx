"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ResourceEmpty,
  ResourceError,
  ResourceLoading,
} from "@/components/resources/resource-states";
import {
  ApiRequestError,
  formatApiDate,
  isRecord,
  requestApi,
} from "@/lib/client-api";

type ContactRow = {
  id: number;
  workspace_id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  properties: Record<string, unknown>;
  created_at: string;
};

function parseNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("The contact response contains an invalid optional field.");
  }

  return value;
}

function parseContact(value: unknown): ContactRow {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    typeof value.workspace_id !== "number" ||
    typeof value.email !== "string" ||
    typeof value.created_at !== "string" ||
    !isRecord(value.properties)
  ) {
    throw new Error("The contact response has an invalid shape.");
  }

  return {
    id: value.id,
    workspace_id: value.workspace_id,
    email: value.email,
    first_name: parseNullableString(value.first_name),
    last_name: parseNullableString(value.last_name),
    phone: parseNullableString(value.phone),
    properties: value.properties,
    created_at: value.created_at,
  };
}

function parseContacts(value: unknown): ContactRow[] {
  if (!Array.isArray(value)) {
    throw new Error("The contacts response is not a list.");
  }

  return value.map(parseContact);
}

function getContactName(contact: ContactRow): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Not provided";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactsManager() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadContacts = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await requestApi(
          "/api/contacts",
          { method: "GET", signal },
          parseContacts,
        );
        setContacts(data);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        if (loadError instanceof ApiRequestError && loadError.status === 401) {
          router.push("/login");
          router.refresh();
          return;
        }

        setLoadError(
          loadError instanceof Error ? loadError.message : "Unable to load contacts.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const controller = new AbortController();

    void requestApi(
      "/api/contacts",
      { method: "GET", signal: controller.signal },
      parseContacts,
    )
      .then(setContacts)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }

        if (loadError instanceof ApiRequestError && loadError.status === 401) {
          router.push("/login");
          router.refresh();
          return;
        }

        setLoadError(
          loadError instanceof Error ? loadError.message : "Unable to load contacts.",
        );
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [router]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setSuccess(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = formData.get("email");

    if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
      setActionError("Enter a valid contact email address.");
      return;
    }

    setIsSubmitting(true);

    try {
      const createdContact = await requestApi(
        "/api/contacts",
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            first_name: formData.get("first_name"),
            last_name: formData.get("last_name"),
            phone: formData.get("phone"),
          }),
        },
        parseContact,
      );
      setContacts((current) => [createdContact, ...current]);
      setSuccess("Contact created successfully.");
      form.reset();
    } catch (createError) {
      if (createError instanceof ApiRequestError && createError.status === 401) {
        router.push("/login");
        router.refresh();
        return;
      }

      setActionError(
        createError instanceof Error ? createError.message : "Unable to create contact.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <article className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm xl:col-span-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">Workspace contacts</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Records returned by the authenticated tenant API.
          </p>
        </div>

        <div className="mt-4">
          {isLoading ? <ResourceLoading label="Loading contacts" /> : null}
          {!isLoading && loadError ? (
            <ResourceError
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                setIsLoading(true);
                void loadContacts();
              }}
            />
          ) : null}
          {!isLoading && !loadError && contacts.length === 0 ? (
            <ResourceEmpty
              description="Create the first real contact using the form on this page."
              title="No contacts found"
            />
          ) : null}
          {!isLoading && !loadError && contacts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-full text-left text-sm">
                <thead className="border-b border-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="py-3 pr-4">Name</th>
                    <th className="py-3 pr-4">Email</th>
                    <th className="py-3 pr-4">Phone</th>
                    <th className="py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {contacts.map((contact) => (
                    <tr key={contact.id}>
                      <td className="py-4 pr-4 font-medium text-zinc-100">
                        {getContactName(contact)}
                      </td>
                      <td className="py-4 pr-4 text-zinc-300">{contact.email}</td>
                      <td className="py-4 pr-4 text-zinc-400">
                        {contact.phone ?? "Not provided"}
                      </td>
                      <td className="py-4 text-zinc-500">
                        {formatApiDate(contact.created_at)}
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
        <h2 className="text-lg font-semibold text-zinc-50">Create contact</h2>
        <p className="mt-1 text-sm text-zinc-400">Add a contact to this workspace.</p>
        <form className="mt-4 space-y-4" noValidate onSubmit={handleCreate}>
          <ContactInput label="Email" name="email" required type="email" />
          <ContactInput label="First name" name="first_name" />
          <ContactInput label="Last name" name="last_name" />
          <ContactInput label="Phone" name="phone" type="tel" />
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
          <button
            className="h-10 w-full rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-500"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Creating contact..." : "Create contact"}
          </button>
        </form>
      </aside>
    </section>
  );
}

type ContactInputProps = {
  label: string;
  name: string;
  required?: boolean;
  type?: "email" | "tel" | "text";
};

function ContactInput({
  label,
  name,
  required = false,
  type = "text",
}: Readonly<ContactInputProps>) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-zinc-200" htmlFor={`contact-${name}`}>
        {label}
      </label>
      <input
        className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        id={`contact-${name}`}
        name={name}
        required={required}
        type={type}
      />
    </div>
  );
}
