import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useAuthenticatedBlobUrl } from '@/hooks/useAuthenticatedBlobUrl';

function hostnameFromUrl(url: string): string | null {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

type RunThumbnailProps = {
  runId: string;
  url: string;
  status: string;
  /** When set (e.g. after a completed recording), load JPEG from the API instead of favicon-only. */
  thumbnailUrl?: string | null;
  className?: string;
};

/** Site favicon preview, or session thumbnail when available; live recording gets a pulse ring + dot. */
export const RunThumbnail = memo(function RunThumbnail({
  runId,
  url,
  status,
  thumbnailUrl,
  className,
}: RunThumbnailProps) {
  const host = hostnameFromUrl(url);
  const favicon = host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
    : null;
  const live = status === 'RECORDING';
  const thumbPath = useMemo(() => {
    if (!thumbnailUrl || live) return null;
    return `/runs/${runId}/recording/thumbnail`;
  }, [thumbnailUrl, live, runId]);
  const thumbBlobUrl = useAuthenticatedBlobUrl(thumbPath, !!thumbPath);

  return (
    <div
      className={cn(
        'relative shrink-0 size-8 rounded-md overflow-hidden border border-border/80 bg-gradient-to-br from-sky-500/10 via-violet-500/10 to-fuchsia-500/10 shadow-sm',
        live && 'ring-2 ring-[var(--ce-primary)]/70 ring-offset-1 ring-offset-background',
        className,
      )}
      title={host ?? undefined}
    >
      {thumbBlobUrl ? (
        <img
          src={thumbBlobUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : favicon ? (
        <img
          src={favicon}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(e) => {
            (e.target as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
      ) : (
        <div className="size-full bg-gradient-to-br from-[var(--ce-primary)]/25 to-[var(--ce-accent)]/35" />
      )}
      {live && (
        <span
          className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-[var(--ce-primary)] shadow-sm animate-pulse"
          aria-hidden
        />
      )}
    </div>
  );
});
