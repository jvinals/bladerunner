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
  attributes: Record<string, string | number | boolean>;
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
  properties?: unknown;
  children?: unknown;
};

type RawA11yProperty = {
  name?: unknown;
  value?: unknown;
};

const DROPPED_TEXT_ROLES = new Set(['statictext', 'inlinetextbox']);
const STRUCTURAL_WRAPPER_ROLES = new Set(['none', 'generic', 'sectionheader']);
const SEMANTIC_CONTAINER_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'cell',
  'columnheader',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'feed',
  'figure',
  'form',
  'grid',
  'group',
  'heading',
  'img',
  'insertion',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'note',
  'option',
  'paragraph',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'section',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);
const ATTRIBUTE_NAMES = new Set([
  'checked',
  'disabled',
  'expanded',
  'level',
  'multiline',
  'pressed',
  'readonly',
  'required',
  'selected',
]);

function normalizeRole(value: unknown): string {
  const role = textOrNull(value) ?? '';
  const compact = role.replace(/\s+/g, '').toLowerCase();
  if (compact === 'image') return 'img';
  return compact;
}

function normalizeText(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function textOrNull(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized ? String(value).trim() : null;
}

function primitiveOrNull(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { value?: unknown }).value;
  return primitiveOrNull(raw);
}

function extractAttributes(node: RawA11yNode): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const props = Array.isArray(node.properties) ? (node.properties as RawA11yProperty[]) : [];
  for (const prop of props) {
    const name = normalizeText(prop.name);
    if (!ATTRIBUTE_NAMES.has(name)) continue;
    const value = primitiveOrNull(prop.value);
    if (value == null) continue;
    out[name] = value;
  }
  return out;
}

function bestTagNumberForNode(node: RawA11yNode, tags: AiVisualIdTag[]): number | null {
  const name = normalizeText(node.name);
  const role = normalizeRole(node.role);
  const value = normalizeText(node.value);
  if (!name && !value) return null;
  if (!INTERACTIVE_ROLES.has(role)) return null;

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

function shouldFlattenNode(
  role: string,
  name: string | null,
  value: string | null,
  description: string | null,
  attributes: Record<string, string | number | boolean>,
  tagNumber: number | null,
): boolean {
  if (role === 'rootwebarea') return true;
  if (DROPPED_TEXT_ROLES.has(role)) return true;
  if (STRUCTURAL_WRAPPER_ROLES.has(role)) return !name && !value && !description && Object.keys(attributes).length === 0;
  if (!SEMANTIC_CONTAINER_ROLES.has(role) && !INTERACTIVE_ROLES.has(role) && !name && !value && !description) {
    return true;
  }
  if (role === 'paragraph' && !tagNumber && !name) return true;
  return false;
}

function buildTree(node: RawA11yNode, tags: AiVisualIdTag[], path: string): AiVisualIdTreeNode[] {
  const childrenRaw = Array.isArray(node.children) ? (node.children as RawA11yNode[]) : [];
  const children = childrenRaw.flatMap((child, idx) => buildTree(child, tags, `${path}.${idx}`));
  const role = normalizeRole(node.role) || 'unknown';
  const name = textOrNull(node.name);
  const value = textOrNull(node.value);
  const description = textOrNull(node.description);
  const attributes = extractAttributes(node);
  const tagNumber = bestTagNumberForNode(node, tags);
  if (shouldFlattenNode(role, name, value, description, attributes, tagNumber)) {
    return children;
  }
  return [
    {
      id: path,
      role,
      name: name ?? '',
      value,
      description,
      attributes,
      tagNumber,
      children,
    },
  ];
}

export function buildAiVisualIdTree(snapshot: unknown, tags: AiVisualIdTag[]): AiVisualIdTreeNode[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  return buildTree(snapshot as RawA11yNode, tags, 'root');
}
