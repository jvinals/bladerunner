import { useEffect, useState } from 'react';
import { apiFetchRaw } from '@/lib/api';

export type SessionRecordingMediaKind = 'video' | 'image';

/**
 * Loads session recording media for the run detail page.
 * Tries **video first** (so we still get a player when `run.recordings` is empty but `recording.webm` exists),
 * then falls back to the JPEG thumbnail.
 */
export function useSessionRecordingPlayback(runId: string | undefined, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<SessionRecordingMediaKind | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId || !enabled) {
      setUrl(null);
      setKind(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setUrl(null);
    setKind(null);

    void (async () => {
      try {
        const videoRes = await apiFetchRaw(`/runs/${runId}/recording/video`);
        if (!cancelled && videoRes.ok) {
          const blob = await videoRes.blob();
          if (blob.size > 0) {
            objectUrl = URL.createObjectURL(blob);
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setUrl(objectUrl);
            setKind('video');
            setLoading(false);
            return;
          }
        }
      } catch {
        /* try thumbnail */
      }

      try {
        const thumbRes = await apiFetchRaw(`/runs/${runId}/recording/thumbnail`);
        if (!cancelled && thumbRes.ok) {
          const blob = await thumbRes.blob();
          if (blob.size > 0) {
            objectUrl = URL.createObjectURL(blob);
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setUrl(objectUrl);
            setKind('image');
          }
        }
      } catch {
        /* ignore */
      }

      if (!cancelled) {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setKind(null);
      setLoading(false);
    };
  }, [runId, enabled]);

  return { url, kind, loading };
}

/**
 * Loads only the thumbnail (e.g. after `<video>` fails to decode WebM in Safari).
 */
export function useSessionRecordingThumbnailOnly(runId: string | undefined, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!runId || !enabled) {
      setUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const res = await apiFetchRaw(`/runs/${runId}/recording/thumbnail`);
        if (!cancelled && res.ok) {
          const blob = await res.blob();
          if (blob.size > 0) {
            objectUrl = URL.createObjectURL(blob);
            if (cancelled) {
              URL.revokeObjectURL(objectUrl);
              return;
            }
            setUrl(objectUrl);
          }
        }
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();

    return () => {
      cancelled = true;
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [runId, enabled]);

  return url;
}
