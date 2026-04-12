/**
 * Extract screenshot URLs from timeline events. Skyvern timeline entries include
 * `screenshot_url` per action/thought — available **during** execution,
 * unlike `run.screenshot_urls` which stays empty until step completion on Cloud.
 * Returns newest-last (caller should reverse or pick last for freshest).
 */
export function collectTimelineScreenshotUrls(root: unknown): string[] {
  const urls: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    for (const k of ['screenshot_url', 'screenshotUrl'] as const) {
      const v = o[k];
      if (typeof v === 'string' && v.startsWith('http')) urls.push(v);
    }
    for (const nested of ['block', 'thought'] as const) {
      const inner = o[nested];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        const obj = inner as Record<string, unknown>;
        for (const k of ['screenshot_url', 'screenshotUrl'] as const) {
          const v = obj[k];
          if (typeof v === 'string' && v.startsWith('http')) urls.push(v);
        }
      }
    }
    for (const v of Object.values(o)) {
      if (v !== null && typeof v === 'object') walk(v);
    }
  };
  walk(root);
  return urls;
}
