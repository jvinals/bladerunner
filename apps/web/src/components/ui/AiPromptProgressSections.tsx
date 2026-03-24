import { useLayoutEffect, useRef } from 'react';
import { LlmVisionScreenshotPreview } from '@/components/ui/LlmVisionScreenshotPreview';
import type { AiPromptDrawerSections } from '@/lib/buildAiPromptDrawerSections';

type AiPromptProgressSectionsProps = {
  sections: AiPromptDrawerSections;
  className?: string;
};

/**
 * Numbered blocks: viewport JPEG, prompt, model thinking / streaming, Playwright code.
 * Shared by Runs “Add AI prompt step” drawer and StepCard AI prompt details.
 */
export function AiPromptProgressSections({ sections, className = 'mt-4 space-y-3' }: AiPromptProgressSectionsProps) {
  const answerRef = useRef<HTMLPreElement>(null);
  const thoughtRef = useRef<HTMLPreElement>(null);

  useLayoutEffect(() => {
    if (!sections.streamingPartial) return;
    const answerEl = answerRef.current;
    const thoughtEl = thoughtRef.current;
    if (answerEl) answerEl.scrollTop = answerEl.scrollHeight;
    if (thoughtEl) thoughtEl.scrollTop = thoughtEl.scrollHeight;
  }, [sections.streamingPartial, sections.liveRawStream, sections.liveThinkingStream]);

  return (
    <div className={className}>
      <div className="rounded border border-gray-100 bg-gray-50/80 p-2">
        <p className="text-[10px] font-semibold text-gray-800 mb-1">1. Viewport sent to the vision model</p>
        <p className="text-[9px] text-gray-500 mb-1.5 leading-snug">
          JPEG attached to the vision API for this run — click to enlarge.
        </p>
        {sections.screenshotBase64 ? (
          <LlmVisionScreenshotPreview
            b64={sections.screenshotBase64}
            modalTitle="Vision input — full resolution"
          />
        ) : (
          <p className="text-[10px] text-gray-400 italic">—</p>
        )}
      </div>
      <div className="rounded border border-gray-100 bg-gray-50/80 p-2">
        <p className="text-[10px] font-semibold text-gray-800 mb-1">2. Prompt sent to the LLM</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-2 font-mono text-[9px] leading-snug text-gray-800">
          {sections.promptText || '—'}
        </pre>
      </div>
      <div className="rounded border border-gray-100 bg-gray-50/80 p-2">
        <p className="text-[10px] font-semibold text-gray-800 mb-1">3. Model Thinking</p>
        {sections.streamingPartial ? (
          <div
            className="mb-2 rounded border border-teal-200/70 bg-teal-50/40 p-2"
            role="log"
            aria-label="Live model streaming output"
          >
            <p className="text-[9px] font-medium text-teal-900 mb-1.5">Live streaming</p>
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-[9px] font-medium text-gray-600 mb-0.5">Answer / Playwright stream</p>
                <pre
                  ref={answerRef}
                  className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-teal-200/80 bg-white p-2 font-mono text-[9px] leading-snug text-gray-800 min-h-[2rem]"
                >
                  {sections.liveRawStream || '…'}
                </pre>
              </div>
              <div>
                <p className="text-[9px] font-medium text-gray-600 mb-0.5">Thought summary</p>
                <p className="text-[9px] text-gray-500 mb-1 leading-snug">
                  From Gemini <code className="rounded bg-white/80 px-0.5">thought: true</code> chunks when includeThoughts
                  is enabled.
                </p>
                <pre
                  ref={thoughtRef}
                  className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded border border-teal-200/60 bg-white p-2 font-mono text-[9px] leading-snug text-gray-800 min-h-[2rem]"
                >
                  {sections.liveThinkingStream || '—'}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
        {sections.thinking ? (
          <div className="mb-2">
            <p className="text-[9px] font-medium text-gray-600 mb-0.5">Model thinking (final)</p>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-2 font-mono text-[9px] leading-snug text-gray-800">
              {sections.thinking}
            </pre>
          </div>
        ) : null}
        <p className="text-[9px] font-medium text-gray-600 mb-0.5">Raw model output (final)</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-2 font-mono text-[9px] leading-snug text-gray-800">
          {sections.rawResponse || '—'}
        </pre>
      </div>
      <div className="rounded border border-gray-100 bg-gray-50/80 p-2">
        <p className="text-[10px] font-semibold text-gray-800 mb-1">4. Playwright code to run</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-200 bg-white p-2 font-mono text-[9px] leading-snug text-gray-800">
          {sections.playwrightCode || '—'}
        </pre>
      </div>
    </div>
  );
}
