"use client";

import { useCallback, useEffect, useState } from "react";

const SESSION_CHECK_INTERVAL_MS = 10_000;

type SessionStatusResponse = {
  success?: boolean;
  code?: string;
};

export function SessionReplacedGuard() {
  const [sessionReplaced, setSessionReplaced] = useState(false);

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "include",
      });
      const result = (await response.json().catch(() => null)) as
        | SessionStatusResponse
        | null;

      if (response.status === 409 && result?.code === "session_replaced") {
        setSessionReplaced(true);
      }
    } catch {
      // A network outage must not be presented as a replaced session.
    }
  }, []);

  useEffect(() => {
    const initialCheckId = window.setTimeout(() => void checkSession(), 0);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkSession();
      }
    }, SESSION_CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkSession();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearTimeout(initialCheckId);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkSession]);

  async function leaveSession(destination: "/" | "/login") {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    window.location.assign(destination);
  }

  if (!sessionReplaced) {
    return null;
  }

  return (
    <div
      aria-labelledby="session-replaced-title"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm"
      role="dialog"
    >
      <section className="w-full max-w-md rounded-lg border border-amber-500/40 bg-zinc-950 p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">
          Session ended
        </p>
        <h2
          className="mt-2 text-xl font-semibold text-zinc-50"
          id="session-replaced-title"
        >
          Signed in on another device
        </h2>
        <p className="mt-3 text-sm leading-6 text-zinc-300">
          This session was closed because your account signed in somewhere else.
          You can sign in again here or return to the homepage.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white outline-none hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400"
            onClick={() => void leaveSession("/login")}
            type="button"
          >
            Sign in again
          </button>
          <button
            className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-100 outline-none hover:border-zinc-500 hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-400"
            onClick={() => void leaveSession("/")}
            type="button"
          >
            Return home
          </button>
        </div>
      </section>
    </div>
  );
}
