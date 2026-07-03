"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type LogoutResponse =
  | {
      success: true;
      data: {
        authenticated: false;
      };
    }
  | {
      success: false;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLogoutResponse(value: unknown): value is LogoutResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    return false;
  }

  if (value.success === false) {
    return typeof value.error === "string";
  }

  return (
    isRecord(value.data) &&
    value.data.authenticated === false
  );
}

async function readLogoutResponse(response: Response): Promise<LogoutResponse> {
  const body: unknown = await response.json().catch(() => null);

  if (isLogoutResponse(body)) {
    return body;
  }

  return {
    success: false,
    error: response.ok
      ? "Signed out, but the response could not be read."
      : "Sign out failed. Please try again.",
  };
}

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignOut() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/logout", {
        credentials: "include",
        method: "POST",
      });
      const result = await readLogoutResponse(response);

      if (!result.success) {
        setError(result.error);
        return;
      }

      router.push("/login");
      router.refresh();
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Sign out failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button
        className="h-10 rounded-md border border-zinc-700 px-4 text-sm font-medium text-zinc-300 outline-none transition-colors hover:bg-zinc-900 hover:text-zinc-50 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:border-zinc-800 disabled:text-zinc-500"
        disabled={isSubmitting}
        onClick={handleSignOut}
        type="button"
      >
        {isSubmitting ? "Signing out..." : "Sign out"}
      </button>
      {error ? (
        <p aria-live="polite" className="text-xs font-medium text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
