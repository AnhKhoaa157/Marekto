"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type RoutePrefetcherProps = {
  disabled?: boolean;
  routes: readonly string[];
};

export function RoutePrefetcher({
  disabled = false,
  routes,
}: Readonly<RoutePrefetcherProps>) {
  const router = useRouter();

  useEffect(() => {
    if (disabled) {
      return;
    }

    const timers = routes.map((route, index) =>
      window.setTimeout(() => {
        router.prefetch(route);
      }, 120 * index),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [disabled, router, routes]);

  return null;
}
