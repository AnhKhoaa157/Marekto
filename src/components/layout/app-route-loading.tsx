import { AppShell, type AppRoute } from "@/components/layout/app-shell";

type AppRouteLoadingProps = {
  activeRoute: AppRoute;
  eyebrow: string;
  title: string;
};

export function AppRouteLoading({
  activeRoute,
  eyebrow,
  title,
}: Readonly<AppRouteLoadingProps>) {
  return (
    <AppShell
      activeRoute={activeRoute}
      authenticated
      eyebrow={eyebrow}
      title={title}
    >
      <section aria-busy="true" aria-label={`Loading ${title}`} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="h-96 animate-pulse rounded-md border border-zinc-800 bg-zinc-900 xl:col-span-2" />
          <div className="h-96 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
        </div>
      </section>
    </AppShell>
  );
}
