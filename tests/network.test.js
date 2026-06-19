import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNode, calculateLineVoltageDrop, calculateTree } from '../js/network.js';
import { NETWORK_TYPES } from '../js/calculations.js';

test('calculateNode считает ток и подбирает защиту листового узла', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  assert.equal(node.result.I, 10);
  assert.equal(node.protection.breaker, 10);
  assert.equal(node.voltageDrop, null);
});

test('calculateNode считает падение напряжения, если задана длина линии', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 20,
  });
  const cable = node.protection.copperCable;
  const expectedDrop = (2 * 0.0175 * 20 * node.result.I) / cable.section;
  assert.ok(Math.abs(node.voltageDrop.drop - expectedDrop) < 1e-9);
  assert.equal(node.voltageDrop.material, 'copper');
});

test('calculateLineVoltageDrop возвращает null без длины линии или без подобранного кабеля', () => {
  const result = { networkType: NETWORK_TYPES.DC, voltage: 24, I: 10, powerFactor: 1 };
  assert.equal(calculateLineVoltageDrop(result, { copperCable: { section: 2.5 } }, 0), null);
  assert.equal(calculateLineVoltageDrop(result, { copperCable: null, aluminumCable: null }, 10), null);
});

test('calculateNode складывает собственную нагрузку с суммой дочерних узлов', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    childrenTotals: { P: 360, Q: 0 },
  });
  assert.equal(node.result.P, 360);
  assert.equal(node.result.I, 15);
  assert.equal(node.protection.breaker, 16);
});

test('calculateNode учитывает коэффициент одновременности', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    simultaneityFactor: 0.5,
    childrenTotals: { P: 360, Q: 0 },
  });
  assert.equal(node.result.P, 180);
  assert.equal(node.result.I, 7.5);
  assert.equal(node.protection.breaker, 10);
});

test('calculateNode для трёхфазной сети без собственной нагрузки согласован с прямым расчётом', () => {
  const leaf = calculateNode({
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    powerFactor: 0.8,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 10000,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });

  const parent = calculateNode({
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    simultaneityFactor: 1,
    childrenTotals: { P: leaf.result.P, Q: leaf.result.Q },
  });

  assert.ok(Math.abs(parent.result.I - leaf.result.I) < 1e-9);
  assert.ok(Math.abs(parent.result.P - leaf.result.P) < 1e-9);
});

test('calculateNode: ошибка при некорректном напряжении или Кс узла без собственной нагрузки', () => {
  assert.throws(() =>
    calculateNode({
      networkType: NETWORK_TYPES.DC,
      voltage: 0,
      hasOwnLoad: false,
      installationMethod: 'air',
      cableCount: 1,
      childrenTotals: { P: 100, Q: 0 },
    }),
  );
  assert.throws(() =>
    calculateNode({
      networkType: NETWORK_TYPES.DC,
      voltage: 24,
      hasOwnLoad: false,
      installationMethod: 'air',
      cableCount: 1,
      simultaneityFactor: 1.5,
      childrenTotals: { P: 100, Q: 0 },
    }),
  );
});

test('calculateNode: ошибка, если у узла нет ни своей нагрузки, ни нагрузки дочерних узлов', () => {
  assert.throws(() =>
    calculateNode({
      networkType: NETWORK_TYPES.DC,
      voltage: 24,
      hasOwnLoad: false,
      installationMethod: 'air',
      cableCount: 1,
      childrenTotals: { P: 0, Q: 0 },
    }),
  );
});

test('calculateTree считает дерево из нескольких уровней и суммирует автоматы дочерних узлов', () => {
  const tree = {
    id: 'root',
    name: 'ВРУ',
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    simultaneityFactor: 1,
    children: [
      {
        id: 'a',
        name: 'Освещение',
        networkType: NETWORK_TYPES.DC,
        voltage: 24,
        hasOwnLoad: true,
        known: 'power',
        knownValue: 240,
        installationMethod: 'air',
        cableCount: 1,
        cableLength: 0,
        children: [],
      },
      {
        id: 'b',
        name: 'Розетки',
        networkType: NETWORK_TYPES.DC,
        voltage: 24,
        hasOwnLoad: true,
        known: 'power',
        knownValue: 120,
        installationMethod: 'air',
        cableCount: 1,
        cableLength: 0,
        children: [],
      },
    ],
  };

  const result = calculateTree(tree);
  assert.equal(result.error, null);
  assert.equal(result.result.P, 360);
  assert.equal(result.result.I, 15);
  assert.equal(result.protection.breaker, 16);
  assert.equal(result.sumOfChildBreakers, 10 + 6);
  assert.equal(result.children.length, 2);
  assert.equal(result.children[0].result.I, 10);
});

test('calculateTree: ошибка в листовом узле блокирует только его предков, а не соседние ветви', () => {
  const tree = {
    id: 'root',
    name: 'ВРУ',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    children: [
      {
        id: 'broken-branch',
        name: 'Щит 1',
        networkType: NETWORK_TYPES.DC,
        voltage: 24,
        hasOwnLoad: false,
        installationMethod: 'air',
        cableCount: 1,
        cableLength: 0,
        children: [
          {
            id: 'broken-leaf',
            name: 'Сломанный узел',
            networkType: NETWORK_TYPES.DC,
            voltage: 0,
            hasOwnLoad: true,
            known: 'power',
            knownValue: 240,
            installationMethod: 'air',
            cableCount: 1,
            cableLength: 0,
            children: [],
          },
        ],
      },
      {
        id: 'healthy-leaf',
        name: 'Освещение',
        networkType: NETWORK_TYPES.DC,
        voltage: 24,
        hasOwnLoad: true,
        known: 'power',
        knownValue: 120,
        installationMethod: 'air',
        cableCount: 1,
        cableLength: 0,
        children: [],
      },
    ],
  };

  const result = calculateTree(tree);
  assert.ok(result.error);
  const brokenBranch = result.children.find((child) => child.id === 'broken-branch');
  const healthyLeaf = result.children.find((child) => child.id === 'healthy-leaf');
  assert.ok(brokenBranch.error);
  assert.ok(brokenBranch.children[0].error);
  assert.equal(healthyLeaf.error, null);
  assert.equal(healthyLeaf.result.I, 5);
});
