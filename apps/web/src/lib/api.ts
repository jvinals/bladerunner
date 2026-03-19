const API_BASE = '/api';

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
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
  startRecording: (data: { name: string; url: string }) =>
    apiFetch<{ runId: string; status: string }>('/runs/record/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  stopRecording: (runId: string) =>
    apiFetch<unknown>('/runs/record/stop', {
      method: 'POST',
      body: JSON.stringify({ runId }),
    }),
  instruct: (runId: string, instruction: string) =>
    apiFetch<{ step: unknown }>(`/runs/${runId}/instruct`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    }),
};

// ─── Projects ────────────────────────────────────────────────────────────────
export const projectsApi = {
  list: () => apiFetch<unknown[]>('/projects'),
  get: (id: string) => apiFetch<unknown>(`/projects/${id}`),
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
