import { memo } from 'react';
import { cn } from '@/lib/utils';

function hostnameFromUrl(url: string): string | null {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

type RunThumbnailProps = {
  url: string;
  status: string;
  className?: string;
};

/** Small site favicon preview; live recording gets a pulse ring + dot. */
export const RunThumbnail = memo(function RunThumbnail({ url, status, className }: RunThumbnailProps) {
  const host = hostnameFromUrl(url);
  const favicon = host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
    : null;
  const live = status === 'RECORDING';

  return (
    <div
      className={cn(
        'relative shrink-0 size-8 rounded-md overflow-hidden border border-border/80 bg-gradient-to-br from-sky-500/10 via-violet-500/10 to-fuchsia-500/10 shadow-sm',
        live && 'ring-2 ring-[var(--ce-primary)]/70 ring-offset-1 ring-offset-background',
        className,
      )}
      title={host ?? undefined}
    >
      {favicon ? (
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
