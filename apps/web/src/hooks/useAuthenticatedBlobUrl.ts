import { useEffect, useState } from 'react';
import { apiFetchRaw } from '@/lib/api';

/**
 * Fetches a binary API resource with Clerk auth and exposes it as a `blob:` URL
 * (for `<video src>`, `<img src>`, etc., which cannot send `Authorization` headers).
 */
export function useAuthenticatedBlobUrl(apiPath: string | null, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !apiPath) {
      setUrl(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const res = await apiFetchRaw(apiPath);
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setUrl(objectUrl);
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
  }, [apiPath, enabled]);

  return url;
}
