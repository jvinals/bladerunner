import type { EvaluationDetail, EvaluationRow } from '@/lib/api';

const iso = (d: Date) => d.toISOString();

/** Built-in list rows (detail lookups use the same ids). */
export const MOCK_NAVIGATION_ROWS: EvaluationRow[] = [
  {
    id: 'nav-mock-queued',
    name: 'Sample navigation (queued)',
    url: 'https://example.com/app',
    projectId: null,
    project: null,
    autoSignIn: false,
    autoSignInClerkOtpMode: null,
    runMode: 'continuous',
    status: 'QUEUED',
    createdAt: iso(new Date('2026-01-15T12:00:00.000Z')),
    updatedAt: iso(new Date('2026-01-15T12:00:00.000Z')),
    startedAt: null,
    completedAt: null,
  },
  {
    id: 'nav-mock-completed',
    name: 'Sample navigation (completed)',
    url: 'https://example.com/dashboard',
    projectId: null,
    project: null,
    autoSignIn: false,
    autoSignInClerkOtpMode: null,
    runMode: 'continuous',
    status: 'COMPLETED',
    createdAt: iso(new Date('2026-01-10T09:30:00.000Z')),
    updatedAt: iso(new Date('2026-01-12T16:00:00.000Z')),
    startedAt: iso(new Date('2026-01-11T10:00:00.000Z')),
    completedAt: iso(new Date('2026-01-12T15:59:00.000Z')),
  },
];

const MOCK_DETAILS: Record<string, EvaluationDetail> = {
  'nav-mock-queued': {
    ...MOCK_NAVIGATION_ROWS[0],
    intent: 'Map primary flows from the landing page.',
    desiredOutput: 'A short outline of top-level routes and entry points.',
    progressSummary: null,
    failureMessage: null,
    steps: [],
    questions: [],
    reports: [],
  },
  'nav-mock-completed': {
    ...MOCK_NAVIGATION_ROWS[1],
    intent: 'Verify dashboard loads and sidebar links work.',
    desiredOutput: 'Pass/fail per main nav item.',
    progressSummary: null,
    failureMessage: null,
    steps: [],
    questions: [],
    reports: [
      {
        id: 'nav-report-sample',
        content: 'Mock report: wiring not connected; replace with real run output.',
        format: 'markdown',
        structuredJson: null,
        createdAt: iso(new Date('2026-01-12T15:59:00.000Z')),
      },
    ],
  },
};

export function getMockNavigationDetail(id: string): EvaluationDetail | null {
  return MOCK_DETAILS[id] ?? null;
}

/** Ephemeral client-only rows (until backend); survives route changes in-session. */
let clientRows: EvaluationRow[] = [];
let clientDetails: Record<string, EvaluationDetail> = {};

export function getAllNavigationRows(): EvaluationRow[] {
  return [...MOCK_NAVIGATION_ROWS, ...clientRows];
}

/** Resolves built-in mocks + client-registered navigations. */
export function getNavigationDetailForPage(id: string): EvaluationDetail | null {
  return getMockNavigationDetail(id) ?? clientDetails[id] ?? null;
}

export function registerClientNavigation(row: EvaluationRow, detail: EvaluationDetail): void {
  clientRows = [...clientRows, row];
  clientDetails = { ...clientDetails, [row.id]: detail };
}

/** Client-only “create navigation” rows share this shape until a backend exists. */
export function buildClientNavigationDetail(
  row: EvaluationRow,
  intent: string,
  desiredOutput: string,
): EvaluationDetail {
  return {
    ...row,
    intent,
    desiredOutput,
    progressSummary: null,
    failureMessage: null,
    steps: [],
    questions: [],
    reports: [],
  };
}
