import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { AiVisualIdTestDetail, AiVisualIdTreeNode } from '@/lib/api';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  test: AiVisualIdTestDetail | null;
  loading?: boolean;
};

type TreeNodeRowProps = {
  node: AiVisualIdTreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelect: (tagNumber: number | null) => void;
  activeTagNumber: number | null;
};

function formatTreeNodeLine(node: AiVisualIdTreeNode): string {
  const attrs = Object.entries(node.attributes)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
    .join(' ');
  const label = node.name || '';
  return `${node.role}${label ? ` ${JSON.stringify(label)}` : ''}${attrs ? ` [${attrs}]` : ''}`;
}

function TreeNodeRow({ node, depth, expanded, onToggle, onSelect, activeTagNumber }: TreeNodeRowProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded[node.id] ?? depth < 2;
  const isActive = activeTagNumber != null && node.tagNumber === activeTagNumber;

  return (
    <div>
      <div
        className={`flex items-start gap-1 rounded px-1.5 py-1 text-[11px] ${
          isActive ? 'bg-blue-50 text-blue-900' : 'text-gray-700 hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30"
          disabled={!hasChildren}
          aria-label={hasChildren ? (isExpanded ? 'Collapse tree node' : 'Expand tree node') : 'No children'}
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node.tagNumber)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-start gap-1.5">
            <span className="min-w-0 break-words font-mono text-[11px] text-gray-900">{formatTreeNodeLine(node)}</span>
            {node.tagNumber != null ? (
              <span className="mt-0.5 shrink-0 rounded border border-amber-300 bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-900">
                [{node.tagNumber}]
              </span>
            ) : null}
          </div>
          {node.value && node.value !== node.name ? (
            <div className="mt-0.5 break-words text-[10px] text-gray-500">Value: {node.value}</div>
          ) : null}
          {node.description ? (
            <div className="mt-0.5 break-words text-[10px] text-gray-500">Description: {node.description}</div>
          ) : null}
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <div>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              activeTagNumber={activeTagNumber}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AiVisualIdTreeModal({ open, onOpenChange, test, loading = false }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeTagNumber, setActiveTagNumber] = useState<number | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);
  const blinkTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !test) return;
    const nextExpanded: Record<string, boolean> = {};
    const seed = (nodes: AiVisualIdTreeNode[], depth: number) => {
      for (const node of nodes) {
        nextExpanded[node.id] = depth < 2;
        if (node.children.length) seed(node.children, depth + 1);
      }
    };
    seed(test.tree, 0);
    setExpanded(nextExpanded);
    setActiveTagNumber(null);
  }, [open, test]);

  useEffect(() => {
    return () => {
      if (blinkTimerRef.current != null) {
        window.clearTimeout(blinkTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const updateSize = () => {
      if (!imageRef.current) return;
      const rect = imageRef.current.getBoundingClientRect();
      setImageSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [open, test?.id]);

  const scale = useMemo(() => {
    const widthBase = test?.screenshotWidth || imageRef.current?.naturalWidth || 1;
    const heightBase = test?.screenshotHeight || imageRef.current?.naturalHeight || 1;
    return {
      x: imageSize.width > 0 ? imageSize.width / widthBase : 1,
      y: imageSize.height > 0 ? imageSize.height / heightBase : 1,
    };
  }, [imageSize.height, imageSize.width, test?.screenshotHeight, test?.screenshotWidth]);

  const activeTag = useMemo(
    () => test?.somTags.find((tag) => tag.number === activeTagNumber) ?? null,
    [activeTagNumber, test?.somTags],
  );

  const toggleNode = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const pulseTag = (tagNumber: number | null) => {
    if (tagNumber == null) return;
    setActiveTagNumber(tagNumber);
    if (blinkTimerRef.current != null) {
      window.clearTimeout(blinkTimerRef.current);
    }
    blinkTimerRef.current = window.setTimeout(() => setActiveTagNumber(null), 2200);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[140] bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[141] flex h-[88vh] w-[min(96vw,1400px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-200 bg-white shadow-2xl outline-none">
          <div className="border-b border-gray-100 px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-gray-900">AI Visual ID — Tree</Dialog.Title>
            <Dialog.Description className="mt-1 text-[11px] text-gray-500">
              Click any accessibility tree node to blink its matching Set-of-Marks tag over the stored screenshot.
            </Dialog.Description>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-0">
            <div className="min-h-0 overflow-auto border-r border-gray-100 bg-gray-950/95 p-3">
              {loading ? (
                <div className="flex h-full items-center justify-center text-gray-200">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading screenshot…
                </div>
              ) : test ? (
                <div className="relative inline-block">
                  <img
                    ref={imageRef}
                    src={`data:image/jpeg;base64,${test.screenshotBase64}`}
                    alt="Labeled screenshot for AI Visual ID"
                    className="block h-auto w-max max-w-none"
                    onLoad={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setImageSize({ width: rect.width, height: rect.height });
                    }}
                    draggable={false}
                  />
                  {activeTag ? (
                    <div
                      className="pointer-events-none absolute animate-pulse"
                      style={{
                        left: `${activeTag.left * scale.x}px`,
                        top: `${activeTag.top * scale.y}px`,
                      }}
                    >
                      <div className="rounded border-2 border-red-500 bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-lg">
                        {activeTag.number}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-[12px] text-gray-300">
                  No stored AI Visual ID capture yet.
                </div>
              )}
            </div>
            <div className="min-h-0 overflow-hidden bg-white">
              {loading ? (
                <div className="flex h-full items-center justify-center text-gray-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading accessibility tree…
                </div>
              ) : test ? (
                <div className="flex h-full flex-col">
                  <div className="border-b border-gray-100 px-3 py-2 text-[10px] text-gray-500">
                    Step #{test.stepSequence} · {test.provider} · {test.model}
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
                    {test.tree.length === 0 ? (
                      <div className="px-3 py-4 text-[11px] text-gray-500">
                        No accessibility tree nodes were saved for this capture.
                      </div>
                    ) : (
                      test.tree.map((node) => (
                        <TreeNodeRow
                          key={node.id}
                          node={node}
                          depth={0}
                          expanded={expanded}
                          onToggle={toggleNode}
                          onSelect={pulseTag}
                          activeTagNumber={activeTagNumber}
                        />
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-gray-500">
                  Run an AI Visual ID test first to inspect the saved accessibility tree and labeled screenshot.
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-4 py-3">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
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
