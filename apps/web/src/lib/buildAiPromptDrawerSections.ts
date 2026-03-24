import type { AiPromptTestProgressPayload } from '@/hooks/useRecording';
import type { AiPromptLastLlmTranscript } from '@/lib/aiPromptLastLlmTranscript';

export type AiPromptDrawerSections = {
  screenshotBase64?: string;
  promptText: string;
  thinking?: string;
  rawResponse: string;
  playwrightCode: string;
  streamingPartial: boolean;
  liveRawStream: string;
  liveThinkingStream: string;
};

/**
 * Same merge logic as Runs page `aiPromptDrawerSections` useMemo — live socket progress + cached transcript.
 */
export function buildAiPromptDrawerSections(input: {
  cached: AiPromptLastLlmTranscript | null;
  metaPw: string;
  live: AiPromptTestProgressPayload | null;
  busyWithNoLive: boolean;
}): AiPromptDrawerSections {
  const { cached, metaPw, live, busyWithNoLive } = input;
  const streamingPartial = live?.streamingPartial === true;

  if (live) {
    return {
      screenshotBase64: live.screenshotBase64 ?? cached?.screenshotBase64,
      promptText: (live.fullUserPrompt || live.promptSent || cached?.userPrompt || '').trim(),
      thinking: streamingPartial ? cached?.thinking : (live.thinking ?? cached?.thinking),
      rawResponse: streamingPartial
        ? (cached?.rawResponse ?? '').trim()
        : (live.rawResponse ?? cached?.rawResponse ?? '').trim(),
      playwrightCode: (live.playwrightCode || metaPw).trim(),
      streamingPartial,
      liveRawStream: streamingPartial ? (live.rawResponse ?? '').trim() : '',
      liveThinkingStream: streamingPartial ? (live.thinking ?? '').trim() : '',
    };
  }

  if (busyWithNoLive) {
    return {
      screenshotBase64: undefined,
      promptText: '',
      thinking: undefined,
      rawResponse: '',
      playwrightCode: '',
      streamingPartial: false,
      liveRawStream: '',
      liveThinkingStream: '',
    };
  }

  return {
    screenshotBase64: cached?.screenshotBase64,
    promptText: (cached?.userPrompt ?? '').trim(),
    thinking: cached?.thinking,
    rawResponse: (cached?.rawResponse ?? '').trim(),
    playwrightCode: metaPw,
    streamingPartial: false,
    liveRawStream: '',
    liveThinkingStream: '',
  };
}
