import assert from 'node:assert/strict';
import { buildAiVisualIdTree } from './ai-visual-id';

try {
  const tree = buildAiVisualIdTree(
    {
      role: 'WebArea',
      name: 'Demo app',
      children: [
        {
          role: 'button',
          name: 'Save changes',
        },
        {
          role: 'textbox',
          name: 'Patient name',
          value: 'John Smith',
        },
      ],
    },
    [
      { number: 7, tag: 'button', role: 'button', type: null, name: 'Save changes', left: 120, top: 80 },
      { number: 9, tag: 'input', role: 'textbox', type: 'text', name: 'Patient name', left: 240, top: 140 },
    ],
  );

  assert.equal(tree.length, 1);
  assert.equal(tree[0]?.role, 'webarea');
  assert.equal(tree[0]?.children.length, 2);
  assert.equal(tree[0]?.children[0]?.tagNumber, 7);
  assert.equal(tree[0]?.children[1]?.tagNumber, 9);
  assert.equal(tree[0]?.children[1]?.value, 'John Smith');

  console.log('recording ai-visual-id.selftest: ok');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
