type CampaignDetailSkeletonProps = {
  showBackLink?: boolean;
};

export function CampaignDetailSkeleton({
  showBackLink = true,
}: Readonly<CampaignDetailSkeletonProps>) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading campaign details"
      className="min-w-0 space-y-6"
    >
      {showBackLink ? (
        <div className="h-5 w-36 animate-pulse rounded bg-zinc-800" />
      ) : null}
      <div className="rounded-md border border-zinc-800 bg-zinc-900 p-6">
        <div className="h-7 w-2/3 animate-pulse rounded bg-zinc-800 sm:w-80" />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="h-16 animate-pulse rounded-md bg-zinc-800" key={index} />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="h-24 animate-pulse rounded-md border border-zinc-800 bg-zinc-900"
            key={index}
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-md border border-zinc-800 bg-zinc-900" />
    </div>
  );
}
