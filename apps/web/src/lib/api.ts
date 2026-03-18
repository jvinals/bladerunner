const API_BASE = '/api';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    throw new Error(`API Error: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
