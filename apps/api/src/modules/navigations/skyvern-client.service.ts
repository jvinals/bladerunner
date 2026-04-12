import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SkyvernWorkflowRunStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'timed_out'
  | 'failed'
  | 'terminated'
  | 'completed'
  | 'canceled';

export interface SkyvernWorkflowRunResponse {
  run_id: string;
  status: SkyvernWorkflowRunStatus;
  failure_reason?: string | null;
  output?: unknown;
  recording_url?: string | null;
  screenshot_urls?: string[] | null;
  browser_session_id?: string | null;
  created_at?: string;
  modified_at?: string;
  finished_at?: string | null;
  /** Agent steps executed (may exceed workflow block count). */
  step_count?: number | null;
  /** URL to view this run in the Skyvern dashboard (live view while running). */
  app_url?: string | null;
}

/** `GET /v1/runs/{run_id}/artifacts` item (screenshots use `signed_url` for download). */
export interface SkyvernArtifact {
  artifact_id: string;
  artifact_type: string;
  uri: string;
  signed_url?: string | null;
  created_at?: string;
  modified_at?: string;
}

export interface SkyvernWorkflowResponse {
  /** Version-scoped id (often `wf_` / `w_`); do not use alone for `POST /v1/run/workflows`. */
  workflow_id?: string;
  /** Stable id (`wpid_…`); this is what Skyvern expects as `workflow_id` in the run request. */
  workflow_permanent_id?: string;
  title?: string;
}

/**
 * Persist and pass this to `runWorkflow` / DB: Skyvern run API expects **`workflow_permanent_id`**, not the
 * version-only `workflow_id` (see Skyvern docs: run body uses the id returned as `workflow_permanent_id`).
 */
export function skyvernPersistentWorkflowId(res: SkyvernWorkflowResponse): string {
  const permanent = res.workflow_permanent_id?.trim();
  const versioned = res.workflow_id?.trim();
  if (permanent) return permanent;
  if (versioned) return versioned;
  throw new Error('Skyvern workflow response missing workflow_permanent_id and workflow_id');
}

export type SkyvernClientOperation =
  | 'createWorkflow'
  | 'updateWorkflow'
  | 'runWorkflow'
  | 'getRun'
  | 'getRunTimeline'
  | 'cancelRun';

/** Structured failure from Skyvern HTTP API (avoids brittle string parsing for recovery logic). */
export class SkyvernClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly operation: SkyvernClientOperation,
    readonly bodySnippet: string,
  ) {
    super(message);
    this.name = 'SkyvernClientError';
  }
}

/** True when the stored workflow id is invalid for this Skyvern tenant/env (404 on sync or run). */
export function isStaleSkyvernWorkflowError(err: unknown): boolean {
  if (err instanceof SkyvernClientError) {
    if (err.status !== 404) return false;
    return err.operation === 'updateWorkflow' || err.operation === 'runWorkflow';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (!/\(404\)/.test(msg)) return false;
  return (
    /workflow_permanent_id/i.test(msg) ||
    /workflow.*not found|not found.*workflow/i.test(msg)
  );
}

/** Merge nested run envelopes and camelCase aliases so Play can read `screenshot_urls` / artifacts. */
function normalizeWorkflowRunPayload(raw: unknown): SkyvernWorkflowRunResponse | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  let merged: Record<string, unknown> = { ...o };
  for (const k of ['workflow_run', 'workflowRun'] as const) {
    const inner = o[k];
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      merged = { ...merged, ...(inner as Record<string, unknown>) };
    }
  }
  if (typeof merged.screenshot_urls === 'string') {
    const s = merged.screenshot_urls.trim();
    if (s.startsWith('[')) {
      try {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) merged.screenshot_urls = p;
      } catch {
        /* keep string */
      }
    }
    if (typeof merged.screenshot_urls === 'string' && merged.screenshot_urls.startsWith('http')) {
      merged.screenshot_urls = [merged.screenshot_urls];
    }
  }
  if (!Array.isArray(merged.screenshot_urls) && Array.isArray(merged.screenshotUrls)) {
    merged.screenshot_urls = merged.screenshotUrls;
  }
  if (merged.recording_url == null && typeof merged.recordingUrl === 'string') {
    merged.recording_url = merged.recordingUrl;
  }
  if (typeof merged.run_id !== 'string') return null;
  return merged as unknown as SkyvernWorkflowRunResponse;
}

function normalizeArtifactListPayload(raw: unknown): SkyvernArtifact[] {
  if (Array.isArray(raw)) return raw as SkyvernArtifact[];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    for (const k of ['artifacts', 'data', 'items', 'results', 'rows']) {
      const v = o[k];
      if (Array.isArray(v)) return v as SkyvernArtifact[];
    }
  }
  return [];
}

@Injectable()
export class SkyvernClientService {
  private readonly logger = new Logger(SkyvernClientService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const raw = this.config.get<string>('SKYVERN_API_BASE_URL')?.trim() || 'https://api.skyvern.com';
    return raw.replace(/\/$/, '');
  }

  private apiKey(): string | null {
    const k = this.config.get<string>('SKYVERN_API_KEY')?.trim();
    return k || null;
  }

  assertConfigured(): void {
    if (!this.apiKey()) {
      throw new BadRequestException('SKYVERN_API_KEY is not set');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
    const key = this.apiKey();
    if (!key) {
      throw new Error('SKYVERN_API_KEY is not set');
    }
    const url = `${this.baseUrl()}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        this.logger.warn(`Skyvern non-JSON response ${res.status}: ${text.slice(0, 200)}`);
      }
    }
    return { ok: res.ok, status: res.status, data, text };
  }

  async createWorkflow(jsonDefinition: Record<string, unknown>): Promise<SkyvernWorkflowResponse> {
    const { ok, status, data, text } = await this.request<SkyvernWorkflowResponse>('POST', '/v1/workflows', {
      json_definition: jsonDefinition,
    });
    if (!ok || !data) {
      throw new SkyvernClientError(
        `Skyvern create workflow failed (${status}): ${text.slice(0, 500)}`,
        status,
        'createWorkflow',
        text.slice(0, 500),
      );
    }
    try {
      skyvernPersistentWorkflowId(data);
    } catch {
      throw new SkyvernClientError(
        `Skyvern create workflow failed (${status}): ${text.slice(0, 500)}`,
        status,
        'createWorkflow',
        text.slice(0, 500),
      );
    }
    return data;
  }

  async updateWorkflow(
    workflowId: string,
    jsonDefinition: Record<string, unknown>,
  ): Promise<SkyvernWorkflowResponse> {
    const { ok, status, data, text } = await this.request<SkyvernWorkflowResponse>(
      'POST',
      `/v1/workflows/${encodeURIComponent(workflowId)}`,
      { json_definition: jsonDefinition },
    );
    if (!ok || !data) {
      throw new SkyvernClientError(
        `Skyvern update workflow failed (${status}): ${text.slice(0, 500)}`,
        status,
        'updateWorkflow',
        text.slice(0, 500),
      );
    }
    try {
      skyvernPersistentWorkflowId(data);
    } catch {
      throw new SkyvernClientError(
        `Skyvern update workflow failed (${status}): ${text.slice(0, 500)}`,
        status,
        'updateWorkflow',
        text.slice(0, 500),
      );
    }
    return data;
  }

  async runWorkflow(body: {
    workflow_id: string;
    parameters?: Record<string, unknown> | null;
    browser_address?: string | null;
    proxy_location?: string;
    title?: string | null;
  }): Promise<SkyvernWorkflowRunResponse> {
    const { ok, status, data, text } = await this.request<SkyvernWorkflowRunResponse>(
      'POST',
      '/v1/run/workflows',
      {
        workflow_id: body.workflow_id,
        parameters: body.parameters ?? {},
        browser_address: body.browser_address ?? undefined,
        proxy_location: body.proxy_location ?? 'NONE',
        title: body.title ?? undefined,
      },
    );
    if (!ok || !data?.run_id) {
      throw new SkyvernClientError(
        `Skyvern run workflow failed (${status}): ${text.slice(0, 500)}`,
        status,
        'runWorkflow',
        text.slice(0, 500),
      );
    }
    return data;
  }

  async getRun(runId: string): Promise<SkyvernWorkflowRunResponse> {
    const { ok, status, data, text } = await this.request<unknown>(
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}`,
    );
    const normalized = normalizeWorkflowRunPayload(data);
    if (!ok || !normalized?.run_id) {
      throw new SkyvernClientError(
        `Skyvern get run failed (${status}): ${text.slice(0, 500)}`,
        status,
        'getRun',
        text.slice(0, 500),
      );
    }
    return normalized;
  }

  /**
   * Block-level status while a workflow run is in flight (`GET /v1/runs/{id}` `output` is often null until the end).
   */
  async getRunTimeline(runId: string): Promise<unknown[]> {
    const { ok, status, data, text } = await this.request<unknown>(
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}/timeline`,
    );
    if (!ok) {
      this.logger.debug(`Skyvern getRunTimeline ${runId} (${status}): ${text.slice(0, 160)}`);
      return [];
    }
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const o = data as Record<string, unknown>;
      if (Array.isArray(o.timeline)) return o.timeline as unknown[];
      if (Array.isArray(o.entries)) return o.entries as unknown[];
    }
    return [];
  }

  /**
   * Live / in-run screenshots often appear here before `screenshot_urls` on `GET /v1/runs/{id}` is populated.
   */
  async listRunArtifacts(runId: string, artifactType?: string): Promise<SkyvernArtifact[]> {
    const q =
      artifactType && artifactType.trim()
        ? `?artifact_type=${encodeURIComponent(artifactType.trim())}`
        : '';
    const { ok, status, data, text } = await this.request<unknown>(
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}/artifacts${q}`,
    );
    if (!ok) {
      this.logger.debug(`Skyvern listRunArtifacts ${runId} (${status}): ${text.slice(0, 160)}`);
      return [];
    }
    return normalizeArtifactListPayload(data);
  }

  /** Fresh `signed_url` for S3 (list responses can be stale or not yet valid → HTTP404 on GET). */
  async getArtifact(artifactId: string): Promise<SkyvernArtifact | null> {
    const { ok, status, data, text } = await this.request<SkyvernArtifact>(
      'GET',
      `/v1/artifacts/${encodeURIComponent(artifactId)}`,
    );
    if (!ok || !data?.artifact_id) {
      this.logger.debug(`Skyvern getArtifact ${artifactId} (${status}): ${text.slice(0, 120)}`);
      return null;
    }
    return data;
  }

  async cancelRun(runId: string): Promise<void> {
    const { ok, status, text } = await this.request<unknown>(
      'POST',
      `/v1/runs/${encodeURIComponent(runId)}/cancel`,
      {},
    );
    if (!ok && status !== 404) {
      this.logger.warn(`Skyvern cancel run ${runId} (${status}): ${text.slice(0, 200)}`);
    }
  }
}
