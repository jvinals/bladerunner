import { Injectable } from '@nestjs/common';

// ─── Mock Data — Realistic seed data for the Bladerunner scaffold ────────────

const MOCK_RUNS = [
  {
    id: 'run_01HQ7K2M3N4P5R6S',
    projectId: 'proj_edgehealth_portal',
    name: 'Patient Dashboard — Full Flow',
    description: 'End-to-end verification of the patient dashboard including login, navigation, and data display',
    status: 'passed',
    platform: 'desktop',
    triggeredBy: 'CI/CD Pipeline',
    startedAt: '2026-03-18T10:30:00Z',
    completedAt: '2026-03-18T10:34:22Z',
    durationMs: 262000,
    targets: [
      { id: 'tgt_01', runId: 'run_01HQ7K2M3N4P5R6S', platform: 'desktop', deviceName: 'Chrome 122', browserOrApp: 'Chrome', resolution: '1920x1080', os: 'macOS 14', status: 'passed' },
    ],
    stepsCount: 12,
    passedSteps: 12,
    failedSteps: 0,
    findingsCount: 0,
    artifactsCount: 14,
    tags: ['regression', 'dashboard', 'critical-path'],
    createdAt: '2026-03-18T10:29:55Z',
    updatedAt: '2026-03-18T10:34:22Z',
  },
  {
    id: 'run_02JR8L3N4O5Q6T7U',
    projectId: 'proj_edgehealth_portal',
    name: 'Appointment Booking — Mobile',
    description: 'Visual accuracy and UX smoothness check for the mobile appointment booking flow',
    status: 'failed',
    platform: 'mobile',
    triggeredBy: 'Manual — Dr. Martinez',
    startedAt: '2026-03-18T11:15:00Z',
    completedAt: '2026-03-18T11:19:45Z',
    durationMs: 285000,
    targets: [
      { id: 'tgt_02', runId: 'run_02JR8L3N4O5Q6T7U', platform: 'mobile', deviceName: 'iPhone 15 Pro', browserOrApp: 'Safari', resolution: '393x852', os: 'iOS 18', status: 'failed' },
    ],
    stepsCount: 8,
    passedSteps: 5,
    failedSteps: 3,
    findingsCount: 4,
    artifactsCount: 10,
    tags: ['booking', 'mobile', 'visual-check'],
    createdAt: '2026-03-18T11:14:50Z',
    updatedAt: '2026-03-18T11:19:45Z',
  },
  {
    id: 'run_03KS9M4O5P6R7V8W',
    projectId: 'proj_edgehealth_portal',
    name: 'Settings Page — Style Consistency',
    description: 'Style guide compliance check for settings page components',
    status: 'needs_review',
    platform: 'desktop',
    triggeredBy: 'Agent Loop — Iteration 3',
    startedAt: '2026-03-18T13:00:00Z',
    completedAt: '2026-03-18T13:02:15Z',
    durationMs: 135000,
    targets: [
      { id: 'tgt_03', runId: 'run_03KS9M4O5P6R7V8W', platform: 'desktop', deviceName: 'Firefox 124', browserOrApp: 'Firefox', resolution: '1440x900', os: 'Windows 11', status: 'needs_review' },
    ],
    stepsCount: 6,
    passedSteps: 4,
    failedSteps: 0,
    findingsCount: 2,
    artifactsCount: 8,
    tags: ['style-check', 'settings', 'agent-driven'],
    createdAt: '2026-03-18T12:59:55Z',
    updatedAt: '2026-03-18T13:02:15Z',
  },
  {
    id: 'run_04LT0N5P6Q7S8X9Y',
    projectId: 'proj_edgehealth_mobile',
    name: 'PWA Install Flow — Android',
    description: 'Validate PWA installability and offline-ready state on Android Chrome',
    status: 'running',
    platform: 'pwa',
    triggeredBy: 'CI/CD Pipeline',
    startedAt: '2026-03-18T14:45:00Z',
    completedAt: undefined,
    durationMs: undefined,
    targets: [
      { id: 'tgt_04', runId: 'run_04LT0N5P6Q7S8X9Y', platform: 'pwa', deviceName: 'Pixel 8', browserOrApp: 'Chrome', resolution: '412x915', os: 'Android 15', status: 'running' },
    ],
    stepsCount: 10,
    passedSteps: 6,
    failedSteps: 0,
    findingsCount: 0,
    artifactsCount: 6,
    tags: ['pwa', 'install', 'android'],
    createdAt: '2026-03-18T14:44:55Z',
    updatedAt: '2026-03-18T14:48:30Z',
  },
  {
    id: 'run_05MU1O6Q7R8T9Z0A',
    projectId: 'proj_edgehealth_portal',
    name: 'Billing Module — Demo Ready',
    description: 'Pre-demo verification run ensuring billing module is presentation-ready',
    status: 'queued',
    platform: 'desktop',
    triggeredBy: 'Manual — Product Team',
    startedAt: undefined,
    completedAt: undefined,
    durationMs: undefined,
    targets: [],
    stepsCount: 15,
    passedSteps: 0,
    failedSteps: 0,
    findingsCount: 0,
    artifactsCount: 0,
    tags: ['demo-prep', 'billing', 'priority'],
    createdAt: '2026-03-18T15:00:00Z',
    updatedAt: '2026-03-18T15:00:00Z',
  },
  {
    id: 'run_06NV2P7R8S9U0B1C',
    projectId: 'proj_edgehealth_portal',
    name: 'Login — Cross-Browser',
    description: 'Cross-browser validation of the authentication flow',
    status: 'passed',
    platform: 'desktop',
    triggeredBy: 'CI/CD Pipeline',
    startedAt: '2026-03-17T09:00:00Z',
    completedAt: '2026-03-17T09:05:30Z',
    durationMs: 330000,
    targets: [
      { id: 'tgt_05', runId: 'run_06NV2P7R8S9U0B1C', platform: 'desktop', deviceName: 'Chrome 122', browserOrApp: 'Chrome', resolution: '1920x1080', os: 'macOS 14', status: 'passed' },
      { id: 'tgt_06', runId: 'run_06NV2P7R8S9U0B1C', platform: 'desktop', deviceName: 'Firefox 124', browserOrApp: 'Firefox', resolution: '1920x1080', os: 'Windows 11', status: 'passed' },
    ],
    stepsCount: 8,
    passedSteps: 8,
    failedSteps: 0,
    findingsCount: 0,
    artifactsCount: 18,
    tags: ['auth', 'cross-browser', 'regression'],
    createdAt: '2026-03-17T08:59:50Z',
    updatedAt: '2026-03-17T09:05:30Z',
  },
];

const MOCK_FINDINGS = [
  {
    id: 'find_01',
    runId: 'run_02JR8L3N4O5Q6T7U',
    stepId: 'step_04',
    category: 'visual_accuracy',
    severity: 'critical',
    title: 'Calendar picker overlaps navigation bar',
    description: 'On iPhone 15 Pro, the date picker modal extends beyond the viewport and overlaps with the bottom navigation bar, making it impossible to select dates in the last row.',
    expected: 'Calendar picker should be contained within the viewport with proper safe area insets',
    actual: 'Calendar extends 24px below the safe area, overlapping the tab bar',
    suggestion: 'Add safe-area-inset-bottom padding to the calendar container',
    resolved: false,
    createdAt: '2026-03-18T11:17:30Z',
  },
  {
    id: 'find_02',
    runId: 'run_02JR8L3N4O5Q6T7U',
    stepId: 'step_06',
    category: 'style_consistency',
    severity: 'warning',
    title: 'Confirmation button uses incorrect border radius',
    description: 'The "Confirm Booking" button uses border-radius: 12px instead of the Edgehealth standard 6px for buttons.',
    expected: 'border-radius: 6px (per Edgehealth Style Guide)',
    actual: 'border-radius: 12px',
    suggestion: 'Update to rounded-md (6px) per the Edgehealth design system',
    resolved: false,
    createdAt: '2026-03-18T11:18:10Z',
  },
  {
    id: 'find_03',
    runId: 'run_02JR8L3N4O5Q6T7U',
    stepId: 'step_07',
    category: 'ux_friction',
    severity: 'warning',
    title: 'No loading indicator during booking submission',
    description: 'After tapping "Confirm", there is no visual feedback for 1.8 seconds while the booking is being processed, leading users to tap multiple times.',
    suggestion: 'Add a spinner or disable the button with loading state during submission',
    resolved: false,
    createdAt: '2026-03-18T11:19:00Z',
  },
  {
    id: 'find_04',
    runId: 'run_03KS9M4O5P6R7V8W',
    stepId: 'step_03',
    category: 'style_consistency',
    severity: 'info',
    title: 'Section headers use gray-600 instead of Primary Blue',
    description: 'Settings section headers use text-gray-600 instead of the ce-section-label pattern (11px, semibold, tracking-wider, uppercase, text-[#4B90FF]).',
    suggestion: 'Apply the ce-section-label class to all settings section headers',
    resolved: false,
    createdAt: '2026-03-18T13:01:30Z',
  },
];

@Injectable()
export class RunsService {
  private runs = [...MOCK_RUNS];
  private findings = [...MOCK_FINDINGS];

  findAll(query?: { status?: string; platform?: string; search?: string; page?: number; pageSize?: number }) {
    let filtered = [...this.runs];

    if (query?.status) {
      filtered = filtered.filter((r) => r.status === query.status);
    }
    if (query?.platform) {
      filtered = filtered.filter((r) => r.platform === query.platform);
    }
    if (query?.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(term) ||
          r.description?.toLowerCase().includes(term) ||
          r.tags.some((t) => t.includes(term)),
      );
    }

    const page = query?.page || 1;
    const pageSize = query?.pageSize || 20;
    const total = filtered.length;
    const data = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  findOne(id: string) {
    return this.runs.find((r) => r.id === id) || null;
  }

  findFindings(runId: string) {
    return this.findings.filter((f) => f.runId === runId);
  }

  create(data: { name: string; projectId: string; platform: string; description?: string; tags?: string[] }) {
    const run = {
      id: `run_${Date.now()}`,
      projectId: data.projectId,
      name: data.name,
      description: data.description,
      status: 'queued' as const,
      platform: data.platform,
      triggeredBy: 'Manual',
      startedAt: undefined,
      completedAt: undefined,
      durationMs: undefined,
      targets: [],
      stepsCount: 0,
      passedSteps: 0,
      failedSteps: 0,
      findingsCount: 0,
      artifactsCount: 0,
      tags: data.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.runs.unshift(run);
    return run;
  }

  getDashboardKpis() {
    const totalRuns = this.runs.length;
    const passed = this.runs.filter((r) => r.status === 'passed').length;
    const passRate = totalRuns > 0 ? Math.round((passed / totalRuns) * 100) : 0;
    const completed = this.runs.filter((r) => r.durationMs);
    const avgDuration = completed.length > 0
      ? Math.round(completed.reduce((sum, r) => sum + (r.durationMs || 0), 0) / completed.length)
      : 0;

    return {
      totalRuns,
      passRate,
      avgDuration,
      activeAgents: 3,
      findingsCount: this.findings.length,
      runsToday: 4,
      runsTrend: 12,
      passRateTrend: 5,
    };
  }
}
