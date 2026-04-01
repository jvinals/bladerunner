import { useCallback, useEffect, useRef } from 'react';
import { DiscoveryLogLineRow } from '@/components/DiscoveryLogLine';
import type { DiscoveryLogLine } from '@/hooks/useDiscoveryLive';

type Props = {
  lines: DiscoveryLogLine[];
  formatTime: (iso: string) => string;
  variant: 'light' | 'dark';
  emptyMessage: string;
  /** Bump when the log is cleared / session resets so follow mode turns back on. */
  sessionKey?: string;
};

const TOP_EPSILON_PX = 6;

/**
 * Newest-first log: keeps scroll pinned to the top while new lines arrive, until the user scrolls down.
 * Scrolling back to the top re-enables auto-follow.
 */
export function DiscoveryAgentLogPanel({ lines, formatTime, variant, emptyMessage, sessionKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToNewestRef = useRef(true);

  useEffect(() => {
    stickToNewestRef.current = true;
  }, [sessionKey]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    stickToNewestRef.current = el.scrollTop <= TOP_EPSILON_PX;
  }, []);

  useEffect(() => {
    if (lines.length === 0) {
      stickToNewestRef.current = true;
    }
  }, [lines.length]);

  useEffect(() => {
    if (!stickToNewestRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [lines]);

  const shell =
    variant === 'dark'
      ? 'flex-1 min-h-0 overflow-y-auto px-2 py-2 text-[10px] leading-snug text-gray-300'
      : 'flex-1 min-h-0 overflow-y-auto px-2 py-1.5 text-[10px] leading-snug';

  return (
    <div ref={containerRef} onScroll={onScroll} className={shell}>
      {lines.length === 0 ? (
        <p className={variant === 'dark' ? 'text-gray-500 text-center py-4' : 'text-gray-400 text-center py-4'}>
          {emptyMessage}
        </p>
      ) : (
        // Keys must use the index in the *original* `lines` array (append order). Using the index
        // after `.reverse()` shifts when new lines arrive and remounts rows — closing open modals.
        lines
          .map((line, i) => (
            <DiscoveryLogLineRow
              key={`${i}-${line.at}`}
              line={line}
              formatTime={formatTime}
              variant={variant}
            />
          ))
          .reverse()
      )}
    </div>
  );
}
