import test from 'node:test';
import assert from 'node:assert/strict';
import { topMostSelectedIds } from '../js/treeSelection.js';

const tree = {
  id: 'root',
  children: [
    { id: 'a', children: [{ id: 'a1', children: [] }, { id: 'a2', children: [] }] },
    { id: 'b', children: [] },
  ],
};

test('topMostSelectedIds: соседние узлы возвращаются оба', () => {
  assert.deepEqual(topMostSelectedIds(tree, new Set(['a', 'b'])), ['a', 'b']);
});

test('topMostSelectedIds: если выбраны и предок, и потомок — остаётся только предок', () => {
  assert.deepEqual(topMostSelectedIds(tree, new Set(['a', 'a1'])), ['a']);
});

test('topMostSelectedIds: потомки разных ветвей при выбранном предке одной из них', () => {
  assert.deepEqual(topMostSelectedIds(tree, new Set(['a1', 'a2', 'b'])), ['a1', 'a2', 'b']);
});

test('topMostSelectedIds: выбранный корень поглощает всех потомков', () => {
  assert.deepEqual(topMostSelectedIds(tree, new Set(['root', 'a', 'b'])), ['root']);
});

test('topMostSelectedIds: пустой выбор — пустой результат', () => {
  assert.deepEqual(topMostSelectedIds(tree, new Set()), []);
});
