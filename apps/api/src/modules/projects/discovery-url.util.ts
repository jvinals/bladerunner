/** Normalize document title for stable screen identity (same URL, different SPA view). */
export function normalizeDiscoveryScreenTitle(title: string | null | undefined): string {
  const t = (title ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return t.slice(0, 160) || '(no title)';
}

/** Composite key: normalized URL + normalized title (SPA screens without URL change). */
export function discoveryScreenKey(urlNorm: string, title: string | null | undefined): string {
  return `${urlNorm}\x1f${normalizeDiscoveryScreenTitle(title)}`;
}

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
