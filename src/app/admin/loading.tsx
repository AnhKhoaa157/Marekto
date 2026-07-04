export default function AdminLoading() {
  return (
    <main className="min-h-dvh bg-zinc-950 px-4 py-6 text-zinc-50 sm:px-6">
      <section
        aria-busy="true"
        aria-label="Loading admin console"
        className="mx-auto max-w-6xl space-y-6"
      >
        <div className="h-10 w-64 animate-pulse rounded-md bg-zinc-900" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
          <div className="h-28 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
        </div>
        <div className="h-80 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
      </section>
    </main>
  );
}
