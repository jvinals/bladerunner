import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  HttpException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page, CDPSession } from 'playwright-core';
import sharp from 'sharp';
import type { BrowserContext } from 'playwright-core';
import { expect } from '@playwright/test';

/** Return type of `BrowserContext.storageState()` (cookies + origins / localStorage). */
type SnapshotStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
import * as fs from 'node:fs/promises';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Prisma, type RunStep } from '../../generated/prisma/client';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { AgentContextService } from '../agent-context/agent-context.service';
import { LlmService, type OptimizedPromptCompilerInput } from '../llm/llm.service';
import type { AiPromptTestFailureHelp } from '../llm/llm.service';
import { EventEmitter } from 'events';
import {
  clerkSignInUrlLooksLike,
  detectClerkSignInUi,
  detectClerkOtpInputVisible,
  fillClerkOtpFromClerkTestEmail,
  fillClerkOtpFromMailSlurp,
  MAILSLURP_POST_PASSWORD_DELAY_MS,
  performClerkPasswordEmail2FA,
  sleepMs,
  type ClerkOtpMode,
} from '@bladerunner/clerk-agentmail-signin';
import {
  detectLikelyClerkLoginPage,
  performProjectPasswordSignIn,
  type AutoSignInAuthKind,
  type ProjectAutoSignInCredentials,
} from './project-auto-sign-in';
import { buildPlaybackSkipSet, normalizePlaybackUrl, shouldSkipStoredPlaywrightForClerk } from './playback-skip.util';
import { filterStepsForPlaybackExecutionChain } from './playback-execution-chain.util';
import { escapeLocatorCssInPlaywrightSnippet } from './playback-css-escape.util';
import {
  buildClerkAutoSignInInstruction,
  CLERK_AUTO_SIGN_IN_KIND,
  CLERK_AUTO_SIGN_IN_SCHEMA_VERSION,
  clerkAutoSignInSentinelPlaywrightCode,
  isClerkAutoSignInMetadata,
  postAuthUrlsRoughlyMatch,
} from './clerk-auto-sign-in-step-metadata';
import {
  AI_PROMPT_STEP_KIND,
  AI_PROMPT_STEP_SCHEMA_VERSION,
  aiPromptStepSentinelPlaywrightCode,
  isAiPromptStepMetadata,
  type AiPromptLlmTranscriptStored,
} from './ai-prompt-step-metadata';
import type { InstructionToActionLlmTranscript } from '../llm/providers/llm-provider.interface';
import { buildGeminiInstructionPrompt } from '../llm/gemini-instruction.client';
import { discoveryScreenKey, normalizeDiscoveryUrlForDedup } from '../projects/discovery-url.util';
import { injectSetOfMarkOverlay, removeSetOfMarkOverlay } from './set-of-mark-capture';
import {
  fallbackNamedButtonSelectTriggerClicksForPlayback,
  fallbackNamedComboboxClicksForPlayback,
  preferGetByTextForBareTagLocator,
  preferRecordedCssSelectorForBarePageLocator,
  relaxClickForceForPlayback,
  relaxPageLocatorFirstForPlayback,
  tightenGetByTextLocatorsForPlayback,
  fixAmbiguousTableLastRowTdLocator,
  stripTypeScriptNonNullAssertionsForPlayback,
  preferSearchConditionsPlaceholderOverFollowingInputLabel,
  excludeFileInputFromFollowingInputXPath,
} from './recording-playwright-merge.util';
import {
  buildPlaybackRepairMetadataPatch,
  isAiPromptSentinelPlaywrightCode,
  isExecutableStoredPlaywrightCode,
  resolveRecordedPlaywrightCode,
} from './recorded-playwright.util';
import { classifyRecordingAutomationFailure } from './recording-timeout.util';
import {
  adjustRecordingVideoDurationToWallClock,
  copyRecordingVideoToArtifacts,
  getRecordingsBaseDir,
  getRunArtifactDir,
  removePathIfExists,
  writeJpegThumbnailFromVideo,
} from './recording-storage';
import { createScreencastVideoEncoder, type ScreencastVideoEncoder } from './recording-screencast-ffmpeg';
import {
  getOptimizedPromptEvidenceRef,
  getOptimizedPromptStored,
  OPTIMIZED_PROMPT_SCHEMA_VERSION,
  type OptimizedPromptCompileSource,
  type OptimizedPromptEvidenceRef,
  withOptimizedPromptFailure,
  withOptimizedPromptSuccess,
} from './optimized-prompt-metadata';
import { buildAiVisualIdTree, type AiVisualIdContextArtifact, type AiVisualIdTag } from './ai-visual-id';

/** AI-generated Playwright often needs longer than Playwright's default 30s action timeout. */
const AI_PROMPT_PW_TIMEOUT_MS = 120_000;
const PLAYWRIGHT_DEFAULT_TIMEOUT_MS = 30_000;

/** Max wait for locator actions / navigation in autonomous evaluation runs (below Playwright 30s default). */
function evaluationPlaywrightTimeoutMs(): number {
  const n = Number(process.env.EVALUATION_PLAYWRIGHT_TIMEOUT_MS);
  /** Default 15s so stuck locators fail faster (override for slow SPAs). */
  return Number.isFinite(n) && n > 0 ? n : 15_000;
}

type RecordingViewportPreset = 'hd' | 'wxga' | 'fhd';
type RecordingStreamQualityPreset = 'low' | 'medium' | 'high';
type RecordingStreamSmoothnessPreset = 'low' | 'medium' | 'high';

type RecordingStartOptions = {
  name: string;
  url: string;
  projectId?: string;
  viewportPreset?: RecordingViewportPreset;
  streamQuality?: RecordingStreamQualityPreset;
  streamSmoothness?: RecordingStreamSmoothnessPreset;
};

type RunCaptureSettings = {
  recordingViewportWidth: number;
  recordingViewportHeight: number;
  streamMaxWidth: number;
  streamMaxHeight: number;
  streamJpegQuality: number;
  streamEveryNthFrame: number;
};

type OptimizedPromptEvidencePayload = {
  pageUrl: string;
  somManifest: string;
  accessibilitySnapshot: string;
  playwrightSnippet: string;
  recordingMode: string;
  humanPromptOrNull: string | null;
  optionalPageMetadata: string;
  screenshotBase64?: string;
};

const VIEWPORT_PRESETS: Record<RecordingViewportPreset, { width: number; height: number }> = {
  hd: { width: 1280, height: 720 },
  wxga: { width: 1440, height: 900 },
  fhd: { width: 1920, height: 1080 },
};

const STREAM_QUALITY_PRESETS: Record<RecordingStreamQualityPreset, { jpegQuality: number; scale: number }> = {
  low: { jpegQuality: 45, scale: 0.75 },
  medium: { jpegQuality: 60, scale: 1 },
  high: { jpegQuality: 78, scale: 1 },
};

const STREAM_SMOOTHNESS_PRESETS: Record<RecordingStreamSmoothnessPreset, number> = {
  low: 3,
  medium: 2,
  high: 1,
};

const DEFAULT_VIEWPORT_PRESET: RecordingViewportPreset = 'hd';
const DEFAULT_STREAM_QUALITY_PRESET: RecordingStreamQualityPreset = 'medium';
const DEFAULT_STREAM_SMOOTHNESS_PRESET: RecordingStreamSmoothnessPreset = 'high';

function buildCaptureSettingsFromPresets(input?: {
  viewportPreset?: string;
  streamQuality?: string;
  streamSmoothness?: string;
}): RunCaptureSettings {
  const viewport =
    VIEWPORT_PRESETS[(input?.viewportPreset as RecordingViewportPreset) || DEFAULT_VIEWPORT_PRESET] ??
    VIEWPORT_PRESETS[DEFAULT_VIEWPORT_PRESET];
  const quality =
    STREAM_QUALITY_PRESETS[(input?.streamQuality as RecordingStreamQualityPreset) || DEFAULT_STREAM_QUALITY_PRESET] ??
    STREAM_QUALITY_PRESETS[DEFAULT_STREAM_QUALITY_PRESET];
  const everyNthFrame =
    STREAM_SMOOTHNESS_PRESETS[
      (input?.streamSmoothness as RecordingStreamSmoothnessPreset) || DEFAULT_STREAM_SMOOTHNESS_PRESET
    ] ?? STREAM_SMOOTHNESS_PRESETS[DEFAULT_STREAM_SMOOTHNESS_PRESET];
  return {
    recordingViewportWidth: viewport.width,
    recordingViewportHeight: viewport.height,
    streamMaxWidth: Math.max(640, Math.round(viewport.width * quality.scale)),
    streamMaxHeight: Math.max(360, Math.round(viewport.height * quality.scale)),
    streamJpegQuality: quality.jpegQuality,
    streamEveryNthFrame: everyNthFrame,
  };
}

function captureSettingsFromRun(run: Partial<RunCaptureSettings>): RunCaptureSettings {
  return {
    recordingViewportWidth: run.recordingViewportWidth ?? 1280,
    recordingViewportHeight: run.recordingViewportHeight ?? 720,
    streamMaxWidth: run.streamMaxWidth ?? 1280,
    streamMaxHeight: run.streamMaxHeight ?? 720,
    streamJpegQuality: run.streamJpegQuality ?? 60,
    streamEveryNthFrame: run.streamEveryNthFrame ?? 1,
  };
}
/**
 * Keep **1** here: `deviceScaleFactor: 2` caused **Clerk automatic sign-in during recording** to fail (hosted UI /
 * layout differences). Vision quality is improved via **JPEG quality** on LLM screenshots instead.
 */
const REMOTE_BROWSER_DEVICE_SCALE_FACTOR = 1;
/** JPEG quality for screenshots sent to the vision LLM (AI prompt, executeInstruction, reRecord). */
const LLM_VISION_SCREENSHOT_JPEG_QUALITY = 85;
/** Default max height (px) for LLM vision JPEG after full-page capture; larger images are downscaled uniformly (badges stay aligned). */
const LLM_VISION_FULL_PAGE_MAX_HEIGHT_DEFAULT = 16384;

export type StartPlaybackServiceOpts = {
  delayMs?: number;
  autoClerkSignIn?: boolean;
  /**
   * How to obtain the email OTP during Clerk auto sign-in.
   * When omitted, server uses `PLAYBACK_CLERK_OTP_MODE` or defaults to `mailslurp` (requires MAILSLURP_* env).
   */
  clerkOtpMode?: ClerkOtpMode;
  skipUntilSequence?: number;
  skipStepIds?: string[];
  /** Stop playback after this step sequence completes (inclusive). Omit = run all steps. */
  playThroughSequence?: number;
  /**
   * When true, pause before executing the first recorded step (after Clerk pre-roll). Clients typically call
   * `advance-one` to run step-by-step from the beginning without pressing Play first.
   */
  startPaused?: boolean;
};

type StopRecordingMode = 'complete' | 'save';

export interface RecordingSession {
  runId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  stepSequence: number;
  latestFrame: Buffer | null;
  /**
   * Encodes CDP screencast JPEGs to WebM on the API host (required when the browser is remote — Playwright
   * `recordVideo` files are not readable from this process).
   */
  screencastVideo: ScreencastVideoEncoder | null;
  /**
   * Serialize `__bladerunnerRecordAction` handling so steps are persisted in strict callback order
   * (avoids LLM latency reordering: e.g. password step before email).
   */
  recordingCaptureTail: Promise<void>;
  /**
   * After server Clerk auto sign-in + canonical steps, ignore one DOM TYPE that looks like the same
   * Clerk OTP field (debounced `input` can still fire after unpause).
   */
  skipDuplicateClerkOtpDomCaptureOnce?: boolean;
  /**
   * True while `performClerkPasswordEmail2FA` runs — DOM capture may still finish LLM work async after
   * the page pause flag is set; this blocks `recordStep` until resume.
   */
  recordingDomCapturePaused: boolean;
  /**
   * Incremented when Clerk auto sign-in DOM pause starts and again when it ends. Capture callbacks
   * snapshot this at entry; if it changed after `await` LLM, the action crossed the pause window and is dropped.
   */
  clerkDomCaptureBarrier: number;
  projectAuth: ProjectAutoSignInCredentials | null;
  screencastClosing?: boolean;
}

/** Stored on each playback session so Restart can replay with the same options. */
export type PlaybackReplaySnapshot = {
  sourceRunId: string;
  delayMs: number;
  wantAutoClerkSignIn: boolean;
  clerkOtpMode: ClerkOtpMode;
  skipUntilSequence?: number;
  skipStepIds?: string[];
  playThroughSequence?: number;
};

/** Live replay session — keyed by playbackSessionId (socket room), not source run id */
export interface PlaybackSession {
  playbackSessionId: string;
  sourceRunId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  latestFrame: Buffer | null;
  paused: boolean;
  /** Resolvers waiting in `waitUntilPlaybackNotPaused` */
  playbackResumeWaiters: Array<() => void>;
  /** Options used when this session started (restart / client UI). */
  replaySnapshot: PlaybackReplaySnapshot;
  /** After resume, pause again when the current step finishes (advance-one). */
  pauseAfterNextStepCompletes?: boolean;
  /** After resume, pause when a step with sequence >= this completes (advance-to). */
  pauseAfterSequenceInclusive?: number | null;
  /** When true, emit `playback_paused` before the first step iteration (then clear). Used with `startPaused` on start. */
  pauseBeforeFirstRecordedStepPending?: boolean;
  /**
   * Set while a Playwright-heavy step runs (AI prompt codegen, recorded step, Clerk auto sign-in).
   * `stopPlayback` awaits this before `browser.close()` so `executePwCode` is not torn down mid-flight.
   */
  activeStepWork: Promise<void> | null;
  projectAuth: ProjectAutoSignInCredentials | null;
  screencastClosing?: boolean;
}

/** Autonomous evaluation browser — keyed by `evaluationId`; socket room `run:<evaluationId>` (same as recording frames). */
type EvaluationLiveSession = {
  evaluationId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  latestFrame: Buffer | null;
  screencastVideo: ScreencastVideoEncoder | null;
  screencastClosing?: boolean;
  /** Set after a successful auto sign-in assist; survives `runLoop` restarts (resume after human/review). */
  autoSignInCompleted?: boolean;
};

/** One-off project discovery browser — keyed by `discoverySessionId` (UUID per job). */
type DiscoveryLiveSession = {
  discoverySessionId: string;
  /** Stable id for live JPEG frames (`emit('frame', \`discovery-${projectId}\`, …)`). */
  projectId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  latestFrame: Buffer | null;
  screencastVideo: ScreencastVideoEncoder | null;
  screencastClosing?: boolean;
  /** Main-frame navigations + logical SPA screens (URL/title pairs; see appendDiscoveryVisitedIfChanged). */
  visitedScreens: Array<{ url: string; title: string | null; navigatedAt: string }>;
};

@Injectable()
export class RecordingService extends EventEmitter {
  private readonly logger = new Logger(RecordingService.name);
  private sessions = new Map<string, RecordingSession>();
  private playbackSessions = new Map<string, PlaybackSession>();
  private evaluationSessions = new Map<string, EvaluationLiveSession>();
  private discoverySessions = new Map<string, DiscoveryLiveSession>();
  /** Latest `evaluationProgress` payload per evaluation (for WebSocket join catch-up). */
  private lastEvaluationProgressById = new Map<string, Record<string, unknown>>();
  /** Real-time evaluation trace lines (orchestrator + LLM); capped for memory; join catch-up. */
  private evaluationDebugLogById = new Map<string, Array<{ at: string; message: string; detail?: Record<string, unknown> }>>();
  private static readonly EVAL_DEBUG_LOG_MAX_LINES = 2500;
  /** Project discovery agent log lines (keyed by project id); join catch-up on `run:discovery-{projectId}`. */
  private discoveryDebugLogByProjectId = new Map<
    string,
    Array<{ at: string; message: string; detail?: Record<string, unknown> }>
  >();
  private static readonly DISCOVERY_DEBUG_LOG_MAX_LINES = 3000;
  /** NDJSON file stream for the current discovery run (`docs/logs/{slug}-discovery-DDMMYY-HHmm.log`). */
  private discoveryLogStreamByProjectId = new Map<string, WriteStream>();
  private discoveryLogBasenameByProjectId = new Map<string, string>();
  /** Latest Mermaid navigation diagram per project (discovery live UI + join catch-up). */
  private discoveryNavigationMermaidByProjectId = new Map<string, string>();
  /** In-flight `testAiPromptStep` work (key `runId:stepId`); `stopRecording` awaits before closing browser. */
  private aiPromptTestInFlight = new Map<string, Promise<void>>();
  /** In-flight optimized prompt generation / refresh work keyed by `${runId}:${stepId}`. */
  private optimizedPromptInFlight = new Map<string, Promise<void>>();
  /** Before each AI prompt Test: URL + `storageState` for Reset (key `${runId}:${stepId}`). */
  private aiPromptPreTestSnapshots = new Map<string, { url: string; state: SnapshotStorageState }>();
  /** Active `test-ai-step` HTTP request — `POST .../abort-ai-test` or client disconnect calls `abort()`. */
  private aiPromptTestAbortControllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly configService: ConfigService,
    private readonly agentContextService: AgentContextService,
  ) {
    super();
  }

  private async attemptPlaybackRepair(
    session: PlaybackSession,
    step: RunStep,
    playbackSessionId: string,
    sourceRunId: string,
    stepPayload: { id: string; sequence: number; action: string; instruction: string },
    skipClickForce: boolean,
    failureContext?: ReturnType<typeof classifyRecordingAutomationFailure>,
  ): Promise<void> {
    let generated: { playwrightCode: string };
    try {
      const runForProject = await this.prisma.run.findFirst({
        where: { id: sourceRunId, userId: session.userId },
        select: { projectId: true },
      });
      const projectId = runForProject?.projectId ?? null;
      generated = await this.runWithActivePlaybackStep(session, () =>
        this.playAiPromptStepOnPage(session.page, step.instruction, {
          userId: session.userId,
          projectId,
          skipClickForce,
          progress: { runId: sourceRunId, stepId: step.id },
          phase: 'generateOnly',
          repairContext: {
            failedPlaywrightCode: isExecutableStoredPlaywrightCode(step.playwrightCode) ? step.playwrightCode : undefined,
            recordedPlaywrightCode: this.resolveStepRecordedPlaywrightCode(step) ?? undefined,
            priorFailureKind: failureContext?.kind,
            priorFailureMessage: failureContext?.message,
          },
          persistTranscript: {
            stepId: step.id,
            runId: sourceRunId,
            userId: session.userId,
            source: 'playback',
            playbackEmit: {
              playbackSessionId,
              sourceRunId,
              step: stepPayload,
            },
          },
        }),
      );
    } catch (generationErr) {
      const generationFailure = classifyRecordingAutomationFailure(generationErr);
      await this.persistPlaybackRepairFailure(step, generationFailure, {
        failedPlaywrightCode: failureContext ? step.playwrightCode : undefined,
      });
      throw generationErr;
    }

    try {
      await this.runWithActivePlaybackStep(session, () =>
        this.executePwCode(session.page, generated.playwrightCode, {
          skipClickForce,
        }),
      );
    } catch (repairErr) {
      const repairFailure = classifyRecordingAutomationFailure(repairErr);
      await this.persistPlaybackRepairFailure(step, repairFailure, {
        failedPlaywrightCode: generated.playwrightCode,
        generatedPlaywrightCode: generated.playwrightCode,
      });
      throw repairErr;
    }

    const fresh = await this.prisma.runStep.findFirst({
      where: { id: step.id, runId: sourceRunId, userId: session.userId },
    });
    const baseMeta =
      fresh?.metadata && typeof fresh.metadata === 'object'
        ? { ...(fresh.metadata as Record<string, unknown>) }
        : {};
    const promotedAt = new Date().toISOString();
    const metadataPatch = buildPlaybackRepairMetadataPatch(baseMeta, {
      failureAt: promotedAt,
      failureKind: failureContext?.kind ?? 'playwright',
      failureMessage: failureContext?.message ?? 'Generated replacement Playwright promoted during playback.',
      failedPlaywrightCode: failureContext ? step.playwrightCode : undefined,
      generatedPlaywrightCode: generated.playwrightCode,
      recordedPlaywrightCode: this.resolveStepRecordedPlaywrightCode(
        fresh ?? step,
        generated.playwrightCode,
      ),
      promotedAt,
    });
    if (isAiPromptStepMetadata(step.metadata) || step.origin === 'AI_PROMPT') {
      metadataPatch.kind = AI_PROMPT_STEP_KIND;
      metadataPatch.schemaVersion = AI_PROMPT_STEP_SCHEMA_VERSION;
      metadataPatch.lastAiPromptCodegenOk = true;
      metadataPatch.lastAiPromptCodegenInstruction = step.instruction;
      metadataPatch.lastAiPromptRunOk = true;
      metadataPatch.lastAiPromptRunInstruction = step.instruction;
    }
    await this.persistStepPlaywrightCodeState(
      fresh ?? step,
      generated.playwrightCode,
      metadataPatch,
    );
  }

  private async attemptPlaybackWithOptimizedPrompt(
    session: PlaybackSession,
    step: RunStep,
    sourceRunId: string,
    skipClickForce: boolean,
    failureContext?: ReturnType<typeof classifyRecordingAutomationFailure>,
  ): Promise<void> {
    const optimized = getOptimizedPromptStored(step.metadata);
    if (!optimized?.canonical_playback_prompt?.trim()) {
      throw new Error('No optimized prompt available');
    }
    const runForProject = await this.prisma.run.findFirst({
      where: { id: sourceRunId, userId: session.userId },
      select: { projectId: true },
    });
    const projectId = runForProject?.projectId ?? null;
    const generated = await this.runWithActivePlaybackStep(session, () =>
      this.playAiPromptStepOnPage(session.page, optimized.canonical_playback_prompt, {
        userId: session.userId,
        projectId,
        skipClickForce,
        phase: 'generateOnly',
        repairContext: {
          failedPlaywrightCode: isExecutableStoredPlaywrightCode(step.playwrightCode) ? step.playwrightCode : undefined,
          recordedPlaywrightCode: this.resolveStepRecordedPlaywrightCode(step) ?? undefined,
          priorFailureKind: failureContext?.kind,
          priorFailureMessage: failureContext?.message,
        },
      }),
    );

    await this.runWithActivePlaybackStep(session, () =>
      this.executePwCode(session.page, generated.playwrightCode, {
        skipClickForce,
      }),
    );

    const fresh = await this.prisma.runStep.findFirst({
      where: { id: step.id, runId: sourceRunId, userId: session.userId },
    });
    const baseMeta =
      fresh?.metadata && typeof fresh.metadata === 'object'
        ? { ...(fresh.metadata as Record<string, unknown>) }
        : {};
    const nowIso = new Date().toISOString();
    const metadataPatch: Record<string, unknown> = {
      ...baseMeta,
      lastOptimizedPromptPlaybackAt: nowIso,
      lastOptimizedPromptPlaybackFailure: null,
      lastOptimizedPromptPlaybackPrompt: optimized.canonical_playback_prompt,
    };

    if (isExecutableStoredPlaywrightCode(step.playwrightCode) && step.origin !== 'AI_PROMPT') {
      await this.persistStepPlaywrightCodeState(fresh ?? step, generated.playwrightCode, metadataPatch);
      return;
    }

    await this.prisma.runStep.update({
      where: { id: step.id },
      data: {
        metadata: metadataPatch as Prisma.InputJsonValue,
      },
    });
  }

  private async persistOptimizedPromptPlaybackFailure(step: RunStep, error: unknown): Promise<void> {
    const fresh = await this.prisma.runStep.findFirst({
      where: { id: step.id, runId: step.runId, userId: step.userId },
    });
    const baseMeta =
      fresh?.metadata && typeof fresh.metadata === 'object'
        ? { ...(fresh.metadata as Record<string, unknown>) }
        : {};
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.runStep.update({
      where: { id: step.id },
      data: {
        metadata: {
          ...baseMeta,
          lastOptimizedPromptPlaybackAt: new Date().toISOString(),
          lastOptimizedPromptPlaybackFailure: message,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async executePlaybackStepWithRepair(
    session: PlaybackSession,
    step: RunStep,
    playbackSessionId: string,
    sourceRunId: string,
    stepPayload: { id: string; sequence: number; action: string; instruction: string },
    skipClickForce: boolean,
  ): Promise<void> {
    const optimizedPrompt = getOptimizedPromptStored(step.metadata);
    if (isExecutableStoredPlaywrightCode(step.playwrightCode)) {
      try {
        await this.runWithActivePlaybackStep(session, () =>
          this.executePwCode(session.page, step.playwrightCode, {
            skipClickForce,
          }),
        );
        return;
      } catch (execErr) {
        const failure = classifyRecordingAutomationFailure(execErr);
        if (!this.shouldAttemptPlaybackRepair(step, failure)) {
          await this.persistPlaybackRepairFailure(step, failure, {
            failedPlaywrightCode: step.playwrightCode,
          });
          throw execErr;
        }
        if (optimizedPrompt) {
          try {
            await this.attemptPlaybackWithOptimizedPrompt(
              session,
              step,
              sourceRunId,
              skipClickForce,
              failure,
            );
            return;
          } catch (optimizedErr) {
            await this.persistOptimizedPromptPlaybackFailure(step, optimizedErr);
            this.logger.warn(`Optimized prompt fallback failed for step ${step.id}: ${optimizedErr}`);
          }
        }
        try {
          await this.attemptPlaybackRepair(
            session,
            step,
            playbackSessionId,
            sourceRunId,
            stepPayload,
            skipClickForce,
            failure,
          );
          return;
        } catch (repairErr) {
          throw repairErr;
        }
      }
    }

    if (optimizedPrompt) {
      try {
        await this.attemptPlaybackWithOptimizedPrompt(
          session,
          step,
          sourceRunId,
          skipClickForce,
        );
        return;
      } catch (optimizedErr) {
        await this.persistOptimizedPromptPlaybackFailure(step, optimizedErr);
        this.logger.warn(`Optimized prompt fallback failed for step ${step.id}: ${optimizedErr}`);
      }
    }

    await this.attemptPlaybackRepair(
      session,
      step,
      playbackSessionId,
      sourceRunId,
      stepPayload,
      skipClickForce,
    );
  }

  getSession(runId: string): RecordingSession | undefined {
    return this.sessions.get(runId);
  }

  getLatestFrame(runId: string): Buffer | null {
    return this.sessions.get(runId)?.latestFrame ?? null;
  }

  getEvaluationSession(evaluationId: string): EvaluationLiveSession | undefined {
    return this.evaluationSessions.get(evaluationId);
  }

  getLatestEvaluationFrame(evaluationId: string): Buffer | null {
    return this.evaluationSessions.get(evaluationId)?.latestFrame ?? null;
  }

  getLatestDiscoveryFrame(projectId: string): Buffer | null {
    for (const s of this.discoverySessions.values()) {
      if (s.projectId === projectId) {
        return s.latestFrame ?? null;
      }
    }
    return null;
  }

  getDiscoveryVisitedScreens(discoverySessionId: string): Array<{
    url: string;
    title: string | null;
    navigatedAt: string;
  }> {
    return this.discoverySessions.get(discoverySessionId)?.visitedScreens ?? [];
  }

  /** Clears buffered discovery log lines when a new run starts for the same project. */
  clearDiscoveryDebugLog(projectId: string): void {
    const prev = this.discoveryLogStreamByProjectId.get(projectId);
    if (prev) {
      try {
        prev.destroy();
      } catch {
        /* ignore */
      }
      this.discoveryLogStreamByProjectId.delete(projectId);
      this.discoveryLogBasenameByProjectId.delete(projectId);
    }
    this.discoveryDebugLogByProjectId.delete(projectId);
    this.discoveryNavigationMermaidByProjectId.delete(projectId);
  }

  /** Resolves `docs/logs` at the repo root (works when `cwd` is repo root or `apps/api`). Override with `DISCOVERY_LOGS_DIR`. */
  private discoveryLogsDir(): string {
    const env = this.configService.get<string>('DISCOVERY_LOGS_DIR')?.trim();
    if (env) {
      return path.isAbsolute(env) ? env : path.join(process.cwd(), env);
    }
    let dir = path.resolve(process.cwd());
    for (let i = 0; i < 12; i++) {
      if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
        return path.join(dir, 'docs', 'logs');
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return path.join(process.cwd(), 'docs', 'logs');
  }

  /**
   * Opens a new NDJSON log file for this discovery run. Filename: `{slug}-discovery-DDMMYY-HHmm.log` (24h clock in local time).
   */
  beginDiscoveryLogFile(projectId: string, projectName: string): void {
    const prev = this.discoveryLogStreamByProjectId.get(projectId);
    if (prev) {
      try {
        prev.destroy();
      } catch {
        /* ignore */
      }
      this.discoveryLogStreamByProjectId.delete(projectId);
      this.discoveryLogBasenameByProjectId.delete(projectId);
    }
    const slug = RecordingService.slugifyForDiscoveryLogFile(projectName);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ddmmyy = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}`;
    const hhmm = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    const basename = `${slug}-discovery-${ddmmyy}-${hhmm}.log`;
    const dir = this.discoveryLogsDir();
    mkdirSync(dir, { recursive: true });
    const fullPath = path.join(dir, basename);
    const stream = createWriteStream(fullPath, { flags: 'w' });
    this.discoveryLogStreamByProjectId.set(projectId, stream);
    this.discoveryLogBasenameByProjectId.set(projectId, basename);
    const header = {
      kind: 'discovery-log-header' as const,
      projectId,
      projectName: projectName.trim().slice(0, 200),
      file: basename,
      startedAt: new Date().toISOString(),
    };
    stream.write(`${JSON.stringify(header)}\n`);
  }

  /** Flush and close the NDJSON log stream; returns the basename written to `docs/logs/`, if any. */
  async finalizeDiscoveryLogFile(projectId: string): Promise<string | null> {
    const stream = this.discoveryLogStreamByProjectId.get(projectId);
    const basename = this.discoveryLogBasenameByProjectId.get(projectId) ?? null;
    this.discoveryLogStreamByProjectId.delete(projectId);
    this.discoveryLogBasenameByProjectId.delete(projectId);
    if (!stream) {
      return basename;
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((err: NodeJS.ErrnoException | undefined) => (err ? reject(err) : resolve()));
    });
    return basename;
  }

  private static slugifyForDiscoveryLogFile(name: string): string {
    const s = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return s || 'project';
  }

  /** Only basenames produced by {@link beginDiscoveryLogFile} (path traversal safe). */
  static isSafeDiscoveryLogBasename(basename: string): boolean {
    return /^[a-z0-9-]+-discovery-\d{6}-\d{4}\.log$/i.test(basename.trim());
  }

  /**
   * Reads NDJSON written during discovery (skips header line). Used by GET `/projects/:id/discovery/agent-log`.
   */
  async readDiscoveryAgentLogFile(
    basename: string,
  ): Promise<Array<{ at: string; message: string; detail?: Record<string, unknown> }>> {
    const name = basename.trim();
    if (!RecordingService.isSafeDiscoveryLogBasename(name)) {
      throw new BadRequestException('Invalid discovery log filename');
    }
    const full = path.join(this.discoveryLogsDir(), name);
    let raw: string;
    try {
      raw = await fs.readFile(full, 'utf8');
    } catch {
      throw new NotFoundException('Discovery log file not found on disk');
    }
    const out: Array<{ at: string; message: string; detail?: Record<string, unknown> }> = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(t) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (o.kind === 'discovery-log-header') {
        continue;
      }
      if (typeof o.at !== 'string' || typeof o.message !== 'string') {
        continue;
      }
      const detail =
        typeof o.detail === 'object' && o.detail !== null && !Array.isArray(o.detail)
          ? (o.detail as Record<string, unknown>)
          : undefined;
      out.push({ at: o.at, message: o.message, detail });
    }
    return out;
  }

  getDiscoveryNavigationMermaid(projectId: string): string | null {
    return this.discoveryNavigationMermaidByProjectId.get(projectId) ?? null;
  }

  /** Push latest Mermaid diagram to WebSocket `discoveryNavigationMermaid` + join catch-up. */
  emitDiscoveryNavigationMermaid(projectId: string, mermaid: string): void {
    const trimmed = mermaid.trim();
    this.discoveryNavigationMermaidByProjectId.set(projectId, trimmed);
    this.emit('discoveryNavigationMermaid', projectId, trimmed);
  }

  getDiscoveryDebugLogLines(projectId: string): Array<{ at: string; message: string; detail?: Record<string, unknown> }> {
    return this.discoveryDebugLogByProjectId.get(projectId) ?? [];
  }

  /**
   * Append a timestamped line to the project discovery agent log (WebSocket `discoveryDebugLog` + join catch-up).
   * Do not log secrets; keep `detail` to sizes and short previews.
   */
  emitDiscoveryDebugLog(projectId: string, message: string, detail?: Record<string, unknown>): void {
    const at = new Date().toISOString();
    const line = { at, message, detail };
    let buf = this.discoveryDebugLogByProjectId.get(projectId);
    if (!buf) {
      buf = [];
      this.discoveryDebugLogByProjectId.set(projectId, buf);
    }
    buf.push(line);
    if (buf.length > RecordingService.DISCOVERY_DEBUG_LOG_MAX_LINES) {
      buf.splice(0, buf.length - RecordingService.DISCOVERY_DEBUG_LOG_MAX_LINES);
    }
    const logStream = this.discoveryLogStreamByProjectId.get(projectId);
    if (logStream) {
      try {
        logStream.write(`${JSON.stringify(line)}\n`);
      } catch (err) {
        this.logger.warn(`discovery NDJSON log write failed for project ${projectId}`, err);
      }
    }
    this.emit('discoveryDebugLog', projectId, line);
  }

  /**
   * Full-page Set-of-Marks JPEG + manifest + CDP accessibility for evaluation codegen / analyzer.
   * Same pipeline as AI prompt steps ({@link captureLlmPageContext}).
   */
  async captureEvaluationLlmPageContext(
    evaluationId: string,
    userId: string,
  ): Promise<{
    pageUrl: string;
    somManifest: string;
    accessibilitySnapshot: string;
    screenshotBase64: string | undefined;
  }> {
    const session = this.evaluationSessions.get(evaluationId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('Evaluation browser session not found');
    }
    const ctx = await this.captureLlmPageContext(session.page, undefined, session.cdpSession);
    return {
      pageUrl: ctx.pageUrl,
      somManifest: ctx.somManifest,
      accessibilitySnapshot: ctx.accessibilitySnapshot,
      screenshotBase64: ctx.screenshotBase64,
    };
  }

  /**
   * Remote Playwright browser for Evaluations — frames emit on `frame` with id = evaluationId (join room `run:<evaluationId>`).
   */
  async startEvaluationSession(evaluationId: string, userId: string): Promise<void> {
    if (this.evaluationSessions.has(evaluationId)) {
      throw new ConflictException('Evaluation browser session already active');
    }
    this.lastEvaluationProgressById.delete(evaluationId);
    const captureSettings = buildCaptureSettingsFromPresets({
      viewportPreset: 'wxga',
      streamQuality: 'high',
      streamSmoothness: 'high',
    });
    const workerUrl = this.configService.get<string>('BROWSER_WORKER_URL', 'ws://localhost:3002');
    const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
    const browser = await chromium.connect(wsEndpoint);
    const ffmpegStagingPath = path.join(os.tmpdir(), `br-eval-screencast-${evaluationId}-${randomUUID()}.mp4`);
    const screencastVideo = createScreencastVideoEncoder(ffmpegStagingPath, this.logger);
    try {
      const context = await browser.newContext({
        viewport: {
          width: captureSettings.recordingViewportWidth,
          height: captureSettings.recordingViewportHeight,
        },
        deviceScaleFactor: REMOTE_BROWSER_DEVICE_SCALE_FACTOR,
      });
      const page = await context.newPage();
      const pwTimeoutMs = evaluationPlaywrightTimeoutMs();
      page.setDefaultTimeout(pwTimeoutMs);
      page.setDefaultNavigationTimeout(pwTimeoutMs);
      const cdpSession = await context.newCDPSession(page);
      const session: EvaluationLiveSession = {
        evaluationId,
        userId,
        browser,
        page,
        cdpSession,
        latestFrame: null,
        screencastVideo,
      };
      this.evaluationSessions.set(evaluationId, session);
      await this.attachScreencast(session.cdpSession, session, evaluationId, captureSettings, {
        onJpegFrame: (jpeg) => screencastVideo?.pushFrame(jpeg),
      });
      this.emit('status', evaluationId, { status: 'evaluation', evaluationId, phase: 'browser_ready' });
    } catch (err) {
      this.evaluationSessions.delete(evaluationId);
      screencastVideo?.kill();
      await removePathIfExists(ffmpegStagingPath).catch(() => {});
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  /**
   * Clerk / generic test-user sign-in assist when the page looks like a login screen (same logic as playback).
   * Pass a persistent `state` from the evaluation loop: the helper only performs work when sign-in UI is present,
   * and sets `state.clerkFullSignInDone` after a successful assist so callers can skip further attempts.
   */
  async maybeEvaluationAutoSignInAssist(
    evaluationId: string,
    userId: string,
    opts: {
      runUrl: string;
      projectForAuth: {
        testUserEmail: string | null;
        testUserPassword: string | null;
        testEmailProvider: string | null;
      } | null;
      wantAuto: boolean;
      clerkOtpMode: ClerkOtpMode;
      state: { clerkFullSignInDone: boolean };
    },
  ): Promise<void> {
    const session = this.evaluationSessions.get(evaluationId);
    if (!session || session.userId !== userId) {
      return;
    }
    const projectAuth = this.projectAuthFromProject(opts.projectForAuth);
    await this.maybePlaybackClerkAuthAssist(
      { page: session.page, projectAuth },
      opts.runUrl,
      opts.wantAuto,
      opts.clerkOtpMode,
      opts.state,
    );
    if (opts.state.clerkFullSignInDone) {
      session.autoSignInCompleted = true;
    }
  }

  /** Resolve Clerk OTP mode for evaluations: stored preference or server default. */
  resolveClerkOtpModeForEvaluation(stored: string | null | undefined): ClerkOtpMode {
    if (stored === 'clerk_test_email' || stored === 'mailslurp') {
      return stored;
    }
    return this.resolveClerkOtpMode(undefined);
  }

  async stopEvaluationSession(evaluationId: string, userId: string): Promise<void> {
    const session = this.evaluationSessions.get(evaluationId);
    if (!session || session.userId !== userId) {
      return;
    }
    const screencastVideo = session.screencastVideo;
    session.screencastClosing = true;
    try {
      await session.cdpSession.send('Page.stopScreencast');
    } catch (err) {
      this.logger.warn(`evaluation stopScreencast ${evaluationId}`, err);
    }
    if (screencastVideo) {
      try {
        await screencastVideo.finalize();
      } catch (err) {
        this.logger.warn(`evaluation screencast finalize ${evaluationId}`, err);
      }
    }
    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn(`evaluation browser close ${evaluationId}`, err);
    }
    this.evaluationSessions.delete(evaluationId);
    this.lastEvaluationProgressById.delete(evaluationId);
    this.emit('status', evaluationId, { status: 'evaluation', evaluationId, phase: 'browser_stopped' });
  }

  /**
   * Temporary browser for project discovery. Live JPEG frames emit as `frame` with id `discovery-${projectId}` (join `run:discovery-${projectId}`).
   */
  async startDiscoverySession(discoverySessionId: string, userId: string, projectId: string): Promise<void> {
    if (this.discoverySessions.has(discoverySessionId)) {
      throw new ConflictException('Discovery browser session already active');
    }
    const captureSettings = buildCaptureSettingsFromPresets({
      viewportPreset: 'wxga',
      streamQuality: 'high',
      streamSmoothness: 'high',
    });
    const workerUrl = this.configService.get<string>('BROWSER_WORKER_URL', 'ws://localhost:3002');
    const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
    const browser = await chromium.connect(wsEndpoint);
    const ffmpegStagingPath = path.join(os.tmpdir(), `br-discovery-screencast-${discoverySessionId}-${randomUUID()}.mp4`);
    const screencastVideo = createScreencastVideoEncoder(ffmpegStagingPath, this.logger);
    try {
      const context = await browser.newContext({
        viewport: {
          width: captureSettings.recordingViewportWidth,
          height: captureSettings.recordingViewportHeight,
        },
        deviceScaleFactor: REMOTE_BROWSER_DEVICE_SCALE_FACTOR,
      });
      const page = await context.newPage();
      const pwTimeoutMs = evaluationPlaywrightTimeoutMs();
      page.setDefaultTimeout(pwTimeoutMs);
      page.setDefaultNavigationTimeout(pwTimeoutMs);
      const cdpSession = await context.newCDPSession(page);
      const session: DiscoveryLiveSession = {
        discoverySessionId,
        projectId,
        userId,
        browser,
        page,
        cdpSession,
        latestFrame: null,
        screencastVideo,
        visitedScreens: [],
      };
      this.discoverySessions.set(discoverySessionId, session);

      const frameChannelId = `discovery-${projectId}`;
      let lastNavUrl = '';
      page.on('framenavigated', async (frame) => {
        if (frame !== page.mainFrame()) {
          return;
        }
        let url = '';
        try {
          url = frame.url();
        } catch {
          return;
        }
        if (!url || url === 'about:blank') {
          return;
        }
        if (url === lastNavUrl) {
          return;
        }
        lastNavUrl = url;
        const navigatedAt = new Date().toISOString();
        let title: string | null = null;
        try {
          title = await page.title().catch(() => null);
        } catch {
          /* ignore */
        }
        session.visitedScreens.push({ url, title, navigatedAt });
      });

      await this.attachScreencast(session.cdpSession, session, frameChannelId, captureSettings, {
        onJpegFrame: (jpeg) => screencastVideo?.pushFrame(jpeg),
      });
    } catch (err) {
      this.discoverySessions.delete(discoverySessionId);
      screencastVideo?.kill();
      await removePathIfExists(ffmpegStagingPath).catch(() => {});
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  async stopDiscoverySession(discoverySessionId: string, userId: string): Promise<void> {
    const session = this.discoverySessions.get(discoverySessionId);
    if (!session || session.userId !== userId) {
      return;
    }
    const screencastVideo = session.screencastVideo;
    session.screencastClosing = true;
    try {
      await session.cdpSession.send('Page.stopScreencast');
    } catch (err) {
      this.logger.warn(`discovery stopScreencast ${discoverySessionId}`, err);
    }
    if (screencastVideo) {
      try {
        await screencastVideo.finalize();
      } catch (err) {
        this.logger.warn(`discovery screencast finalize ${discoverySessionId}`, err);
      }
    }
    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn(`discovery browser close ${discoverySessionId}`, err);
    }
    this.discoverySessions.delete(discoverySessionId);
  }

  /**
   * Scroll the document and common overflow regions so SOM/a11y see off-screen controls,
   * then record a visit if URL+title changed (SPA views without navigation events).
   */
  private async discoveryScrollRevealPage(page: Page): Promise<void> {
    try {
      await page.evaluate(async () => {
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const doc = document.documentElement;
        const body = document.body;
        const maxH = Math.max(doc.scrollHeight, body?.scrollHeight ?? 0, 1);
        const maxW = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0, 1);
        const step = 450;
        for (let y = 0; y <= maxH; y += step) {
          window.scrollTo({ top: y, left: 0, behavior: 'instant' });
          await sleep(35);
        }
        window.scrollTo({ top: maxH, left: 0, behavior: 'instant' });
        for (let x = 0; x <= maxW; x += step) {
          window.scrollTo({ top: maxH, left: x, behavior: 'instant' });
          await sleep(35);
        }
        window.scrollTo({ top: maxH, left: maxW, behavior: 'instant' });
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => {
          const st = window.getComputedStyle(el);
          const oy = st.overflowY;
          const ox = st.overflowX;
          const scrollY =
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 24;
          const scrollX =
            (ox === 'auto' || ox === 'scroll' || ox === 'overlay') && el.scrollWidth > el.clientWidth + 24;
          return scrollY || scrollX;
        }).slice(0, 35);
        for (const el of candidates) {
          try {
            el.scrollTop = el.scrollHeight;
            el.scrollLeft = el.scrollWidth;
            await sleep(40);
          } catch {
            /* ignore */
          }
        }
      });
      await sleepMs(150);
    } catch (err) {
      this.logger.warn('discoveryScrollRevealPage failed', err);
    }
  }

  /** Append to visitedScreens when the logical screen (URL + normalized title) differs from the last entry. */
  private async appendDiscoveryVisitedIfChanged(session: DiscoveryLiveSession): Promise<void> {
    const { page } = session;
    let url = '';
    try {
      url = page.url();
    } catch {
      return;
    }
    if (!url || url === 'about:blank') {
      return;
    }
    let title: string | null = null;
    try {
      title = await page.title();
    } catch {
      title = null;
    }
    const urlNorm = normalizeDiscoveryUrlForDedup(url);
    const key = discoveryScreenKey(urlNorm, title);
    const last = session.visitedScreens[session.visitedScreens.length - 1];
    if (last) {
      const lastKey = discoveryScreenKey(normalizeDiscoveryUrlForDedup(last.url), last.title);
      if (lastKey === key) {
        return;
      }
    }
    session.visitedScreens.push({
      url,
      title,
      navigatedAt: new Date().toISOString(),
    });
  }

  async captureDiscoveryLlmPageContext(
    discoverySessionId: string,
    userId: string,
  ): Promise<{
    pageUrl: string;
    pageTitle: string;
    somManifest: string;
    accessibilitySnapshot: string;
    screenshotBase64: string | undefined;
  }> {
    const session = this.discoverySessions.get(discoverySessionId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('Discovery browser session not found');
    }
    await this.discoveryScrollRevealPage(session.page);
    await this.appendDiscoveryVisitedIfChanged(session);
    const ctx = await this.captureLlmPageContext(session.page, undefined, session.cdpSession);
    let pageTitle = '';
    try {
      pageTitle = await session.page.title();
    } catch {
      pageTitle = '';
    }
    return {
      pageUrl: ctx.pageUrl,
      pageTitle,
      somManifest: ctx.somManifest,
      accessibilitySnapshot: ctx.accessibilitySnapshot,
      screenshotBase64: ctx.screenshotBase64,
    };
  }

  /** Run one Playwright snippet during project discovery (same codegen constraints as evaluation). */
  async discoveryRunPlaywrightSnippet(
    discoverySessionId: string,
    userId: string,
    code: string,
  ): Promise<void> {
    const session = this.discoverySessions.get(discoverySessionId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('Discovery browser session not found');
    }
    await this.executePwCode(session.page, code, {});
  }

  async discoveryGoto(discoverySessionId: string, userId: string, url: string): Promise<void> {
    const session = this.discoverySessions.get(discoverySessionId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('Discovery browser session not found');
    }
    await session.page.goto(url.trim(), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  }

  async discoveryWaitForDomContentLoaded(discoverySessionId: string, userId: string): Promise<void> {
    const session = this.discoverySessions.get(discoverySessionId);
    if (!session || session.userId !== userId) {
      return;
    }
    await session.page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  /**
   * Optional Clerk / test-user sign-in during discovery (same assist as evaluations).
   */
  async maybeDiscoveryAutoSignInAssist(
    discoverySessionId: string,
    userId: string,
    opts: {
      runUrl: string;
      projectForAuth: {
        testUserEmail: string | null;
        testUserPassword: string | null;
        testEmailProvider: string | null;
      } | null;
      wantAuto: boolean;
      clerkOtpMode: ClerkOtpMode;
      state: { clerkFullSignInDone: boolean };
    },
  ): Promise<void> {
    const session = this.discoverySessions.get(discoverySessionId);
    if (!session || session.userId !== userId) {
      return;
    }
    const projectAuth = this.projectAuthFromProject(opts.projectForAuth);
    await this.maybePlaybackClerkAuthAssist(
      { page: session.page, projectAuth },
      opts.runUrl,
      opts.wantAuto,
      opts.clerkOtpMode,
      opts.state,
    );
  }

  /** For clients that join `run:<evaluationId>` after progress was already broadcast. */
  getLatestEvaluationProgress(evaluationId: string): Record<string, unknown> | undefined {
    return this.lastEvaluationProgressById.get(evaluationId);
  }

  async runEvaluationPlaywright(evaluationId: string, userId: string, code: string): Promise<void> {
    const session = this.evaluationSessions.get(evaluationId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('No active evaluation browser session');
    }
    await this.executePwCode(session.page, code, {});
  }

  emitEvaluationProgress(evaluationId: string, payload: Record<string, unknown>): void {
    this.lastEvaluationProgressById.set(evaluationId, { evaluationId, ...payload });
    this.emit('evaluationProgress', evaluationId, payload);
  }

  /**
   * Append a timestamped line to the evaluation trace (WebSocket `evaluationDebugLog` + join catch-up batch).
   * Do not log secrets; keep `detail` to sizes, flags, and short previews.
   */
  emitEvaluationDebugLog(
    evaluationId: string,
    message: string,
    detail?: Record<string, unknown>,
  ): void {
    const at = new Date().toISOString();
    const line = { at, message, detail };
    let buf = this.evaluationDebugLogById.get(evaluationId);
    if (!buf) {
      buf = [];
      this.evaluationDebugLogById.set(evaluationId, buf);
    }
    buf.push(line);
    if (buf.length > RecordingService.EVAL_DEBUG_LOG_MAX_LINES) {
      buf.splice(0, buf.length - RecordingService.EVAL_DEBUG_LOG_MAX_LINES);
    }
    this.emit('evaluationDebugLog', evaluationId, line);
  }

  getEvaluationDebugLogLines(evaluationId: string): Array<{ at: string; message: string; detail?: Record<string, unknown> }> {
    return this.evaluationDebugLogById.get(evaluationId) ?? [];
  }

  /** Clears buffered trace lines (call when a new autonomous run starts). */
  clearEvaluationDebugLog(evaluationId: string): void {
    this.evaluationDebugLogById.delete(evaluationId);
  }

  private async createLiveRecordingSession(args: {
    runId: string;
    userId: string;
    captureSettings: RunCaptureSettings;
    projectAuth: ProjectAutoSignInCredentials | null;
  }): Promise<RecordingSession> {
    const workerUrl = this.configService.get<string>('BROWSER_WORKER_URL', 'ws://localhost:3002');
    const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
    const browser = await chromium.connect(wsEndpoint);
    const ffmpegStagingPath = path.join(os.tmpdir(), `br-screencast-${args.runId}-${randomUUID()}.mp4`);
    const screencastVideo = createScreencastVideoEncoder(ffmpegStagingPath, this.logger);
    try {
      const context = await browser.newContext({
        viewport: {
          width: args.captureSettings.recordingViewportWidth,
          height: args.captureSettings.recordingViewportHeight,
        },
        deviceScaleFactor: REMOTE_BROWSER_DEVICE_SCALE_FACTOR,
      });
      const page = await context.newPage();
      const cdpSession = await context.newCDPSession(page);
      const session: RecordingSession = {
        runId: args.runId,
        userId: args.userId,
        browser,
        page,
        cdpSession,
        stepSequence: 0,
        latestFrame: null,
        screencastVideo,
        recordingCaptureTail: Promise.resolve(),
        recordingDomCapturePaused: false,
        clerkDomCaptureBarrier: 0,
        projectAuth: args.projectAuth,
      };
      this.sessions.set(args.runId, session);
      await this.attachScreencast(session.cdpSession, session, session.runId, args.captureSettings, {
        onJpegFrame: (jpeg) => screencastVideo?.pushFrame(jpeg),
      });
      await this.setupEventCapture(session);
      return session;
    } catch (err) {
      this.sessions.delete(args.runId);
      screencastVideo?.kill();
      await removePathIfExists(ffmpegStagingPath).catch(() => {});
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  private async readLatestCheckpointSnapshot(args: {
    runId: string;
    userId: string;
  }): Promise<{ pageUrl: string; afterStepSequence: number; state: SnapshotStorageState } | null> {
    const checkpoint = await this.prisma.runCheckpoint.findFirst({
      where: { runId: args.runId, userId: args.userId, storageStatePath: { not: null } },
      orderBy: { afterStepSequence: 'desc' },
      select: { pageUrl: true, storageStatePath: true, afterStepSequence: true },
    });
    if (!checkpoint?.storageStatePath) return null;
    const artifactDir = getRunArtifactDir(getRecordingsBaseDir(this.configService), args.userId, args.runId);
    const raw = await fs.readFile(path.join(artifactDir, checkpoint.storageStatePath), 'utf8');
    return {
      pageUrl: checkpoint.pageUrl?.trim() || '',
      afterStepSequence: checkpoint.afterStepSequence,
      state: JSON.parse(raw) as SnapshotStorageState,
    };
  }

  async startRecording(userId: string, opts: RecordingStartOptions) {
    const pid = opts.projectId?.trim();
    const captureSettings = buildCaptureSettingsFromPresets(opts);
    let projectAuth: ProjectAutoSignInCredentials | null = null;
    if (pid) {
      const proj = await this.prisma.project.findFirst({ where: { id: pid, userId } });
      if (!proj) {
        throw new BadRequestException('Project not found');
      }
      projectAuth = this.projectAuthFromProject(proj);
    }

    const run = await this.prisma.run.create({
      data: {
        userId,
        name: opts.name,
        url: opts.url,
        projectId: pid || null,
        status: 'RECORDING',
        platform: 'DESKTOP',
        ...captureSettings,
        durationMs: 0,
        startedAt: new Date(),
      },
    });
    try {
      const session = await this.createLiveRecordingSession({
        runId: run.id,
        userId,
        captureSettings,
        projectAuth,
      });

      await session.page.goto(opts.url, { waitUntil: 'domcontentloaded' });

      const navStep = await this.recordStep(session, {
        action: 'NAVIGATE',
        selector: null,
        value: opts.url,
        instruction: `Navigate to ${opts.url}`,
        playwrightCode: `await page.goto('${opts.url}');`,
        origin: 'MANUAL',
      });

      this.emit('step', run.id, navStep);
      this.emit('status', run.id, { status: 'recording', runId: run.id });

      this.logger.log(`Recording started: ${run.id} -> ${opts.url}`);
      return run;
    } catch (err) {
      await this.prisma.run.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      const detail = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Recording could not start (browser worker / Playwright). ${detail}`,
      );
    }
  }

  async stopRecording(runId: string, userId: string, mode: StopRecordingMode = 'complete') {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return null;
    }

    for (const [key, p] of this.aiPromptTestInFlight) {
      if (key.startsWith(`${runId}:`)) {
        await p.catch(() => {});
      }
    }
    await this.waitForOptimizedPromptTasks(runId);

    const latestFrame = session.latestFrame;
    const screencastVideo = session.screencastVideo;
    session.screencastClosing = true;

    try {
      await session.cdpSession.send('Page.stopScreencast');
    } catch (err) {
      this.logger.warn('stopScreencast', err);
    }

    if (screencastVideo) {
      try {
        await screencastVideo.finalize();
      } catch (err) {
        this.logger.warn(`screencast video finalize failed for ${runId}:`, err);
      }
    }

    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn('Error closing browser', err);
    }

    this.sessions.delete(runId);
    this.clearAiPromptSnapshotsForRun(runId);

    /** Staging file written by ffmpeg on the API host (same process as this service). */
    let rawVideoPath: string | null = null;
    if (screencastVideo) {
      try {
        const st = await fs.stat(screencastVideo.outputPath);
        if (st.size > 0) {
          rawVideoPath = screencastVideo.outputPath;
        } else {
          this.logger.warn(`screencast video is empty for ${runId}, skipping copy`);
        }
      } catch {
        this.logger.warn(`screencast video not found or unreadable for ${runId}`);
      }
    }

    const base = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(base, userId, runId);
    let thumbnailUrl: string | null = null;
    let recordingUrl: string | null = null;
    let sizeBytes: number | null = null;

    const runRow = await this.prisma.run.findUnique({ where: { id: runId } });
    const wallClockSec =
      runRow?.startedAt != null
        ? Math.max(0.5, (Date.now() - runRow.startedAt.getTime()) / 1000)
        : 0;

    try {
      if (rawVideoPath) {
        const { videoPath, sizeBytes: sz } = await copyRecordingVideoToArtifacts(rawVideoPath, artifactDir);
        sizeBytes = sz;
        await adjustRecordingVideoDurationToWallClock(videoPath, wallClockSec, this.logger);
        const stAfterTiming = await fs.stat(videoPath);
        sizeBytes = stAfterTiming.size;
        const thumbPath = path.join(artifactDir, 'thumbnail.jpg');
        const ffmpegOk = await writeJpegThumbnailFromVideo(videoPath, thumbPath, this.logger);
        if (!ffmpegOk && latestFrame) {
          await fs.writeFile(thumbPath, latestFrame);
        }
        thumbnailUrl = `/api/runs/${runId}/recording/thumbnail`;
        recordingUrl = `/api/runs/${runId}/recording/video`;
      } else if (latestFrame) {
        await fs.mkdir(artifactDir, { recursive: true });
        const thumbPath = path.join(artifactDir, 'thumbnail.jpg');
        await fs.writeFile(thumbPath, latestFrame);
        thumbnailUrl = `/api/runs/${runId}/recording/thumbnail`;
      }
    } catch (err) {
      this.logger.warn(`persist recording artifacts failed for ${runId}:`, err);
    }

    if (screencastVideo) {
      await removePathIfExists(screencastVideo.outputPath).catch(() => {});
    }

    const started = runRow?.startedAt;
    const now = Date.now();
    const accumulatedDurationMs = (runRow?.durationMs ?? 0) + (started ? Math.round(now - started.getTime()) : 0);
    if (!started) {
      this.logger.warn(`stopRecording: run ${runId} missing startedAt; duration may be wrong`);
    }
    const run = await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: mode === 'save' ? 'PAUSED' : 'COMPLETED',
        startedAt: mode === 'save' ? null : runRow?.startedAt ?? null,
        completedAt: mode === 'save' ? null : new Date(now),
        durationMs: accumulatedDurationMs,
        thumbnailUrl,
      },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    if (recordingUrl && sizeBytes != null) {
      await this.prisma.runRecording.deleteMany({ where: { runId, userId } });
      await this.prisma.runRecording.create({
        data: {
          runId,
          userId,
          format: 'mp4',
          url: recordingUrl,
          sizeBytes,
        },
      });
    }

    if (mode === 'complete') {
      void this.refreshOptimizedPromptsForRun(runId, userId)
        .catch((err) => {
          this.logger.warn(`Optimized prompt stop-refresh failed for ${runId}: ${err}`);
        })
        .finally(() => {
          this.clearOptimizedPromptTasksForRun(runId);
        });
    } else {
      this.clearOptimizedPromptTasksForRun(runId);
    }

    this.emit('status', runId, { status: mode === 'save' ? 'paused' : 'completed', runId });
    this.logger.log(mode === 'save' ? `Recording saved for later: ${runId}` : `Recording stopped: ${runId}`);
    return run;
  }

  async resumeRecording(runId: string, userId: string) {
    const existingSession = this.sessions.get(runId);
    if (existingSession) {
      if (existingSession.userId !== userId) {
        throw new ForbiddenException('Not allowed to resume this recording session');
      }
      throw new ConflictException('Run is already recording');
    }

    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      include: {
        project: {
          select: {
            testUserEmail: true,
            testUserPassword: true,
            testEmailProvider: true,
          },
        },
      },
    });
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }
    if (run.status !== 'PAUSED' && run.status !== 'RECORDING') {
      throw new ConflictException('Only saved or dormant recordings can be resumed');
    }

    const latestStep = await this.prisma.runStep.findFirst({
      where: { runId, userId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const session = await this.createLiveRecordingSession({
      runId,
      userId,
      captureSettings: captureSettingsFromRun(run),
      projectAuth: this.projectAuthFromProject(run.project),
    });
    session.stepSequence = latestStep?.sequence ?? 0;

    try {
      const latestCheckpoint = await this.readLatestCheckpointSnapshot({ runId, userId }).catch((err) => {
        this.logger.warn(`resumeRecording ${runId} checkpoint restore skipped: ${err}`);
        return null;
      });
      if (latestCheckpoint) {
        await this.applyStorageStateToPage(session.page, latestCheckpoint.state, latestCheckpoint.pageUrl || run.url);
      } else {
        await session.page.goto(run.url, { waitUntil: 'domcontentloaded' });
      }
    } catch (err) {
      session.screencastClosing = true;
      try {
        await session.cdpSession.send('Page.stopScreencast');
      } catch {
        /* ignore */
      }
      if (session.screencastVideo) {
        session.screencastVideo.kill();
        await removePathIfExists(session.screencastVideo.outputPath).catch(() => {});
      }
      try {
        await session.browser.close();
      } catch {
        /* ignore */
      }
      this.sessions.delete(runId);
      this.clearAiPromptSnapshotsForRun(runId);
      this.clearOptimizedPromptTasksForRun(runId);
      const detail = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Recording could not resume. ${detail}`);
    }

    const resumedRun = await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: 'RECORDING',
        startedAt: new Date(),
        completedAt: null,
      },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    this.emit('status', runId, { status: 'recording', runId });
    this.logger.log(`Recording resumed: ${runId}`);
    return resumedRun;
  }

  /**
   * Closes browser + session without marking the run completed (used when deleting a RECORDING run).
   */
  async abortRecordingForDeletion(runId: string, userId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) {
      return;
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Not allowed to end this recording session');
    }
    session.screencastClosing = true;
    try {
      await session.cdpSession.send('Page.stopScreencast');
    } catch (err) {
      this.logger.warn(`abortRecordingForDeletion ${runId} stopScreencast:`, err);
    }
    if (session.screencastVideo) {
      session.screencastVideo.kill();
      await removePathIfExists(session.screencastVideo.outputPath).catch(() => {});
    }
    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn(`abortRecordingForDeletion ${runId} browser.close:`, err);
    }
    this.sessions.delete(runId);
    this.clearAiPromptSnapshotsForRun(runId);
    this.clearOptimizedPromptTasksForRun(runId);
    this.emit('status', runId, { status: 'cancelled', runId });
    this.logger.log(`Recording session aborted for delete: ${runId}`);
  }

  getRunArtifactFilePaths(runId: string, userId: string): {
    artifactDir: string;
    /** Preferred: H.264 MP4 (current encoder). */
    recordingVideoMp4: string;
    /** Legacy VP8 WebM from older runs. */
    recordingVideoWebm: string;
    thumbnailPath: string;
  } {
    const base = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(base, userId, runId);
    return {
      artifactDir,
      recordingVideoMp4: path.join(artifactDir, 'recording.mp4'),
      recordingVideoWebm: path.join(artifactDir, 'recording.webm'),
      thumbnailPath: path.join(artifactDir, 'thumbnail.jpg'),
    };
  }

  async deleteRunArtifactsFromDisk(runId: string, userId: string): Promise<void> {
    const { artifactDir } = this.getRunArtifactFilePaths(runId, userId);
    await removePathIfExists(artifactDir);
  }

  /**
   * One-shot Clerk + MailSlurp sign-in on the recording browser (server env credentials).
   * Persists **one** `CUSTOM` step with `metadata.kind === clerk_auto_sign_in` (otpMode + post-auth URL);
   * playback runs `performClerkPasswordEmail2FA` once from that metadata.
   */
  async clerkAutoSignInDuringRecording(
    runId: string,
    userId: string,
    opts?: { clerkOtpMode?: ClerkOtpMode },
  ) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('No active recording session for this run');
    }
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      include: {
        project: {
          select: {
            testUserEmail: true,
            testUserPassword: true,
            testEmailProvider: true,
          },
        },
      },
    });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    const projectAuth = session.projectAuth ?? this.projectAuthFromProject(run.project);
    const authKind = await this.resolveAutoSignInAuthKind(session.page, projectAuth);
    if (!authKind) {
      throw new BadRequestException(
        'Automatic sign-in is not configured for this project. Use a Clerk sign-in page with API env credentials, or set the project test email and password.',
      );
    }
    const otpMode = authKind === 'generic' ? projectAuth!.otpMode : opts?.clerkOtpMode ?? this.resolveClerkOtpMode(undefined);
    if (authKind === 'clerk' && !this.playbackClerkAssistAvailable(otpMode)) {
      if (!this.playbackClerkCoreEnvReady()) {
        throw new BadRequestException(
          'Clerk test credentials are not fully configured on the API. Set E2E_CLERK_USER_PASSWORD, E2E_CLERK_USER_EMAIL or E2E_CLERK_USER_USERNAME (use +clerk_test in the email for test-email OTP mode), CLERK_SECRET_KEY (or PLAYBACK_CLERK_SECRET_KEY / E2E_CLERK_SECRET_KEY), and CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY.',
        );
      }
      throw new BadRequestException(
        'MailSlurp OTP mode requires MAILSLURP_API_KEY and MAILSLURP_INBOX_ID or MAILSLURP_INBOX_EMAIL.',
      );
    }
    const baseURL = this.playbackClerkBaseUrl(run.url);
    /** Set before page pause so in-flight capture callbacks see it before `recordStep`. */
    session.recordingDomCapturePaused = true;
    session.clerkDomCaptureBarrier += 1;
    try {
      /** Do not record debounced `input` events from automated fill — a single CUSTOM step is persisted after. */
      await session.page.evaluate(() => {
        (globalThis as unknown as { __bladerunnerPauseRecording?: boolean }).__bladerunnerPauseRecording =
          true;
      });
      if (authKind === 'generic') {
        await performProjectPasswordSignIn(session.page, baseURL, projectAuth!);
      } else {
        const password = this.configService.get<string>('E2E_CLERK_USER_PASSWORD')!.trim();
        const identifier =
          this.configService.get<string>('E2E_CLERK_USER_USERNAME')?.trim() ||
          this.configService.get<string>('E2E_CLERK_USER_EMAIL')!.trim();
        await performClerkPasswordEmail2FA(session.page, {
          baseURL,
          identifier,
          password,
          skipInitialNavigate: true,
          otpMode,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`clerkAutoSignInDuringRecording failed: ${msg}`);
      throw new ServiceUnavailableException(`Automatic sign-in failed: ${msg}`);
    } finally {
      session.recordingDomCapturePaused = false;
      session.clerkDomCaptureBarrier += 1;
      try {
        await session.page.evaluate(() => {
          (globalThis as unknown as { __bladerunnerPauseRecording?: boolean }).__bladerunnerPauseRecording =
            false;
        });
      } catch {
        /* ignore */
      }
    }

    let postAuthPageUrl = '';
    try {
      postAuthPageUrl = normalizePlaybackUrl(session.page.url());
    } catch {
      try {
        postAuthPageUrl = session.page.url();
      } catch {
        postAuthPageUrl = '';
      }
    }
    if (!postAuthPageUrl.trim()) {
      try {
        postAuthPageUrl = normalizePlaybackUrl(run.url);
      } catch {
        postAuthPageUrl = run.url;
      }
    }

    /** Drop sloppy manual captures (clicks/types) after navigate so the single auto sign-in step replaces them. */
    const removed = await this.prisma.runStep.deleteMany({
      where: { runId, userId, sequence: { gt: 1 } },
    });
    await this.prisma.runCheckpoint.deleteMany({
      where: { runId, userId, afterStepSequence: { gt: 1 } },
    });
    session.stepSequence = 1;
    if (removed.count > 0) {
      this.logger.log(
        `Recording ${runId}: removed ${removed.count} manual step(s) after navigate before automatic Clerk sign-in step`,
      );
    }

    const step = await this.recordStep(
      session,
      {
        action: 'CUSTOM',
        selector: null,
        value: null,
        instruction: buildClerkAutoSignInInstruction(otpMode, authKind),
        playwrightCode: clerkAutoSignInSentinelPlaywrightCode(),
        origin: 'MANUAL',
      },
      {
        clerkAutoSignInBlock: {
          authKind,
          otpMode,
          postAuthPageUrl,
        },
      },
    );
    this.emit('step', runId, step);
    /** If a debounced OTP `input` still fires after unpause, drop one matching TYPE. */
    session.skipDuplicateClerkOtpDomCaptureOnce = true;
    this.logger.log(
      `Recording ${runId}: clerk auto sign-in completed, single step sequence ${step.sequence}`,
    );
    return { ok: true as const, step };
  }

  async executeInstruction(runId: string, userId: string, instruction: string) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new Error('No active recording session found');
    }

    const { pageUrl, somManifest, accessibilitySnapshot, screenshotBase64 } =
      await this.captureLlmPageContext(session.page);

    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      select: { projectId: true },
    });
    const agentContextBlock = await this.agentContextService.getPromptInjectionBlock(userId, run?.projectId);

    const llmResult = await this.llmService.instructionToAction(
      {
        instruction,
        pageUrl,
        somManifest,
        accessibilitySnapshot,
        screenshotBase64,
        ...(agentContextBlock.trim() ? { agentContextBlock } : {}),
      },
      { userId },
    );
    const out = llmResult.output;

    try {
      await this.executePwCode(session.page, out.playwrightCode);
    } catch (err) {
      this.logger.error(`Playwright execution failed: ${err}`);
      throw new Error(`Failed to execute action: ${err}`);
    }

    await session.page.waitForLoadState('domcontentloaded').catch(() => {});

    const step = await this.recordStep(session, {
      action: (out.action?.toUpperCase() || 'CUSTOM') as any,
      selector: out.selector || null,
      value: out.value || null,
      instruction,
      playwrightCode: out.playwrightCode,
      recordedPlaywrightCode: out.playwrightCode,
      origin: 'AI_DRIVEN',
    });

    const optimizedCtx = await this.captureLlmPageContext(session.page).catch((err) => {
      this.logger.warn(`Optimized prompt capture after executeInstruction failed for ${step.id}: ${err}`);
      return null;
    });
    if (optimizedCtx) {
      this.scheduleOptimizedPromptGeneration(
        session,
        step,
        this.buildOptimizedPromptEvidencePayload(step, optimizedCtx),
        'immediate',
      );
    }

    this.emit('step', runId, step);
    return step;
  }

  /**
   * Re-capture a single step by natural-language instruction while recording (replaces row in place).
   * Origin/metadata follow the same Clerk/MailSlurp rules as new steps.
   */
  async reRecordStep(runId: string, userId: string, stepId: string, instruction: string) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('No active recording session for this run');
    }
    const trimmed = instruction?.trim();
    if (!trimmed) {
      throw new BadRequestException('instruction is required');
    }

    const existing = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Step not found');
    }

    const { pageUrl, somManifest, accessibilitySnapshot, screenshotBase64 } =
      await this.captureLlmPageContext(session.page);

    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      select: { projectId: true },
    });
    const agentContextBlock = await this.agentContextService.getPromptInjectionBlock(userId, run?.projectId);

    const llmResult = await this.llmService.instructionToAction(
      {
        instruction: trimmed,
        pageUrl,
        somManifest,
        accessibilitySnapshot,
        screenshotBase64,
        ...(agentContextBlock.trim() ? { agentContextBlock } : {}),
      },
      { userId },
    );
    const out = llmResult.output;

    try {
      await this.executePwCode(session.page, out.playwrightCode);
    } catch (err) {
      this.logger.error(`reRecordStep Playwright execution failed: ${err}`);
      throw new BadRequestException(`Failed to execute action: ${err}`);
    }

    await session.page.waitForLoadState('domcontentloaded').catch(() => {});

    const data = {
      action: (out.action?.toUpperCase() || 'CUSTOM') as string,
      selector: out.selector || null,
      value: out.value || null,
      instruction: trimmed,
      playwrightCode: out.playwrightCode,
      recordedPlaywrightCode: out.playwrightCode,
      origin: 'AI_DRIVEN' as const,
    };

    const { metadata, origin, instruction: finalInstruction } = await this.buildStepPersistence(session, data, {
      stepSequenceHint: existing.sequence,
    });

    const step = await this.prisma.runStep.update({
      where: { id: stepId },
      data: {
        action: data.action as any,
        selector: data.selector,
        value: data.value,
        instruction: finalInstruction,
        playwrightCode: data.playwrightCode,
        recordedPlaywrightCode: data.recordedPlaywrightCode,
        origin: origin as any,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        timestamp: new Date(),
      },
    });

    void this.persistCheckpointAfterStep(session, step).catch((err) => {
      this.logger.warn(`Checkpoint after re-record step ${step.sequence}: ${err}`);
    });

    const optimizedCtx = await this.captureLlmPageContext(session.page).catch((err) => {
      this.logger.warn(`Optimized prompt capture after re-record failed for ${step.id}: ${err}`);
      return null;
    });
    if (optimizedCtx) {
      this.scheduleOptimizedPromptGeneration(
        session,
        step,
        this.buildOptimizedPromptEvidencePayload(step, optimizedCtx),
        'immediate',
      );
    }

    this.emit('step', runId, step);
    this.logger.log(`Recording ${runId}: re-recorded step ${step.sequence} (${stepId})`);
    return step;
  }

  /**
   * Update a step row: set human prompt, enable/disable AI prompt mode (metadata + `AI_PROMPT` origin).
   */
  async patchRunStep(
    runId: string,
    userId: string,
    stepId: string,
    dto: { instruction?: string; aiPromptMode?: boolean; excludedFromPlayback?: boolean },
  ): Promise<RunStep> {
    const existing = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Step not found');
    }

    if (
      dto.excludedFromPlayback !== undefined &&
      dto.instruction === undefined &&
      dto.aiPromptMode === undefined
    ) {
      return this.prisma.runStep.update({
        where: { id: stepId },
        data: { excludedFromPlayback: dto.excludedFromPlayback },
      });
    }

    if (dto.aiPromptMode === true) {
      const instr = (dto.instruction ?? existing.instruction).trim();
      if (!instr) {
        throw new BadRequestException('instruction is required when enabling AI prompt mode');
      }
      return this.prisma.runStep.update({
        where: { id: stepId },
        data: {
          instruction: instr,
          action: 'CUSTOM',
          origin: 'AI_PROMPT',
          playwrightCode: aiPromptStepSentinelPlaywrightCode(),
          recordedPlaywrightCode: existing.recordedPlaywrightCode,
          metadata: {
            kind: AI_PROMPT_STEP_KIND,
            schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION,
          } as Prisma.InputJsonValue,
        },
      });
    }

    if (dto.aiPromptMode === false) {
      const pw = existing.playwrightCode ?? '';
      const keepPw = pw && !pw.includes('ai_prompt_step: execution');
      const recordedPw = existing.recordedPlaywrightCode ?? '';
      const keepRecordedPw = recordedPw && !isAiPromptSentinelPlaywrightCode(recordedPw);
      return this.prisma.runStep.update({
        where: { id: stepId },
        data: {
          origin: 'MANUAL',
          metadata: Prisma.JsonNull,
          playwrightCode: keepPw
            ? pw
            : keepRecordedPw
              ? recordedPw
            : '// Reverted from AI prompt — use Re-record to capture Playwright',
        },
      });
    }

    if (dto.instruction !== undefined) {
      const t = dto.instruction.trim();
      if (!t) {
        throw new BadRequestException('instruction cannot be empty');
      }
      return this.prisma.runStep.update({
        where: { id: stepId },
        data: {
          instruction: t,
          ...(dto.excludedFromPlayback !== undefined ? { excludedFromPlayback: dto.excludedFromPlayback } : {}),
        },
      });
    }

    throw new BadRequestException('Provide instruction and/or aiPromptMode, or excludedFromPlayback alone');
  }

  /**
   * After the user added or edited `anchorStepId`, ask the LLM which forward steps should be marked skip replay.
   */
  async suggestSkipReplayAfterChange(
    runId: string,
    userId: string,
    anchorStepId: string,
  ): Promise<{ suggestions: Array<{ stepId: string; reason: string }> }> {
    const anchor = await this.prisma.runStep.findFirst({
      where: { id: anchorStepId, runId, userId },
      select: {
        id: true,
        sequence: true,
        instruction: true,
        action: true,
        origin: true,
      },
    });
    if (!anchor) {
      throw new NotFoundException('Step not found');
    }

    const forward = await this.prisma.runStep.findMany({
      where: {
        runId,
        userId,
        sequence: { gt: anchor.sequence },
        excludedFromPlayback: false,
      },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        sequence: true,
        instruction: true,
        action: true,
        origin: true,
      },
    });

    if (forward.length === 0) {
      return { suggestions: [] };
    }

    const llm = await this.llmService.suggestStepsToSkipAfterChange(
      {
        anchor: {
          sequence: anchor.sequence,
          instruction: anchor.instruction,
          action: anchor.action,
          origin: anchor.origin,
        },
        forwardSteps: forward.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          instruction: s.instruction,
          action: s.action,
          origin: s.origin,
        })),
      },
      { userId },
    );

    const allowed = new Set(forward.map((s) => s.id));
    const suggestions: Array<{ stepId: string; reason: string }> = [];
    for (const s of llm.suggestions) {
      if (!allowed.has(s.stepId)) continue;
      suggestions.push({ stepId: s.stepId, reason: s.reason });
    }
    return { suggestions };
  }

  /**
   * Mark multiple steps as skip replay; only steps after `anchorStepId` and not already skipped are updated.
   */
  async bulkMarkSkipReplay(
    runId: string,
    userId: string,
    anchorStepId: string,
    stepIds: string[],
  ): Promise<{ updated: number }> {
    const anchor = await this.prisma.runStep.findFirst({
      where: { id: anchorStepId, runId, userId },
      select: { sequence: true },
    });
    if (!anchor) {
      throw new NotFoundException('Anchor step not found');
    }
    const unique = [...new Set(stepIds)].filter(Boolean);
    if (unique.length === 0) {
      return { updated: 0 };
    }

    const rows = await this.prisma.runStep.findMany({
      where: { runId, userId, id: { in: unique } },
      select: { id: true, sequence: true, excludedFromPlayback: true },
    });
    const okIds = rows
      .filter((r) => r.sequence > anchor.sequence && !r.excludedFromPlayback)
      .map((r) => r.id);
    if (okIds.length === 0) {
      return { updated: 0 };
    }

    const result = await this.prisma.runStep.updateMany({
      where: { runId, userId, id: { in: okIds } },
      data: { excludedFromPlayback: true },
    });
    return { updated: result.count };
  }

  /**
   * Permanently delete all steps with `excludedFromPlayback`; renumber remaining steps and remap checkpoints.
   */
  async purgeSkippedSteps(runId: string, userId: string): Promise<{ deleted: number }> {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      select: { status: true },
    });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    if (run.status === 'RECORDING') {
      throw new BadRequestException('Finish recording before purging skipped steps');
    }

    const toRemove = await this.prisma.runStep.findMany({
      where: { runId, userId, excludedFromPlayback: true },
      orderBy: { sequence: 'asc' },
    });
    if (toRemove.length === 0) {
      return { deleted: 0 };
    }

    const deletedSeqs = new Set(toRemove.map((s) => s.sequence));
    const deletedIds = toRemove.map((s) => s.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.runCheckpoint.deleteMany({
        where: { runId, userId, afterStepSequence: { in: [...deletedSeqs] } },
      });

      await tx.runStep.deleteMany({ where: { id: { in: deletedIds } } });

      const remaining = await tx.runStep.findMany({
        where: { runId, userId },
        orderBy: { sequence: 'asc' },
      });

      if (remaining.length === 0) {
        await tx.runCheckpoint.deleteMany({ where: { runId, userId } });
        return;
      }

      const oldToNew = new Map<number, number>();
      remaining.forEach((s, i) => {
        oldToNew.set(s.sequence, i + 1);
      });

      for (let i = 0; i < remaining.length; i++) {
        const newSeq = i + 1;
        if (remaining[i].sequence !== newSeq) {
          await tx.runStep.update({
            where: { id: remaining[i].id },
            data: { sequence: newSeq },
          });
        }
      }

      const checkpoints = await tx.runCheckpoint.findMany({
        where: { runId, userId },
      });
      for (const cp of checkpoints) {
        const newSeq = oldToNew.get(cp.afterStepSequence);
        if (newSeq === undefined) {
          await tx.runCheckpoint.delete({ where: { id: cp.id } });
        } else if (newSeq !== cp.afterStepSequence) {
          await tx.runCheckpoint.update({
            where: { id: cp.id },
            data: { afterStepSequence: newSeq },
          });
        }
      }
    });

    return { deleted: toRemove.length };
  }

  /**
   * Ephemeral: run LLM + vision + codegen on the current recording or playback page (same as playback for AI prompt steps).
   * Optional `instruction` overrides the stored step text for this run only (draft testing). Captures URL + `storageState` before running so `resetAiPromptTest` can undo.
   */
  async testAiPromptStep(
    runId: string,
    userId: string,
    stepId: string,
    opts?: { instruction?: string; signal?: AbortSignal; phase?: 'full' | 'generate' | 'run' },
  ): Promise<{
    ok: boolean;
    playwrightCode?: string;
    error?: string;
    cancelled?: boolean;
    failureHelp?: AiPromptTestFailureHelp;
  }> {
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
    });
    if (!step) {
      throw new NotFoundException('Step not found');
    }
    if (!isAiPromptStepMetadata(step.metadata) && step.origin !== 'AI_PROMPT') {
      throw new BadRequestException('Step is not an AI prompt step');
    }

    const page = this.findLivePageForRun(runId, userId);
    if (!page) {
      throw new BadRequestException(
        'Start recording or playback for this run to test — no active browser session',
      );
    }

    const instructionOverride = opts?.instruction?.trim();
    const instructionToRun = (instructionOverride ?? step.instruction).trim();
    if (!instructionToRun) {
      throw new BadRequestException('instruction is empty');
    }

    const signal = opts?.signal;

    /** While testing on the live *recording* page, generated Playwright must not create new RunSteps from DOM capture. */
    const recordingSession = this.sessions.get(runId);
    const pauseDomCapture = !!recordingSession && recordingSession.userId === userId;
    if (pauseDomCapture) {
      recordingSession.recordingDomCapturePaused = true;
      recordingSession.clerkDomCaptureBarrier += 1;
      try {
        await page.evaluate(() => {
          (globalThis as unknown as { __bladerunnerPauseRecording?: boolean }).__bladerunnerPauseRecording =
            true;
        });
      } catch {
        /* page may be closing */
      }
    }

    try {
      const testFlightKey = this.aiPromptSnapshotKey(runId, stepId);
      const playbackSessionForTest = this.findPlaybackSessionByPage(page);
      const apiPhase = opts?.phase ?? 'full';
      const testPromise = (async () => {
        let lastAttemptedPlaywrightCode =
          typeof step.playwrightCode === 'string' && step.playwrightCode.trim()
            ? step.playwrightCode.trim()
            : undefined;
        let retried = false;
        try {
          this.emitAiPromptTestProgress(runId, stepId, 'Preparing snapshot for undo (Reset)…', 'capturing');
          this.throwIfAborted(signal);

          let url = '';
          try {
            url = page.url();
          } catch {
            /* */
          }
          const state = await page.context().storageState();
          this.aiPromptPreTestSnapshots.set(this.aiPromptSnapshotKey(runId, stepId), { url, state });

          const runRow = await this.prisma.run.findFirst({
            where: { id: runId, userId },
            select: { projectId: true },
          });
          const projectId = runRow?.projectId ?? null;

          let playwrightCode: string;

          if (apiPhase === 'run') {
            const row = await this.prisma.runStep.findFirst({
              where: { id: stepId, runId, userId },
            });
            const meta =
              row?.metadata && typeof row.metadata === 'object'
                ? (row.metadata as Record<string, unknown>)
                : {};
            if (meta.lastAiPromptCodegenOk !== true) {
              throw new BadRequestException(
                'Generate Playwright first — use the generate (vision + codegen) step before Run on page.',
              );
            }
            if ((meta.lastAiPromptCodegenInstruction as string | undefined)?.trim() !== instructionToRun) {
              throw new BadRequestException(
                'Prompt changed since last generate — generate Playwright again before running on the page.',
              );
            }
            const pw = row?.playwrightCode?.trim() ?? '';
            const sentinel = aiPromptStepSentinelPlaywrightCode().trim();
            if (!pw || pw === sentinel) {
              throw new BadRequestException('No generated Playwright to run — generate first.');
            }
            lastAttemptedPlaywrightCode = pw;
            const runResult = await this.playAiPromptStepOnPage(page, instructionToRun, {
              userId,
              projectId,
              skipClickForce: false,
              signal,
              progress: { runId, stepId },
              phase: 'executeOnly',
              executePlaywrightCode: pw,
            });
            playwrightCode = runResult.playwrightCode;

            const freshAfter = await this.prisma.runStep.findFirst({
              where: { id: stepId, runId, userId },
            });
            const baseMetaRun =
              freshAfter?.metadata && typeof freshAfter.metadata === 'object'
                ? (freshAfter.metadata as Record<string, unknown>)
                : {};
            await this.prisma.runStep.update({
              where: { id: stepId },
              data: {
                recordedPlaywrightCode: this.resolveStepRecordedPlaywrightCode(
                  freshAfter ?? row ?? { recordedPlaywrightCode: null, playwrightCode: pw },
                  playwrightCode,
                ),
                metadata: {
                  ...baseMetaRun,
                  kind: AI_PROMPT_STEP_KIND,
                  schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION,
                  lastAiPromptRunOk: true,
                  lastAiPromptRunInstruction: instructionToRun,
                  lastTestAt: new Date().toISOString(),
                  lastTestOk: true,
                } as Prisma.InputJsonValue,
              },
            });
          } else {
            const playPhase = apiPhase === 'generate' ? 'generateOnly' : 'full';
            const attemptPlayPhase = () =>
              this.playAiPromptStepOnPage(page, instructionToRun, {
                userId,
                projectId,
                skipClickForce: false,
                persistTranscript: { stepId, runId, userId, source: 'test' },
                signal,
                progress: { runId, stepId },
                phase: playPhase,
              });
            let out: Awaited<ReturnType<typeof attemptPlayPhase>>;
            try {
              out = await attemptPlayPhase();
            } catch (firstErr) {
              const firstFailure = classifyRecordingAutomationFailure(firstErr);
              if (apiPhase !== 'generate' || !firstFailure.isRetryable || signal?.aborted) {
                throw firstErr;
              }
              retried = true;
              this.logger.warn(
                `Retrying AI prompt generate after ${firstFailure.kind} for run ${runId} step ${stepId}`,
              );
              this.emitAiPromptTestProgress(
                runId,
                stepId,
                'Transient timeout while generating Playwright. Retrying once…',
                'llm',
              );
              out = await attemptPlayPhase();
            }
            playwrightCode = out.playwrightCode;
            lastAttemptedPlaywrightCode = playwrightCode;

            const fresh = await this.prisma.runStep.findFirst({
              where: { id: stepId, runId, userId },
            });
            const baseMeta =
              fresh?.metadata && typeof fresh.metadata === 'object'
                ? (fresh.metadata as Record<string, unknown>)
                : {};
            const nowIso = new Date().toISOString();
            if (apiPhase === 'generate') {
              await this.prisma.runStep.update({
                where: { id: stepId },
                data: {
                  recordedPlaywrightCode: this.resolveStepRecordedPlaywrightCode(
                    fresh ?? { recordedPlaywrightCode: null, playwrightCode },
                    playwrightCode,
                  ),
                  metadata: {
                    ...baseMeta,
                    kind: AI_PROMPT_STEP_KIND,
                    schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION,
                    lastAiPromptCodegenOk: true,
                    lastAiPromptCodegenInstruction: instructionToRun,
                    lastAiPromptRunOk: false,
                    lastTestAt: nowIso,
                    lastTestOk: false,
                  } as Prisma.InputJsonValue,
                  playwrightCode,
                },
              });
            } else {
              await this.prisma.runStep.update({
                where: { id: stepId },
                data: {
                  recordedPlaywrightCode: this.resolveStepRecordedPlaywrightCode(
                    fresh ?? { recordedPlaywrightCode: null, playwrightCode },
                    playwrightCode,
                  ),
                  metadata: {
                    ...baseMeta,
                    kind: AI_PROMPT_STEP_KIND,
                    schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION,
                    lastAiPromptCodegenOk: true,
                    lastAiPromptCodegenInstruction: instructionToRun,
                    lastAiPromptRunOk: true,
                    lastAiPromptRunInstruction: instructionToRun,
                    lastTestAt: nowIso,
                    lastTestOk: true,
                  } as Prisma.InputJsonValue,
                  playwrightCode,
                },
              });
            }
          }

          const doneMsg =
            apiPhase === 'generate'
              ? 'Playwright code generated.'
              : apiPhase === 'run'
                ? 'Playwright run completed on the page.'
                : 'Test completed.';
          this.emitAiPromptTestProgress(runId, stepId, doneMsg, 'done');
          return { ok: true, playwrightCode };
        } catch (e) {
          const failure = classifyRecordingAutomationFailure(e);
          if (signal?.aborted || failure.isAbort || this.isAbortError(e)) {
            this.emitAiPromptTestProgress(runId, stepId, 'Cancelled.', 'cancelled');
            return { ok: false, error: 'Cancelled', cancelled: true };
          }
          const msg = failure.message;
          let failureHelp: AiPromptTestFailureHelp | undefined;
          try {
            const ctx = await this.captureLlmPageContext(page, signal);
            const hint = await this.llmService.explainAiPromptTestFailure(
              {
                instruction: instructionToRun,
                technicalError: msg,
                pageUrl: ctx.pageUrl,
                pageAccessibilityTree: this.combineSomAndA11yForExplain(ctx),
                screenshotBase64: ctx.screenshotBase64,
                failedPlaywrightCode: lastAttemptedPlaywrightCode,
                recordedPlaywrightCode:
                  step.recordedPlaywrightCode && step.recordedPlaywrightCode.trim()
                    ? step.recordedPlaywrightCode.trim()
                    : undefined,
              },
              { signal, userId },
            );
            if (hint) {
              failureHelp = hint;
            }
          } catch (explainErr) {
            this.logger.debug(`explainAiPromptTestFailure skipped: ${explainErr}`);
          }
          this.emitAiPromptTestProgress(
            runId,
            stepId,
            msg.length > 140 ? `${msg.slice(0, 137)}…` : msg,
            'error',
            failureHelp?.suggestedPrompt?.trim()
              ? { suggestedPrompt: failureHelp.suggestedPrompt.trim() }
              : undefined,
          );
          const fresh = await this.prisma.runStep.findFirst({
            where: { id: stepId, runId, userId },
          });
          const baseMeta =
            fresh?.metadata && typeof fresh.metadata === 'object'
              ? (fresh.metadata as Record<string, unknown>)
              : {};
          const transcriptCode =
            baseMeta.lastLlmTranscript &&
            typeof baseMeta.lastLlmTranscript === 'object' &&
            typeof (baseMeta.lastLlmTranscript as { rawResponse?: unknown }).rawResponse === 'string'
              ? ((baseMeta.lastLlmTranscript as { rawResponse: string }).rawResponse.trim() || undefined)
              : undefined;
          const failedPlaywrightCode =
            lastAttemptedPlaywrightCode ??
            (typeof fresh?.playwrightCode === 'string' && fresh.playwrightCode.trim()
              ? fresh.playwrightCode.trim()
              : undefined) ??
            transcriptCode;
          const failurePatch: Record<string, unknown> = {
            ...baseMeta,
            kind: AI_PROMPT_STEP_KIND,
            schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION,
            lastTestAt: new Date().toISOString(),
            lastTestOk: false,
            lastAiPromptFailureAt: new Date().toISOString(),
            lastAiPromptFailureKind: failure.kind,
            lastAiPromptFailureMessage: msg,
            lastAiPromptFailureInstruction: instructionToRun,
            lastAiPromptRetried: retried,
          };
          if (failedPlaywrightCode) {
            failurePatch.lastAiPromptFailedPlaywrightCode = failedPlaywrightCode;
          }
          if (apiPhase === 'generate') {
            failurePatch.lastAiPromptCodegenOk = false;
            failurePatch.lastAiPromptRunOk = false;
          } else if (apiPhase === 'run') {
            failurePatch.lastAiPromptRunOk = false;
          } else {
            failurePatch.lastAiPromptCodegenOk = false;
            failurePatch.lastAiPromptRunOk = false;
          }
          await this.prisma.runStep.update({
            where: { id: stepId },
            data: {
              metadata: failurePatch as Prisma.InputJsonValue,
            },
          });

          return { ok: false, error: msg, failureHelp };
        }
      })();
      this.aiPromptTestInFlight.set(testFlightKey, testPromise.then(() => {}).catch(() => {}));
      try {
        if (playbackSessionForTest) {
          return await this.runWithActivePlaybackStep(playbackSessionForTest, () => testPromise);
        }
        return await testPromise;
      } finally {
        this.aiPromptTestInFlight.delete(testFlightKey);
      }
    } finally {
      if (pauseDomCapture && recordingSession) {
        recordingSession.recordingDomCapturePaused = false;
        recordingSession.clerkDomCaptureBarrier += 1;
        try {
          await page.evaluate(() => {
            (globalThis as unknown as { __bladerunnerPauseRecording?: boolean }).__bladerunnerPauseRecording =
              false;
          });
        } catch {
          /* */
        }
      }
    }
  }

  /** Which playback session owns this page, if any (used to serialize stop vs in-flight Test). */
  private findPlaybackSessionByPage(page: Page): PlaybackSession | null {
    for (const s of this.playbackSessions.values()) {
      if (s.page === page) {
        return s;
      }
    }
    return null;
  }

  /** Recording session page, or any active playback session sourced from this run. */
  findLivePageForRun(runId: string, userId: string): Page | null {
    const rec = this.sessions.get(runId);
    if (rec && rec.userId === userId) {
      return rec.page;
    }
    for (const s of this.playbackSessions.values()) {
      if (s.sourceRunId === runId && s.userId === userId) {
        return s.page;
      }
    }
    return null;
  }

  private aiPromptSnapshotKey(runId: string, stepId: string): string {
    return `${runId}:${stepId}`;
  }

  /** @internal Used by `RunsController` when starting `test-ai-step` so cancel / client disconnect can abort. */
  registerAiPromptTestAbort(runId: string, stepId: string, ac: AbortController): void {
    this.aiPromptTestAbortControllers.set(this.aiPromptSnapshotKey(runId, stepId), ac);
  }

  unregisterAiPromptTestAbort(runId: string, stepId: string): void {
    this.aiPromptTestAbortControllers.delete(this.aiPromptSnapshotKey(runId, stepId));
  }

  /**
   * Best-effort abort for an in-flight `test-ai-step` (vision request or between phases).
   * Generated Playwright may still run briefly after the model returns.
   */
  async abortAiPromptTest(runId: string, userId: string, stepId: string): Promise<{ ok: boolean }> {
    const row = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException('Step not found');
    }
    this.aiPromptTestAbortControllers.get(this.aiPromptSnapshotKey(runId, stepId))?.abort();
    return { ok: true };
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }
  }

  private isAbortError(e: unknown): boolean {
    if (e instanceof Error && e.name === 'AbortError') return true;
    const msg = e instanceof Error ? e.message : String(e);
    return /aborted|AbortError/i.test(msg);
  }

  private resolveStepRecordedPlaywrightCode(
    step: Pick<RunStep, 'recordedPlaywrightCode' | 'playwrightCode'>,
    nextActiveCode?: string | null,
  ): string | null {
    return resolveRecordedPlaywrightCode(step.recordedPlaywrightCode, step.playwrightCode, nextActiveCode);
  }

  private async persistStepPlaywrightCodeState(
    step: Pick<RunStep, 'id' | 'recordedPlaywrightCode' | 'playwrightCode' | 'metadata'>,
    activePlaywrightCode: string,
    extraMetadata?: Record<string, unknown>,
  ): Promise<void> {
    const recordedPlaywrightCode = this.resolveStepRecordedPlaywrightCode(step, activePlaywrightCode);
    const baseMeta =
      step.metadata && typeof step.metadata === 'object' ? { ...(step.metadata as Record<string, unknown>) } : {};
    await this.prisma.runStep.update({
      where: { id: step.id },
      data: {
        playwrightCode: activePlaywrightCode,
        recordedPlaywrightCode,
        ...(extraMetadata
          ? {
              metadata: {
                ...baseMeta,
                ...extraMetadata,
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  }

  private async persistPlaybackRepairFailure(
    step: RunStep,
    failure: ReturnType<typeof classifyRecordingAutomationFailure>,
    opts: {
      failedPlaywrightCode?: string | null;
      generatedPlaywrightCode?: string | null;
    } = {},
  ): Promise<void> {
    const baseMeta =
      step.metadata && typeof step.metadata === 'object' ? { ...(step.metadata as Record<string, unknown>) } : {};
    const recordedPlaywrightCode = this.resolveStepRecordedPlaywrightCode(step, opts.generatedPlaywrightCode);
    const nowIso = new Date().toISOString();
    const metadataPatch = buildPlaybackRepairMetadataPatch(baseMeta, {
      failureAt: nowIso,
      failureKind: failure.kind,
      failureMessage: failure.message,
      failedPlaywrightCode: opts.failedPlaywrightCode ?? step.playwrightCode,
      generatedPlaywrightCode: opts.generatedPlaywrightCode,
      recordedPlaywrightCode,
    });
    if (isAiPromptStepMetadata(step.metadata) || step.origin === 'AI_PROMPT') {
      metadataPatch.kind = AI_PROMPT_STEP_KIND;
      metadataPatch.schemaVersion = AI_PROMPT_STEP_SCHEMA_VERSION;
      metadataPatch.lastAiPromptRunOk = false;
      metadataPatch.lastAiPromptFailureAt = nowIso;
      metadataPatch.lastAiPromptFailureKind = failure.kind;
      metadataPatch.lastAiPromptFailureMessage = failure.message;
      metadataPatch.lastAiPromptFailureInstruction = step.instruction;
      metadataPatch.lastAiPromptRetried = !!opts.generatedPlaywrightCode;
      if ((opts.failedPlaywrightCode ?? step.playwrightCode)?.trim()) {
        metadataPatch.lastAiPromptFailedPlaywrightCode = (
          opts.failedPlaywrightCode ?? step.playwrightCode
        )?.trim();
      }
    }
    await this.prisma.runStep.update({
      where: { id: step.id },
      data: {
        metadata: metadataPatch as Prisma.InputJsonValue,
        ...(recordedPlaywrightCode && !step.recordedPlaywrightCode
          ? { recordedPlaywrightCode }
          : {}),
      },
    });
  }

  private shouldAttemptPlaybackRepair(step: Pick<RunStep, 'instruction'>, failure: ReturnType<typeof classifyRecordingAutomationFailure>): boolean {
    if (failure.isAbort || failure.kind === 'other') return false;
    return !!step.instruction?.trim();
  }

  /** Keep socket payloads bounded (JPEG is separate). */
  private static readonly AI_PROMPT_SOCKET_TEXT_MAX = 120_000;

  private clipAiPromptSocketText(s: string, max = RecordingService.AI_PROMPT_SOCKET_TEXT_MAX): string {
    const t = s.trim();
    if (!t) return '';
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  private emitAiPromptTestProgress(
    runId: string,
    stepId: string,
    message: string,
    phase: 'capturing' | 'llm' | 'executing' | 'done' | 'error' | 'cancelled',
    extras?: {
      thinking?: string;
      screenshotBase64?: string;
      /** Instruction text for this test (draft / override). */
      promptSent?: string;
      /** Full user message sent to the vision LLM. */
      fullUserPrompt?: string;
      /** Raw assistant string from the model (usually JSON). */
      rawResponse?: string;
      /** Generated Playwright source to run next. */
      playwrightCode?: string;
      /** When Test fails with failure-help from the explain LLM. */
      suggestedPrompt?: string;
      /** True while Gemini stream is in progress; client merges cumulative `rawResponse` / `thinking`. */
      streamingPartial?: boolean;
    },
  ): void {
    const payload: Record<string, unknown> = { runId, stepId, message, phase };
    if (extras?.streamingPartial === true) {
      payload.streamingPartial = true;
    }
    if (extras?.thinking?.trim()) {
      payload.thinking = extras.thinking.trim();
    }
    if (extras?.screenshotBase64?.trim()) {
      payload.screenshotBase64 = extras.screenshotBase64.trim();
    }
    if (extras?.promptSent?.trim()) {
      payload.promptSent = this.clipAiPromptSocketText(extras.promptSent, 16_384);
    }
    if (extras?.fullUserPrompt?.trim()) {
      payload.fullUserPrompt = this.clipAiPromptSocketText(extras.fullUserPrompt);
    }
    if (extras?.rawResponse?.trim()) {
      payload.rawResponse = this.clipAiPromptSocketText(extras.rawResponse);
    }
    if (extras?.playwrightCode?.trim()) {
      payload.playwrightCode = this.clipAiPromptSocketText(extras.playwrightCode);
    }
    if (extras?.suggestedPrompt?.trim()) {
      payload.suggestedPrompt = this.clipAiPromptSocketText(extras.suggestedPrompt, 16_384);
    }
    this.emit('aiPromptTestProgress', runId, payload);
    for (const s of this.playbackSessions.values()) {
      if (s.sourceRunId === runId) {
        this.emit('aiPromptTestProgress', s.playbackSessionId, payload);
      }
    }
  }

  private clearAiPromptSnapshotsForRun(runId: string): void {
    const prefix = `${runId}:`;
    for (const k of this.aiPromptPreTestSnapshots.keys()) {
      if (k.startsWith(prefix)) {
        this.aiPromptPreTestSnapshots.delete(k);
      }
    }
  }

  private optimizedPromptTaskKey(runId: string, stepId: string): string {
    return `${runId}:${stepId}`;
  }

  private clearOptimizedPromptTasksForRun(runId: string): void {
    const prefix = `${runId}:`;
    for (const key of this.optimizedPromptInFlight.keys()) {
      if (key.startsWith(prefix)) {
        this.optimizedPromptInFlight.delete(key);
      }
    }
  }

  private async waitForOptimizedPromptTasks(runId: string): Promise<void> {
    for (const [key, task] of this.optimizedPromptInFlight) {
      if (key.startsWith(`${runId}:`)) {
        await task.catch(() => {});
      }
    }
  }

  private shouldGenerateOptimizedPromptForStep(step: Pick<RunStep, 'origin' | 'instruction'>): boolean {
    if (step.origin === 'AUTOMATIC') return false;
    return !!step.instruction?.trim();
  }

  private humanPromptForOptimizedStep(step: Pick<RunStep, 'origin' | 'instruction'>): string | null {
    if (step.origin === 'AI_DRIVEN' || step.origin === 'AI_PROMPT') {
      const prompt = step.instruction?.trim();
      return prompt ? prompt : null;
    }
    return null;
  }

  private stepSummaryForOptimizedContext(step: Pick<RunStep, 'instruction' | 'metadata'>): string {
    const optimized = getOptimizedPromptStored(step.metadata);
    return optimized?.step_intent_summary?.trim() || step.instruction.trim();
  }

  private async writeOptimizedPromptEvidence(
    runId: string,
    userId: string,
    step: Pick<RunStep, 'id' | 'sequence'>,
    payload: OptimizedPromptEvidencePayload,
    source: OptimizedPromptCompileSource,
  ): Promise<OptimizedPromptEvidenceRef> {
    const baseDir = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(baseDir, userId, runId);
    const promptDir = path.join(artifactDir, 'optimized-prompts');
    await fs.mkdir(promptDir, { recursive: true });
    const stem = `step-${String(step.sequence).padStart(4, '0')}-${step.id}`;
    const evidenceFile = `${stem}.json`;
    const screenshotFile = `${stem}.jpg`;
    const evidencePath = path.join(promptDir, evidenceFile);
    const screenshotPath = payload.screenshotBase64?.trim()
      ? path.join(promptDir, screenshotFile)
      : null;
    if (screenshotPath) {
      await fs.writeFile(screenshotPath, Buffer.from(payload.screenshotBase64!.trim(), 'base64'));
    }
    await fs.writeFile(
      evidencePath,
      JSON.stringify(
        {
          schemaVersion: OPTIMIZED_PROMPT_SCHEMA_VERSION,
          capturedAt: new Date().toISOString(),
          source,
          pageUrl: payload.pageUrl,
          somManifest: payload.somManifest,
          accessibilitySnapshot: payload.accessibilitySnapshot,
          playwrightSnippet: payload.playwrightSnippet,
          recordingMode: payload.recordingMode,
          humanPromptOrNull: payload.humanPromptOrNull,
          optionalPageMetadata: payload.optionalPageMetadata,
        },
        null,
        2,
      ),
    );
    return {
      schemaVersion: OPTIMIZED_PROMPT_SCHEMA_VERSION,
      capturedAt: new Date().toISOString(),
      source,
      evidencePath: path.relative(artifactDir, evidencePath),
      screenshotPath: screenshotPath ? path.relative(artifactDir, screenshotPath) : null,
    };
  }

  private async readOptimizedPromptEvidence(
    runId: string,
    userId: string,
    metadata: unknown,
  ): Promise<OptimizedPromptEvidencePayload | null> {
    const ref = getOptimizedPromptEvidenceRef(metadata);
    if (!ref) return null;
    const artifactDir = getRunArtifactDir(getRecordingsBaseDir(this.configService), userId, runId);
    try {
      const raw = JSON.parse(await fs.readFile(path.join(artifactDir, ref.evidencePath), 'utf8')) as Record<
        string,
        unknown
      >;
      const screenshotBase64 =
        ref.screenshotPath != null
          ? (await fs.readFile(path.join(artifactDir, ref.screenshotPath))).toString('base64')
          : undefined;
      return {
        pageUrl: typeof raw.pageUrl === 'string' ? raw.pageUrl : '',
        somManifest: typeof raw.somManifest === 'string' ? raw.somManifest : '',
        accessibilitySnapshot:
          typeof raw.accessibilitySnapshot === 'string' ? raw.accessibilitySnapshot : '',
        playwrightSnippet: typeof raw.playwrightSnippet === 'string' ? raw.playwrightSnippet : '',
        recordingMode: typeof raw.recordingMode === 'string' ? raw.recordingMode : 'unknown',
        humanPromptOrNull:
          typeof raw.humanPromptOrNull === 'string' && raw.humanPromptOrNull.trim()
            ? raw.humanPromptOrNull.trim()
            : null,
        optionalPageMetadata:
          typeof raw.optionalPageMetadata === 'string' ? raw.optionalPageMetadata : '',
        ...(screenshotBase64 ? { screenshotBase64 } : {}),
      };
    } catch (err) {
      this.logger.warn(`readOptimizedPromptEvidence ${runId}: ${err}`);
      return null;
    }
  }

  private async buildOptimizedPromptAppContext(
    run: {
      id: string;
      name: string;
      url: string;
      project?: { id: string; name?: string | null; kind?: string | null; url?: string | null } | null;
    },
    userId: string,
  ): Promise<string> {
    const agentFields = await this.agentContextService.getAppContextKnowledgeFields(
      userId,
      run.project?.id ?? null,
    );
    return JSON.stringify(
      {
        runId: run.id,
        runName: run.name,
        runUrl: run.url,
        project:
          run.project != null
            ? {
                id: run.project.id,
                name: run.project.name ?? null,
                kind: run.project.kind ?? null,
                url: run.project.url ?? null,
              }
            : null,
        agentKnowledge: {
          general: agentFields.general,
          projectManual: agentFields.projectManual,
          discoveryContext: agentFields.discoveryContext,
        },
      },
      null,
      2,
    );
  }

  private buildOptimizedPromptWorkflowContext(
    run: { name: string; url: string },
    steps: RunStep[],
    step: RunStep,
  ): string {
    return JSON.stringify(
      {
        runName: run.name,
        runUrl: run.url,
        totalSteps: steps.length,
        currentStepSequence: step.sequence,
        currentInstruction: step.instruction,
      },
      null,
      2,
    );
  }

  private buildOptimizedPromptEvidencePayload(
    step: Pick<RunStep, 'action' | 'selector' | 'value' | 'origin' | 'instruction' | 'playwrightCode'>,
    ctx: {
      pageUrl: string;
      somManifest: string;
      accessibilitySnapshot: string;
      screenshotBase64?: string;
    },
  ): OptimizedPromptEvidencePayload {
    return {
      pageUrl: ctx.pageUrl,
      somManifest: ctx.somManifest,
      accessibilitySnapshot: ctx.accessibilitySnapshot,
      playwrightSnippet: step.playwrightCode,
      recordingMode: step.origin.toLowerCase(),
      humanPromptOrNull: this.humanPromptForOptimizedStep(step),
      optionalPageMetadata: JSON.stringify(
        {
          pageUrl: ctx.pageUrl,
          stepAction: step.action,
          selector: step.selector,
          value: step.value,
          instruction: step.instruction,
        },
        null,
        2,
      ),
      ...(ctx.screenshotBase64?.trim() ? { screenshotBase64: ctx.screenshotBase64.trim() } : {}),
    };
  }

  private async generateOptimizedPromptForStep(
    stepId: string,
    runId: string,
    userId: string,
    source: OptimizedPromptCompileSource,
    evidenceOverride?: OptimizedPromptEvidencePayload,
  ): Promise<void> {
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
    });
    if (!step || !this.shouldGenerateOptimizedPromptForStep(step)) return;

    const evidence = evidenceOverride ?? (await this.readOptimizedPromptEvidence(runId, userId, step.metadata));
    if (!evidence) return;

    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      include: {
        project: { select: { id: true, name: true, kind: true, url: true } },
      },
    });
    if (!run) return;

    const steps = await this.prisma.runStep.findMany({
      where: { runId, userId },
      orderBy: { sequence: 'asc' },
    });
    const idx = steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const current = steps[idx];
    const previousStepSummaries = steps
      .slice(0, idx)
      .map((s) => this.stepSummaryForOptimizedContext(s))
      .filter(Boolean);
    const nextStepSummaries = steps
      .slice(idx + 1)
      .map((s) => this.stepSummaryForOptimizedContext(s))
      .filter(Boolean);

    const compilerInput: OptimizedPromptCompilerInput = {
      appContext: await this.buildOptimizedPromptAppContext(run, userId),
      workflowContext: this.buildOptimizedPromptWorkflowContext(run, steps, current),
      stepId: current.id,
      stepIndex: current.sequence,
      recordingMode: evidence.recordingMode,
      timestamp: current.timestamp.toISOString(),
      previousStepSummaries,
      nextStepSummaries,
      humanPromptOrNull: evidence.humanPromptOrNull,
      playwrightSnippet: evidence.playwrightSnippet,
      taggedScreenshotDescription: evidence.somManifest,
      accessibilityTree: evidence.accessibilitySnapshot,
      optionalPageMetadata: evidence.optionalPageMetadata,
      screenshotBase64: evidence.screenshotBase64,
    };

    const baseMeta =
      current.metadata && typeof current.metadata === 'object'
        ? { ...(current.metadata as Record<string, unknown>) }
        : {};

    try {
      const compiled = await this.llmService.compileOptimizedPrompt(compilerInput, {
        userId,
      });
      const evidenceRef = getOptimizedPromptEvidenceRef(current.metadata);
      if (!evidenceRef) return;
      await this.prisma.runStep.update({
        where: { id: stepId },
        data: {
          metadata: withOptimizedPromptSuccess(
            baseMeta,
            {
              ...compiled.output,
              schemaVersion: OPTIMIZED_PROMPT_SCHEMA_VERSION,
              generatedAt: new Date().toISOString(),
              source,
            },
            evidenceRef,
          ) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.runStep.update({
        where: { id: stepId },
        data: {
          metadata: withOptimizedPromptFailure(baseMeta, source, message) as Prisma.InputJsonValue,
        },
      });
      this.logger.warn(`Optimized prompt generation failed for ${stepId}: ${message}`);
    }
  }

  private scheduleOptimizedPromptGeneration(
    session: RecordingSession,
    step: RunStep,
    evidence: OptimizedPromptEvidencePayload,
    source: OptimizedPromptCompileSource,
  ): void {
    if (!this.shouldGenerateOptimizedPromptForStep(step)) return;
    const taskKey = this.optimizedPromptTaskKey(step.runId, step.id);
    const task = (async () => {
      const ref = await this.writeOptimizedPromptEvidence(step.runId, session.userId, step, evidence, source);
      const baseMeta =
        step.metadata && typeof step.metadata === 'object' ? { ...(step.metadata as Record<string, unknown>) } : {};
      await this.prisma.runStep.update({
        where: { id: step.id },
        data: {
          metadata: {
            ...baseMeta,
            optimizedPromptEvidence: ref,
            lastOptimizedPromptAttemptAt: new Date().toISOString(),
            lastOptimizedPromptSource: source,
          } as Prisma.InputJsonValue,
        },
      });
      await this.generateOptimizedPromptForStep(step.id, step.runId, session.userId, source, evidence);
    })()
      .catch((err) => {
        this.logger.warn(`scheduleOptimizedPromptGeneration ${taskKey}: ${err}`);
      })
      .finally(() => {
        this.optimizedPromptInFlight.delete(taskKey);
      });
    this.optimizedPromptInFlight.set(taskKey, task);
  }

  private async refreshOptimizedPromptsForRun(runId: string, userId: string): Promise<void> {
    const steps = await this.prisma.runStep.findMany({
      where: { runId, userId },
      orderBy: { sequence: 'asc' },
    });
    for (const step of steps) {
      if (!this.shouldGenerateOptimizedPromptForStep(step)) continue;
      if (!getOptimizedPromptEvidenceRef(step.metadata)) continue;
      await this.generateOptimizedPromptForStep(step.id, runId, userId, 'recording_stop_refresh');
    }
  }

  /**
   * Append an AI prompt step during an active recording (no DOM capture). Emits `step` like other recorded steps.
   */
  async appendAiPromptStepDuringRecording(
    runId: string,
    userId: string,
    dto: { instruction: string; excludedFromPlayback?: boolean },
  ): Promise<RunStep> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('No active recording session for this run');
    }
    const instr = dto.instruction?.trim();
    if (!instr) {
      throw new BadRequestException('instruction is required');
    }
    session.stepSequence += 1;
    const step = await this.prisma.runStep.create({
      data: {
        runId,
        userId,
        sequence: session.stepSequence,
        action: 'CUSTOM',
        selector: null,
        value: null,
        instruction: instr,
        playwrightCode: aiPromptStepSentinelPlaywrightCode(),
        recordedPlaywrightCode: null,
        origin: 'AI_PROMPT',
        metadata: {
          kind: AI_PROMPT_STEP_KIND,
          schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION,
        } as Prisma.InputJsonValue,
        excludedFromPlayback: dto.excludedFromPlayback ?? false,
        timestamp: new Date(),
      },
    });
    void this.persistCheckpointAfterStep(session, step).catch((err) => {
      this.logger.warn(`Checkpoint after AI prompt step ${step.sequence}: ${err}`);
    });
    const optimizedCtx = await this.captureLlmPageContext(session.page).catch((err) => {
      this.logger.warn(`Optimized prompt capture after AI prompt append failed for ${step.id}: ${err}`);
      return null;
    });
    if (optimizedCtx) {
      this.scheduleOptimizedPromptGeneration(
        session,
        step,
        this.buildOptimizedPromptEvidencePayload(step, optimizedCtx),
        'immediate',
      );
    }
    this.emit('step', runId, step);
    return step;
  }

  /**
   * Remove the most recently recorded step while recording (e.g. cancel an “Add AI step” draft). Renumbers are not needed — only the tail step is allowed.
   */
  async deleteLastRunStepDuringRecording(runId: string, userId: string, stepId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('No active recording session for this run');
    }
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
    });
    if (!step) {
      throw new NotFoundException('Step not found');
    }
    if (step.sequence !== session.stepSequence) {
      throw new BadRequestException('Only the last recorded step can be removed during recording');
    }
    await this.prisma.runCheckpoint.deleteMany({
      where: { runId, userId, afterStepSequence: step.sequence },
    });
    await this.prisma.runStep.delete({ where: { id: stepId } });
    session.stepSequence -= 1;
    this.aiPromptPreTestSnapshots.delete(this.aiPromptSnapshotKey(runId, stepId));
  }

  /**
   * Restore the live browser to the state captured immediately before the last `testAiPromptStep` for this step,
   * or fall back to the checkpoint after the previous step (`afterStepSequence === sequence - 1`).
   */
  async resetAiPromptTest(runId: string, userId: string, stepId: string): Promise<{ ok: boolean }> {
    const step = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
    });
    if (!step) {
      throw new NotFoundException('Step not found');
    }
    if (!isAiPromptStepMetadata(step.metadata) && step.origin !== 'AI_PROMPT') {
      throw new BadRequestException('Step is not an AI prompt step');
    }
    const page = this.findLivePageForRun(runId, userId);
    if (!page) {
      throw new BadRequestException(
        'Start recording or playback for this run to reset — no active browser session',
      );
    }

    const key = this.aiPromptSnapshotKey(runId, stepId);
    const snap = this.aiPromptPreTestSnapshots.get(key);
    let targetUrl: string;
    let state: SnapshotStorageState;

    if (snap) {
      targetUrl = snap.url;
      state = snap.state;
    } else {
      const prevSeq = step.sequence - 1;
      if (prevSeq < 1) {
        throw new BadRequestException('No checkpoint before this step');
      }
      const cp = await this.prisma.runCheckpoint.findFirst({
        where: { runId, userId, afterStepSequence: prevSeq },
      });
      if (!cp?.storageStatePath) {
        throw new BadRequestException(
          'No snapshot to restore — enable recording checkpoints or run Test once so a pre-test snapshot is stored',
        );
      }
      const base = getRecordingsBaseDir(this.configService);
      const artifactDir = getRunArtifactDir(base, userId, runId);
      const abs = path.join(artifactDir, cp.storageStatePath);
      let raw: string;
      try {
        raw = await fs.readFile(abs, 'utf-8');
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new BadRequestException(`Checkpoint file missing or unreadable: ${detail}`);
      }
      state = JSON.parse(raw) as SnapshotStorageState;
      targetUrl = (cp.pageUrl && cp.pageUrl.trim()) || '';
      if (!targetUrl) {
        const runRow = await this.prisma.run.findFirst({
          where: { id: runId, userId },
          select: { url: true },
        });
        targetUrl = runRow?.url?.trim() || 'about:blank';
      }
    }

    await this.applyStorageStateToPage(page, state, targetUrl);
    return { ok: true };
  }

  private async applyStorageStateToPage(page: Page, state: SnapshotStorageState, targetUrl: string): Promise<void> {
    const context = page.context();
    await context.clearCookies();
    if (state.cookies?.length) {
      await context.addCookies(state.cookies);
    }
    const origins = state.origins ?? [];
    for (const origin of origins) {
      const o = origin.origin;
      if (!o?.trim()) continue;
      try {
        await page.goto(o, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      } catch {
        await page.goto(o, { waitUntil: 'load', timeout: 120_000 }).catch(() => {});
      }
      const ls = origin.localStorage ?? [];
      await page.evaluate((items: Array<{ name: string; value: string }>) => {
        try {
          localStorage.clear();
          for (const { name, value } of items) {
            localStorage.setItem(name, value);
          }
        } catch {
          /* storage may be blocked */
        }
      }, ls);
    }
    const dest =
      targetUrl.trim() ||
      origins[0]?.origin ||
      (() => {
        try {
          return page.url();
        } catch {
          return 'about:blank';
        }
      })();
    try {
      await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    } catch {
      await page.goto(dest, { waitUntil: 'load', timeout: 120_000 });
    }
  }

  /**
   * CDP accessibility snapshots are often sparse on SPAs (title only), so the LLM invents
   * `placeholder="John"`-style selectors → Playwright auto-waits until timeout. Append body text.
   */
  /**
   * Playwright CDP accessibility snapshot (+ body text enrichment), **before** Set-of-Marks overlay
   * so the tree does not include badge UI.
   */
  private axValue(value: unknown): string | number | boolean | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (!value || typeof value !== 'object') return null;
    const raw = (value as { value?: unknown }).value;
    return this.axValue(raw);
  }

  private cdpAxNodeToTree(
    nodeId: string,
    byId: Map<string, any>,
    seen = new Set<string>(),
  ): {
    role?: string | number | boolean;
    name?: string | number | boolean;
    value?: string | number | boolean;
    description?: string | number | boolean;
    properties?: Array<{ name?: string | number | boolean; value?: string | number | boolean }>;
    children?: unknown[];
  } | null {
    if (seen.has(nodeId)) return null;
    const node = byId.get(nodeId);
    if (!node) return null;
    seen.add(nodeId);
    const children = Array.isArray(node.childIds)
      ? node.childIds
          .map((childId: string) => this.cdpAxNodeToTree(childId, byId, seen))
          .filter(
            (
              child: unknown,
            ): child is {
              role?: string | number | boolean;
              name?: string | number | boolean;
              value?: string | number | boolean;
              description?: string | number | boolean;
              properties?: Array<{ name?: string | number | boolean; value?: string | number | boolean }>;
              children?: unknown[];
            } =>
              !!child,
          )
      : [];
    const properties = Array.isArray(node.properties)
      ? node.properties
          .map((prop: any) => ({
            name: this.axValue(prop?.name) ?? undefined,
            value: this.axValue(prop?.value) ?? undefined,
          }))
          .filter((prop: { name?: string | number | boolean; value?: string | number | boolean }) => prop.name != null)
      : [];
    return {
      role: this.axValue(node.role) ?? undefined,
      name: this.axValue(node.name) ?? undefined,
      value: this.axValue(node.value) ?? undefined,
      description: this.axValue(node.description) ?? undefined,
      ...(properties.length ? { properties } : {}),
      ...(children.length ? { children } : {}),
    };
  }

  private async captureAccessibilitySnapshotObject(page: Page, cdpSession?: CDPSession): Promise<unknown | null> {
    try {
      const accessibilityApi = (page as any).accessibility;
      const hasApi = !!accessibilityApi?.snapshot;
      const defaultSnapshot = hasApi ? await accessibilityApi.snapshot().catch(() => null) : null;
      const fullSnapshot = hasApi
        ? await accessibilityApi.snapshot({ interestingOnly: false }).catch(() => null)
        : null;
      let cdpSnapshot: unknown | null = null;
      if (!fullSnapshot && !defaultSnapshot) {
        const ownedSession =
          cdpSession ??
          (await page
            .context()
            .newCDPSession(page)
            .catch(() => null));
        if (ownedSession) {
          try {
            const result = (await ownedSession.send('Accessibility.getFullAXTree')) as {
              nodes?: Array<{
                nodeId: string;
                childIds?: string[];
                role?: unknown;
                name?: unknown;
                value?: unknown;
                description?: unknown;
              properties?: unknown[];
              }>;
            };
            const nodes = result.nodes ?? [];
            const byId = new Map(nodes.map((node) => [node.nodeId, node]));
            const rootNode =
              nodes.find((node) => {
                const role = this.axValue(node.role);
                return typeof role === 'string' && role.toLowerCase() === 'rootwebarea';
              }) ?? nodes[0] ?? null;
            cdpSnapshot = rootNode ? this.cdpAxNodeToTree(rootNode.nodeId, byId) : null;
          } finally {
            if (!cdpSession) {
              await ownedSession.detach().catch(() => {});
            }
          }
        }
      }
      return fullSnapshot ?? defaultSnapshot ?? cdpSnapshot ?? null;
    } catch (error) {
      return null;
    }
  }

  private async captureAccessibilitySnapshotForLlm(page: Page, snapshot?: unknown | null): Promise<string> {
    let pageAccessibilityTree = snapshot ? JSON.stringify(snapshot, null, 2) : '';
    if (!pageAccessibilityTree.trim()) {
      try {
        pageAccessibilityTree = await page.title();
      } catch {
        pageAccessibilityTree = 'Unable to capture accessibility tree';
      }
    }
    return this.enrichAccessibilityTreeForLlm(page, pageAccessibilityTree);
  }

  /** For failure-explain LLM: one string with both SOM and a11y sections (matches what codegen sees). */
  private combineSomAndA11yForExplain(ctx: { somManifest: string; accessibilitySnapshot: string }): string {
    const parts: string[] = [];
    if (ctx.somManifest.trim()) {
      parts.push(`=== Set-of-Marks manifest ===\n${ctx.somManifest.trim()}`);
    }
    if (ctx.accessibilitySnapshot.trim()) {
      parts.push(`=== Accessibility snapshot ===\n${ctx.accessibilitySnapshot.trim()}`);
    }
    return parts.join('\n\n') || ctx.accessibilitySnapshot.trim() || '(no DOM context)';
  }

  private async enrichAccessibilityTreeForLlm(page: Page, base: string): Promise<string> {
    if (base.length >= 2000) return base;
    try {
      /** Runs in browser; string form avoids Node `tsc` needing DOM lib for `document`. */
      const vis = (await page.evaluate(
        "() => { const t = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim(); return t.slice(0, 12000); }",
      )) as string;
      if (vis.length > 40) {
        return `${base}\n\n---\nVisible page text (use for getByLabel/getByRole/getByPlaceholder; do not invent placeholders from example names in the instruction):\n${vis}`;
      }
    } catch {
      /* */
    }
    return base;
  }

  /** Parsed env for full-page vision JPEG caps; invalid values fall back to defaults / unset width. */
  private llmVisionFullPageMaxHeightPx(): number {
    const raw = this.configService.get<string>('LLM_VISION_FULL_PAGE_MAX_HEIGHT_PX')?.trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 256) return Math.floor(n);
    return LLM_VISION_FULL_PAGE_MAX_HEIGHT_DEFAULT;
  }

  private llmVisionFullPageMaxWidthPx(): number | undefined {
    const raw = this.configService.get<string>('LLM_VISION_FULL_PAGE_MAX_WIDTH_PX')?.trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 256) return Math.floor(n);
    return undefined;
  }

  /**
   * Full-page screenshots can exceed model limits; uniform downscale keeps Set-of-Marks badges aligned with controls.
   */
  private async maybeResizeLlmVisionJpeg(buf: Buffer): Promise<Buffer> {
    const maxH = this.llmVisionFullPageMaxHeightPx();
    const maxW = this.llmVisionFullPageMaxWidthPx();
    try {
      const meta = await sharp(buf).metadata();
      const h = meta.height ?? 0;
      const w = meta.width ?? 0;
      if (!h || !w) return buf;
      const overH = h > maxH;
      const overW = maxW != null && w > maxW;
      if (!overH && !overW) return buf;
      this.logger.debug(
        `LLM vision JPEG ${w}×${h}px exceeds cap; resizing (max ${maxW ?? '∞'}×${maxH})`,
      );
      const resized = sharp(buf).resize(
        maxW != null
          ? { width: maxW, height: maxH, fit: 'inside', withoutEnlargement: true }
          : { height: maxH, fit: 'inside', withoutEnlargement: true },
      );
      return await resized.jpeg({ quality: LLM_VISION_SCREENSHOT_JPEG_QUALITY }).toBuffer();
    } catch (e) {
      this.logger.warn(`maybeResizeLlmVisionJpeg failed, using original buffer: ${e}`);
      return buf;
    }
  }

  private async captureLlmPageContext(
    page: Page,
    signal?: AbortSignal,
    cdpSession?: CDPSession,
  ): Promise<{
    pageUrl: string;
    /** Set-of-Marks lines `[n] …` aligned with numeric badges on the JPEG; empty if injection failed. */
    somManifest: string;
    /** CDP accessibility JSON (+ enrichment), captured before overlay. */
    accessibilitySnapshot: string;
    rawAccessibilitySnapshot: unknown | null;
    screenshotBase64?: string;
    somTags: AiVisualIdTag[];
    screenshotWidth?: number;
    screenshotHeight?: number;
  }> {
    this.throwIfAborted(signal);
    const pageUrl = page.url();
    const rawAccessibilitySnapshot = await this.captureAccessibilitySnapshotObject(page, cdpSession);
    const accessibilitySnapshot = await this.captureAccessibilitySnapshotForLlm(page, rawAccessibilitySnapshot);

    let somManifest = '';
    let screenshotBase64: string | undefined;
    let somTags: AiVisualIdTag[] = [];
    let screenshotWidth: number | undefined;
    let screenshotHeight: number | undefined;

    try {
      const { manifestText, tags } = await injectSetOfMarkOverlay(page);
      somManifest = manifestText;
      somTags = tags;
      this.throwIfAborted(signal);
      const rawBuf = await page.screenshot({
        type: 'jpeg',
        quality: LLM_VISION_SCREENSHOT_JPEG_QUALITY,
        fullPage: true,
        animations: 'disabled',
      });
      const rawMeta = await sharp(rawBuf).metadata();
      const buf = await this.maybeResizeLlmVisionJpeg(Buffer.from(rawBuf));
      const meta = await sharp(buf).metadata();
      screenshotWidth = meta.width ?? undefined;
      screenshotHeight = meta.height ?? undefined;
      const rawWidth = rawMeta.width ?? meta.width ?? 0;
      const rawHeight = rawMeta.height ?? meta.height ?? 0;
      if (rawWidth > 0 && rawHeight > 0 && screenshotWidth && screenshotHeight) {
        const scaleX = screenshotWidth / rawWidth;
        const scaleY = screenshotHeight / rawHeight;
        somTags = somTags.map((tag) => ({
          ...tag,
          left: Math.round(tag.left * scaleX),
          top: Math.round(tag.top * scaleY),
        }));
      }
      screenshotBase64 = buf.toString('base64');
    } catch (err) {
      /** Tagged screenshot is best-effort when overlay/screenshot fails; a11y snapshot was already captured. */
      this.logger.warn(`captureLlmPageContext: Set-of-Marks or screenshot failed (${err})`);
      try {
        const rawBuf = await page.screenshot({
          type: 'jpeg',
          quality: LLM_VISION_SCREENSHOT_JPEG_QUALITY,
          fullPage: true,
          animations: 'disabled',
        });
        const buf = await this.maybeResizeLlmVisionJpeg(Buffer.from(rawBuf));
        const meta = await sharp(buf).metadata();
        screenshotWidth = meta.width ?? undefined;
        screenshotHeight = meta.height ?? undefined;
        screenshotBase64 = buf.toString('base64');
      } catch {
        /* optional */
      }
    } finally {
      await removeSetOfMarkOverlay(page).catch(() => {});
    }

    return {
      pageUrl,
      somManifest,
      accessibilitySnapshot,
      rawAccessibilitySnapshot,
      screenshotBase64,
      somTags,
      screenshotWidth,
      screenshotHeight,
    };
  }

  /** Vision + LLM → Playwright, then optionally execute (used by playback and Test Step). */
  private async playAiPromptStepOnPage(
    page: Page,
    instruction: string,
    opts: {
      /** Clerk user id — selects per-user LLM model routing in Settings. */
      userId?: string;
      /** When set (e.g. run linked to a project), merges project manual + discovery into codegen. */
      projectId?: string | null;
      skipClickForce: boolean;
      signal?: AbortSignal;
      progress?: { runId: string; stepId: string };
      /** Default `full`: vision + codegen + execute. `generateOnly`: vision + codegen. `executeOnly`: run `executePlaywrightCode` only. */
      phase?: 'full' | 'generateOnly' | 'executeOnly';
      /** Required when `phase` is `executeOnly`. */
      executePlaywrightCode?: string;
      repairContext?: {
        failedPlaywrightCode?: string;
        recordedPlaywrightCode?: string;
        priorFailureKind?: string;
        priorFailureMessage?: string;
      };
      persistTranscript?: {
        stepId: string;
        runId: string;
        userId: string;
        source: 'test' | 'playback';
        /**
         * After persisting `lastLlmTranscript` (incl. screenshot), emit so clients refetch steps **before**
         * generated Playwright runs (which can take minutes).
         */
        playbackEmit?: {
          playbackSessionId: string;
          sourceRunId: string;
          step: { id: string; sequence: number; action: string; instruction: string };
        };
      };
    },
  ): Promise<{ playwrightCode: string }> {
    const { signal, progress } = opts;
    const phase = opts.phase ?? 'full';

    if (phase === 'executeOnly') {
      const code = opts.executePlaywrightCode?.trim() ?? '';
      const sentinel = aiPromptStepSentinelPlaywrightCode().trim();
      if (!code || code === sentinel || code.includes('ai_prompt_step: execution')) {
        throw new BadRequestException(
          'No generated Playwright to run — generate code first (vision + LLM step).',
        );
      }
      if (progress) {
        this.emitAiPromptTestProgress(
          progress.runId,
          progress.stepId,
          'Running generated Playwright on the page…',
          'executing',
        );
      }
      this.throwIfAborted(signal);
      try {
        page.setDefaultTimeout(AI_PROMPT_PW_TIMEOUT_MS);
        page.setDefaultNavigationTimeout(AI_PROMPT_PW_TIMEOUT_MS);
        await this.executePwCode(page, code, {
          skipClickForce: opts.skipClickForce,
        });
      } finally {
        page.setDefaultTimeout(PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
        page.setDefaultNavigationTimeout(PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
      }
      return { playwrightCode: code };
    }

    if (progress) {
      this.emitAiPromptTestProgress(
        progress.runId,
        progress.stepId,
        'Capturing Set-of-Marks overlay and viewport screenshot…',
        'capturing',
      );
    }
    this.throwIfAborted(signal);

    const { pageUrl, somManifest, accessibilitySnapshot, screenshotBase64 } = await this.captureLlmPageContext(
      page,
      signal,
    );
    if (progress) {
      this.emitAiPromptTestProgress(
        progress.runId,
        progress.stepId,
        'Calling vision model (this may take a minute)…',
        'llm',
        {
          ...(screenshotBase64?.trim() ? { screenshotBase64: screenshotBase64.trim() } : {}),
          promptSent: instruction.trim(),
        },
      );
    }
    this.throwIfAborted(signal);

    let agentContextBlock = '';
    const uid = opts.userId ?? opts.persistTranscript?.userId;
    if (uid) {
      agentContextBlock = (
        await this.agentContextService.getPromptInjectionBlock(uid, opts.projectId ?? null)
      ).trim();
    }

    const fullUserPrompt = buildGeminiInstructionPrompt({
      instruction: instruction.trim(),
      pageUrl,
      somManifest,
      accessibilitySnapshot,
      ...(agentContextBlock ? { agentContextBlock } : {}),
      failedPlaywrightCode: opts.repairContext?.failedPlaywrightCode,
      recordedPlaywrightCode: opts.repairContext?.recordedPlaywrightCode,
      priorFailureKind: opts.repairContext?.priorFailureKind,
      priorFailureMessage: opts.repairContext?.priorFailureMessage,
    });

    const llmUserId = opts.userId ?? opts.persistTranscript?.userId;

    const llmResult = await this.llmService.instructionToAction(
      {
        instruction: instruction.trim(),
        pageUrl,
        somManifest,
        accessibilitySnapshot,
        screenshotBase64,
        ...(agentContextBlock ? { agentContextBlock } : {}),
        failedPlaywrightCode: opts.repairContext?.failedPlaywrightCode,
        recordedPlaywrightCode: opts.repairContext?.recordedPlaywrightCode,
        priorFailureKind: opts.repairContext?.priorFailureKind,
        priorFailureMessage: opts.repairContext?.priorFailureMessage,
      },
      {
        userId: llmUserId,
        signal,
        onStream: progress
          ? (ev) => {
              this.emitAiPromptTestProgress(
                progress.runId,
                progress.stepId,
                'Generating Playwright from vision model…',
                'llm',
                {
                  ...(screenshotBase64?.trim() ? { screenshotBase64: screenshotBase64.trim() } : {}),
                  promptSent: instruction.trim(),
                  fullUserPrompt,
                  rawResponse: ev.rawText,
                  ...(ev.thinking?.trim() ? { thinking: ev.thinking.trim() } : {}),
                  streamingPartial: true,
                },
              );
            }
          : undefined,
      },
    );
    const out = llmResult.output;
    const transcript = llmResult.transcript;
    if (progress) {
      const thinkingRaw = transcript.thinking?.trim();
      const maxThink = 12_000;
      const thinking =
        thinkingRaw && thinkingRaw.length > maxThink ? `${thinkingRaw.slice(0, maxThink)}…` : thinkingRaw;
      this.emitAiPromptTestProgress(
        progress.runId,
        progress.stepId,
        thinking ? 'Vision model finished — reasoning below.' : 'Vision model finished.',
        'llm',
        {
          ...(screenshotBase64?.trim() ? { screenshotBase64: screenshotBase64.trim() } : {}),
          promptSent: instruction.trim(),
          fullUserPrompt: transcript.userPrompt,
          rawResponse: transcript.rawResponse,
          playwrightCode: out.playwrightCode,
          ...(thinking ? { thinking } : {}),
          streamingPartial: false,
        },
      );
    }
    if (opts.persistTranscript) {
      const { stepId, runId, userId, source, playbackEmit } = opts.persistTranscript;
      const ok = await this.persistAiPromptLlmTranscript(stepId, runId, userId, llmResult.transcript, source);
      if (ok && playbackEmit) {
        this.emit('playbackProgress', playbackEmit.playbackSessionId, {
          playbackSessionId: playbackEmit.playbackSessionId,
          sourceRunId: playbackEmit.sourceRunId,
          step: playbackEmit.step,
          phase: 'transcript',
        });
      }
    }

    if (phase === 'generateOnly') {
      if (progress) {
        this.emitAiPromptTestProgress(
          progress.runId,
          progress.stepId,
          'Playwright code generated — use Run on page to execute.',
          'done',
        );
      }
      return { playwrightCode: out.playwrightCode };
    }

    if (progress) {
      this.emitAiPromptTestProgress(
        progress.runId,
        progress.stepId,
        'Running generated Playwright actions on the page…',
        'executing',
      );
    }
    this.throwIfAborted(signal);
    try {
      page.setDefaultTimeout(AI_PROMPT_PW_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(AI_PROMPT_PW_TIMEOUT_MS);
      await this.executePwCode(page, out.playwrightCode, {
        skipClickForce: opts.skipClickForce,
      });
    } finally {
      page.setDefaultTimeout(PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
      page.setDefaultNavigationTimeout(PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
    }
    return { playwrightCode: out.playwrightCode };
  }

  /** @returns true if metadata was written (false on lookup mismatch / skip). */
  private async persistAiPromptLlmTranscript(
    stepId: string,
    runId: string,
    userId: string,
    transcript: InstructionToActionLlmTranscript,
    source: 'test' | 'playback',
  ): Promise<boolean> {
    const row = await this.prisma.runStep.findFirst({
      where: { id: stepId },
    });
    if (!row) {
      this.logger.warn(`persistAiPromptLlmTranscript: no RunStep ${stepId}`);
      return false;
    }
    if (row.runId !== runId) {
      this.logger.warn(
        `persistAiPromptLlmTranscript: runId mismatch step=${stepId} expected=${runId} actual=${row.runId}`,
      );
      return false;
    }
    if (row.userId !== userId) {
      this.logger.warn(
        `persistAiPromptLlmTranscript: userId mismatch step=${stepId} — skip metadata write (playback user may differ from step owner)`,
      );
      return false;
    }
    const baseMeta =
      row.metadata && typeof row.metadata === 'object' ? { ...(row.metadata as Record<string, unknown>) } : {};
    const {
      kind: _discardKind,
      schemaVersion: _discardSchemaVersion,
      ...baseMetaSansAiPromptKind
    } = baseMeta;
    const stored: AiPromptLlmTranscriptStored = {
      ...transcript,
      capturedAt: new Date().toISOString(),
      source,
    };
    await this.prisma.runStep.update({
      where: { id: stepId },
      data: {
        metadata: {
          ...(row.origin === 'AI_PROMPT' ? baseMeta : baseMetaSansAiPromptKind),
          ...(row.origin === 'AI_PROMPT'
            ? {
                kind: AI_PROMPT_STEP_KIND,
                schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION,
              }
            : {}),
          lastLlmTranscript: stored,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  }

  private getAiVisualIdArtifactPaths(runId: string, userId: string, testId: string) {
    const baseDir = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(baseDir, userId, runId);
    const visualDir = path.join(artifactDir, 'ai-visual-id');
    return {
      artifactDir,
      visualDir,
      screenshotAbsPath: path.join(visualDir, `${testId}.jpg`),
      contextAbsPath: path.join(visualDir, `${testId}.json`),
    };
  }

  private async writeAiVisualIdArtifacts(
    runId: string,
    userId: string,
    testId: string,
    screenshotBase64: string,
    context: AiVisualIdContextArtifact,
  ): Promise<{ screenshotPath: string; contextPath: string }> {
    const paths = this.getAiVisualIdArtifactPaths(runId, userId, testId);
    await fs.mkdir(paths.visualDir, { recursive: true });
    await fs.writeFile(paths.screenshotAbsPath, Buffer.from(screenshotBase64, 'base64'));
    await fs.writeFile(paths.contextAbsPath, JSON.stringify(context, null, 2), 'utf8');
    return {
      screenshotPath: path.relative(paths.artifactDir, paths.screenshotAbsPath),
      contextPath: path.relative(paths.artifactDir, paths.contextAbsPath),
    };
  }

  private async readAiVisualIdArtifacts(
    runId: string,
    userId: string,
    row: { screenshotPath: string; contextPath: string },
  ): Promise<{ screenshotBase64: string; context: AiVisualIdContextArtifact }> {
    const baseDir = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(baseDir, userId, runId);
    const [screenshotBase64, context] = await Promise.all([
      fs.readFile(path.join(artifactDir, row.screenshotPath)).then((buf) => buf.toString('base64')),
      fs
        .readFile(path.join(artifactDir, row.contextPath), 'utf8')
        .then((raw) => JSON.parse(raw) as AiVisualIdContextArtifact),
    ]);
    return { screenshotBase64, context };
  }

  async createAiVisualIdTest(runId: string, userId: string, prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new BadRequestException('AI Visual ID prompt is required');
    }
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException('No active recording session for this run');
    }

    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      select: { id: true },
    });
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    const ctx = await this.captureLlmPageContext(session.page, undefined, session.cdpSession);
    const screenshotBase64 = ctx.screenshotBase64?.trim();
    if (!screenshotBase64) {
      throw new ServiceUnavailableException('AI Visual ID could not capture a labeled screenshot');
    }

    const tree = buildAiVisualIdTree(ctx.rawAccessibilitySnapshot, ctx.somTags);
    const llmResult = await this.llmService.aiVisualId(
      {
        prompt: trimmedPrompt,
        pageUrl: ctx.pageUrl,
        somManifest: ctx.somManifest,
        accessibilitySnapshot: ctx.accessibilitySnapshot,
        screenshotBase64,
      },
      { userId },
    );

    const id = randomUUID();
    const context: AiVisualIdContextArtifact = {
      pageUrl: ctx.pageUrl,
      somManifest: ctx.somManifest,
      accessibilitySnapshot: ctx.accessibilitySnapshot,
      somTags: ctx.somTags,
      tree,
      screenshotWidth: ctx.screenshotWidth ?? 0,
      screenshotHeight: ctx.screenshotHeight ?? 0,
      prompt: trimmedPrompt,
      fullPrompt: llmResult.fullPrompt,
      answer: llmResult.answer,
      provider: llmResult.provider,
      model: llmResult.model,
    };

    const artifactPaths = await this.writeAiVisualIdArtifacts(runId, userId, id, screenshotBase64, context);
    let row;
    try {
      row = await this.prisma.aiVisualIdTest.create({
        data: {
          id,
          runId,
          userId,
          stepSequence: session.stepSequence,
          provider: llmResult.provider,
          model: llmResult.model,
          prompt: trimmedPrompt,
          answer: llmResult.answer,
          pageUrl: ctx.pageUrl,
          screenshotPath: artifactPaths.screenshotPath,
          contextPath: artifactPaths.contextPath,
        },
      });
    } catch (error) {
      throw error;
    }

    return {
      id: row.id,
      runId: row.runId,
      stepSequence: row.stepSequence,
      provider: row.provider,
      model: row.model,
      prompt: row.prompt,
      answer: row.answer,
      pageUrl: row.pageUrl,
      createdAt: row.createdAt.toISOString(),
      screenshotBase64,
      screenshotWidth: context.screenshotWidth,
      screenshotHeight: context.screenshotHeight,
      somManifest: context.somManifest,
      somTags: context.somTags,
      accessibilitySnapshot: context.accessibilitySnapshot,
      tree: context.tree,
      fullPrompt: context.fullPrompt,
    };
  }

  async getAiVisualIdTest(runId: string, userId: string, testId: string) {
    const row = await this.prisma.aiVisualIdTest.findFirst({
      where: { id: testId, runId, userId },
    });
    if (!row) {
      throw new NotFoundException('AI Visual ID test not found');
    }
    const { screenshotBase64, context } = await this.readAiVisualIdArtifacts(runId, userId, row);
    return {
      id: row.id,
      runId: row.runId,
      stepSequence: row.stepSequence,
      provider: row.provider,
      model: row.model,
      prompt: row.prompt,
      answer: row.answer,
      pageUrl: row.pageUrl,
      createdAt: row.createdAt.toISOString(),
      screenshotBase64,
      screenshotWidth: context.screenshotWidth,
      screenshotHeight: context.screenshotHeight,
      somManifest: context.somManifest,
      somTags: context.somTags,
      accessibilitySnapshot: context.accessibilitySnapshot,
      tree: context.tree,
      fullPrompt: context.fullPrompt,
    };
  }

  /** Forward pointer from the UI preview (canvas) into the Playwright page viewport. */
  async dispatchRemotePointer(
    runId: string,
    userId: string,
    payload: {
      kind: 'move' | 'down' | 'up' | 'wheel' | 'dblclick';
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
      deltaX?: number;
      deltaY?: number;
    },
  ): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return;
    }

    const { page } = session;
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const rawX = payload.x ?? 0;
    const rawY = payload.y ?? 0;
    const x = Math.max(0, Math.min(rawX, vp.width - 1));
    const y = Math.max(0, Math.min(rawY, vp.height - 1));
    const button = payload.button ?? 'left';

    try {
      switch (payload.kind) {
        case 'move':
          await page.mouse.move(x, y);
          break;
        case 'down':
          await page.mouse.move(x, y);
          await page.mouse.down({ button });
          break;
        case 'up':
          await page.mouse.move(x, y);
          await page.mouse.up({ button });
          break;
        case 'wheel': {
          await page.mouse.move(x, y);
          await page.mouse.wheel(payload.deltaX ?? 0, payload.deltaY ?? 0);
          break;
        }
        case 'dblclick':
          await page.mouse.move(x, y);
          await page.mouse.click(x, y, { button, clickCount: 2, delay: 50 });
          break;
        default:
          break;
      }
    } catch (err) {
      this.logger.debug(`dispatchRemotePointer ${payload.kind}: ${err}`);
    }
  }

  /**
   * Real touch / swipe / pinch via CDP (mobile sites ignore mouse-only events).
   * touchPoints = active contacts still on screen after this event (Chrome CDP contract).
   */
  async dispatchRemoteTouch(
    runId: string,
    userId: string,
    payload: {
      type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
      touchPoints: Array<{ id: number; x: number; y: number; force?: number }>;
    },
  ): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return;
    }

    const vp = session.page.viewportSize() ?? { width: 1280, height: 720 };
    const points = payload.touchPoints.map((t) => {
      const x = Math.round(Math.max(0, Math.min(t.x, vp.width - 1)));
      const y = Math.round(Math.max(0, Math.min(t.y, vp.height - 1)));
      const force = Math.min(1, Math.max(0, t.force ?? 1));
      return {
        x,
        y,
        radiusX: 6,
        radiusY: 6,
        rotationAngle: 0,
        force,
        id: Math.floor(Math.abs(t.id)) % 0xffff,
      };
    });

    try {
      await session.cdpSession.send('Input.dispatchTouchEvent' as any, {
        type: payload.type,
        touchPoints: points,
        modifiers: 0,
      });
    } catch (err) {
      this.logger.debug(`dispatchRemoteTouch ${payload.type}: ${err}`);
    }
  }

  /** Insert text from the operator clipboard into the focused element in the remote page. */
  async insertRemoteClipboardText(runId: string, userId: string, text: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId || !text) {
      return;
    }
    try {
      await session.page.keyboard.insertText(text);
    } catch (err) {
      this.logger.debug(`insertRemoteClipboardText: ${err}`);
    }
  }

  /** Read selected text in the remote page (for copy to operator clipboard). */
  async getRemoteSelectionText(runId: string, userId: string): Promise<string> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return '';
    }
    try {
      return await session.page.evaluate(
        "() => (typeof window !== 'undefined' && window.getSelection?.()?.toString()) || ''",
      );
    } catch {
      return '';
    }
  }

  /** Cut: return selected text and remove it in the remote DOM (operator clipboard). */
  async cutRemoteSelection(runId: string, userId: string): Promise<string> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return '';
    }
    try {
      return await session.page.evaluate(`() => {
        const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
        if (!sel || sel.rangeCount === 0) return '';
        const t = sel.toString();
        if (!t) return '';
        sel.deleteFromDocument();
        return t;
      }`);
    } catch {
      return '';
    }
  }

  /** Forward keyboard from the focused preview into Playwright. */
  async dispatchRemoteKey(
    runId: string,
    userId: string,
    payload: { type: 'down' | 'up'; key: string },
  ): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return;
    }

    const pk = this.normalizePlaywrightKey(payload.key);
    if (!pk) {
      return;
    }

    try {
      if (payload.type === 'down') {
        await session.page.keyboard.down(pk);
      } else {
        await session.page.keyboard.up(pk);
      }
    } catch (err) {
      this.logger.debug(`dispatchRemoteKey ${payload.type} ${pk}: ${err}`);
    }
  }

  private normalizePlaywrightKey(key: string): string | null {
    if (!key || key === 'Unidentified' || key === 'Dead') {
      return null;
    }
    if (key === ' ') {
      return ' ';
    }
    return key;
  }

  private static readonly MAILSLURP_INSTRUCTION_PREFIX = '[MailSlurp automation] ';

  /** Prefix human-readable copy for Clerk/MailSlurp-tagged steps (idempotent). */
  private applyMailSlurpInstructionPrefix(instruction: string): string {
    const t = instruction.trim();
    if (!t) return instruction;
    if (/^\[MailSlurp automation\]/i.test(t)) return instruction;
    if (/MailSlurp automation/i.test(t)) return instruction;
    return `${RecordingService.MAILSLURP_INSTRUCTION_PREFIX}${instruction}`;
  }

  /**
   * Computes metadata (clerkAuthPhase), final origin (AUTOMATIC vs caller), and instruction copy.
   * Playback skip uses metadata.clerkAuthPhase; AUTOMATIC is for UI labeling only.
   */
  private async buildStepPersistence(
    session: RecordingSession,
    data: {
      action: string;
      selector: string | null;
      value: string | null;
      instruction: string;
      playwrightCode: string;
      recordedPlaywrightCode?: string | null;
      origin: 'MANUAL' | 'AI_DRIVEN';
    },
    opts?: {
      syntheticClerkAutoSignIn?: boolean;
      /** Single-step automatic Clerk sign-in (recorded otpMode + post-auth URL for playback). */
      clerkAutoSignInBlock?: { authKind: AutoSignInAuthKind; otpMode: ClerkOtpMode; postAuthPageUrl: string };
      /** Re-record path: use the DB step’s sequence (session.stepSequence may not match). */
      stepSequenceHint?: number;
    },
  ): Promise<{
    metadata: Record<string, unknown> | undefined;
    origin: 'MANUAL' | 'AI_DRIVEN' | 'AUTOMATIC';
    instruction: string;
  }> {
    let metadata: Record<string, unknown> | undefined;
    if (opts?.clerkAutoSignInBlock) {
      const { authKind, otpMode, postAuthPageUrl } = opts.clerkAutoSignInBlock;
      metadata = {
        kind: CLERK_AUTO_SIGN_IN_KIND,
        schemaVersion: CLERK_AUTO_SIGN_IN_SCHEMA_VERSION,
        authKind,
        otpMode,
        postAuthPageUrl,
      };
      /** UI: Run list / step cards show **Automatic** (same as other server-driven automation rows). */
      return { metadata, origin: 'AUTOMATIC', instruction: data.instruction };
    }
    if (opts?.syntheticClerkAutoSignIn) {
      metadata = {
        clerkAuthPhase: true,
        clerkAutoOneShot: true,
        /** Never mixed into Playwright execution loop — audit/UI only when auto Clerk runs server-side. */
        clerkAutomationCanonical: true,
      };
    } else {
      const clerkAuthPhase = await this.computeClerkAuthPhaseForRecording(session, data);
      metadata = clerkAuthPhase ? { clerkAuthPhase: true } : undefined;
    }
    const isAutomatic = !!(
      opts?.syntheticClerkAutoSignIn ||
      (metadata && (metadata as { clerkAuthPhase?: boolean }).clerkAuthPhase === true)
    );
    const sequenceForOrigin = opts?.stepSequenceHint ?? session.stepSequence;
    /** First step “load the app” — always AUTOMATIC for UI; does not set clerkAuthPhase (playback unchanged). */
    const isInitialAppNavigate = sequenceForOrigin === 1 && data.action === 'NAVIGATE';
    const originAutomatic = isAutomatic || isInitialAppNavigate;
    const finalOrigin: 'MANUAL' | 'AI_DRIVEN' | 'AUTOMATIC' = originAutomatic ? 'AUTOMATIC' : data.origin;
    const finalInstruction = isAutomatic
      ? this.applyMailSlurpInstructionPrefix(data.instruction)
      : data.instruction;
    return { metadata, origin: finalOrigin, instruction: finalInstruction };
  }

  private async recordStep(
    session: RecordingSession,
    data: {
      action: string;
      selector: string | null;
      value: string | null;
      instruction: string;
      playwrightCode: string;
      recordedPlaywrightCode?: string | null;
      origin: 'MANUAL' | 'AI_DRIVEN';
    },
    opts?: {
      syntheticClerkAutoSignIn?: boolean;
      clerkAutoSignInBlock?: { authKind: AutoSignInAuthKind; otpMode: ClerkOtpMode; postAuthPageUrl: string };
      stepSequenceHint?: number;
    },
  ) {
    session.stepSequence += 1;

    const { metadata, origin, instruction } = await this.buildStepPersistence(session, data, opts);

    const step = await this.prisma.runStep.create({
      data: {
        runId: session.runId,
        userId: session.userId,
        sequence: session.stepSequence,
        action: data.action as any,
        selector: data.selector,
        value: data.value,
        instruction,
        playwrightCode: data.playwrightCode,
        recordedPlaywrightCode: data.recordedPlaywrightCode ?? data.playwrightCode,
        origin: origin as any,
        timestamp: new Date(),
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    void this.persistCheckpointAfterStep(session, step).catch((err) => {
      this.logger.warn(`Checkpoint after step ${step.sequence}: ${err}`);
    });

    return step;
  }

  private buildScrollInstruction(deltaX: number, deltaY: number, selector: string | null, isRoot: boolean): string {
    const horizontal =
      Math.abs(deltaX) >= Math.abs(deltaY) && Math.abs(deltaX) > 0
        ? deltaX > 0
          ? 'right'
          : 'left'
        : null;
    const vertical =
      Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 0
        ? deltaY > 0
          ? 'down'
          : 'up'
        : null;
    const direction = horizontal ?? vertical ?? 'down';
    if (isRoot) return `Scroll ${direction} on the page`;
    if (selector?.trim()) return `Scroll ${direction} inside ${selector.trim()}`;
    return `Scroll ${direction} inside the current panel`;
  }

  private buildScrollPlaywrightCode(selector: string | null, deltaX: number, deltaY: number, isRoot: boolean): string {
    const left = Math.round(deltaX);
    const top = Math.round(deltaY);
    if (isRoot || !selector?.trim()) {
      return `await page.evaluate(({ left, top }) => {\n  window.scrollBy({ left, top, behavior: 'auto' });\n}, { left: ${left}, top: ${top} });`;
    }
    return `await page.locator(${JSON.stringify(selector.trim())}).evaluate((el, delta) => {\n  el.scrollBy({ left: delta.left, top: delta.top, behavior: 'auto' });\n}, { left: ${left}, top: ${top} });`;
  }

  private parseStoredScrollCode(code: string): { selector: string | null; left: number; top: number; isRoot: boolean } | null {
    const trimmed = code.trim();
    const rootMatch = trimmed.match(/\{ left:\s*(-?\d+),\s*top:\s*(-?\d+)\s*\}\s*\);?\s*$/s);
    if (trimmed.includes('window.scrollBy({ left, top, behavior: \'auto\' })') && rootMatch) {
      return {
        selector: null,
        left: Number(rootMatch[1]),
        top: Number(rootMatch[2]),
        isRoot: true,
      };
    }
    const locatorPrefix = 'await page.locator(';
    const prefixIndex = trimmed.indexOf(locatorPrefix);
    if (prefixIndex === -1 || !trimmed.includes('el.scrollBy({ left: delta.left, top: delta.top, behavior: \'auto\' });')) {
      return null;
    }
    const selectorStart = prefixIndex + locatorPrefix.length;
    const quote = trimmed[selectorStart];
    if (quote !== '"' && quote !== '\'') return null;
    let selectorEnd = selectorStart + 1;
    while (selectorEnd < trimmed.length) {
      const ch = trimmed[selectorEnd];
      if (ch === quote && trimmed[selectorEnd - 1] !== '\\') break;
      selectorEnd += 1;
    }
    if (selectorEnd >= trimmed.length) return null;
    const rawSelector = trimmed.slice(selectorStart + 1, selectorEnd);
    const deltaMatch = trimmed.match(/\{ left:\s*(-?\d+),\s*top:\s*(-?\d+)\s*\}\s*\);?\s*$/s);
    if (!deltaMatch) return null;
    return {
      selector: rawSelector,
      left: Number(deltaMatch[1]),
      top: Number(deltaMatch[2]),
      isRoot: false,
    };
  }

  private async executeRecordedScrollPlayback(
    page: Page,
    input: { selector: string | null; left: number; top: number; isRoot: boolean },
  ): Promise<{
    mode: 'root' | 'selector';
    selector: string | null;
    changed: boolean;
    matchedCount: number;
    chosenTag: string | null;
    chosenClassName: string | null;
    chosenDepth: number | null;
    beforeTop: number | null;
    afterTop: number | null;
    beforeLeft: number | null;
    afterLeft: number | null;
    durationMs: number;
  }> {
    return page.evaluate((payload) => {
      const startedAt = performance.now();
      const animateScroll = (
        getPosition: () => { left: number; top: number },
        apply: (left: number, top: number) => void,
        targetLeft: number,
        targetTop: number,
      ) =>
        new Promise<{ beforeLeft: number; beforeTop: number; afterLeft: number; afterTop: number; durationMs: number }>((resolve) => {
          const start = getPosition();
          const duration = Math.min(
            260,
            Math.max(140, Math.round(Math.max(Math.abs(targetLeft), Math.abs(targetTop)) * 0.22)),
          );
          const begin = performance.now();
          const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
          const tick = (now: number) => {
            const progress = duration <= 0 ? 1 : Math.min(1, (now - begin) / duration);
            const eased = easeOutCubic(progress);
            const nextLeft = start.left + targetLeft * eased;
            const nextTop = start.top + targetTop * eased;
            apply(nextLeft, nextTop);
            if (progress < 1) {
              requestAnimationFrame(tick);
              return;
            }
            const end = getPosition();
            resolve({
              beforeLeft: start.left,
              beforeTop: start.top,
              afterLeft: end.left,
              afterTop: end.top,
              durationMs: performance.now() - begin,
            });
          };
          requestAnimationFrame(tick);
        });
      if (payload.isRoot || !payload.selector) {
        return animateScroll(
          () => ({ left: window.scrollX, top: window.scrollY }),
          (left, top) => window.scrollTo({ left, top, behavior: 'auto' }),
          payload.left,
          payload.top,
        ).then(({ beforeLeft, beforeTop, afterLeft, afterTop, durationMs }) => ({
          mode: 'root' as const,
          selector: null,
          changed: afterLeft !== beforeLeft || afterTop !== beforeTop,
          matchedCount: 1,
          chosenTag: 'document',
          chosenClassName: null,
          chosenDepth: 0,
          beforeTop,
          afterTop,
          beforeLeft,
          afterLeft,
          durationMs: performance.now() - startedAt + durationMs - durationMs,
        }));
      }

      const matches = Array.from(document.querySelectorAll(payload.selector)).filter(
        (el): el is HTMLElement => el instanceof HTMLElement,
      );
      const seen = new Set<HTMLElement>();
      const candidates: Array<{ el: HTMLElement; depth: number }> = [];
      const axisCanScroll = (el: HTMLElement) =>
        (payload.top !== 0 && el.scrollHeight - el.clientHeight > 8) ||
        (payload.left !== 0 && el.scrollWidth - el.clientWidth > 8);
      const anyCanScroll = (el: HTMLElement) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
      const depthOf = (el: HTMLElement) => {
        let depth = 0;
        let cur: HTMLElement | null = el;
        while (cur?.parentElement) {
          depth += 1;
          cur = cur.parentElement;
        }
        return depth;
      };
      const pushCandidate = (el: HTMLElement) => {
        if (seen.has(el)) return;
        seen.add(el);
        if (!axisCanScroll(el) && !anyCanScroll(el)) return;
        candidates.push({ el, depth: depthOf(el) });
      };

      for (const match of matches) {
        pushCandidate(match);
        const descendants = Array.from(match.querySelectorAll('*')).filter(
          (el): el is HTMLElement => el instanceof HTMLElement,
        );
        for (const descendant of descendants) pushCandidate(descendant);
      }

      const pickBestCandidate = () => {
        let best:
          | {
              el: HTMLElement;
              depth: number;
              score: number;
              beforeTop: number;
              beforeLeft: number;
              probeAfterTop: number;
              probeAfterLeft: number;
            }
          | null = null;
        for (const candidate of candidates) {
          const beforeTop = candidate.el.scrollTop;
          const beforeLeft = candidate.el.scrollLeft;
          candidate.el.scrollBy({ left: payload.left, top: payload.top, behavior: 'auto' });
          const probeAfterTop = candidate.el.scrollTop;
          const probeAfterLeft = candidate.el.scrollLeft;
          candidate.el.scrollTo({ left: beforeLeft, top: beforeTop, behavior: 'auto' });
          const movedY = Math.abs(probeAfterTop - beforeTop);
          const movedX = Math.abs(probeAfterLeft - beforeLeft);
          const score = movedY + movedX;
          if (score <= 0) continue;
          if (!best || score > best.score || (score === best.score && candidate.depth > best.depth)) {
            best = {
              el: candidate.el,
              depth: candidate.depth,
              score,
              beforeTop,
              beforeLeft,
              probeAfterTop,
              probeAfterLeft,
            };
          }
        }
        return best;
      };

      const best = pickBestCandidate();
      if (!best) {
        return {
          mode: 'selector' as const,
          selector: payload.selector,
          changed: false,
          matchedCount: matches.length,
          chosenTag: null,
          chosenClassName: null,
          chosenDepth: null,
          beforeTop: null,
          afterTop: null,
          beforeLeft: null,
          afterLeft: null,
          durationMs: performance.now() - startedAt,
        };
      }

      return animateScroll(
        () => ({ left: best.el.scrollLeft, top: best.el.scrollTop }),
        (left, top) => best.el.scrollTo({ left, top, behavior: 'auto' }),
        payload.left,
        payload.top,
      ).then(({ beforeLeft, beforeTop, afterLeft, afterTop, durationMs }) => ({
        mode: 'selector' as const,
        selector: payload.selector,
        changed: afterTop !== beforeTop || afterLeft !== beforeLeft,
        matchedCount: matches.length,
        chosenTag: best.el.tagName.toLowerCase(),
        chosenClassName: best.el.className ? String(best.el.className).slice(0, 160) : null,
        chosenDepth: best.depth,
        beforeTop,
        afterTop,
        beforeLeft,
        afterLeft,
        durationMs: performance.now() - startedAt + durationMs - durationMs,
      }));
    }, input);
  }

  /**
   * Saves Playwright `storageState` + DB row for “app state” labels (best-effort; prefix replay is still authoritative).
   * Disabled when `RECORDING_CHECKPOINTS=false`.
   */
  private async persistCheckpointAfterStep(session: RecordingSession, step: RunStep): Promise<void> {
    const raw = this.configService.get<string>('RECORDING_CHECKPOINTS', 'true').toLowerCase();
    if (raw === 'false' || raw === '0' || raw === 'no') return;

    const base = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(base, session.userId, session.runId);
    await fs.mkdir(artifactDir, { recursive: true });

    const fileName = `checkpoint-${step.sequence}.json`;
    const absPath = path.join(artifactDir, fileName);
    try {
      await session.page.context().storageState({ path: absPath });
    } catch (err) {
      this.logger.warn(`storageState failed for step ${step.sequence}: ${err}`);
      return;
    }

    let pageUrl: string | undefined;
    try {
      pageUrl = session.page.url();
    } catch {
      /* ignore */
    }

    let thumbName: string | undefined;
    try {
      const thumbFile = `checkpoint-${step.sequence}.jpg`;
      const thumbPath = path.join(artifactDir, thumbFile);
      const buf = await session.page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
      await fs.writeFile(thumbPath, buf);
      thumbName = thumbFile;
    } catch {
      /* best-effort */
    }

    try {
      await this.prisma.runCheckpoint.deleteMany({
        where: { runId: session.runId, afterStepSequence: step.sequence },
      });
      await this.prisma.runCheckpoint.create({
        data: {
          runId: session.runId,
          userId: session.userId,
          afterStepSequence: step.sequence,
          label: `After step ${step.sequence}`,
          pageUrl: pageUrl ?? null,
          storageStatePath: fileName,
          thumbnailPath: thumbName ?? null,
        },
      });
    } catch (dbErr) {
      this.logger.warn(`Checkpoint DB write failed for step ${step.sequence}: ${dbErr}`);
    }
  }

  /** True while URL or visible UI looks like Clerk sign-in (tags step for playback skip + auto auth). */
  private async computeClerkAuthPhaseForRecording(
    session: RecordingSession,
    data: { action: string; value: string | null },
  ): Promise<boolean> {
    if (data.action === 'NAVIGATE' && data.value && clerkSignInUrlLooksLike(String(data.value))) {
      return true;
    }
    try {
      if (clerkSignInUrlLooksLike(session.page.url())) {
        return true;
      }
    } catch {
      /* ignore */
    }
    try {
      return await detectClerkSignInUi(session.page);
    } catch {
      return false;
    }
  }

  /** CDP screencast → `emit('frame', frameChannelId, base64Jpeg)` */
  private async attachScreencast(
    cdpSession: CDPSession,
    latestFrameHolder: { latestFrame: Buffer | null; page?: Page; browser?: Browser; screencastClosing?: boolean },
    frameChannelId: string,
    captureSettings: RunCaptureSettings,
    opts?: { onJpegFrame?: (jpeg: Buffer) => void },
  ) {
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: captureSettings.streamJpegQuality,
      maxWidth: captureSettings.streamMaxWidth,
      maxHeight: captureSettings.streamMaxHeight,
      everyNthFrame: captureSettings.streamEveryNthFrame,
    });

    cdpSession.on('Page.screencastFrame', async (params: any) => {
      const buf = Buffer.from(params.data, 'base64');
      latestFrameHolder.latestFrame = buf;
      opts?.onJpegFrame?.(buf);

      try {
        await cdpSession.send('Page.screencastFrameAck', {
          sessionId: params.sessionId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const duringTeardown =
          latestFrameHolder.screencastClosing === true ||
          latestFrameHolder.page?.isClosed?.() === true ||
          latestFrameHolder.browser?.isConnected?.() === false;
        if (duringTeardown && /Target page, context or browser has been closed/i.test(msg)) {
          return;
        }
        throw err;
      }

      this.emit('frame', frameChannelId, params.data);
    });
  }

  /**
   * Replay stored steps in a new browser session; returns immediately while playback runs async.
   * Clients join socket room `run:<playbackSessionId>`.
   */
  async startPlayback(
    userId: string,
    sourceRunId: string,
    opts?: StartPlaybackServiceOpts,
  ): Promise<{ playbackSessionId: string; sourceRunId: string }> {
    const run = await this.prisma.run.findFirst({
      where: { id: sourceRunId, userId },
      include: {
        steps: { orderBy: { sequence: 'asc' } },
        project: {
          select: {
            testUserEmail: true,
            testUserPassword: true,
            testEmailProvider: true,
          },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Run ${sourceRunId} not found`);
    }
    const hasLiveRecordingSession = this.sessions.has(sourceRunId);
    if (run.status === 'RECORDING' && hasLiveRecordingSession) {
      throw new ConflictException('Run is still recording; wait until it completes before playback');
    }
    if (!run.steps.length) {
      throw new BadRequestException('This run has no recorded steps to play back');
    }

    const playbackSessionId = randomUUID();
    const delayMs = Math.min(5000, Math.max(0, opts?.delayMs ?? 600));
    const envAutoRaw = this.configService.get<string>('PLAYBACK_AUTO_CLERK_SIGNIN', '').trim().toLowerCase();
    const envAutoOn = envAutoRaw === 'true' || envAutoRaw === '1' || envAutoRaw === 'yes';
    const envExplicitlyOff =
      envAutoRaw === 'false' || envAutoRaw === '0' || envAutoRaw === 'no';
    /** When env is unset and the client omits `autoClerkSignIn`, default ON (matches UI "Server default" + MailSlurp parity). */
    const wantAutoClerkSignIn =
      opts?.autoClerkSignIn !== undefined
        ? opts.autoClerkSignIn
        : envExplicitlyOff
          ? false
          : envAutoOn || envAutoRaw === '';
    const skipSet = buildPlaybackSkipSet({
      steps: run.steps.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        metadata: s.metadata,
        action: s.action,
        value: s.value,
        origin: s.origin,
        instruction: s.instruction,
        playwrightCode: s.playwrightCode,
      })),
      wantAutoClerkSkip: wantAutoClerkSignIn,
      skipUntilSequence: opts?.skipUntilSequence,
      skipStepIds: opts?.skipStepIds,
      runUrl: run.url,
    });
    for (const s of run.steps) {
      if (s.excludedFromPlayback) skipSet.add(s.id);
    }
    const clerkOtpMode = this.resolveClerkOtpMode(opts);
    const replaySnapshot: PlaybackReplaySnapshot = {
      sourceRunId,
      delayMs,
      wantAutoClerkSignIn,
      clerkOtpMode,
      skipUntilSequence: opts?.skipUntilSequence,
      skipStepIds: opts?.skipStepIds,
      playThroughSequence: opts?.playThroughSequence,
    };
    const workerUrl = this.configService.get<string>('BROWSER_WORKER_URL', 'ws://localhost:3002');

    let wsEndpoint: string;
    let browser: Browser;
    try {
      wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
      browser = await chromium.connect(wsEndpoint);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Playback could not start (browser worker / Playwright). ${detail}`,
      );
    }

    try {
      const captureSettings = captureSettingsFromRun(run);
      const context = await browser.newContext({
        viewport: {
          width: captureSettings.recordingViewportWidth,
          height: captureSettings.recordingViewportHeight,
        },
        deviceScaleFactor: REMOTE_BROWSER_DEVICE_SCALE_FACTOR,
      });
      const page = await context.newPage();
      const cdpSession = await context.newCDPSession(page);

      const session: PlaybackSession = {
        playbackSessionId,
        sourceRunId,
        userId,
        browser,
        page,
        cdpSession,
        latestFrame: null,
        paused: false,
        playbackResumeWaiters: [],
        replaySnapshot,
        activeStepWork: null,
        /** Pause after this step completes when `playThroughSequence` caps the run (step-through + Prev rewind). */
        pauseAfterSequenceInclusive:
          opts?.playThroughSequence != null && Number.isFinite(opts.playThroughSequence)
            ? Math.floor(opts.playThroughSequence)
            : null,
        pauseBeforeFirstRecordedStepPending: opts?.startPaused === true,
        projectAuth: this.projectAuthFromProject(run.project),
      };

      this.playbackSessions.set(playbackSessionId, session);
      await this.attachScreencast(cdpSession, session, playbackSessionId, captureSettings);

      const steps = run.steps;
      const playbackExecutionSteps = filterStepsForPlaybackExecutionChain(steps, wantAutoClerkSignIn);
      if (playbackExecutionSteps.length !== steps.length) {
        this.logger.log(
          `Playback: ${playbackExecutionSteps.length} step(s) in execution chain (${steps.length - playbackExecutionSteps.length} Clerk/MailSlurp row(s) excluded from Playwright loop)`,
        );
      }
      /** Zero-state load — aligns with recording; redundant first NAVIGATE is skipped via `skipSet`. */
      await page.goto(run.url, { waitUntil: 'domcontentloaded' });

      void this.runPlaybackLoop(playbackSessionId, session, playbackExecutionSteps, delayMs, sourceRunId, run.url, {
        wantAutoClerkSignIn,
        clerkOtpMode,
        skipSet,
        playThroughSequence: opts?.playThroughSequence,
      });

      this.logger.log(`Playback started: ${playbackSessionId} (source ${sourceRunId})`);
      return { playbackSessionId, sourceRunId };
    } catch (err) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
      this.playbackSessions.delete(playbackSessionId);
      if (err instanceof HttpException) {
        throw err;
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Playback setup failed. ${detail}`);
    }
  }

  async pausePlayback(playbackSessionId: string, userId: string): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    session.paused = true;
    this.emit('status', playbackSessionId, {
      status: 'playback_paused',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  async resumePlayback(playbackSessionId: string, userId: string): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    session.pauseAfterNextStepCompletes = false;
    session.pauseAfterSequenceInclusive = null;
    session.paused = false;
    const waiters = session.playbackResumeWaiters.splice(0);
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
    this.emit('status', playbackSessionId, {
      status: 'playback',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  /** Resume, run exactly one step, then pause again (only valid while paused). */
  async resumePlaybackAfterOneStep(playbackSessionId: string, userId: string): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    if (!session.paused) {
      throw new BadRequestException('Playback is not paused');
    }
    session.pauseAfterNextStepCompletes = true;
    session.pauseAfterSequenceInclusive = null;
    session.paused = false;
    const waiters = session.playbackResumeWaiters.splice(0);
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
    this.emit('status', playbackSessionId, {
      status: 'playback',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  /** Resume until `stopAfterSequence` completes (inclusive), then pause. */
  async resumePlaybackUntilSequence(playbackSessionId: string, userId: string, stopAfterSequence: number): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    if (!session.paused) {
      throw new BadRequestException('Playback is not paused');
    }
    if (!Number.isFinite(stopAfterSequence) || stopAfterSequence < 0) {
      throw new BadRequestException('stopAfterSequence must be a non-negative integer');
    }
    session.pauseAfterNextStepCompletes = false;
    session.pauseAfterSequenceInclusive = Math.floor(stopAfterSequence);
    session.paused = false;
    const waiters = session.playbackResumeWaiters.splice(0);
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
    this.emit('status', playbackSessionId, {
      status: 'playback',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  getPlaybackSessionSnapshot(
    playbackSessionId: string,
    userId: string,
  ): (PlaybackReplaySnapshot & { playbackSessionId: string; paused: boolean }) | null {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return null;
    }
    return {
      playbackSessionId: session.playbackSessionId,
      paused: session.paused,
      ...session.replaySnapshot,
    };
  }

  /** Stop current session and start a new playback with the same options. */
  async restartPlayback(
    playbackSessionId: string,
    userId: string,
  ): Promise<{ playbackSessionId: string; sourceRunId: string } | null> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return null;
    }
    const snap = session.replaySnapshot;
    const ok = await this.stopPlayback(playbackSessionId, userId);
    if (!ok) {
      return null;
    }
    return this.startPlayback(userId, snap.sourceRunId, {
      delayMs: snap.delayMs,
      autoClerkSignIn: snap.wantAutoClerkSignIn,
      clerkOtpMode: snap.clerkOtpMode,
      skipUntilSequence: snap.skipUntilSequence,
      skipStepIds: snap.skipStepIds,
      playThroughSequence: snap.playThroughSequence,
    });
  }

  async stopPlayback(playbackSessionId: string, userId: string): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    if (session.activeStepWork) {
      await session.activeStepWork.catch(() => {});
    }
    await this.cleanupPlaybackSession(playbackSessionId, session);
    this.emit('status', playbackSessionId, {
      status: 'stopped',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  /**
   * @param steps Playback execution chain (legacy `clerkAutomationCanonical` rows omitted when auto Clerk is on;
   * `clerk_auto_sign_in` is included and handled via `playbackClerkAutoSignInFromRecordedStep`).
   */
  private async runPlaybackLoop(
    playbackSessionId: string,
    session: PlaybackSession,
    steps: RunStep[],
    delayMs: number,
    sourceRunId: string,
    runUrl: string,
    ctx: {
      wantAutoClerkSignIn: boolean;
      clerkOtpMode: ClerkOtpMode;
      skipSet: Set<string>;
      playThroughSequence?: number;
    },
  ) {
    const clerkPlaybackState = { clerkFullSignInDone: false };

    try {
      this.emit('status', playbackSessionId, {
        status: 'playback',
        runId: playbackSessionId,
        sourceRunId,
      });

      /** Avoid double sign-in: recorded `clerk_auto_sign_in` step runs `performClerkPasswordEmail2FA` explicitly. */
      const hasRecordedClerkAutoSignIn = steps.some((s) => isClerkAutoSignInMetadata(s.metadata));
      if (!hasRecordedClerkAutoSignIn) {
        await this.maybePlaybackClerkAuthAssist(
          session,
          runUrl,
          ctx.wantAutoClerkSignIn,
          ctx.clerkOtpMode,
          clerkPlaybackState,
        );
      }

      for (const step of steps) {
        if (ctx.playThroughSequence != null && step.sequence > ctx.playThroughSequence) {
          break;
        }

        if (session.pauseBeforeFirstRecordedStepPending) {
          session.pauseBeforeFirstRecordedStepPending = false;
          session.paused = true;
          this.emit('status', playbackSessionId, {
            status: 'playback_paused',
            runId: playbackSessionId,
            sourceRunId,
          });
        }

        await this.waitUntilPlaybackNotPaused(session);

        const stepPayload = {
          id: step.id,
          sequence: step.sequence,
          action: step.action,
          instruction: step.instruction,
        };

        const skipped =
          ctx.skipSet.has(step.id) ||
          shouldSkipStoredPlaywrightForClerk(
            {
              id: step.id,
              sequence: step.sequence,
              metadata: step.metadata,
              action: step.action,
              value: step.value,
              origin: step.origin,
              instruction: step.instruction,
              playwrightCode: step.playwrightCode,
            },
            ctx.wantAutoClerkSignIn,
          );

        this.emit('playbackProgress', playbackSessionId, {
          playbackSessionId,
          sourceRunId,
          step: stepPayload,
          phase: 'before',
        });

        if (isClerkAutoSignInMetadata(step.metadata) && !ctx.skipSet.has(step.id)) {
          try {
            await this.runWithActivePlaybackStep(session, () =>
              this.playbackClerkAutoSignInFromRecordedStep(session, step, runUrl),
            );
            clerkPlaybackState.clerkFullSignInDone = true;
          } catch (execErr) {
            const msg = execErr instanceof Error ? execErr.message : String(execErr);
            this.logger.warn(`Playback clerk_auto_sign_in step ${step.sequence} failed: ${msg}`);
            this.emit('playbackProgress', playbackSessionId, {
              playbackSessionId,
              sourceRunId,
              step: stepPayload,
              phase: 'error',
              error: msg,
            });
            this.emit('status', playbackSessionId, {
              status: 'failed',
              runId: playbackSessionId,
              sourceRunId,
              error: msg,
            });
            await this.cleanupPlaybackSession(playbackSessionId, session);
            return;
          }
          await this.maybePlaybackClerkAuthAssist(
            session,
            runUrl,
            ctx.wantAutoClerkSignIn,
            ctx.clerkOtpMode,
            clerkPlaybackState,
          );
          await session.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.sleepWithPause(session, delayMs);
          this.emit('playbackProgress', playbackSessionId, {
            playbackSessionId,
            sourceRunId,
            step: stepPayload,
            phase: 'after',
          });
          this.applySteppedPauseAfterStep(playbackSessionId, session, step);
          continue;
        }

        if (skipped) {
          this.emit('playbackProgress', playbackSessionId, {
            playbackSessionId,
            sourceRunId,
            step: stepPayload,
            phase: 'skipped',
          });
          await this.maybePlaybackClerkAuthAssist(
            session,
            runUrl,
            ctx.wantAutoClerkSignIn,
            ctx.clerkOtpMode,
            clerkPlaybackState,
          );
          await this.sleepWithPause(session, delayMs);
          this.applySteppedPauseAfterStep(playbackSessionId, session, step);
          continue;
        }

        try {
          await this.executePlaybackStepWithRepair(
            session,
            step,
            playbackSessionId,
            sourceRunId,
            stepPayload,
            !clerkPlaybackState.clerkFullSignInDone,
          );
        } catch (execErr) {
          const failure = classifyRecordingAutomationFailure(execErr);
          const msg = failure.message;
          this.logger.warn(`Playback step ${step.sequence} failed: ${msg}`);
          this.emit('playbackProgress', playbackSessionId, {
            playbackSessionId,
            sourceRunId,
            step: stepPayload,
            phase: 'error',
            error: msg,
          });
          this.emit('status', playbackSessionId, {
            status: 'failed',
            runId: playbackSessionId,
            sourceRunId,
            error: msg,
          });
          await this.cleanupPlaybackSession(playbackSessionId, session);
          return;
        }

        await this.maybePlaybackClerkAuthAssist(
          session,
          runUrl,
          ctx.wantAutoClerkSignIn,
          ctx.clerkOtpMode,
          clerkPlaybackState,
        );

        await session.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.sleepWithPause(session, delayMs);
        this.emit('playbackProgress', playbackSessionId, {
          playbackSessionId,
          sourceRunId,
          step: stepPayload,
          phase: 'after',
        });
        this.applySteppedPauseAfterStep(playbackSessionId, session, step);
      }

      this.emit('status', playbackSessionId, {
        status: 'completed',
        runId: playbackSessionId,
        sourceRunId,
      });
    } catch (e) {
      const failure = classifyRecordingAutomationFailure(e);
      const msg = failure.message;
      this.logger.error(`Playback loop error: ${msg}`);
      this.emit('status', playbackSessionId, {
        status: 'failed',
        runId: playbackSessionId,
        sourceRunId,
        error: msg,
      });
    } finally {
      const still = this.playbackSessions.get(playbackSessionId);
      if (still) {
        await this.cleanupPlaybackSession(playbackSessionId, still);
      }
    }
  }

  private async cleanupPlaybackSession(playbackSessionId: string, session: PlaybackSession) {
    session.paused = false;
    session.screencastClosing = true;
    const waiters = session.playbackResumeWaiters.splice(0);
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
    this.playbackSessions.delete(playbackSessionId);
    try {
      await session.cdpSession.send('Page.stopScreencast').catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn('Error closing playback browser', err);
    }
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  /**
   * After a step iteration completes, optionally pause (advance-one / advance-to) before the next step.
   */
  private applySteppedPauseAfterStep(playbackSessionId: string, session: PlaybackSession, step: RunStep): void {
    if (session.pauseAfterNextStepCompletes) {
      session.pauseAfterNextStepCompletes = false;
      session.paused = true;
      this.emit('status', playbackSessionId, {
        status: 'playback_paused',
        runId: playbackSessionId,
        sourceRunId: session.sourceRunId,
      });
      return;
    }
    const target = session.pauseAfterSequenceInclusive;
    if (target != null && step.sequence >= target) {
      session.pauseAfterSequenceInclusive = null;
      session.paused = true;
      this.emit('status', playbackSessionId, {
        status: 'playback_paused',
        runId: playbackSessionId,
        sourceRunId: session.sourceRunId,
      });
    }
  }

  private async waitUntilPlaybackNotPaused(session: PlaybackSession): Promise<void> {
    while (session.paused) {
      await new Promise<void>((resolve) => {
        session.playbackResumeWaiters.push(resolve);
      });
    }
  }

  /** Like `sleep` but respects pause (and can resume mid-wait). */
  private async sleepWithPause(session: PlaybackSession, ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await this.waitUntilPlaybackNotPaused(session);
      const remaining = end - Date.now();
      if (remaining <= 0) break;
      await this.sleep(Math.min(100, remaining));
    }
  }

  /** Clerk user + keys (no MailSlurp). */
  private playbackClerkCoreEnvReady(): boolean {
    const password = this.configService.get<string>('E2E_CLERK_USER_PASSWORD')?.trim();
    const identifier =
      this.configService.get<string>('E2E_CLERK_USER_USERNAME')?.trim() ||
      this.configService.get<string>('E2E_CLERK_USER_EMAIL')?.trim();
    const secret =
      this.configService.get<string>('PLAYBACK_CLERK_SECRET_KEY')?.trim() ||
      this.configService.get<string>('E2E_CLERK_SECRET_KEY')?.trim() ||
      this.configService.get<string>('CLERK_SECRET_KEY')?.trim();
    const pub =
      this.configService.get<string>('CLERK_PUBLISHABLE_KEY')?.trim() ||
      this.configService.get<string>('VITE_CLERK_PUBLISHABLE_KEY')?.trim();
    return !!(password && identifier && secret && pub);
  }

  private playbackClerkMailSlurpEnvReady(): boolean {
    const mailslurp = this.configService.get<string>('MAILSLURP_API_KEY')?.trim();
    const inbox =
      this.configService.get<string>('MAILSLURP_INBOX_ID')?.trim() ||
      this.configService.get<string>('MAILSLURP_INBOX_EMAIL')?.trim();
    return !!(mailslurp && inbox);
  }

  private playbackClerkAssistAvailable(mode: ClerkOtpMode): boolean {
    if (!this.playbackClerkCoreEnvReady()) return false;
    if (mode === 'mailslurp') return this.playbackClerkMailSlurpEnvReady();
    return true;
  }

  private projectAuthFromProject(project: {
    testUserEmail?: string | null;
    testUserPassword?: string | null;
    testEmailProvider?: string | null;
  } | null | undefined): ProjectAutoSignInCredentials | null {
    const identifier = project?.testUserEmail?.trim();
    const password = project?.testUserPassword ?? '';
    if (!identifier || !password) return null;
    return {
      identifier,
      password,
      otpMode: project?.testEmailProvider === 'CLERK_TEST_EMAIL' ? 'clerk_test_email' : 'mailslurp',
    };
  }

  private async resolveAutoSignInAuthKind(
    page: Page,
    projectAuth: ProjectAutoSignInCredentials | null,
  ): Promise<AutoSignInAuthKind | null> {
    if (await detectLikelyClerkLoginPage(page)) return 'clerk';
    if (projectAuth) return 'generic';
    return null;
  }

  private resolveClerkOtpMode(opts?: StartPlaybackServiceOpts): ClerkOtpMode {
    if (opts?.clerkOtpMode) return opts.clerkOtpMode;
    const raw = this.configService.get<string>('PLAYBACK_CLERK_OTP_MODE', '').trim().toLowerCase();
    if (raw === 'clerk_test_email' || raw === 'test_email') return 'clerk_test_email';
    if (raw === 'mailslurp' || raw === 'mail_slurp') return 'mailslurp';
    return 'mailslurp';
  }

  private playbackClerkBaseUrl(runUrl: string): string {
    try {
      return new URL(runUrl).origin;
    } catch {
      return runUrl.replace(/\/$/, '');
    }
  }

  private async runPlaybackClerkAutoSignIn(
    page: Page,
    runUrl: string,
    otpMode: ClerkOtpMode,
  ): Promise<void> {
    const password = this.configService.get<string>('E2E_CLERK_USER_PASSWORD')!.trim();
    const identifier =
      this.configService.get<string>('E2E_CLERK_USER_USERNAME')?.trim() ||
      this.configService.get<string>('E2E_CLERK_USER_EMAIL')!.trim();
    const baseURL = this.playbackClerkBaseUrl(runUrl);
    await performClerkPasswordEmail2FA(page, {
      baseURL,
      identifier,
      password,
      skipInitialNavigate: true,
      otpMode,
    });
    this.logger.log(`Playback: Clerk auto sign-in completed (otpMode=${otpMode})`);
  }

  /** Replays a recorded single-step `clerk_auto_sign_in` row using **metadata.otpMode** (not playback UI defaults). */
  private async playbackClerkAutoSignInFromRecordedStep(
    session: PlaybackSession,
    step: RunStep,
    runUrl: string,
  ): Promise<void> {
    const meta = step.metadata;
    if (!isClerkAutoSignInMetadata(meta)) {
      throw new Error('Invalid clerk_auto_sign_in step metadata');
    }
    const authKind = meta.authKind ?? 'clerk';
    if (authKind === 'generic') {
      if (!session.projectAuth) {
        throw new Error('Project test credentials are required for generic automatic sign-in');
      }
      await performProjectPasswordSignIn(session.page, runUrl, session.projectAuth);
    } else {
      await this.runPlaybackClerkAutoSignIn(session.page, runUrl, meta.otpMode);
    }
    let current = '';
    try {
      current = session.page.url();
    } catch {
      /* ignore */
    }
    if (current && !postAuthUrlsRoughlyMatch(meta.postAuthPageUrl, current)) {
      this.logger.warn(
        `Playback: post-auth URL differs from recorded (${meta.postAuthPageUrl} vs ${current})`,
      );
    }
  }

  /**
   * Clerk sign-in assist: test email (+clerk_test, code 424242) or MailSlurp inbox, when UI shows sign-in or OTP-only.
   */
  private async maybePlaybackClerkAuthAssist(
    session: Pick<PlaybackSession, 'page' | 'projectAuth'>,
    runUrl: string,
    wantAuto: boolean,
    otpMode: ClerkOtpMode,
    state: { clerkFullSignInDone: boolean },
  ): Promise<void> {
    if (!wantAuto) {
      return;
    }
    try {
      const page = session.page;
      const authKind = await this.resolveAutoSignInAuthKind(page, session.projectAuth);
      if (authKind === 'generic' && session.projectAuth && !state.clerkFullSignInDone) {
        const emailVisible = await page
          .locator('input[type="email"], input[name="email"], input[autocomplete="email"], input[name*="email" i]')
          .first()
          .isVisible()
          .catch(() => false);
        const passwordVisible = await page
          .locator('input[name="password"][type="password"], input[type="password"], input[name*="password" i]')
          .first()
          .isVisible()
          .catch(() => false);
        const otpVisibleGeneric = await detectClerkOtpInputVisible(page);
        if (emailVisible || passwordVisible || otpVisibleGeneric) {
          await performProjectPasswordSignIn(page, runUrl, session.projectAuth);
          state.clerkFullSignInDone = true;
          return;
        }
      }
      const assistOk = this.playbackClerkAssistAvailable(otpMode);
      if (!assistOk) {
        return;
      }
      const identifier = page.locator('input[name="identifier"], #identifier-field').first();
      const idVisible = await identifier.isVisible().catch(() => false);
      const otpVisible = await detectClerkOtpInputVisible(page);

      /**
       * OTP locator matches any `input[inputmode="numeric"]` etc. — common on post-login UIs.
       * Only run MailSlurp / test-email OTP assist when the page URL looks like Clerk or /login.
       */
      if (otpVisible && !idVisible) {
        if (state.clerkFullSignInDone) {
          return;
        }
        let pageUrl = '';
        try {
          pageUrl = page.url();
        } catch {
          return;
        }
        if (!clerkSignInUrlLooksLike(pageUrl)) {
          this.logger.debug(
            `Playback: skip OTP-only Clerk assist (URL does not look like sign-in: ${pageUrl})`,
          );
          return;
        }
        if (otpMode === 'mailslurp') {
          const otpWindowStartMs = Date.now();
          await sleepMs(MAILSLURP_POST_PASSWORD_DELAY_MS);
          await fillClerkOtpFromMailSlurp(page, {
            runUrl,
            notBeforeMs: otpWindowStartMs,
          });
        } else {
          await fillClerkOtpFromClerkTestEmail(page, { runUrl });
        }
        state.clerkFullSignInDone = true;
        return;
      }

      if (!state.clerkFullSignInDone && (await detectClerkSignInUi(page))) {
        let pageUrl = '';
        try {
          pageUrl = page.url();
        } catch {
          return;
        }
        /**
         * detectClerkSignInUi falls back to OTP-visible-only; that matches non-Clerk numeric fields.
         * Require sign-in-like URL unless the email identifier field is visible (strong Clerk signal).
         */
        if (!idVisible && !clerkSignInUrlLooksLike(pageUrl)) {
          this.logger.debug(
            `Playback: skip full Clerk sign-in assist (URL not sign-in-like: ${pageUrl})`,
          );
          return;
        }
        await this.runPlaybackClerkAutoSignIn(page, runUrl, otpMode);
        state.clerkFullSignInDone = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Playback Clerk auth assist failed: ${msg}`);
    }
  }

  /**
   * Run one captured DOM action through LLM + DB in strict FIFO order (matches debounce/click order).
   */
  private async enqueueRecordingCapture(session: RecordingSession, fn: () => Promise<void>): Promise<void> {
    const prev = session.recordingCaptureTail;
    const next = prev
      .then(fn)
      .catch((err) => this.logger.error('Recording capture failed', err));
    session.recordingCaptureTail = next;
    await next;
  }

  private async setupEventCapture(session: RecordingSession) {
    await session.page.exposeFunction(
      '__bladerunnerRecordAction',
      async (actionData: string) => {
        await this.enqueueRecordingCapture(session, async () => {
          const data = JSON.parse(actionData);
          const barrierAtStart = session.clerkDomCaptureBarrier;
          if (session.recordingDomCapturePaused) {
            return;
          }
          if (session.skipDuplicateClerkOtpDomCaptureOnce && data.type === 'type') {
            const v = String(data.value ?? '').trim();
            const html = String(data.elementHtml ?? '');
            const looksOtp =
              /^\d{4,8}$/.test(v) ||
              /inputmode\s*=\s*["']numeric["']/i.test(html) ||
              /verification|otp|one[-\s]?time/i.test(html);
            if (looksOtp) {
              session.skipDuplicateClerkOtpDomCaptureOnce = false;
              return;
            }
          }
          if (data.type === 'scroll') {
            if (session.clerkDomCaptureBarrier !== barrierAtStart) {
              return;
            }
            const deltaX = Number(data.deltaX ?? 0);
            const deltaY = Number(data.deltaY ?? 0);
            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
              return;
            }
            const selector = typeof data.selector === 'string' && data.selector.trim() ? data.selector.trim() : null;
            const isRoot = data.isRoot === true;
            const step = await this.recordStep(session, {
              action: 'SCROLL',
              selector,
              value: JSON.stringify({
                deltaX: Math.round(deltaX),
                deltaY: Math.round(deltaY),
                scrollLeft: Number(data.scrollLeft ?? 0),
                scrollTop: Number(data.scrollTop ?? 0),
              }),
              instruction: this.buildScrollInstruction(deltaX, deltaY, selector, isRoot),
              playwrightCode: this.buildScrollPlaywrightCode(selector, deltaX, deltaY, isRoot),
              origin: 'MANUAL',
            });
            this.emit('step', session.runId, step);
            return;
          }
          let accessibilityTree = '';
          try {
            const snapshot = await (session.page as any).accessibility?.snapshot();
            accessibilityTree = snapshot ? JSON.stringify(snapshot, null, 2) : '';
          } catch {}

          accessibilityTree = await this.enrichAccessibilityTreeForLlm(session.page, accessibilityTree);

          const translated = await this.llmService.actionToInstruction(
            {
              action: data.type,
              selector: data.selector || '',
              elementHtml: data.elementHtml || '',
              elementVisibleText:
                typeof data.elementText === 'string' ? data.elementText : undefined,
              ariaLabel: typeof data.ariaLabel === 'string' ? data.ariaLabel : undefined,
              value: data.value,
              pageAccessibilityTree: accessibilityTree,
            },
            { userId: session.userId },
          );

          if (session.clerkDomCaptureBarrier !== barrierAtStart) {
            return;
          }

          let playwrightCode = preferRecordedCssSelectorForBarePageLocator(
            data.selector,
            translated.playwrightCode,
          );
          playwrightCode = preferGetByTextForBareTagLocator(
            data.selector,
            typeof data.elementText === 'string' ? data.elementText : undefined,
            playwrightCode,
          );

          const step = await this.recordStep(session, {
            action: (data.type?.toUpperCase() || 'CUSTOM') as any,
            selector: data.selector,
            value: data.value,
            instruction: translated.instruction,
            playwrightCode,
            origin: 'MANUAL',
          });

          const optimizedCtx = await this.captureLlmPageContext(session.page).catch((err) => {
            this.logger.warn(`Optimized prompt capture after manual step failed for ${step.id}: ${err}`);
            return null;
          });
          if (optimizedCtx) {
            this.scheduleOptimizedPromptGeneration(
              session,
              step,
              this.buildOptimizedPromptEvidencePayload(step, optimizedCtx),
              'immediate',
            );
          }

          this.emit('step', session.runId, step);
        });
      },
    );

    await session.page.addInitScript(`
      (function() {
        function getSelector(el) {
          if (el.id) return '#' + el.id;
          if (el.getAttribute && el.getAttribute('data-testid'))
            return '[data-testid="' + el.getAttribute('data-testid') + '"]';
          var tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
          var cls = el.className
            ? '.' + el.className.toString().trim().split(/\\s+/).join('.')
            : '';
          return tag + cls;
        }

        function getElementHtml(el) {
          var h = el.outerHTML ? el.outerHTML : '';
          var limit = el.tagName && el.tagName.toLowerCase() === 'input' ? 400 : 400;
          return h.slice(0, limit);
        }

        function getVisibleText(el) {
          try {
            var t = el.innerText || '';
            return t.replace(/\\s+/g, ' ').trim().slice(0, 200);
          } catch (e) {
            return '';
          }
        }

        function getAriaLabel(el) {
          try {
            if (!el.getAttribute) return '';
            var a = el.getAttribute('aria-label');
            return a ? String(a).trim().slice(0, 160) : '';
          } catch (e) {
            return '';
          }
        }

        var __brScrollState = new WeakMap();
        document.addEventListener('wheel', function(e) {
          if (window.__bladerunnerPauseRecording) return;
          if (!window.__bladerunnerRecordAction) return;
          var root = document.scrollingElement || document.documentElement || document.body;
          var rawTarget = e.target;
          var target =
            rawTarget && rawTarget.nodeType === 1 ? rawTarget : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : root);
          if (!target) target = root;
          var isRoot =
            target === document ||
            target === document.documentElement ||
            target === document.body ||
            target === root;
          var node = isRoot ? root : target;
          var existing = __brScrollState.get(node);
          var next = existing || {
            deltaX: 0,
            deltaY: 0,
            timer: 0
          };
          next.deltaX += Number(e.deltaX || 0);
          next.deltaY += Number(e.deltaY || 0);
          next.selector = isRoot ? 'document.scrollingElement' : getSelector(node);
          next.elementHtml = isRoot ? '' : getElementHtml(node);
          next.elementText = isRoot ? '' : getVisibleText(node);
          next.ariaLabel = isRoot ? '' : getAriaLabel(node);
          next.scrollLeft = isRoot ? (window.scrollX || root.scrollLeft || 0) : (node.scrollLeft || 0);
          next.scrollTop = isRoot ? (window.scrollY || root.scrollTop || 0) : (node.scrollTop || 0);
          next.isRoot = !!isRoot;
          clearTimeout(next.timer);
          next.timer = setTimeout(function() {
            if (window.__bladerunnerPauseRecording) return;
            window.__bladerunnerRecordAction(
              JSON.stringify({
                type: 'scroll',
                selector: next.selector,
                elementHtml: next.elementHtml,
                elementText: next.elementText,
                ariaLabel: next.ariaLabel,
                value: null,
                deltaX: next.deltaX,
                deltaY: next.deltaY,
                scrollLeft: next.scrollLeft,
                scrollTop: next.scrollTop,
                isRoot: next.isRoot
              })
            );
            __brScrollState.delete(node);
          }, 180);
          __brScrollState.set(node, next);
        }, { capture: true, passive: true });

        document.addEventListener('click', function(e) {
          if (window.__bladerunnerPauseRecording) return;
          var target = e.target;
          if (!target || !window.__bladerunnerRecordAction) return;
          window.__bladerunnerRecordAction(
            JSON.stringify({
              type: 'click',
              selector: getSelector(target),
              elementHtml: getElementHtml(target),
              elementText: getVisibleText(target),
              ariaLabel: getAriaLabel(target),
              value: null
            })
          );
        }, true);

        document.addEventListener('input', function(e) {
          if (window.__bladerunnerPauseRecording) return;
          var target = e.target;
          if (!target || !window.__bladerunnerRecordAction) return;
          clearTimeout(target.__brDebounce);
          target.__brDebounce = setTimeout(function() {
            if (window.__bladerunnerPauseRecording) return;
            window.__bladerunnerRecordAction(
              JSON.stringify({
                type: 'type',
                selector: getSelector(target),
                elementHtml: getElementHtml(target),
                elementText: getVisibleText(target),
                ariaLabel: getAriaLabel(target),
                value: target.value
              })
            );
          }, 500);
        }, true);
      })();
    `);
  }

  private async runWithActivePlaybackStep<T>(
    session: PlaybackSession,
    fn: () => Promise<T>,
  ): Promise<T> {
    const work = fn();
    session.activeStepWork = work.then(() => {}).catch(() => {});
    try {
      return await work;
    } finally {
      session.activeStepWork = null;
    }
  }

  /**
   * Default `true`: playback rewrites bare `.click()` to `.click({ force: true })` (avoids Radix/modal
   * "subtree intercepts pointer events"). Set `PLAYBACK_CLICK_FORCE=false` to disable.
   */
  private wantPlaybackClickForce(): boolean {
    const raw = this.configService.get<string>('PLAYBACK_CLICK_FORCE', 'true').trim().toLowerCase();
    if (raw === '' || raw === 'true' || raw === '1' || raw === 'yes') return true;
    return false;
  }

  private async executePwCode(
    page: Page,
    code: string,
    opts?: { skipClickForce?: boolean },
  ): Promise<void> {
    const forbidden = ['require(', 'import ', 'process.', 'fs.', 'child_process', 'eval('];
    for (const f of forbidden) {
      if (code.includes(f)) {
        throw new Error(`Forbidden operation in generated code: ${f}`);
      }
    }

    const relaxed = relaxPageLocatorFirstForPlayback(code);
    const searchPlaceholderFixed = preferSearchConditionsPlaceholderOverFollowingInputLabel(relaxed);
    const followingInputFixed = excludeFileInputFromFollowingInputXPath(searchPlaceholderFixed);
    const tableTdFixed = fixAmbiguousTableLastRowTdLocator(followingInputFixed);
    const tightened = tightenGetByTextLocatorsForPlayback(tableTdFixed);
    const comboboxFallback = fallbackNamedComboboxClicksForPlayback(tightened);
    const buttonTriggerFallback = fallbackNamedButtonSelectTriggerClicksForPlayback(comboboxFallback);
    const applyForce = this.wantPlaybackClickForce() && !opts?.skipClickForce;
    const withForce = applyForce ? relaxClickForceForPlayback(buttonTriggerFallback) : buttonTriggerFallback;
    const escaped = escapeLocatorCssInPlaywrightSnippet(withForce);
    const safeCode = stripTypeScriptNonNullAssertionsForPlayback(escaped);
    const parsedScroll = this.parseStoredScrollCode(safeCode);
    if (parsedScroll) {
      await this.executeRecordedScrollPlayback(page, parsedScroll);
      return;
    }
    let fn: (page: Page, expectFn: typeof expect) => Promise<unknown>;
    try {
      fn = new Function('page', 'expect', `return (async () => { ${safeCode} })();`) as (
        page: Page,
        expectFn: typeof expect,
      ) => Promise<unknown>;
    } catch (err) {
      throw err;
    }
    await fn(page, expect);
  }

  private requestBrowserFromWorker(workerUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(workerUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Browser worker connection timeout'));
      }, 15000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'launch' }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'launch:result' && msg.wsEndpoint) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.wsEndpoint);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.error));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
