const API_BASE = '/api';

/** Clerk email OTP automation during auto sign-in (playback + recording). */
export type ClerkOtpMode = 'clerk_test_email' | 'mailslurp';

/** Body for `POST /runs/:id/playback/start` */
export type StartPlaybackBody = {
  delayMs?: number;
  autoClerkSignIn?: boolean;
  /** Omit to use server `PLAYBACK_CLERK_OTP_MODE` (defaults to mailslurp when unset). */
  clerkOtpMode?: ClerkOtpMode;
  skipUntilSequence?: number;
  skipStepIds?: string[];
  /** Stop after this step sequence (inclusive). Pair with `skipUntilSequence` to play one step only. */
  playThroughSequence?: number;
};

export type AutoClerkPlaybackMode = 'default' | 'on' | 'off';

/** UI: which OTP path to request; `default` = omit body, use server env. */
export type AutoClerkOtpUiMode = 'default' | ClerkOtpMode;

export function buildStartPlaybackBody(params: {
  delayMs?: number;
  autoClerkMode?: AutoClerkPlaybackMode;
  clerkOtpMode?: AutoClerkOtpUiMode;
  /** Skip steps with sequence strictly less than this (legacy runs). */
  skipUntilSequence?: number;
  /** Stop playback after this step sequence (inclusive). */
  playThroughSequence?: number;
}): StartPlaybackBody {
  const out: StartPlaybackBody = {};
  if (params.delayMs != null) out.delayMs = params.delayMs;
  if (params.autoClerkMode === 'on') out.autoClerkSignIn = true;
  if (params.autoClerkMode === 'off') out.autoClerkSignIn = false;
  if (params.clerkOtpMode && params.clerkOtpMode !== 'default') {
    out.clerkOtpMode = params.clerkOtpMode;
  }
  if (
    typeof params.skipUntilSequence === 'number' &&
    Number.isFinite(params.skipUntilSequence) &&
    params.skipUntilSequence >= 0
  ) {
    out.skipUntilSequence = Math.floor(params.skipUntilSequence);
  }
  if (
    typeof params.playThroughSequence === 'number' &&
    Number.isFinite(params.playThroughSequence) &&
    params.playThroughSequence >= 0
  ) {
    out.playThroughSequence = Math.floor(params.playThroughSequence);
  }
  return out;
}

/** Build `POST .../playback/start` body from a server playback snapshot (e.g. `GET /runs/playback/:id`). */
export function playbackBodyFromSnapshot(s: {
  delayMs: number;
  wantAutoClerkSignIn: boolean;
  clerkOtpMode: ClerkOtpMode;
  skipUntilSequence?: number;
  skipStepIds?: string[];
  playThroughSequence?: number;
}): StartPlaybackBody {
  const out: StartPlaybackBody = {
    delayMs: s.delayMs,
    autoClerkSignIn: s.wantAutoClerkSignIn,
    clerkOtpMode: s.clerkOtpMode,
  };
  if (
    typeof s.skipUntilSequence === 'number' &&
    Number.isFinite(s.skipUntilSequence) &&
    s.skipUntilSequence >= 0
  ) {
    out.skipUntilSequence = Math.floor(s.skipUntilSequence);
  }
  if (s.skipStepIds?.length) out.skipStepIds = s.skipStepIds;
  if (
    typeof s.playThroughSequence === 'number' &&
    Number.isFinite(s.playThroughSequence) &&
    s.playThroughSequence >= 0
  ) {
    out.playThroughSequence = Math.floor(s.playThroughSequence);
  }
  return out;
}

let _getToken: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>) {
  _getToken = fn;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await _getToken?.();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...auth, ...options?.headers },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const ct = res.headers.get('content-type');
      if (ct?.includes('application/json')) {
        const body = (await res.json()) as { message?: string | string[] };
        if (Array.isArray(body.message)) detail = body.message.join(', ');
        else if (typeof body.message === 'string') detail = body.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(
      detail
        ? `API Error: ${res.status} ${res.statusText} — ${detail}`
        : `API Error: ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

/** DELETE/204 responses with no JSON body */
export async function apiFetchVoid(path: string, options?: RequestInit): Promise<void> {
  const auth = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...auth, ...options?.headers },
  });
  if (!res.ok) {
    let detail = '';
    try {
      const ct = res.headers.get('content-type');
      if (ct?.includes('application/json')) {
        const body = (await res.json()) as { message?: string | string[] };
        if (Array.isArray(body.message)) detail = body.message.join(', ');
        else if (typeof body.message === 'string') detail = body.message;
      }
    } catch {
      /* ignore */
    }
    throw new Error(
      detail
        ? `API Error: ${res.status} ${res.statusText} — ${detail}`
        : `API Error: ${res.status} ${res.statusText}`,
    );
  }
}

export async function apiFetchRaw(path: string, options?: RequestInit): Promise<Response> {
  const auth = await authHeaders();
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...auth, ...options?.headers },
  });
}

// ─── Runs ────────────────────────────────────────────────────────────────────
export const runsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return apiFetch<{
      data: unknown[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }>(`/runs${qs}`);
  },
  get: (id: string) => apiFetch<unknown>(`/runs/${id}`),
  getFindings: (id: string) => apiFetch<unknown[]>(`/runs/${id}/findings`),
  getSteps: (id: string) => apiFetch<unknown[]>(`/runs/${id}/steps`),
  getStatus: (id: string) => apiFetch<{ runId: string; status: string; stepsCount: number; durationMs: number | null }>(`/runs/${id}/status`),
  getScreenshot: (id: string) => apiFetchRaw(`/runs/${id}/screenshot`),
  getDashboard: () => apiFetch<{
    totalRuns: number;
    passRate: number;
    avgDuration: number;
    activeAgents: number;
    findingsCount: number;
    runsToday: number;
    runsTrend: number;
    passRateTrend: number;
  }>('/runs/dashboard'),
  startRecording: (data: { name: string; url: string; projectId?: string }) =>
    apiFetch<{ runId: string; status: string }>('/runs/record/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteRun: (id: string) =>
    apiFetchVoid(`/runs/${id}`, {
      method: 'DELETE',
    }),
  stopRecording: (runId: string) =>
    apiFetch<unknown>('/runs/record/stop', {
      method: 'POST',
      body: JSON.stringify({ runId }),
    }),
  /** Active recording only: server runs Clerk auto sign-in on the remote browser; appends a tagged step. */
  clerkAutoSignInRecording: (runId: string, body?: { clerkOtpMode?: ClerkOtpMode }) =>
    apiFetch<{ ok: boolean; step: unknown }>(`/runs/${runId}/recording/clerk-auto-sign-in`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  instruct: (runId: string, instruction: string) =>
    apiFetch<{ step: unknown }>(`/runs/${runId}/instruct`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }),
  /** Active recording only: re-run LLM + Playwright for one step; updates the step row in place. */
  reRecordStep: (runId: string, stepId: string, instruction: string) =>
    apiFetch<{ step: unknown }>(`/runs/${runId}/steps/${stepId}/re-record`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }),
  /** Update instruction and/or enable/disable AI prompt mode (LLM + vision at playback). */
  patchRunStep: (
    runId: string,
    stepId: string,
    body: { instruction?: string; aiPromptMode?: boolean; excludedFromPlayback?: boolean },
  ) =>
    apiFetch<{ step: unknown }>(`/runs/${runId}/steps/${stepId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  /** Ephemeral test on active recording or playback browser session. */
  testAiPromptStep: (runId: string, stepId: string) =>
    apiFetch<{ ok: boolean; playwrightCode?: string; error?: string }>(
      `/runs/${runId}/steps/${stepId}/test-ai-step`,
      { method: 'POST' },
    ),
  /** Permanently delete all steps marked skip replay; renumbers remaining steps. */
  purgeSkippedSteps: (runId: string) =>
    apiFetch<{ deleted: number }>(`/runs/${runId}/steps/purge-skipped`, { method: 'POST' }),
  startPlayback: (runId: string, opts?: StartPlaybackBody) =>
    apiFetch<{ playbackSessionId: string; sourceRunId: string }>(`/runs/${runId}/playback/start`, {
      method: 'POST',
      body: JSON.stringify(opts && Object.keys(opts).length > 0 ? opts : {}),
    }),
  stopPlayback: (playbackSessionId: string) =>
    apiFetch<{ ok: boolean }>('/runs/playback/stop', {
      method: 'POST',
      body: JSON.stringify({ playbackSessionId }),
    }),
  pausePlayback: (playbackSessionId: string) =>
    apiFetch<{ ok: boolean }>('/runs/playback/pause', {
      method: 'POST',
      body: JSON.stringify({ playbackSessionId }),
    }),
  resumePlayback: (playbackSessionId: string) =>
    apiFetch<{ ok: boolean }>('/runs/playback/resume', {
      method: 'POST',
      body: JSON.stringify({ playbackSessionId }),
    }),
  /** While paused: run one step, then pause again */
  advancePlaybackOne: (playbackSessionId: string) =>
    apiFetch<{ ok: boolean }>('/runs/playback/advance-one', {
      method: 'POST',
      body: JSON.stringify({ playbackSessionId }),
    }),
  /** While paused: run until `stopAfterSequence` completes, then pause */
  advancePlaybackTo: (playbackSessionId: string, stopAfterSequence: number) =>
    apiFetch<{ ok: boolean }>('/runs/playback/advance-to', {
      method: 'POST',
      body: JSON.stringify({ playbackSessionId, stopAfterSequence }),
    }),
  /** Stop and start a new playback with the same options; returns new session ids */
  restartPlayback: (playbackSessionId: string) =>
    apiFetch<{ playbackSessionId: string; sourceRunId: string }>('/runs/playback/restart', {
      method: 'POST',
      body: JSON.stringify({ playbackSessionId }),
    }),
  getPlaybackSession: (playbackSessionId: string) =>
    apiFetch<{
      playbackSessionId: string;
      paused: boolean;
      sourceRunId: string;
      delayMs: number;
      wantAutoClerkSignIn: boolean;
      clerkOtpMode: ClerkOtpMode;
      skipUntilSequence?: number;
      skipStepIds?: string[];
      playThroughSequence?: number;
    }>(`/runs/playback/${encodeURIComponent(playbackSessionId)}`),
  /** App-state checkpoints (storage snapshots after each step while recording). */
  getCheckpoints: (runId: string) =>
    apiFetch<
      Array<{
        id: string;
        afterStepSequence: number;
        label: string;
        pageUrl: string | null;
        storageStatePath: string | null;
        thumbnailPath: string | null;
        createdAt: string;
      }>
    >(`/runs/${runId}/checkpoints`),
  /** Authenticated JPEG thumbnail for a checkpoint (returns blob URL). */
  getCheckpointThumbnailUrl: async (runId: string, checkpointId: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/runs/${runId}/checkpoints/${checkpointId}/thumbnail`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  },
};

// ─── Projects ────────────────────────────────────────────────────────────────
export type ProjectDto = {
  id: string;
  userId: string;
  name: string;
  kind: 'WEB' | 'IOS' | 'ANDROID';
  url: string | null;
  artifactUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectBody = {
  name: string;
  kind?: 'WEB' | 'IOS' | 'ANDROID';
  url?: string;
  artifactUrl?: string;
};

export const projectsApi = {
  list: () => apiFetch<ProjectDto[]>('/projects'),
  get: (id: string) => apiFetch<ProjectDto>(`/projects/${id}`),
  create: (body: CreateProjectBody) =>
    apiFetch<ProjectDto>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<CreateProjectBody>) =>
    apiFetch<ProjectDto>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (id: string) =>
    apiFetchVoid(`/projects/${id}`, {
      method: 'DELETE',
    }),
};

// ─── Settings ────────────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => apiFetch<unknown>('/settings'),
  update: (data: unknown) =>
    apiFetch<unknown>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ─── Integrations ────────────────────────────────────────────────────────────
export const integrationsApi = {
  list: () => apiFetch<unknown[]>('/integrations'),
};

// ─── Agents ──────────────────────────────────────────────────────────────────
export const agentsApi = {
  list: () => apiFetch<unknown[]>('/agents'),
};

// ─── Health ──────────────────────────────────────────────────────────────────
export const healthApi = {
  check: () => apiFetch<{ status: string; version: string; timestamp: string }>('/health'),
};
