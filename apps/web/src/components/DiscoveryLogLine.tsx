import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDownToLine, ChevronRight, FileText, ImageIcon, MessageSquare, X } from 'lucide-react';
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

const PRE_WRAP = 'whitespace-pre-wrap break-words font-mono text-[10px] leading-snug';

function ExpandableBlock({
  label,
  text,
  truncated,
  variant,
}: {
  label: string;
  text: string;
  truncated?: boolean;
  variant: 'light' | 'dark';
}) {
  const [open, setOpen] = useState(false);
  const long = text.length > 1200;
  const shell =
    variant === 'dark'
      ? 'border-gray-600 bg-gray-900/80 text-gray-200'
      : 'border-gray-200 bg-gray-50 text-gray-800';
  const btn =
    variant === 'dark'
      ? 'text-cyan-400 hover:text-cyan-300'
      : 'text-blue-600 hover:text-blue-800';

  if (!long) {
    return (
      <details className={`rounded border ${shell} px-2 py-1.5`}>
        <summary className="cursor-pointer select-none text-[10px] font-semibold">{label}</summary>
        {truncated && (
          <p
            className={`text-[9px] mt-1 ${variant === 'dark' ? 'text-amber-400' : 'text-amber-600'}`}
          >
            Truncated in log.
          </p>
        )}
        <pre className={`mt-1 max-h-64 overflow-auto ${PRE_WRAP}`}>{text}</pre>
      </details>
    );
  }

  return (
    <div className={`rounded border ${shell} px-2 py-1.5`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold">{label}</span>
        <button
          type="button"
          className={`inline-flex items-center gap-1 text-[10px] ${btn}`}
          onClick={() => setOpen(true)}
        >
          <FileText className="h-3 w-3 shrink-0" aria-hidden />
          View full
        </button>
      </div>
      {truncated && (
        <p className={`text-[9px] mt-1 ${variant === 'dark' ? 'text-amber-400' : 'text-amber-600'}`}>
          Truncated in log.
        </p>
      )}
      <pre className={`mt-1 max-h-32 overflow-auto opacity-90 ${PRE_WRAP}`}>{text.slice(0, 800)}…</pre>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] flex max-h-[88vh] w-[min(96vw,900px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-xl outline-none">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
              <Dialog.Title className="text-sm font-semibold text-gray-900">{label}</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Full text content</Dialog.Description>
            <pre className={`mt-2 flex-1 overflow-auto max-h-[calc(88vh-5rem)] ${PRE_WRAP} text-gray-800`}>
              {text}
            </pre>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ImageSentRow({
  sent,
  variant,
}: {
  sent: DiscoveryLlmLogDetail['sent'];
  variant: 'light' | 'dark';
}) {
  const [open, setOpen] = useState(false);
  const dataUrl = useMemo(
    () => (sent.imageBase64 ? toImageDataUrl(sent.imageBase64) : null),
    [sent.imageBase64],
  );
  const muted = variant === 'dark' ? 'text-gray-400' : 'text-gray-500';
  const accent = variant === 'dark' ? 'text-cyan-400' : 'text-blue-600';

  if (!sent.hasImage) {
    return <p className={`text-[10px] ${muted}`}>No image attached to this request.</p>;
  }
  if (sent.imageOmittedDueToSize) {
    return (
      <p className={`text-[10px] ${muted}`}>
        Screenshot was attached (~{sent.imageSizeChars?.toLocaleString() ?? '?'} chars) but omitted from the log
        (size limit). Use the live browser preview for the current frame.
      </p>
    );
  }
  if (!dataUrl) {
    return <p className={`text-[10px] ${muted}`}>Image metadata missing.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {sent.imageTruncated && (
        <span className={`text-[9px] ${variant === 'dark' ? 'text-amber-400' : 'text-amber-600'}`}>
          Image data truncated in log.
        </span>
      )}
      <button
        type="button"
        className={`inline-flex items-center gap-1 text-[10px] font-medium ${accent} hover:underline`}
        onClick={() => setOpen(true)}
      >
        <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        View screenshot (SENT)
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/70" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] flex max-h-[92vh] w-[min(96vw,1100px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-xl outline-none">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
              <Dialog.Title className="text-sm font-semibold text-gray-900">
                Screenshot sent with request
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded p-1 text-gray-500 hover:bg-gray-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">Full-page Set-of-Marks screenshot</Dialog.Description>
            <div className="mt-2 flex-1 overflow-auto max-h-[calc(92vh-4rem)] flex justify-center bg-gray-100 rounded">
              <img src={dataUrl} alt="Discovery SOM screenshot sent to LLM" className="max-w-full object-contain" />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function LlmCollapsible({
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
  const oneLine = formatDiscoveryLogSingleLine(line, formatTime);
  const border = variant === 'dark' ? 'border-gray-700' : 'border-gray-100';
  const summaryText = variant === 'dark' ? 'text-gray-200' : 'text-gray-800';
  const panel = variant === 'dark' ? 'bg-gray-900/50' : 'bg-white';

  const sumLine = variant === 'dark' ? 'text-gray-200' : 'text-gray-800';
  return (
    <details className={`group border-b ${border} py-0.5 last:border-0`}>
      <summary
        className={`cursor-pointer list-none flex items-start gap-1 font-mono text-[10px] leading-tight whitespace-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&::-webkit-details-marker]:hidden ${sumLine}`}
      >
        <ChevronRight className="h-3 w-3 shrink-0 mt-0.5 text-gray-500 group-open:rotate-90 transition-transform" />
        <span className="min-w-0 break-all whitespace-normal">{oneLine}</span>
      </summary>
      <div className={`pl-4 pr-1 pb-2 pt-1 space-y-2 rounded-md ${panel}`}>
        <div className={`text-[10px] font-semibold uppercase tracking-wide ${summaryText}`}>
          {llm.kind === 'explore' ? 'Explore step' : 'Final synthesis'} · {llm.usageKey}
        </div>

        <div className="space-y-1.5">
          <div className={`flex items-center gap-1 text-[10px] font-semibold ${summaryText}`}>
            <MessageSquare className="h-3 w-3" />
            SENT
          </div>
          <ExpandableBlock
            label="System prompt"
            text={llm.sent.systemPrompt}
            truncated={llm.sent.systemPromptTruncated}
            variant={variant}
          />
          <ExpandableBlock
            label="User prompt"
            text={llm.sent.userPrompt}
            truncated={llm.sent.userPromptTruncated}
            variant={variant}
          />
          <div
            className={`rounded border border-dashed px-2 py-1.5 ${variant === 'dark' ? 'border-gray-600' : 'border-gray-300'}`}
          >
            <p
              className={`text-[10px] font-semibold mb-1 ${variant === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}
            >
              Other inputs
            </p>
            <ImageSentRow sent={llm.sent} variant={variant} />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className={`flex items-center gap-1 text-[10px] font-semibold ${summaryText}`}>
            <ArrowDownToLine className="h-3 w-3" />
            RECEIVED
          </div>
          <ExpandableBlock
            label="Model message (raw)"
            text={llm.received.content}
            truncated={llm.received.contentTruncated}
            variant={variant}
          />
          {llm.received.thinking?.trim() ? (
            <ExpandableBlock
              label="Thinking (if any)"
              text={llm.received.thinking}
              variant={variant}
            />
          ) : null}
        </div>
      </div>
    </details>
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
    return <LlmCollapsible line={line} llm={llm} formatTime={formatTime} variant={variant} />;
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
