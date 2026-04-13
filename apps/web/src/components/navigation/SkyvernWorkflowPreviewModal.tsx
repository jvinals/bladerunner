/**
 * Preview and download the Skyvern workflow definition (JSON / YAML / PDF).
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Download, FileJson, FileText, FileType } from 'lucide-react';
import { jsPDF } from 'jspdf';
import yaml from 'js-yaml';
import { navigationsApi } from '@/lib/api';

type FormatTab = 'json' | 'yaml' | 'pdf';

function buildPdfBlob(text: string): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  doc.setFont('courier', 'normal');
  doc.setFontSize(7);
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxWidth = pageW - margin * 2;
  const lines = doc.splitTextToSize(text, maxWidth);
  let y = 48;
  const lineH = 9;
  for (const line of lines) {
    if (y > pageH - margin) {
      doc.addPage();
      y = 48;
    }
    doc.text(line, margin, y);
    y += lineH;
  }
  return doc.output('blob');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface SkyvernWorkflowPreviewModalProps {
  navId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SkyvernWorkflowPreviewModal({ navId, open, onOpenChange }: SkyvernWorkflowPreviewModalProps) {
  const [tab, setTab] = useState<FormatTab>('json');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['navigation', navId, 'skyvern-workflow'],
    queryFn: () => navigationsApi.skyvernWorkflow(navId),
    enabled: open && Boolean(navId),
    staleTime: 30_000,
  });

  const data = query.data;

  const jsonText = useMemo(() => {
    if (!data) return '';
    return JSON.stringify(data, null, 2);
  }, [data]);

  const yamlText = useMemo(() => {
    if (!data) return '';
    try {
      return yaml.dump(data as unknown as object, { lineWidth: 120, noRefs: true });
    } catch {
      return '';
    }
  }, [data]);

  useEffect(() => {
    if (!data || tab !== 'pdf') {
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const blob = buildPdfBlob(jsonText);
    const url = URL.createObjectURL(blob);
    setPdfPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [data, tab, jsonText]);

  const downloadJson = () => {
    if (!data) return;
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    triggerDownload(blob, `skyvern-workflow-${navId}.json`);
  };

  const downloadYaml = () => {
    if (!yamlText) return;
    const blob = new Blob([yamlText], { type: 'text/yaml;charset=utf-8' });
    triggerDownload(blob, `skyvern-workflow-${navId}.yaml`);
  };

  const downloadPdf = () => {
    if (!data) return;
    const blob = buildPdfBlob(jsonText);
    triggerDownload(blob, `skyvern-workflow-${navId}.pdf`);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 data-[state=open]:animate-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] flex max-h-[min(90vh,40rem)] w-[min(100vw-1.5rem,42rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-200 bg-white shadow-lg focus:outline-none">
          <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div>
              <Dialog.Title className="text-sm font-semibold text-gray-900">
                Skyvern workflow
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-gray-500">
                Same definition as Play sync (create/update payload).
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          {query.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">Loading…</p>
          ) : query.isError ? (
            <p className="px-4 py-6 text-center text-sm text-red-600">
              {query.error instanceof Error ? query.error.message : 'Could not load workflow.'}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1 border-b border-gray-100 px-3 py-2">
                {(
                  [
                    { id: 'json' as const, label: 'JSON', icon: FileJson },
                    { id: 'yaml' as const, label: 'YAML', icon: FileText },
                    { id: 'pdf' as const, label: 'PDF', icon: FileType },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                      tab === id
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Icon size={12} aria-hidden />
                    {label}
                  </button>
                ))}
              </div>

              <div className="min-h-[200px] flex-1 overflow-hidden px-3 pb-2">
                {tab === 'json' && (
                  <pre className="max-h-[min(50vh,22rem)] overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-[10px] leading-relaxed text-gray-800 font-mono whitespace-pre-wrap break-words">
                    {jsonText}
                  </pre>
                )}
                {tab === 'yaml' && (
                  <pre className="max-h-[min(50vh,22rem)] overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-[10px] leading-relaxed text-gray-800 font-mono whitespace-pre-wrap break-words">
                    {yamlText}
                  </pre>
                )}
                {tab === 'pdf' && pdfPreviewUrl && (
                  <iframe
                    title="PDF preview"
                    className="h-[min(50vh,22rem)] w-full rounded-lg border border-gray-200 bg-gray-100"
                    src={pdfPreviewUrl}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
                <button
                  type="button"
                  onClick={downloadJson}
                  disabled={!data}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Download size={14} />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={downloadYaml}
                  disabled={!yamlText}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Download size={14} />
                  YAML
                </button>
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={!data}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Download size={14} />
                  PDF
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
