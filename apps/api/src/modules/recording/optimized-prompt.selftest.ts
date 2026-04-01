import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RecordingService } from './recording.service';
import {
  getOptimizedPromptEvidenceRef,
  getOptimizedPromptStored,
  OPTIMIZED_PROMPT_SCHEMA_VERSION,
  withOptimizedPromptSuccess,
} from './optimized-prompt-metadata';

(async () => {
  const optimizedMetadata = withOptimizedPromptSuccess(
    {},
    {
      schemaVersion: OPTIMIZED_PROMPT_SCHEMA_VERSION,
      generatedAt: '2026-03-26T00:00:00.000Z',
      source: 'immediate',
      step_intent_summary: 'Open the patient chart.',
      canonical_playback_prompt:
        'Open the patient chart using the patient identity and surrounding clinical context.',
      action_type: 'open',
      business_object: 'patient',
      target_semantic_description: 'Patient record entry in the worklist',
      input_or_selection_value: 'John A. Smith',
      preconditions: ['The worklist is visible.'],
      expected_outcome: ['The patient chart is visible.'],
      disambiguation_hints: ['Use patient identity and nearby clinical details.'],
      do_not_depend_on: ['Exact row index'],
      uncertainty_notes: [],
      confidence: 0.91,
    },
    {
      schemaVersion: OPTIMIZED_PROMPT_SCHEMA_VERSION,
      capturedAt: '2026-03-26T00:00:00.000Z',
      source: 'immediate',
      evidencePath: 'optimized-prompts/step-0002-step-2.json',
      screenshotPath: 'optimized-prompts/step-0002-step-2.jpg',
    },
  );

  assert.equal(getOptimizedPromptStored(optimizedMetadata)?.action_type, 'open');
  assert.equal(
    getOptimizedPromptStored(optimizedMetadata)?.canonical_playback_prompt,
    'Open the patient chart using the patient identity and surrounding clinical context.',
  );
  assert.equal(
    getOptimizedPromptEvidenceRef(optimizedMetadata)?.evidencePath,
    'optimized-prompts/step-0002-step-2.json',
  );

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'optimized-prompt-selftest-'));
  const config = {
    get(key: string) {
      if (key === 'RECORDINGS_DIR') return tmpRoot;
      return undefined;
    },
  } as any;

  const service = new RecordingService({} as any, {} as any, config, {} as any) as any;
  const evidenceRef = await service.writeOptimizedPromptEvidence(
    'run-1',
    'user-1',
    { id: 'step-2', sequence: 2 },
    {
      pageUrl: 'https://example.com/patients',
      somManifest: '[1] button "Open chart"',
      accessibilitySnapshot: '{"role":"root"}',
      playwrightSnippet: `await page.getByRole('button', { name: 'Open chart' }).click();`,
      recordingMode: 'manual',
      humanPromptOrNull: null,
      optionalPageMetadata: '{"pageUrl":"https://example.com/patients"}',
      screenshotBase64: Buffer.from('fake-jpeg').toString('base64'),
    },
    'immediate',
  );

  const loadedEvidence = await service.readOptimizedPromptEvidence('run-1', 'user-1', {
    optimizedPromptEvidence: evidenceRef,
  });
  assert.equal(loadedEvidence?.pageUrl, 'https://example.com/patients');
  assert.equal(loadedEvidence?.recordingMode, 'manual');
  assert.equal(loadedEvidence?.playwrightSnippet.includes('Open chart'), true);
  assert.equal(loadedEvidence?.screenshotBase64, Buffer.from('fake-jpeg').toString('base64'));

  const orderedCalls: string[] = [];
  service.runWithActivePlaybackStep = async (_session: unknown, fn: () => Promise<unknown>) => fn();
  service.executePwCode = async () => {
    orderedCalls.push('stored');
    throw new Error('stored code failed');
  };
  service.attemptPlaybackWithOptimizedPrompt = async () => {
    orderedCalls.push('optimized');
  };
  service.attemptPlaybackRepair = async () => {
    orderedCalls.push('repair');
  };
  service.persistPlaybackRepairFailure = async () => {
    orderedCalls.push('persist-failure');
  };
  service.persistOptimizedPromptPlaybackFailure = async () => {
    orderedCalls.push('persist-optimized-failure');
  };
  service.shouldAttemptPlaybackRepair = () => true;

  await service.executePlaybackStepWithRepair(
    {} as any,
    {
      id: 'step-2',
      runId: 'run-1',
      userId: 'user-1',
      instruction: 'Open patient chart',
      playwrightCode: `await page.getByRole('button', { name: 'Broken' }).click();`,
      recordedPlaywrightCode: null,
      origin: 'MANUAL',
      metadata: optimizedMetadata,
    },
    'pb-1',
    'run-1',
    { id: 'step-2', sequence: 2, action: 'CLICK', instruction: 'Open patient chart' },
    false,
  );
  assert.deepEqual(orderedCalls, ['stored', 'optimized']);

  orderedCalls.length = 0;
  service.attemptPlaybackWithOptimizedPrompt = async () => {
    orderedCalls.push('optimized');
    throw new Error('optimized failed');
  };
  await service.executePlaybackStepWithRepair(
    {} as any,
    {
      id: 'step-2',
      runId: 'run-1',
      userId: 'user-1',
      instruction: 'Open patient chart',
      playwrightCode: `await page.getByRole('button', { name: 'Broken' }).click();`,
      recordedPlaywrightCode: null,
      origin: 'MANUAL',
      metadata: optimizedMetadata,
    },
    'pb-1',
    'run-1',
    { id: 'step-2', sequence: 2, action: 'CLICK', instruction: 'Open patient chart' },
    false,
  );
  assert.deepEqual(orderedCalls, ['stored', 'optimized', 'persist-optimized-failure', 'repair']);

  await fs.rm(tmpRoot, { recursive: true, force: true });

  console.log('optimized-prompt.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
