// ─── Bladerunner by Edgehealth — Shared Domain Types ─────────────────────────

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum RunStatus {
  Queued = 'queued',
  Running = 'running',
  Passed = 'passed',
  Failed = 'failed',
  NeedsReview = 'needs_review',
  Cancelled = 'cancelled',
}

export enum PlatformType {
  Desktop = 'desktop',
  Mobile = 'mobile',
  PWA = 'pwa',
}

export enum FindingSeverity {
  Critical = 'critical',
  Warning = 'warning',
  Info = 'info',
  Suggestion = 'suggestion',
}

export enum FindingCategory {
  VisualAccuracy = 'visual_accuracy',
  StyleConsistency = 'style_consistency',
  UXFriction = 'ux_friction',
  Performance = 'performance',
  Accessibility = 'accessibility',
  Blocker = 'blocker',
}

export enum ArtifactType {
  Screenshot = 'screenshot',
  Video = 'video',
  Log = 'log',
  Trace = 'trace',
  Summary = 'summary',
  Diff = 'diff',
}

export enum IntegrationStatus {
  Active = 'active',
  Inactive = 'inactive',
  Pending = 'pending',
  Error = 'error',
}

export enum AgentStatus {
  Online = 'online',
  Offline = 'offline',
  Busy = 'busy',
  Error = 'error',
}

export enum EnvironmentType {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Preview = 'preview',
}

// ─── Core Entities ───────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  repositoryUrl?: string;
  defaultBranch?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: RunStatus;
  platform: PlatformType;
  triggeredBy: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  targets: RunTarget[];
  stepsCount: number;
  passedSteps: number;
  failedSteps: number;
  findingsCount: number;
  artifactsCount: number;
  tags: string[];
  metadata?: Record<string, unknown>;
  orchestratorRunId?: string; // future: link to orchestrator
  createdAt: string;
  updatedAt: string;
}

export interface RunTarget {
  id: string;
  runId: string;
  platform: PlatformType;
  deviceName: string;
  browserOrApp?: string;
  resolution?: string;
  os?: string;
  status: RunStatus;
}

export interface RunStep {
  id: string;
  runId: string;
  targetId: string;
  sequence: number;
  name: string;
  description?: string;
  status: RunStatus;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  screenshotUrl?: string;
  error?: string;
}

export interface Artifact {
  id: string;
  runId: string;
  stepId?: string;
  type: ArtifactType;
  name: string;
  url: string;
  sizeBytes?: number;
  mimeType?: string;
  createdAt: string;
}

export interface Finding {
  id: string;
  runId: string;
  stepId?: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  screenshotUrl?: string;
  expected?: string;
  actual?: string;
  suggestion?: string;
  resolved: boolean;
  createdAt: string;
}

export interface Integration {
  id: string;
  workspaceId: string;
  name: string;
  type: string; // e.g., 'github', 'slack', 'orchestrator', 'ci_cd'
  status: IntegrationStatus;
  config?: Record<string, unknown>;
  lastSyncAt?: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  type: string; // e.g., 'browser', 'mobile', 'desktop'
  status: AgentStatus;
  version?: string;
  lastHeartbeatAt?: string;
  capabilities: string[];
  currentRunId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  type: EnvironmentType;
  baseUrl: string;
  variables?: Record<string, string>;
  isDefault: boolean;
  createdAt: string;
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  timestamp: string;
  services: Record<string, 'ok' | 'degraded' | 'down'>;
}

// ─── Dashboard Types ─────────────────────────────────────────────────────────

export interface DashboardKPIs {
  totalRuns: number;
  passRate: number;
  avgDuration: number;
  activeAgents: number;
  findingsCount: number;
  runsToday: number;
  runsTrend: number; // percentage change
  passRateTrend: number;
}

export interface SystemStatus {
  api: 'operational' | 'degraded' | 'down';
  agents: 'operational' | 'degraded' | 'down';
  orchestrator: 'operational' | 'degraded' | 'down' | 'not_configured';
  storage: 'operational' | 'degraded' | 'down';
}

// ─── Settings Types ──────────────────────────────────────────────────────────

export interface WorkspaceSettings {
  workspace: Workspace;
  defaultPlatform: PlatformType;
  notificationsEnabled: boolean;
  slackWebhookUrl?: string;
  retentionDays: number;
}

// ─── Recording Types ─────────────────────────────────────────────────────────

export enum RecordingRunStatus {
  Recording = 'RECORDING',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
  Cancelled = 'CANCELLED',
}

export enum StepAction {
  Navigate = 'NAVIGATE',
  Click = 'CLICK',
  Type = 'TYPE',
  Scroll = 'SCROLL',
  Select = 'SELECT',
  Hover = 'HOVER',
  Screenshot = 'SCREENSHOT',
  Assert = 'ASSERT',
  Wait = 'WAIT',
  Custom = 'CUSTOM',
}

export enum StepOrigin {
  Manual = 'MANUAL',
  AiDriven = 'AI_DRIVEN',
  /** Prompt-only: playback uses LLM + vision on live DOM; not stored Playwright replay. */
  AiPrompt = 'AI_PROMPT',
  Automatic = 'AUTOMATIC',
}

/** `RunStep.metadata` when `origin` is `AI_PROMPT` (see API README). */
export interface AiPromptStepMetadata {
  kind: 'ai_prompt_step';
  schemaVersion: 1;
  lastTestAt?: string;
  lastTestOk?: boolean;
}

export interface RecordingRun {
  id: string;
  userId: string;
  name: string;
  url: string;
  status: RecordingRunStatus;
  platform: PlatformType;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  steps?: RecordedStep[];
}

export interface RecordedStep {
  id: string;
  runId: string;
  userId: string;
  sequence: number;
  action: StepAction;
  selector?: string;
  value?: string;
  instruction: string;
  playwrightCode: string;
  origin: StepOrigin;
  durationMs?: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
  /** When true, replay skips this step (row kept for audit). */
  excludedFromPlayback?: boolean;
  createdAt: string;
}

export interface RunRecording {
  id: string;
  runId: string;
  userId: string;
  format: string;
  url?: string;
  sizeBytes?: number;
  createdAt: string;
}
