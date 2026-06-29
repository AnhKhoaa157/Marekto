type ResourceLoadingProps = {
  label: string;
};

export function ResourceLoading({ label }: Readonly<ResourceLoadingProps>) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-3 py-4">
      <div className="h-10 animate-pulse rounded-md bg-zinc-800" />
      <div className="h-10 animate-pulse rounded-md bg-zinc-800" />
      <div className="h-10 animate-pulse rounded-md bg-zinc-800" />
    </div>
  );
}

type ResourceErrorProps = {
  message: string;
  onRetry: () => void;
};

export function ResourceError({ message, onRetry }: Readonly<ResourceErrorProps>) {
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4" role="alert">
      <p className="text-sm font-medium text-red-100">Unable to load data</p>
      <p className="mt-1 text-sm text-red-100/80">{message}</p>
      <button
        className="mt-4 h-9 rounded-md border border-red-400/40 px-3 text-sm font-medium text-red-100 outline-none transition-colors hover:bg-red-400/10 focus-visible:ring-2 focus-visible:ring-red-300"
        onClick={onRetry}
        type="button"
      >
        Retry
      </button>
    </div>
  );
}

type ResourceEmptyProps = {
  description: string;
  title: string;
};

export function ResourceEmpty({
  description,
  title,
}: Readonly<ResourceEmptyProps>) {
  return (
    <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-950 p-6 text-center">
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      <p className="mt-2 text-sm text-zinc-500">{description}</p>
    </div>
  );
}
