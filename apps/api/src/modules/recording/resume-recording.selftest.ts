import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { RecordingService } from './recording.service';

type MutableRun = {
  id: string;
  userId: string;
  name: string;
  url: string;
  status: 'RECORDING' | 'PAUSED' | 'COMPLETED';
  durationMs: number;
  startedAt: Date | null;
  completedAt: Date | null;
  recordingViewportWidth: number;
  recordingViewportHeight: number;
  streamMaxWidth: number;
  streamMaxHeight: number;
  streamJpegQuality: number;
  streamEveryNthFrame: number;
  steps: Array<{
    id: string;
    runId: string;
    userId: string;
    sequence: number;
    action: 'NAVIGATE' | 'CLICK';
    selector: string | null;
    value: string | null;
    instruction: string;
    playwrightCode: string;
    origin: 'MANUAL';
    timestamp: Date;
    excludedFromPlayback: boolean;
    metadata: null;
  }>;
};

function makeMockPage() {
  const context = {
    clearCookies: async () => {},
    addCookies: async () => {},
  };
  return {
    gotoCalls: [] as string[],
    async goto(url: string) {
      this.gotoCalls.push(url);
    },
    context: () => context,
    url: () => 'https://example.com/dashboard',
    screenshot: async () => Buffer.from('thumb'),
  };
}

async function main() {
  const run: MutableRun = {
    id: 'run-1',
    userId: 'user-1',
    name: 'Resume flow',
    url: 'https://example.com',
    status: 'RECORDING',
    durationMs: 1_500,
    startedAt: new Date(Date.now() - 2_000),
    completedAt: null,
    recordingViewportWidth: 1280,
    recordingViewportHeight: 720,
    streamMaxWidth: 1280,
    streamMaxHeight: 720,
    streamJpegQuality: 60,
    streamEveryNthFrame: 1,
    steps: [
      {
        id: 'step-1',
        runId: 'run-1',
        userId: 'user-1',
        sequence: 1,
        action: 'NAVIGATE',
        selector: null,
        value: 'https://example.com',
        instruction: 'Navigate',
        playwrightCode: "await page.goto('https://example.com');",
        origin: 'MANUAL',
        timestamp: new Date(),
        excludedFromPlayback: false,
        metadata: null,
      },
      {
        id: 'step-2',
        runId: 'run-1',
        userId: 'user-1',
        sequence: 2,
        action: 'CLICK',
        selector: 'button',
        value: null,
        instruction: 'Click save',
        playwrightCode: "await page.locator('button').click();",
        origin: 'MANUAL',
        timestamp: new Date(),
        excludedFromPlayback: false,
        metadata: null,
      },
    ],
  };

  const prisma: any = {
    run: {
      async findFirst() {
        return { ...run, project: null, steps: run.steps };
      },
      async findUnique() {
        return { id: run.id, startedAt: run.startedAt, durationMs: run.durationMs };
      },
      async update(args: any) {
        Object.assign(run, args.data);
        return { ...run, steps: run.steps };
      },
    },
    runStep: {
      async findFirst(args: any) {
        if (args?.select?.sequence) {
          return { sequence: run.steps[run.steps.length - 1]?.sequence ?? 0 };
        }
        return null;
      },
    },
    runRecording: {
      async deleteMany() {},
      async create() {},
    },
    runCheckpoint: {
      async findFirst() {
        return null;
      },
      async deleteMany() {},
      async create() {},
    },
  };

  const config = {
    get(key: string, fallback?: string) {
      if (key === 'RECORDING_CHECKPOINTS') return 'false';
      return fallback;
    },
  };

  const service = new RecordingService(prisma, {} as any, config as any);
  (service as any).waitForOptimizedPromptTasks = async () => {};
  (service as any).refreshOptimizedPromptsForRun = async () => {};
  (service as any).clearOptimizedPromptTasksForRun = () => {};
  (service as any).clearAiPromptSnapshotsForRun = () => {};

  const stopPage = makeMockPage();
  (service as any).sessions.set(run.id, {
    runId: run.id,
    userId: run.userId,
    browser: { close: async () => {} },
    page: stopPage,
    cdpSession: { send: async () => {} },
    stepSequence: 2,
    latestFrame: null,
    screencastVideo: null,
    recordingCaptureTail: Promise.resolve(),
    recordingDomCapturePaused: false,
    clerkDomCaptureBarrier: 0,
    projectAuth: null,
  });

  await service.stopRecording(run.id, run.userId, 'save');
  assert.equal(run.status, 'PAUSED');
  assert.equal(run.completedAt, null);
  assert.equal((service as any).sessions.has(run.id), false);
  assert.ok(run.durationMs >= 3_000);

  const resumePage = makeMockPage();
  let restoredUrl = '';
  (service as any).createLiveRecordingSession = async () => {
    const nextSession = {
      runId: run.id,
      userId: run.userId,
      browser: { close: async () => {} },
      page: resumePage,
      cdpSession: { send: async () => {} },
      stepSequence: 0,
      latestFrame: null,
      screencastVideo: null,
      recordingCaptureTail: Promise.resolve(),
      recordingDomCapturePaused: false,
      clerkDomCaptureBarrier: 0,
      projectAuth: null,
    };
    (service as any).sessions.set(run.id, nextSession);
    return nextSession;
  };
  (service as any).readLatestCheckpointSnapshot = async () => ({
    pageUrl: 'https://example.com/dashboard',
    state: { cookies: [], origins: [] },
  });
  (service as any).applyStorageStateToPage = async (_page: unknown, _state: unknown, targetUrl: string) => {
    restoredUrl = targetUrl;
  };

  const resumedRun = await service.resumeRecording(run.id, run.userId);
  assert.equal(resumedRun.status, 'RECORDING');
  assert.equal(restoredUrl, 'https://example.com/dashboard');
  const resumedSession = (service as any).sessions.get(run.id);
  assert.equal(resumedSession.stepSequence, 2);

  (service as any).sessions.delete(run.id);
  run.status = 'RECORDING';
  restoredUrl = '';
  const legacyRecordingResumedRun = await service.resumeRecording(run.id, run.userId);
  assert.equal(legacyRecordingResumedRun.status, 'RECORDING');
  assert.equal(restoredUrl, 'https://example.com/dashboard');
  const legacyResumedSession = (service as any).sessions.get(run.id);
  assert.equal(legacyResumedSession.stepSequence, 2);
  (service as any).sessions.delete(run.id);

  run.status = 'PAUSED';
  (service as any).attachScreencast = async () => {};
  (service as any).runPlaybackLoop = async () => {};
  (service as any).requestBrowserFromWorker = async () => 'ws://mock-browser';

  const playbackPage = makeMockPage();
  const mockBrowser = {
    newContext: async () => ({
      newPage: async () => playbackPage,
      newCDPSession: async () => ({ send: async () => {} }),
    }),
    close: async () => {},
  };
  const originalConnect = (chromium as any).connect;
  (chromium as any).connect = async () => mockBrowser;
  try {
    const playback = await service.startPlayback(run.userId, run.id, {});
    assert.equal(playback.sourceRunId, run.id);
    assert.ok(service.getPlaybackSessionSnapshot(playback.playbackSessionId, run.userId));
  } finally {
    (chromium as any).connect = originalConnect;
  }

  console.log('recording resume-recording.selftest: ok');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
