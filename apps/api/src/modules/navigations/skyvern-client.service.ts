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
}

export interface SkyvernWorkflowResponse {
  workflow_id: string;
  title?: string;
}

/** True when Skyvern says the stored workflow id no longer exists (wrong env, deleted, or new API key). */
export function isStaleSkyvernWorkflowError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/\(404\)/.test(msg)) return false;
  return /workflow.*not found|not found.*workflow/i.test(msg);
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
    if (!ok || !data?.workflow_id) {
      throw new Error(`Skyvern create workflow failed (${status}): ${text.slice(0, 500)}`);
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
    if (!ok || !data?.workflow_id) {
      throw new Error(`Skyvern update workflow failed (${status}): ${text.slice(0, 500)}`);
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
      throw new Error(`Skyvern run workflow failed (${status}): ${text.slice(0, 500)}`);
    }
    return data;
  }

  async getRun(runId: string): Promise<SkyvernWorkflowRunResponse> {
    const { ok, status, data, text } = await this.request<SkyvernWorkflowRunResponse>(
      'GET',
      `/v1/runs/${encodeURIComponent(runId)}`,
    );
    if (!ok || !data?.run_id) {
      throw new Error(`Skyvern get run failed (${status}): ${text.slice(0, 500)}`);
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
