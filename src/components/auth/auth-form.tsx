"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type AuthMode = "login" | "register";

type AuthFormProps = {
  mode: AuthMode;
};

type AuthSuccessResponse = {
  success: true;
  data: {
    token: string;
    userId: number;
    workspaceId: number;
  };
};

type AuthErrorResponse = {
  success: false;
  error: string;
};

type AuthResponse = AuthSuccessResponse | AuthErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuthResponse(value: unknown): value is AuthResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    return false;
  }

  if (value.success === false) {
    return typeof value.error === "string";
  }

  if (!isRecord(value.data)) {
    return false;
  }

  return (
    typeof value.data.token === "string" &&
    typeof value.data.userId === "number" &&
    typeof value.data.workspaceId === "number"
  );
}

function readFormText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const body: unknown = await response.json().catch(() => null);

  if (isAuthResponse(body)) {
    return body;
  }

  return {
    success: false,
    error: response.ok
      ? "Authentication completed, but the response could not be read."
      : "Authentication failed. Please try again.",
  };
}

export function AuthForm({ mode }: Readonly<AuthFormProps>) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  const isRegister = mode === "register";
  const title = isRegister ? "Create your workspace" : "Sign in to Marekto";
  const description = isRegister
    ? "Start with a real tenant workspace and owner account."
    : "Use your existing account to load live tenant data.";
  const submitLabel = isRegister ? "Create account" : "Sign in";
  const pendingLabel = isRegister ? "Creating account..." : "Signing in...";
  const feedbackId = `${mode}-auth-feedback`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = readFormText(formData, "email").trim().toLowerCase();
    const password = readFormText(formData, "password");
    const workspaceName = readFormText(formData, "workspaceName").trim();

    const payload = isRegister
      ? { email, password, workspaceName: workspaceName || undefined }
      : { email, password };

    try {
      const response = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
        body: JSON.stringify(payload),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const result = await readAuthResponse(response);

      if (!result.success) {
        setError(result.error);
        return;
      }

      setIsRedirecting(true);
      router.push("/dashboard");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isSubmitting || isRedirecting;

  return (
    <section className="rounded-md border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
          Tenant access
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">{description}</p>
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-200" htmlFor={`${mode}-email`}>
            Email
          </label>
          <input
            autoComplete="email"
            className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:text-zinc-500"
            disabled={isBusy}
            id={`${mode}-email`}
            name="email"
            placeholder="Email address"
            required
            type="email"
          />
        </div>

        {isRegister ? (
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-zinc-200"
              htmlFor={`${mode}-workspaceName`}
            >
              Workspace name
            </label>
            <input
              autoComplete="organization"
              className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:text-zinc-500"
              disabled={isBusy}
              id={`${mode}-workspaceName`}
              name="workspaceName"
              placeholder="Workspace name"
              type="text"
            />
            <p className="text-xs text-zinc-500">
              Leave blank to let the backend assign a workspace label.
            </p>
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-200" htmlFor={`${mode}-password`}>
            Password
          </label>
          <input
            autoComplete={isRegister ? "new-password" : "current-password"}
            className="h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:text-zinc-500"
            disabled={isBusy}
            id={`${mode}-password`}
            name="password"
            placeholder="Password"
            required
            type="password"
          />
        </div>

        {error ? (
          <div
            aria-live="polite"
            className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100"
            id={feedbackId}
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {isRedirecting ? (
          <div
            aria-live="polite"
            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
            id={feedbackId}
          >
            Authentication succeeded. Redirecting to dashboard...
          </div>
        ) : null}

        <button
          aria-describedby={error || isRedirecting ? feedbackId : undefined}
          className="h-10 w-full rounded-md bg-indigo-600 px-4 text-sm font-medium text-white outline-none transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-500"
          disabled={isBusy}
          type="submit"
        >
          {isBusy ? pendingLabel : submitLabel}
        </button>
      </form>

      <div className="mt-6 border-t border-zinc-800 pt-4 text-sm text-zinc-400">
        {isRegister ? (
          <p>
            Already have an account?{" "}
            <Link
              className="font-medium text-indigo-300 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/login"
            >
              Sign in
            </Link>
          </p>
        ) : (
          <p>
            Need a workspace?{" "}
            <Link
              className="font-medium text-indigo-300 outline-none transition-colors hover:text-indigo-200 focus-visible:ring-2 focus-visible:ring-indigo-400"
              href="/register"
            >
              Create an account
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
