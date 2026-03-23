import { type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Wand2 } from 'lucide-react';
import {
  parseAiPromptLastLlmTranscript,
  type AiPromptLastLlmTranscript,
} from '@/lib/aiPromptLastLlmTranscript';
import { LlmVisionScreenshotPreview } from '@/components/ui/LlmVisionScreenshotPreview';

export type AiPromptFailureHelp = {
  error: string;
  explanation: string;
  suggestedPrompt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metadata: unknown;
  /** Optional: last test / explain failure (recording modal). */
  failure?: AiPromptFailureHelp | null;
  onAdoptSuggested?: () => void;
  adoptBusy?: boolean;
  /** When set, opens the dialog from a trigger (e.g. StepCard badge). */
  trigger?: ReactNode;
  /** Overlay z-index class (e.g. `z-[125]` when stacking over another modal). */
  overlayClassName?: string;
  /** Content panel z-index class. */
  contentClassName?: string;
};

function TranscriptSections({ lastLlmTranscript }: { lastLlmTranscript: AiPromptLastLlmTranscript | null }) {
  return (
    <>
      {lastLlmTranscript?.screenshotBase64 ? (
        <div className="mt-2 space-y-1.5">
          <div className="text-[10px] font-semibold text-gray-600">Screenshot sent to the LLM (JPEG)</div>
          <p className="text-[9px] text-gray-500">Click the preview for full size, scroll, and copy.</p>
          <div className="max-h-[min(50vh,420px)] overflow-auto rounded border border-gray-200 bg-gray-50 p-1">
            <LlmVisionScreenshotPreview
              b64={lastLlmTranscript.screenshotBase64}
              overlayClassName="z-[110]"
              contentClassName="z-[111]"
              thumbnailImgClassName="mx-auto max-w-full h-auto"
            />
          </div>
        </div>
      ) : lastLlmTranscript?.visionAttached ? (
        <p className="mt-2 text-[10px] leading-snug text-amber-900/90 rounded bg-amber-50 px-2 py-1.5 border border-amber-100">
          A JPEG screenshot was attached to this LLM request, but it was not stored in this transcript (re-run Test step
          or playback to capture it).
        </p>
      ) : null}
      {lastLlmTranscript?.capturedAt ? (
        <p className="mt-2 text-[10px] text-gray-500">
          Last captured {new Date(lastLlmTranscript.capturedAt).toLocaleString()}
          {lastLlmTranscript.source ? ` (${lastLlmTranscript.source})` : ''}
        </p>
      ) : null}
      {!lastLlmTranscript ? (
        <p className="mt-3 text-sm text-gray-600">
          No transcript yet. Run Test step or playback once to capture the exact prompt and response.
        </p>
      ) : (
        <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-left">
          <div>
            <div className="mb-1 text-[10px] font-semibold text-gray-600">System prompt</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-800">
              {lastLlmTranscript.systemPrompt}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold text-gray-600">User prompt</div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-800">
              {lastLlmTranscript.userPrompt}
            </pre>
          </div>
          {lastLlmTranscript.thinking ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold text-gray-600">Model thinking</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-800">
                {lastLlmTranscript.thinking}
              </pre>
            </div>
          ) : null}
          <div>
            <div className="mb-1 text-[10px] font-semibold text-gray-600">Raw response</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-800">
              {lastLlmTranscript.rawResponse}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * LLM transcript + optional failure explanation (same content as StepCard “AI prompt” review, plus recording failure fields).
 */
export function AiPromptReviewModal({
  open,
  onOpenChange,
  metadata,
  failure,
  onAdoptSuggested,
  adoptBusy,
  trigger,
  overlayClassName = 'z-[100]',
  contentClassName = 'z-[101]',
}: Props) {
  const lastLlmTranscript = parseAiPromptLastLlmTranscript(metadata);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className={`fixed inset-0 bg-black/45 ${overlayClassName}`} />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 flex max-h-[85vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-xl outline-none ${contentClassName}`}
        >
          <Dialog.Title className="text-sm font-semibold text-gray-900">AI prompt — LLM transcript</Dialog.Title>
          <Dialog.Description className="sr-only">
            Exact system prompt, user prompt, and raw model response from the last test or playback run.
            {failure ? ' Includes result of the LLM call and suggested prompt when a test failed.' : ''}
          </Dialog.Description>

          {failure ? (
            <div className="mt-3 space-y-2 border-b border-gray-100 pb-3">
              <p className="text-[10px] font-semibold text-gray-600">Technical error</p>
              <p className="text-[10px] text-red-700/90 font-mono leading-snug break-words border border-red-100 bg-red-50/80 rounded px-2 py-1.5">
                {failure.error}
              </p>
              <p className="text-[10px] font-semibold text-gray-600">Result of the LLM call</p>
              <div className="max-h-[min(35vh,200px)] overflow-y-auto rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-800 leading-relaxed whitespace-pre-wrap">
                {failure.explanation}
              </div>
              <p className="text-[10px] font-semibold text-gray-600">Suggested prompt</p>
              <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded border border-teal-100 bg-teal-50/50 px-2 py-1.5 font-mono text-[10px] text-gray-800 leading-snug">
                {failure.suggestedPrompt}
              </pre>
            </div>
          ) : null}

          <TranscriptSections lastLlmTranscript={lastLlmTranscript} />

          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
            {failure && onAdoptSuggested ? (
              <button
                type="button"
                disabled={adoptBusy}
                onClick={() => onAdoptSuggested()}
                className="inline-flex items-center gap-1.5 rounded-md border border-teal-500 bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
              >
                <Wand2 size={14} aria-hidden />
                Adopt this prompt
              </button>
            ) : null}
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-200"
              >
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
