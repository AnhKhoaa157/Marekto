"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import {
  ResourceError,
  ResourceLoading,
} from "@/components/resources/resource-states";
import {
  ApiRequestError,
  formatApiDate,
  isRecord,
  requestApi,
} from "@/lib/client-api";

type ProfileRow = {
  id: number;
  email: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
};

type ProfileFormState = {
  firstName: string;
  lastName: string;
  phone: string;
};

function parseNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("The profile response contains an invalid optional field.");
  }

  return value;
}

function parseProfile(value: unknown): ProfileRow {
  if (
    !isRecord(value) ||
    typeof value.id !== "number" ||
    typeof value.email !== "string" ||
    typeof value.role !== "string" ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("The profile response has an invalid shape.");
  }

  return {
    id: value.id,
    email: value.email,
    role: value.role,
    first_name: parseNullableString(value.first_name),
    last_name: parseNullableString(value.last_name),
    phone: parseNullableString(value.phone),
    created_at: value.created_at,
  };
}

function getFormState(profile: ProfileRow): ProfileFormState {
  return {
    firstName: profile.first_name ?? "",
    lastName: profile.last_name ?? "",
    phone: profile.phone ?? "",
  };
}

function getDisplayName(profile: ProfileRow): string {
  const displayName = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ");

  return displayName || "Not provided";
}

export function ProfileManager() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [formState, setFormState] = useState<ProfileFormState>({
    firstName: "",
    lastName: "",
    phone: "",
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const loadedProfile = await requestApi(
          "/api/profile",
          { method: "GET", signal },
          parseProfile,
        );

        setProfile(loadedProfile);
        setFormState(getFormState(loadedProfile));
        setLoadError(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (error instanceof ApiRequestError && error.status === 401) {
          router.push("/login");
          router.refresh();
          return;
        }

        setLoadError(
          error instanceof Error ? error.message : "Unable to load profile.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfile(controller.signal);

    return () => controller.abort();
  }, [loadProfile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setActionError(null);
    setSuccess(null);
    setIsSaving(true);

    try {
      const updatedProfile = await requestApi(
        "/api/profile",
        {
          method: "PATCH",
          body: JSON.stringify({
            first_name: formState.firstName,
            last_name: formState.lastName,
            phone: formState.phone,
          }),
        },
        parseProfile,
      );

      setProfile(updatedProfile);
      setFormState(getFormState(updatedProfile));
      setSuccess("Profile updated successfully.");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        router.push("/login");
        router.refresh();
        return;
      }

      setActionError(
        error instanceof Error ? error.message : "Unable to update profile.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const isDirty = profile
    ? formState.firstName !== (profile.first_name ?? "") ||
      formState.lastName !== (profile.last_name ?? "") ||
      formState.phone !== (profile.phone ?? "")
    : false;

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <article className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm xl:col-span-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-50">Personal details</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Manage the account information connected to your authenticated
            Marekto session.
          </p>
        </div>

        <div className="mt-4">
          {isLoading ? <ResourceLoading label="Loading profile" /> : null}
          {!isLoading && loadError ? (
            <ResourceError
              message={loadError}
              onRetry={() => {
                setLoadError(null);
                setIsLoading(true);
                void loadProfile();
              }}
            />
          ) : null}
          {!isLoading && !loadError && profile ? (
            <form className="space-y-4" noValidate onSubmit={handleSubmit}>
              <ProfileInput
                disabled
                helpText="Email is used for sign-in and cannot be changed here."
                label="Email"
                name="email"
                type="email"
                value={profile.email}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <ProfileInput
                  label="First name"
                  maxLength={120}
                  name="first_name"
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      firstName: value,
                    }))
                  }
                  value={formState.firstName}
                />
                <ProfileInput
                  label="Last name"
                  maxLength={120}
                  name="last_name"
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      lastName: value,
                    }))
                  }
                  value={formState.lastName}
                />
              </div>
              <ProfileInput
                label="Phone number"
                maxLength={40}
                name="phone"
                onChange={(value) =>
                  setFormState((current) => ({ ...current, phone: value }))
                }
                type="tel"
                value={formState.phone}
              />

              {actionError ? (
                <div
                  className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100"
                  role="alert"
                >
                  {actionError}
                </div>
              ) : null}
              {success ? (
                <div
                  aria-live="polite"
                  className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
                >
                  {success}
                </div>
              ) : null}

              <div className="flex flex-col justify-end gap-2 sm:flex-row">
                {isDirty && profile ? (
                  <button
                    className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-400"
                    onClick={() => {
                      setFormState(getFormState(profile));
                      setActionError(null);
                      setSuccess(null);
                    }}
                    type="button"
                  >
                    Reset changes
                  </button>
                ) : null}
                <button
                  className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-500"
                  disabled={isSaving || !isDirty}
                  type="submit"
                >
                  {isSaving ? "Saving changes..." : "Save changes"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </article>

      <aside className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-50">Account summary</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Live account data from the authenticated session.
        </p>

        {isLoading ? (
          <ResourceLoading label="Loading account summary" />
        ) : null}
        {!isLoading && !loadError && profile ? (
          <dl className="mt-4 space-y-4">
            <ProfileMeta label="Display name" value={getDisplayName(profile)} />
            <ProfileMeta label="Role" value={profile.role} />
            <ProfileMeta
              label="Account created"
              value={formatApiDate(profile.created_at)}
            />
          </dl>
        ) : null}
        {!isLoading && loadError ? (
          <div className="mt-4 rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-4 text-center">
            <p className="text-sm font-medium text-zinc-200">
              Account summary unavailable
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Reload the profile after the API is available.
            </p>
          </div>
        ) : null}
      </aside>
    </section>
  );
}

type ProfileInputProps = {
  disabled?: boolean;
  helpText?: string;
  label: string;
  maxLength?: number;
  name: string;
  onChange?: (value: string) => void;
  type?: "email" | "tel" | "text";
  value: string;
};

function ProfileInput({
  disabled = false,
  helpText,
  label,
  maxLength,
  name,
  onChange,
  type = "text",
  value,
}: Readonly<ProfileInputProps>) {
  const inputId = `profile-${name}`;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-zinc-200" htmlFor={inputId}>
        {label}
      </label>
      <input
        className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-500"
        disabled={disabled}
        id={inputId}
        maxLength={maxLength}
        name={name}
        onChange={(event) => onChange?.(event.currentTarget.value)}
        type={type}
        value={value}
      />
      {helpText ? <p className="text-xs text-zinc-500">{helpText}</p> : null}
    </div>
  );
}

type ProfileMetaProps = {
  label: string;
  value: string;
};

function ProfileMeta({ label, value }: Readonly<ProfileMetaProps>) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-zinc-100">
        {value}
      </dd>
    </div>
  );
}
