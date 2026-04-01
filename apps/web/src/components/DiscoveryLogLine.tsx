import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, FileText, MessageSquare, X } from 'lucide-react';
import {
  formatDiscoveryLogSingleLine,
  type DiscoveryLogLine,
  type DiscoveryLlmLogDetail,
} from '@/hooks/useDiscoveryLive';

function toImageDataUrl(b64: string): string {
  const t = b64.trim();
  if (t.startsWith('data:')) return t;
  return `data:image/jpeg;base64,${t}`;
}

const PRE_WRAP = 'whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed';

function LlmExchangeModalBody({
  line,
  llm,
  formatTime,
  variant,
}: {
  line: DiscoveryLogLine;
  llm: DiscoveryLlmLogDetail;
  formatTime: (iso: string) => string;
  variant: 'light' | 'dark';
}) {
  const dataUrl = useMemo(
    () => (llm.sent.imageBase64 ? toImageDataUrl(llm.sent.imageBase64) : null),
    [llm.sent.imageBase64],
  );
  const muted = variant === 'dark' ? 'text-gray-400' : 'text-gray-500';
  const heading = variant === 'dark' ? 'text-gray-200' : 'text-gray-800';
  const preBg = variant === 'dark' ? 'bg-gray-950/80 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-200 text-gray-800';
  const sectionBorder = variant === 'dark' ? 'border-gray-700' : 'border-gray-200';
  const warn = variant === 'dark' ? 'text-amber-400' : 'text-amber-700';

  return (
    <div className="space-y-6 pr-1">
      <p className={`text-[11px] ${muted}`}>
        {formatTime(line.at)} · {llm.kind === 'explore' ? 'Explore step' : 'Final synthesis'} · {llm.usageKey}
      </p>

      <section className={`space-y-3 border-b ${sectionBorder} pb-4`}>
        <h3 className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${heading}`}>
          <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          SENT
        </h3>
        <div className="space-y-2">
          <p className={`text-[10px] font-semibold ${heading}`}>System prompt</p>
          {llm.sent.systemPromptTruncated ? (
            <p className={`text-[9px] ${warn}`}>Truncated at capture.</p>
          ) : null}
          <pre className={`rounded border p-2.5 ${preBg} ${PRE_WRAP}`}>{llm.sent.systemPrompt || '(empty)'}</pre>
        </div>
        <div className="space-y-2">
          <p className={`text-[10px] font-semibold ${heading}`}>User prompt</p>
          {llm.sent.userPromptTruncated ? (
            <p className={`text-[9px] ${warn}`}>Truncated at capture.</p>
          ) : null}
          <pre className={`rounded border p-2.5 ${preBg} ${PRE_WRAP}`}>{llm.sent.userPrompt || '(empty)'}</pre>
        </div>
        <div className="space-y-2">
          <p className={`text-[10px] font-semibold ${heading}`}>Screenshot / other inputs</p>
          {!llm.sent.hasImage ? (
            <p className={`text-[10px] ${muted}`}>No image attached to this request.</p>
          ) : llm.sent.imageOmittedDueToSize ? (
            <p className={`text-[10px] ${muted}`}>
              Screenshot was attached (~{llm.sent.imageSizeChars?.toLocaleString() ?? '?'} chars) but omitted from the log
              (size limit). Use the live browser preview for the current frame.
            </p>
          ) : !dataUrl ? (
            <p className={`text-[10px] ${muted}`}>Image metadata missing.</p>
          ) : (
            <>
              {llm.sent.imageTruncated ? (
                <p className={`text-[9px] ${warn}`}>Image data truncated in log.</p>
              ) : null}
              <div
                className={`rounded border overflow-hidden flex justify-center ${variant === 'dark' ? 'border-gray-600 bg-black/40' : 'border-gray-200 bg-gray-100'}`}
              >
                <img
                  src={dataUrl}
                  alt="Set-of-Marks screenshot sent to the model"
                  className="max-w-full object-contain max-h-[min(70vh,900px)]"
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${heading}`}>
          <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          RECEIVED
        </h3>
        <div className="space-y-2">
          <p className={`text-[10px] font-semibold ${heading}`}>Message from model</p>
          {llm.received.contentTruncated ? (
            <p className={`text-[9px] ${warn}`}>Truncated at capture.</p>
          ) : null}
          <pre className={`rounded border p-2.5 ${preBg} ${PRE_WRAP}`}>{llm.received.content || '(empty)'}</pre>
        </div>
        {llm.received.thinking?.trim() ? (
          <div className="space-y-2">
            <p className={`text-[10px] font-semibold ${heading}`}>Thinking</p>
            <pre className={`rounded border p-2.5 ${preBg} ${PRE_WRAP}`}>{llm.received.thinking}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LlmLogRowModal({
  line,
  llm,
  formatTime,
  variant,
}: {
  line: DiscoveryLogLine;
  llm: DiscoveryLlmLogDetail;
  formatTime: (iso: string) => string;
  variant: 'light' | 'dark';
}) {
  const [open, setOpen] = useState(false);
  const oneLine = formatDiscoveryLogSingleLine(line, formatTime);
  const border = variant === 'dark' ? 'border-gray-700' : 'border-gray-100';
  const text = variant === 'dark' ? 'text-gray-200' : 'text-gray-800';
  const btnHover = variant === 'dark' ? 'hover:bg-gray-800/80' : 'hover:bg-gray-50';

  const shell =
    variant === 'dark'
      ? 'border-gray-600 bg-gray-900 text-gray-100'
      : 'border-gray-200 bg-white text-gray-900';
  const overlay = variant === 'dark' ? 'bg-black/70' : 'bg-black/60';

  return (
    <div className={`border-b ${border} py-0.5 last:border-0`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`w-full text-left rounded px-1 py-0.5 -mx-1 flex items-start gap-1.5 font-mono text-[10px] leading-tight ${text} ${btnHover} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4B90FF]/50`}
      >
        <FileText className="h-3 w-3 shrink-0 mt-0.5 opacity-60" aria-hidden />
        <span className="min-w-0 break-all whitespace-normal">{oneLine}</span>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={`fixed inset-0 z-[200] ${overlay}`} />
          <Dialog.Content
            className={`fixed left-1/2 top-1/2 z-[201] flex max-h-[min(92vh,900px)] w-[min(96vw,960px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border shadow-xl outline-none ${shell}`}
          >
            <div
              className={`flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5 ${variant === 'dark' ? 'border-gray-700' : 'border-gray-100'}`}
            >
              <Dialog.Title className="text-sm font-semibold pr-2">
                LLM exchange — review
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={`rounded p-1.5 shrink-0 ${variant === 'dark' ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-100' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Full prompts, screenshot, and model response for this discovery LLM call.
            </Dialog.Description>
            <div
              className={`min-h-0 flex-1 overflow-y-auto px-3 py-3 ${variant === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}
            >
              <LlmExchangeModalBody line={line} llm={llm} formatTime={formatTime} variant={variant} />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

type Props = {
  line: DiscoveryLogLine;
  formatTime: (iso: string) => string;
  variant?: 'light' | 'dark';
};

export function DiscoveryLogLineRow({ line, formatTime, variant = 'light' }: Props) {
  const llm = line.detail?.llm;
  if (llm) {
    return <LlmLogRowModal line={line} llm={llm} formatTime={formatTime} variant={variant} />;
  }
  const oneLine = formatDiscoveryLogSingleLine(line, formatTime);
  const border = variant === 'dark' ? 'border-gray-700' : 'border-gray-100';
  const text = variant === 'dark' ? 'text-gray-200' : 'text-gray-800';
  return (
    <div
      className={`font-mono text-[10px] leading-tight border-b ${border} py-0.5 last:border-0 whitespace-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${text}`}
      title={oneLine}
    >
      {oneLine}
    </div>
  );
}
