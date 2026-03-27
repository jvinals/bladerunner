export type AiVisualIdTag = {
  number: number;
  tag: string;
  role: string | null;
  type: string | null;
  name: string;
  left: number;
  top: number;
};

export type AiVisualIdTreeNode = {
  id: string;
  role: string;
  name: string;
  value: string | null;
  description: string | null;
  tagNumber: number | null;
  children: AiVisualIdTreeNode[];
};

export type AiVisualIdContextArtifact = {
  pageUrl: string;
  somManifest: string;
  accessibilitySnapshot: string;
  somTags: AiVisualIdTag[];
  tree: AiVisualIdTreeNode[];
  screenshotWidth: number;
  screenshotHeight: number;
  prompt: string;
  fullPrompt: string;
  answer: string;
  provider: string;
  model: string;
};

type RawA11yNode = {
  role?: unknown;
  name?: unknown;
  value?: unknown;
  description?: unknown;
  children?: unknown;
};

function normalizeText(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function textOrNull(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized ? String(value).trim() : null;
}

function bestTagNumberForNode(node: RawA11yNode, tags: AiVisualIdTag[]): number | null {
  const name = normalizeText(node.name);
  const role = normalizeText(node.role);
  const value = normalizeText(node.value);
  if (!name && !value) return null;

  const exactByNameAndRole = tags.find(
    (tag) => normalizeText(tag.name) === name && (!!role ? normalizeText(tag.role) === role : true),
  );
  if (exactByNameAndRole) return exactByNameAndRole.number;

  const exactByName = tags.find((tag) => normalizeText(tag.name) === name);
  if (exactByName) return exactByName.number;

  if (value) {
    const exactByValue = tags.find((tag) => normalizeText(tag.name) === value);
    if (exactByValue) return exactByValue.number;
  }

  const includesByName = tags.find((tag) => {
    const tagName = normalizeText(tag.name);
    return !!name && (tagName.includes(name) || name.includes(tagName));
  });
  return includesByName?.number ?? null;
}

function buildTree(node: RawA11yNode, tags: AiVisualIdTag[], path: string): AiVisualIdTreeNode {
  const childrenRaw = Array.isArray(node.children) ? (node.children as RawA11yNode[]) : [];
  return {
    id: path,
    role: textOrNull(node.role) ?? 'unknown',
    name: textOrNull(node.name) ?? '',
    value: textOrNull(node.value),
    description: textOrNull(node.description),
    tagNumber: bestTagNumberForNode(node, tags),
    children: childrenRaw.map((child, idx) => buildTree(child, tags, `${path}.${idx}`)),
  };
}

export function buildAiVisualIdTree(snapshot: unknown, tags: AiVisualIdTag[]): AiVisualIdTreeNode[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  return [buildTree(snapshot as RawA11yNode, tags, 'root')];
}
