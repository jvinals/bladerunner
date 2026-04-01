/** Normalize URL for deduping discovery navigations (strip hash, UTM-like params). */
export function normalizeDiscoveryUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    const drop = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']);
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith('utm_') || drop.has(k)) {
        u.searchParams.delete(k);
      }
    }
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}
