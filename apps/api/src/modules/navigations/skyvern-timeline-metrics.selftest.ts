/**
 * Quick sanity check for timeline enrichment (run: pnpm --filter @bladerunner/api exec tsx src/modules/navigations/skyvern-timeline-metrics.selftest.ts)
 */
import {
  alignEnrichedBlocksToLabels,
  collectSkyvernTimelineEnrichedBlocks,
  durationMsExclusive,
} from './skyvern-timeline-metrics';

const timeline = [
  {
    type: 'block',
    block: {
      label: 's1_nav',
      status: 'completed',
      started_at: '2026-04-14T10:00:00.000Z',
      completed_at: '2026-04-14T10:00:05.000Z',
    },
  },
];

const enriched = collectSkyvernTimelineEnrichedBlocks(timeline);
if (enriched.length < 1) throw new Error('expected at least one block');
const aligned = alignEnrichedBlocksToLabels(['s1_nav', 's2_click'], enriched);
if (aligned.length !== 2) throw new Error('aligned length');
const ms = durationMsExclusive(aligned[0]!.startedAt, aligned[0]!.completedAt);
if (ms !== 5000) throw new Error(`duration ${ms}`);
console.log('skyvern-timeline-metrics.selftest ok');
