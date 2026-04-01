import { discoveryScreenKey, normalizeDiscoveryUrlForDedup } from './discovery-url.util';

export type NavNodeRecord = {
  id: string;
  label: string;
  depth: number;
  parentId: string | null;
  urlNorm: string;
};

/** Sanitize Mermaid node IDs (alphanumeric + underscore). */
export function sanitizeMermaidNodeId(id: string): string {
  return `N${id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

/** Human-readable label: title + pathname when useful (avoids duplicate "Dashboard" boxes). */
export function formatMermaidNodeLabel(n: NavNodeRecord): string {
  const base = (n.label || n.urlNorm || n.id).replace(/"/g, '\\"').replace(/\n/g, ' ');
  if (!n.urlNorm?.trim()) {
    return base.length > 80 ? `${base.slice(0, 77)}…` : base;
  }
  try {
    const u = new URL(n.urlNorm);
    const path = u.pathname || '/';
    const pathPart = path.length > 1 ? path.slice(0, 52) : '';
    const combined = pathPart ? `${base.slice(0, 56)} · ${pathPart}` : base;
    return combined.length > 80 ? `${combined.slice(0, 77)}…` : combined;
  } catch {
    const short = base.length > 80 ? `${base.slice(0, 77)}…` : base;
    return short;
  }
}

export function graphToMermaid(
  nodes: Iterable<NavNodeRecord>,
  edges: Array<{ from: string; to: string }>,
): string {
  const lines: string[] = ['flowchart TD'];
  const seen = new Set<string>();
  for (const n of nodes) {
    const mid = sanitizeMermaidNodeId(n.id);
    if (seen.has(mid)) continue;
    seen.add(mid);
    const short = formatMermaidNodeLabel(n);
    lines.push(`  ${mid}["${short}"]`);
  }
  const seenEdges = new Set<string>();
  for (const e of edges) {
    const a = sanitizeMermaidNodeId(e.from);
    const b = sanitizeMermaidNodeId(e.to);
    const ek = `${a}-->${b}`;
    if (seenEdges.has(ek)) continue;
    seenEdges.add(ek);
    lines.push(`  ${a} --> ${b}`);
  }
  return lines.join('\n');
}

const MAX_LLM_TREE_CHARS = 6000;

/**
 * DFS-oriented navigation tree for discovery: one node per **logical screen** (normalized URL +
 * normalized title) so SPAs without URL changes still grow the map. subsectionComplete() moves focus to parent.
 */
export class DiscoveryNavigationTree {
  private nextId = 0;
  readonly nodes = new Map<string, NavNodeRecord>();
  readonly edges: Array<{ from: string; to: string }> = [];
  readonly rootId: string;
  focusId: string;
  /** Maps logical screen key (URL + title) → node id. */
  private screenKeyToNodeId = new Map<string, string>();
  readonly maxDepth: number;

  constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
    this.rootId = this.allocId();
    this.nodes.set(this.rootId, {
      id: this.rootId,
      label: 'App',
      depth: 0,
      parentId: null,
      urlNorm: '',
    });
    this.focusId = this.rootId;
  }

  private allocId(): string {
    return `nav_${this.nextId++}`;
  }

  /** Sync from main-frame visit list: link last URL to tree under current focus. */
  syncFromVisitedScreens(
    screens: Array<{ url: string; title: string | null; navigatedAt: string }>,
  ): void {
    if (screens.length === 0) return;
    const last = screens[screens.length - 1];
    const urlNorm = normalizeDiscoveryUrlForDedup(last.url);
    const label = (last.title?.trim() || last.url).slice(0, 120);
    this.recordScreen(urlNorm, label);
  }

  /** Record a logical screen (URL + title); create child if new, or move focus if seen. */
  recordScreen(urlNorm: string, label: string): void {
    const key = discoveryScreenKey(urlNorm, label);
    const existing = this.screenKeyToNodeId.get(key);
    if (existing) {
      this.focusId = existing;
      return;
    }
    const parent = this.nodes.get(this.focusId);
    if (!parent) return;
    const nextDepth = Math.min(parent.depth + 1, this.maxDepth);
    const id = this.allocId();
    this.nodes.set(id, {
      id,
      label: label || urlNorm.slice(0, 80),
      depth: nextDepth,
      parentId: this.focusId,
      urlNorm,
    });
    this.screenKeyToNodeId.set(key, id);
    this.edges.push({ from: this.focusId, to: id });
    this.focusId = id;
  }

  /** LLM reports subsection exhausted — move focus to parent for backtrack. */
  subsectionComplete(): void {
    const node = this.nodes.get(this.focusId);
    if (!node?.parentId) return;
    this.focusId = node.parentId;
  }

  depthOf(nodeId: string): number {
    return this.nodes.get(nodeId)?.depth ?? 0;
  }

  /** Labels of nodes attached directly under the synthetic root (breadth checklist for the LLM). */
  topLevelLabels(): string[] {
    const labels: string[] = [];
    for (const n of this.nodes.values()) {
      if (n.parentId === this.rootId && n.urlNorm) {
        labels.push(n.label || n.urlNorm.slice(0, 80));
      }
    }
    return labels;
  }

  /** Compact path + stack for explore prompt. */
  formatSummaryForLlm(): string {
    const path: string[] = [];
    let cur: string | null = this.focusId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = this.nodes.get(cur);
      if (!n) break;
      path.unshift(`${n.depth}:${n.label}`);
      cur = n.parentId;
    }
    const tail = path.slice(-12).join(' → ');
    const top = this.topLevelLabels();
    let out = `Current focus depth: ${this.depthOf(this.focusId)} / max ${this.maxDepth}\nPath (root→focus): ${tail || '(root)'}\n`;
    out += `Top-level areas seen so far (${top.length}): ${top.length ? top.slice(0, 28).join(' | ') : '(none yet — open each primary sidebar/top-nav item in turn)'}\n`;
    out += `Distinct screens in tree: ${this.nodes.size - 1}\n`;
    if (out.length > MAX_LLM_TREE_CHARS) {
      return `${out.slice(0, MAX_LLM_TREE_CHARS)}\n… [truncated]`;
    }
    return out;
  }

  toMermaid(): string {
    return graphToMermaid(this.nodes.values(), this.edges);
  }
}
