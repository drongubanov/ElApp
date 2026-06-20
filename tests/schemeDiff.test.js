import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSchemes, hasDiff } from '../js/schemeDiff.js';
import { NETWORK_TYPES } from '../js/calculations.js';

function tree(children = []) {
  return {
    id: 'root',
    name: 'ВРУ',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    simultaneityFactor: 1,
    children,
  };
}

function load(id, knownValue, overrides = {}) {
  return {
    id,
    name: id,
    networkType: NETWORK_TYPES.AC1,
    voltage: 220,
    powerFactor: 1,
    hasOwnLoad: true,
    known: 'power',
    knownValue,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    simultaneityFactor: 1,
    children: [],
    ...overrides,
  };
}

test('diffSchemes: одинаковые схемы — изменений нет', () => {
  const a = tree([load('a', 1000), load('b', 2000)]);
  const b = tree([load('a', 1000), load('b', 2000)]);
  const diff = diffSchemes(a, b);
  assert.equal(hasDiff(diff), false);
  assert.deepEqual(diff, { added: [], removed: [], changed: [] });
});

test('diffSchemes: добавленный узел попадает в added', () => {
  const a = tree([load('a', 1000)]);
  const b = tree([load('a', 1000), load('b', 2000)]);
  const diff = diffSchemes(a, b);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].id, 'b');
  assert.equal(diff.removed.length, 0);
});

test('diffSchemes: удалённый узел попадает в removed', () => {
  const a = tree([load('a', 1000), load('b', 2000)]);
  const b = tree([load('a', 1000)]);
  const diff = diffSchemes(a, b);
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].id, 'b');
});

test('diffSchemes: изменение нагрузки отражается в P, I (и в узле, и в корне, который суммирует детей)', () => {
  const a = tree([load('a', 1000)]);
  const b = tree([load('a', 5000)]);
  const diff = diffSchemes(a, b);
  // Меняется и сам узел «a», и корень «root» (его расчётная нагрузка — сумма детей).
  const ids = diff.changed.map((c) => c.id).sort();
  assert.deepEqual(ids, ['a', 'root']);
  const changedA = diff.changed.find((c) => c.id === 'a');
  const keys = changedA.fields.map((f) => f.key);
  assert.ok(keys.includes('P'), 'должно измениться P');
  assert.ok(keys.includes('I'), 'должно измениться I');
  const pField = changedA.fields.find((f) => f.key === 'P');
  assert.equal(pField.from, 1000);
  assert.equal(pField.to, 5000);
});

test('diffSchemes: появление ошибки расчёта фиксируется как изменение', () => {
  const a = tree([load('a', 1000)]);
  const b = tree([load('a', 1000, { voltage: 0 })]); // делает узел нерасчитываемым
  const diff = diffSchemes(a, b);
  const changedA = diff.changed.find((c) => c.id === 'a');
  assert.ok(changedA, 'узел a должен быть среди изменённых');
  assert.ok(changedA.fields.some((f) => f.key === 'error'));
});
