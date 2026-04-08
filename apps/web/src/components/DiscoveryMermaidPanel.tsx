import { useEffect, useRef, useState } from 'react';

// Lazy-load mermaid to keep it out of the initial JS bundle.
// It is only needed when a discovery navigation map is actually rendered.
type MermaidModule = typeof import('mermaid');
let mermaidModule: MermaidModule | null = null;
let mermaidInited = false;
const renderSeq = { n: 0 };

async function getMermaid(): Promise<MermaidModule> {
  if (!mermaidModule) {
    mermaidModule = (await import('mermaid')) as MermaidModule;
  }
  return mermaidModule;
}

type Props = {
  /** Mermaid source (e.g. flowchart TD …) */
  source: string | null | undefined;
  className?: string;
};

/**
 * Renders a Mermaid diagram; safe empty state when source is missing.
 * Mermaid is loaded lazily to keep it out of the critical bundle path.
 */
export function DiscoveryMermaidPanel({ source, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source?.trim()) return;
    getMermaid().then((m) => {
      if (!mermaidInited) {
        m.default.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
        });
        mermaidInited = true;
      }
    });
  }, [source]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const trimmed = source?.trim();
    if (!trimmed) {
      el.innerHTML = '';
      setError(null);
      return;
    }
    renderSeq.n += 1;
    const id = `dm-${renderSeq.n}`;
    let cancelled = false;
    setError(null);
    getMermaid()
      .then((m) => m.default.render(id, trimmed))
      .then(({ svg }) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        if (containerRef.current) containerRef.current.innerHTML = '';
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div
      className={`rounded-md border border-gray-200 bg-white overflow-hidden flex flex-col min-h-[200px] max-h-[280px] ${className}`}
    >
      <div className="px-2.5 py-1.5 bg-gray-50 border-b border-gray-200 shrink-0">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Navigation map</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2 bg-gray-50">
        {!source?.trim() ? (
          <p className="text-[11px] text-gray-400 text-center py-6">
            The live navigation graph appears here during discovery.
          </p>
        ) : error ? (
          <p className="text-[11px] text-red-600 font-mono">{error}</p>
        ) : (
          <div ref={containerRef} className="flex justify-center [&_svg]:max-w-full" />
        )}
      </div>
    </div>
  );
}
