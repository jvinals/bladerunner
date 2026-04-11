/**
 * Resolved API URL for browser `fetch`. Default: `/api/...` (Vite dev proxy → API). Set `VITE_API_URL`
 * (e.g. `http://127.0.0.1:3001`) to bypass the proxy — same pattern as `recordingSocket.ts`.
 */
export function buildApiUrl(path: string): string {
  const root = import.meta.env.VITE_API_URL?.trim();
  const p = path.startsWith('/') ? path : `/${path}`;
  if (root) {
    return `${root.replace(/\/$/, '')}${p}`;
  }
  return `/api${p}`;
}

function mapFetchNetworkError(path: string, err: unknown): Error {
  if (err instanceof TypeError) {
    const m = err.message || '';
    if (m === 'Failed to fetch' || m === 'Load failed' || /^networkerror /i.test(m)) {
      return new Error(
        `Network error (${m}). Ensure the API is running (port 3001), open the app from the Vite dev URL, or set VITE_API_URL=http://127.0.0.1:3001. Request: ${buildApiUrl(path)}`,
      );
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

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
  /** Pause before the first recorded step; use with advance-one to step from the start. */
  startPaused?: boolean;
};

export type AutoClerkPlaybackMode = 'default' | 'on' | 'off';

/** UI: which OTP path to request; `default` = omit body, use server env. */
export type AutoClerkOtpUiMode = 'default' | ClerkOtpMode;
export type RecordingViewportPreset = 'hd' | 'wxga' | 'fhd';
export type RecordingStreamQuality = 'low' | 'medium' | 'high';
export type RecordingStreamSmoothness = 'low' | 'medium' | 'high';
export type AiVisualIdTag = {
  number: number;
  tag: string;
  role: string | null;
  type: string | null;
  name: string;
  left: number;
  top: number;
};
export type AiVisualIdTreeNode = {
  id: string;
  role: string;
  name: string;
  value: string | null;
  description: string | null;
  attributes: Record<string, string | number | boolean>;
  tagNumber: number | null;
  children: AiVisualIdTreeNode[];
};
export type AiVisualIdTestSummary = {
  id: string;
  runId: string;
  stepSequence: number;
  provider: string;
  model: string;
  prompt: string;
  answer: string;
  pageUrl: string | null;
  createdAt: string;
};
export type AiVisualIdTestDetail = AiVisualIdTestSummary & {
  screenshotBase64: string;
  screenshotWidth: number;
  screenshotHeight: number;
  somManifest: string;
  somTags: AiVisualIdTag[];
  accessibilitySnapshot: string;
  tree: AiVisualIdTreeNode[];
  fullPrompt: string;
};
export type StartRecordingBody = {
  name: string;
  url: string;
  projectId?: string;
  viewportPreset?: RecordingViewportPreset;
  streamQuality?: RecordingStreamQuality;
  streamSmoothness?: RecordingStreamSmoothness;
};

export type StopRecordingMode = 'complete' | 'save';

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
  let res: Response;
  try {
    res = await fetch(buildApiUrl(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...auth, ...options?.headers },
    });
  } catch (e) {
    throw mapFetchNetworkError(path, e);
  }
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
  let res: Response;
  try {
    res = await fetch(buildApiUrl(path), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...auth, ...options?.headers },
    });
  } catch (e) {
    throw mapFetchNetworkError(path, e);
  }
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
  try {
    return await fetch(buildApiUrl(path), {
      ...options,
      headers: { ...auth, ...options?.headers },
    });
  } catch (e) {
    throw mapFetchNetworkError(path, e);
  }
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
  startRecording: (data: StartRecordingBody) =>
    apiFetch<{ runId: string; status: string }>('/runs/record/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteRun: (id: string) =>
    apiFetchVoid(`/runs/${id}`, {
      method: 'DELETE',
    }),
  stopRecording: (runId: string, mode: StopRecordingMode = 'complete') =>
    apiFetch<unknown>('/runs/record/stop', {
      method: 'POST',
      body: JSON.stringify({ runId, mode }),
    }),
  resumeRecording: (runId: string) =>
    apiFetch<{ runId: string; status: string }>(`/runs/${runId}/recording/resume`, {
      method: 'POST',
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
  /** Ephemeral test on active recording or playback browser session. Optional `instruction` overrides the stored prompt for this run only. `phase`: `full` (default), `generate` (vision + codegen only), `run` (execute stored code). Pass `signal` to cancel; progress arrives on the recording socket as `aiPromptTestProgress`. */
  testAiPromptStep: (
    runId: string,
    stepId: string,
    body?: { instruction?: string; phase?: 'full' | 'generate' | 'run' },
    opts?: { signal?: AbortSignal },
  ) =>
    apiFetch<{
      ok: boolean;
      playwrightCode?: string;
      error?: string;
      cancelled?: boolean;
      failureHelp?: { explanation: string; suggestedPrompt: string };
    }>(`/runs/${runId}/steps/${stepId}/test-ai-step`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      signal: opts?.signal,
    }),
  /** Best-effort abort of an in-flight test (also cancel the client `fetch` via `signal`). */
  abortAiPromptTest: (runId: string, stepId: string) =>
    apiFetch<{ ok: boolean }>(`/runs/${runId}/steps/${stepId}/abort-ai-test`, { method: 'POST' }),
  /** Active recording only: append an AI prompt step (no DOM capture). */
  appendAiPromptStepRecording: (
    runId: string,
    body: { instruction: string; excludedFromPlayback?: boolean },
  ) =>
    apiFetch<{ step: unknown }>(`/runs/${runId}/recording/ai-prompt-step`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Restore browser to state before last AI prompt Test (or prior checkpoint). */
  resetAiPromptTest: (runId: string, stepId: string) =>
    apiFetch<{ ok: boolean }>(`/runs/${runId}/steps/${stepId}/reset-ai-test`, { method: 'POST' }),
  createAiVisualIdTest: (runId: string, body: { prompt: string }) =>
    apiFetch<AiVisualIdTestDetail>(`/runs/${runId}/ai-visual-id/tests`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listAiVisualIdTests: (runId: string) =>
    apiFetch<AiVisualIdTestSummary[]>(`/runs/${runId}/ai-visual-id/tests`),
  getAiVisualIdTest: (runId: string, testId: string) =>
    apiFetch<AiVisualIdTestDetail>(`/runs/${runId}/ai-visual-id/tests/${testId}`),
  /** Active recording only: remove the most recently recorded step (e.g. cancel draft AI step). */
  deleteLastRunStepDuringRecording: (runId: string, stepId: string) =>
    apiFetchVoid(`/runs/${runId}/steps/${stepId}`, { method: 'DELETE' }),
  /** Permanently delete all steps marked skip replay; renumbers remaining steps. */
  purgeSkippedSteps: (runId: string) =>
    apiFetch<{ deleted: number }>(`/runs/${runId}/steps/purge-skipped`, { method: 'POST' }),
  /** LLM: suggest forward steps to mark skip replay after a step add/edit. */
  suggestSkipAfterChange: (runId: string, body: { anchorStepId: string }) =>
    apiFetch<{ suggestions: Array<{ stepId: string; reason: string }> }>(
      `/runs/${runId}/steps/suggest-skip-after-change`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** Mark multiple steps as skip replay (server validates vs anchor sequence). */
  bulkSkipReplay: (runId: string, body: { anchorStepId: string; stepIds: string[] }) =>
    apiFetch<{ updated: number }>(`/runs/${runId}/steps/bulk-skip-replay`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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
      const res = await fetch(buildApiUrl(`/runs/${runId}/checkpoints/${checkpointId}/thumbnail`), {
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
export type TestEmailProvider = 'MAILSLURP' | 'CLERK_TEST_EMAIL';

export const TEST_EMAIL_PROVIDERS: { value: TestEmailProvider; label: string }[] = [
  { value: 'MAILSLURP', label: 'MailSlurp' },
  { value: 'CLERK_TEST_EMAIL', label: 'Clerk Test Email' },
];

export type ProjectDto = {
  id: string;
  userId: string;
  name: string;
  kind: 'WEB' | 'IOS' | 'ANDROID';
  url: string | null;
  artifactUrl: string | null;
  color: string;
  testUserEmail: string | null;
  testUserPassword: string | null;
  testEmailProvider: TestEmailProvider | null;
  createdAt: string;
  updatedAt: string;
  /** Basename under repo `docs/logs/` after the last discovery run (API host). */
  discoveryAgentLogFile?: string | null;
};

export type CreateProjectBody = {
  name: string;
  kind?: 'WEB' | 'IOS' | 'ANDROID';
  url?: string;
  artifactUrl?: string;
  color?: string;
  testUserEmail?: string;
  testUserPassword?: string;
  testEmailProvider?: TestEmailProvider | null;
};

export type ProjectDiscoveryStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

/** Latest discovery run timeline (from `discovery_steps_json`). */
export type DiscoveryStepDto = {
  id: string;
  sequence: number;
  kind: 'orchestrator_goto' | 'orchestrator_auth' | 'llm_explore';
  title: string;
  playwrightCode?: string;
  outcome?: 'success' | 'failed' | 'blocked';
  error?: string;
  thinkingStructured?: Record<string, unknown>;
  createdAt: string;
};

export type ProjectAgentKnowledgeDto = {
  projectId: string;
  manualInstructions: string | null;
  discoveryStatus: ProjectDiscoveryStatus;
  discoveryStartedAt: string | null;
  discoveryCompletedAt: string | null;
  discoveryError: string | null;
  discoverySummaryMarkdown: string | null;
  discoveryStructured: unknown;
  discoveryNavigationMermaid: string | null;
  discoveryAgentLogFile: string | null;
  /** Ordered steps for the latest discovery run; empty when none. */
  discoverySteps?: DiscoveryStepDto[];
  updatedAt: string | null;
};

export type DiscoveryAgentLogDto = {
  filename: string;
  lines: Array<{ at: string; message: string; detail?: Record<string, unknown> }>;
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
  getAgentKnowledge: (id: string) => apiFetch<ProjectAgentKnowledgeDto>(`/projects/${id}/agent-knowledge`),
  patchAgentKnowledge: (
    id: string,
    body: {
      manualInstructions?: string | null;
      discoverySummaryMarkdown?: string | null;
      discoveryStructured?: Record<string, unknown> | null;
      discoveryNavigationMermaid?: string | null;
    },
  ) =>
    apiFetch<ProjectAgentKnowledgeDto>(`/projects/${id}/agent-knowledge`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  triggerDiscovery: (id: string) =>
    apiFetch<{ accepted: boolean; reason?: string }>(`/projects/${id}/discovery`, { method: 'POST' }),
  cancelDiscovery: (id: string) =>
    apiFetch<{ cancelled: boolean; reason?: string }>(`/projects/${id}/discovery/cancel`, { method: 'POST' }),
  getDiscoveryAgentLog: (id: string) =>
    apiFetch<DiscoveryAgentLogDto>(`/projects/${id}/discovery/agent-log`),
};

// ─── Evaluations (autonomous browser + LLM) ────────────────────────────────────
export type EvaluationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_FOR_HUMAN'
  | 'WAITING_FOR_REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type EvaluationRunMode = 'continuous' | 'step_review';

export type EvaluationProjectSummary = {
  id: string;
  name: string;
  color: string;
};

export type EvaluationRow = {
  id: string;
  name: string;
  url: string;
  projectId: string | null;
  project: EvaluationProjectSummary | null;
  /** When true, the run attempts automatic sign-in when a login screen is detected (Clerk or project test user). */
  autoSignIn: boolean;
  /** Clerk OTP path when using auto sign-in on Clerk pages; null = server default. */
  autoSignInClerkOtpMode: ClerkOtpMode | null;
  runMode: EvaluationRunMode;
  status: EvaluationStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type EvaluationStepKindApi =
  | 'llm'
  | 'orchestrator_navigate'
  | 'orchestrator_auto_sign_in';

export type EvaluationStepDto = {
  id: string;
  sequence: number;
  /** LLM codegen vs orchestrator preamble rows (navigate / auto sign-in). Omitted on older API responses. */
  stepKind?: EvaluationStepKindApi;
  pageUrl: string | null;
  stepTitle: string | null;
  progressSummaryBefore: string | null;
  codegenInputJson: unknown;
  codegenOutputJson: unknown;
  analyzerInputJson: unknown;
  analyzerOutputJson: unknown;
  thinkingText: string | null;
  proposedCode: string | null;
  expectedOutcome: string | null;
  actualOutcome: string | null;
  errorMessage: string | null;
  decision: string | null;
  analyzerRationale: string | null;
  /** Wall time for the full step (ms); absent/null for older steps or incomplete. */
  stepDurationMs?: number | null;
  createdAt: string;
};

export type EvaluationQuestionDto = {
  id: string;
  prompt: string;
  optionsJson: string;
  state: string;
  selectedIndex: number | null;
  stepSequence: number | null;
  createdAt: string;
  answeredAt: string | null;
};

export type EvaluationReportDto = {
  id: string;
  content: string;
  format: string;
  structuredJson: unknown;
  createdAt: string;
};

export type EvaluationDetail = EvaluationRow & {
  intent: string;
  desiredOutput: string;
  progressSummary: string | null;
  failureMessage: string | null;
  steps: EvaluationStepDto[];
  questions: EvaluationQuestionDto[];
  reports: EvaluationReportDto[];
};

export type StartEvaluationRunBody = {
  runMode?: EvaluationRunMode;
};

export type CreateEvaluationBody = {
  name?: string;
  url: string;
  intent: string;
  desiredOutput: string;
  /** Optional project to associate (must be one of your projects). */
  projectId?: string | null;
  autoSignIn?: boolean;
  /** Clerk OTP mode when auto sign-in hits Clerk; omit for server default. */
  autoSignInClerkOtpMode?: ClerkOtpMode | null;
};

export type UpdateEvaluationBody = {
  name?: string;
  intent?: string;
  desiredOutput?: string;
  projectId?: string | null;
  autoSignIn?: boolean;
  autoSignInClerkOtpMode?: ClerkOtpMode | null;
};

export const evaluationsApi = {
  list: () => apiFetch<EvaluationRow[]>('/evaluations'),
  create: (body: CreateEvaluationBody) =>
    apiFetch<EvaluationRow>('/evaluations', { method: 'POST', body: JSON.stringify(body) }),
  get: (id: string) => apiFetch<EvaluationDetail>(`/evaluations/${id}`),
  patch: (id: string, body: UpdateEvaluationBody) =>
    apiFetch<EvaluationDetail>(`/evaluations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  start: (id: string, body?: StartEvaluationRunBody) =>
    apiFetch<{ accepted: boolean; scheduled: boolean; evaluationId: string }>(`/evaluations/${id}/start`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  /** Clear steps/reports/questions and queue a new run (not for QUEUED first start — use `start`). */
  reprocess: (id: string, body?: StartEvaluationRunBody) =>
    apiFetch<{ accepted: boolean; scheduled: boolean; evaluationId: string }>(`/evaluations/${id}/reprocess`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  continueReview: (id: string) =>
    apiFetch<{ accepted: boolean; evaluationId: string }>(`/evaluations/${id}/continue-review`, {
      method: 'POST',
    }),
  cancel: (id: string) =>
    apiFetch<{ ok: boolean }>(`/evaluations/${id}/cancel`, { method: 'POST' }),
  humanAnswer: (id: string, body: { questionId: string; selectedIndex: number }) =>
    apiFetch<{ accepted: boolean; evaluationId: string }>(`/evaluations/${id}/human-answer`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ─── Navigations (planning records; separate from evaluations) ──────────────
export type CreateNavigationBody = CreateEvaluationBody;
export type UpdateNavigationBody = UpdateEvaluationBody & {
  runMode?: EvaluationRunMode;
};

export const navigationsApi = {
  list: () => apiFetch<EvaluationRow[]>('/navigations'),
  create: (body: CreateNavigationBody) =>
    apiFetch<EvaluationRow>('/navigations', { method: 'POST', body: JSON.stringify(body) }),
  get: (id: string) => apiFetch<EvaluationDetail>(`/navigations/${id}`),
  patch: (id: string, body: UpdateNavigationBody) =>
    apiFetch<EvaluationDetail>(`/navigations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

// ─── Settings ────────────────────────────────────────────────────────────────
export const settingsApi = {
  get: () => apiFetch<unknown>('/settings'),
  update: (data: unknown) =>
    apiFetch<unknown>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  getAgentContext: () => apiFetch<{ generalInstructions: string }>('/settings/agent-context'),
  patchAgentContext: (body: { generalInstructions?: string }) =>
    apiFetch<{ generalInstructions: string }>('/settings/agent-context', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getProviderModels: (providerId: string) =>
    apiFetch<{ providerId: string; models: Array<{ id: string; launchDate: string | null }> }>(
      `/settings/llm/models?providerId=${encodeURIComponent(providerId)}`,
    ),
  getModelDetail: (providerId: string, modelId: string) =>
    apiFetch<unknown>(
      `/settings/llm/model-detail?providerId=${encodeURIComponent(providerId)}&modelId=${encodeURIComponent(modelId)}`,
    ),
  testProviderConnection: (
    providerId: string,
    opts?: { model?: string; apiKey?: string; baseUrl?: string },
  ) =>
    apiFetch<{ ok: boolean; latencyMs: number; source: string; error?: string }>(
      '/settings/llm/test-connection',
      {
        method: 'POST',
        body: JSON.stringify({
          providerId,
          ...(opts?.model ? { model: opts.model } : {}),
          ...(opts?.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
          ...(opts?.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
        }),
      },
    ),
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
