/**
 * Extract per-block timing hints from Skyvern `GET /v1/runs/{id}/timeline` JSON.
 * Field names vary by version; we probe common keys. Values are orchestrator-level, not app-exclusive time.
 */

export type SkyvernTimelineBlockEnriched = {
  label: string | null;
  status: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

const DATE_KEYS_START = [
  'started_at',
  'startedAt',
  'start_time',
  'startTime',
  'begin_at',
  'created_at',
  'createdAt',
] as const;
const DATE_KEYS_END = [
  'completed_at',
  'completedAt',
  'end_time',
  'endTime',
  'finished_at',
  'finishedAt',
  'modified_at',
  'modifiedAt',
] as const;

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

function pickFirstDate(o: Record<string, unknown>, keys: readonly string[]): Date | null {
  for (const k of keys) {
    const d = parseDate(o[k]);
    if (d) return d;
  }
  return null;
}

function enrichBlockLike(o: Record<string, unknown>): SkyvernTimelineBlockEnriched | null {
  let label: string | null = typeof o.label === 'string' ? o.label : null;
  let inner: Record<string, unknown> | null = null;

  if (String(o.type).toLowerCase() === 'block' && o.block && typeof o.block === 'object') {
    inner = o.block as Record<string, unknown>;
    if (!label && typeof inner.label === 'string') label = inner.label;
  }

  const status = typeof o.status === 'string' ? o.status : typeof inner?.status === 'string' ? inner.status : null;
  const src = inner ?? o;
  const startedAt = pickFirstDate(src, DATE_KEYS_START);
  let completedAt = pickFirstDate(src, DATE_KEYS_END);
  if (!completedAt && inner && inner !== o) {
    completedAt = pickFirstDate(o, DATE_KEYS_END);
  }

  const looksBlock =
    (typeof o.workflow_run_block_id === 'string' ||
      typeof o.block_workflow_run_id === 'string' ||
      typeof o.block_type === 'string' ||
      String(o.type).toLowerCase() === 'block') &&
    (label !== null || inner !== null);

  if (!looksBlock && label === null) return null;

  return { label, status, startedAt, completedAt };
}

/**
 * Deep-walk timeline JSON and collect block-like rows with optional timestamps.
 */
export function collectSkyvernTimelineEnrichedBlocks(root: unknown): SkyvernTimelineBlockEnriched[] {
  const out: SkyvernTimelineBlockEnriched[] = [];

  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const row = enrichBlockLike(o);
    if (row) out.push(row);
    for (const v of Object.values(o)) {
      if (v !== null && typeof v === 'object') walk(v);
    }
  };

  walk(root);
  return out;
}

/**
 * Align enriched rows to workflow block order (`s1_nav`, …). Prefer exact label match per index.
 */
export function alignEnrichedBlocksToLabels(
  blockLabels: string[],
  enriched: SkyvernTimelineBlockEnriched[],
): SkyvernTimelineBlockEnriched[] {
  const n = blockLabels.length;
  const out: SkyvernTimelineBlockEnriched[] = [];
  const used = new Set<number>();

  for (let k = 0; k < n; k++) {
    const want = blockLabels[k]!.trim();
    let bestJ = -1;
    for (let j = 0; j < enriched.length; j++) {
      if (used.has(j)) continue;
      const lab = enriched[j]!.label?.trim();
      if (lab === want) {
        bestJ = j;
        break;
      }
    }
    if (bestJ >= 0) {
      used.add(bestJ);
      out.push(enriched[bestJ]!);
    } else {
      out.push({ label: blockLabels[k] ?? null, status: null, startedAt: null, completedAt: null });
    }
  }
  return out;
}

export function durationMsExclusive(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return ms >= 0 ? Math.round(ms) : null;
}
