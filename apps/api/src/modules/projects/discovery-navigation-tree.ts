import { normalizeDiscoveryUrlForDedup } from './discovery-url.util';

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
    const label = (n.label || n.urlNorm || n.id).replace(/"/g, '\\"').replace(/\n/g, ' ');
    const short = label.length > 80 ? `${label.slice(0, 77)}…` : label;
    lines.push(`  ${mid}["${short}"]`);
  }
  for (const e of edges) {
    const a = sanitizeMermaidNodeId(e.from);
    const b = sanitizeMermaidNodeId(e.to);
    lines.push(`  ${a} --> ${b}`);
  }
  return lines.join('\n');
}

const MAX_LLM_TREE_CHARS = 6000;

/**
 * DFS-oriented navigation tree for discovery: one node per distinct normalized URL,
 * edges when moving from focus to a new URL. subsectionComplete() moves focus to parent.
 */
export class DiscoveryNavigationTree {
  private nextId = 0;
  readonly nodes = new Map<string, NavNodeRecord>();
  readonly edges: Array<{ from: string; to: string }> = [];
  readonly rootId: string;
  focusId: string;
  private urlToNodeId = new Map<string, string>();
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
    this.recordUrl(urlNorm, label);
  }

  /** Record a normalized URL; create child if new, or move focus if seen. */
  recordUrl(urlNorm: string, label: string): void {
    const existing = this.urlToNodeId.get(urlNorm);
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
    this.urlToNodeId.set(urlNorm, id);
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
