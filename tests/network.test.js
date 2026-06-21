import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateNode, calculateLineVoltageDrop, calculateTree, annotateShortCircuit, annotateVoltageDrop, phaseBalance } from '../js/network.js';
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

test('calculateNode: коэффициент использования Ku снижает расчётную нагрузку относительно установленной', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    utilizationFactor: 0.5,
  });
  assert.equal(node.installed.P, 240);
  assert.equal(node.result.P, 120);
  assert.equal(node.result.I, 5);
  assert.equal(node.utilizationFactor, 0.5);
});

test('calculateNode: ошибка при некорректном Ku', () => {
  assert.throws(() =>
    calculateNode({
      networkType: NETWORK_TYPES.DC,
      voltage: 24,
      hasOwnLoad: true,
      known: 'power',
      knownValue: 240,
      installationMethod: 'air',
      cableCount: 1,
      utilizationFactor: 1.5,
    }),
  );
});

test('calculateNode: для двигательной нагрузки считает пусковой ток и подбирает характеристику автомата', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    loadType: 'motor',
    startCurrentRatio: 6,
  });
  assert.equal(node.result.I, 10);
  assert.equal(node.startCurrent, 60);
  assert.equal(node.protection.startCurrent, 60);
  assert.equal(node.protection.recommendedCurve, 'C'); // 60/10=6 -> укладывается в C (≤10)
});

test('calculateNode: для общей нагрузки пусковой ток не считается', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
  });
  assert.equal(node.startCurrent, null);
  assert.equal(node.protection.recommendedCurve, null);
});

test('calculateNode: loadInputMode "group" с единственным приёмником даёт Pр = ΣPн (Кс.гр = 1)', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    loadInputMode: 'group',
    receivers: [{ installedP: 240, ku: 0.6 }],
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  assert.equal(node.result.P, 240);
  assert.equal(node.result.I, 10);
  assert.ok(node.groupDemand);
  assert.equal(node.groupDemand.nEffective, 1);
  assert.equal(node.groupDemand.supplyFactor, 1);
  assert.equal(node.groupDemand.count, 1);
});

test('calculateNode: loadInputMode "group" со смешанной группой приёмников считает Pр методом Ки/Кр', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    loadInputMode: 'group',
    receivers: [
      { installedP: 100, ku: 0.7 },
      { installedP: 50, ku: 0.5 },
      { installedP: 20, ku: 0.8 },
      { installedP: 10, ku: 0.3 },
    ],
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  assert.ok(Math.abs(node.result.P - 155.80643225363505) < 1e-6);
  assert.ok(Math.abs(node.result.I - 6.491934677234794) < 1e-6);
  assert.ok(node.groupDemand);
  assert.equal(node.groupDemand.installedTotal, 180);
  assert.equal(node.groupDemand.count, 4);
});

test('calculateNode: loadInputMode "group" без корректных приёмников — ошибка', () => {
  assert.throws(() =>
    calculateNode({
      networkType: NETWORK_TYPES.DC,
      voltage: 24,
      hasOwnLoad: true,
      loadInputMode: 'group',
      receivers: [],
      installationMethod: 'air',
      cableCount: 1,
    }),
  );
});

test('calculateTree: узел в режиме "group" передаёт groupDemand в результат дерева', () => {
  const tree = {
    id: 'root',
    name: 'Группа приёмников',
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    loadInputMode: 'group',
    receivers: [{ installedP: 240, ku: 0.6 }],
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    simultaneityFactor: 1,
    children: [],
  };
  const calc = calculateTree(tree);
  assert.equal(calc.error, null);
  assert.ok(calc.groupDemand);
  assert.equal(calc.groupDemand.count, 1);
});

test('calculateNode считает рекомендацию по компенсации реактивной мощности при низком cosφ узла', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.AC1,
    voltage: 220,
    powerFactor: 0.6,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 300,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    targetPowerFactor: 0.8,
  });
  assert.ok(Math.abs(node.result.P - 300) < 1e-9);
  assert.ok(Math.abs(node.result.Q - 400) < 1e-6);
  assert.ok(node.compensation);
  assert.ok(Math.abs(node.compensation.currentPowerFactor - 0.6) < 1e-9);
  // tgφ1 = 4/3, tgφ2 = 0.75 → Qc = 300·(4/3 − 0.75) = 175.
  assert.ok(Math.abs(node.compensation.requiredQc - 175) < 1e-6);
  assert.ok(Math.abs(node.compensation.compensatedQ - 225) < 1e-6);
});

test('calculateNode не предлагает компенсацию, если cosφ узла уже не ниже целевого', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.AC1,
    voltage: 220,
    powerFactor: 1,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 1000,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  assert.equal(node.compensation, null);
});

test('calculateNode не считает компенсацию для сети постоянного тока (Q всегда 0)', () => {
  const node = calculateNode({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    targetPowerFactor: 0.5,
  });
  assert.equal(node.compensation, null);
});

test('calculateTree передаёт рекомендацию по компенсации в результат дерева', () => {
  const tree = {
    id: 'root',
    name: 'Силовой щит',
    networkType: NETWORK_TYPES.AC1,
    voltage: 220,
    powerFactor: 0.6,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 300,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    simultaneityFactor: 1,
    targetPowerFactor: 0.8,
    children: [],
  };
  const calc = calculateTree(tree);
  assert.equal(calc.error, null);
  assert.ok(calc.compensation);
  assert.ok(Math.abs(calc.compensation.requiredQc - 175) < 1e-6);
});

test('calculateTree считает наибольший номинал среди дочерних автоматов и проверяет селективность', () => {
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
  assert.equal(result.protection.breaker, 16);
  assert.equal(result.maxOfChildBreakers, 10);
  assert.ok(result.selectivity);
  assert.equal(result.selectivity.maxDownstream, 10);
  assert.ok(Math.abs(result.selectivity.ratio - 1.6) < 1e-9);
  assert.equal(result.selectivity.level, 'uncertain'); // 16/10 = 1.6, в диапазоне (1, SELECTIVITY_SAFE_RATIO)
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

function baseNode(overrides = {}) {
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
    children: [],
    ...overrides,
  };
}

test('calculateTree: balance — при Кс = 1 защита узла рассчитана на полную сумму нагрузок → null', () => {
  const tree = baseNode({
    cableLength: 5,
    children: [
      { ...baseNode(), id: 'a', name: 'A', hasOwnLoad: true, known: 'power', knownValue: 5000, children: [] },
      { ...baseNode(), id: 'b', name: 'B', hasOwnLoad: true, known: 'power', knownValue: 5000, children: [] },
    ],
  });
  const result = calculateTree(tree);
  assert.equal(result.balance, null);
});

test('calculateTree: balance — малый Кс маскирует превышение полной суммы нагрузок дочерних узлов', () => {
  // Узел с малым Кс: автомат и кабель подобраны по уменьшенной (диверсифицированной)
  // нагрузке, но если все дочерние линии включить одновременно на полный расчётный
  // ток (Кс = 1), он превысит номинал автомата и допустимый ток кабеля узла —
  // типичный случай, когда защита щита держится только на допущении о Кс.
  const tree = baseNode({
    simultaneityFactor: 0.1,
    children: [
      { ...baseNode(), id: 'a', name: 'A', hasOwnLoad: true, known: 'current', knownValue: 200, children: [] },
      { ...baseNode(), id: 'b', name: 'B', hasOwnLoad: true, known: 'current', knownValue: 200, children: [] },
    ],
  });
  const result = calculateTree(tree);
  assert.ok(result.balance);
  assert.ok(result.balance.rawCurrent > result.protection.breaker);
  assert.ok(result.balance.overBreaker);
});

test('annotateShortCircuit: без параметров трансформатора на корне — shortCircuit остаётся null', () => {
  const tree = baseNode({ children: [{ ...baseNode(), id: 'a', hasOwnLoad: true, known: 'power', knownValue: 5000, children: [] }] });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  assert.equal(calc.shortCircuit, null);
  assert.equal(calc.children[0].shortCircuit, null);
});

test('annotateShortCircuit: ток КЗ убывает по мере удаления от точки ввода (накопление сопротивления кабелей)', () => {
  const tree = baseNode({
    transformerPowerKva: 250,
    transformerUkPercent: 4.5,
    cableLength: 5,
    children: [
      {
        ...baseNode(),
        id: 'near',
        name: 'Близкий щит',
        cableLength: 10,
        children: [{ ...baseNode(), id: 'near-leaf', hasOwnLoad: true, known: 'power', knownValue: 3000, cableLength: 5, children: [] }],
      },
    ],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  assert.ok(calc.shortCircuit);
  assert.ok(calc.shortCircuit.i3 > calc.children[0].shortCircuit.i3);
  assert.ok(calc.children[0].shortCircuit.i3 > calc.children[0].children[0].shortCircuit.i3);
  assert.ok(calc.children[0].children[0].shortCircuit.i3 > calc.children[0].children[0].shortCircuit.i1);
});

test('annotateShortCircuit: проверка отключения по характеристике автомата (disconnection)', () => {
  const tree = baseNode({
    transformerPowerKva: 1000,
    transformerUkPercent: 4,
    children: [{ ...baseNode(), id: 'a', hasOwnLoad: true, known: 'power', knownValue: 2000, cableLength: 2, children: [] }],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  const leaf = calc.children[0];
  assert.ok(leaf.shortCircuit.disconnection);
  assert.equal(typeof leaf.shortCircuit.disconnection.ok, 'boolean');
});

test('annotateShortCircuit: термостойкость — короткая линия от мощного трансформатора не выдерживает нагрев при КЗ', () => {
  // Малая нагрузка (2 кВт) даёт сечение 1.5 мм² по току, но мощный трансформатор (1000 кВА)
  // и короткий кабель (2 м) — огромный ток КЗ: даже за гарантированно мгновенное отключение
  // (0,1 с) сечение, подобранное по нагрузке, тепловому импульсу не выдерживает.
  const tree = baseNode({
    transformerPowerKva: 1000,
    transformerUkPercent: 4,
    children: [{ ...baseNode(), id: 'a', hasOwnLoad: true, known: 'power', knownValue: 2000, cableLength: 2, children: [] }],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  const leaf = calc.children[0];
  const { thermalCheck, disconnection, i3 } = leaf.shortCircuit;
  assert.ok(disconnection.ok);
  assert.ok(thermalCheck);
  assert.equal(thermalCheck.time, 0.1);
  assert.ok(Math.abs(thermalCheck.minSection - (i3 * Math.sqrt(0.1)) / 115) < 1e-6);
  assert.equal(thermalCheck.actualSection, 1.5);
  assert.equal(thermalCheck.ok, false);
});

test('annotateShortCircuit: термостойкость — удалённый узел с длинной линией выдерживает нагрев при КЗ', () => {
  const tree = baseNode({
    transformerPowerKva: 250,
    transformerUkPercent: 4.5,
    cableLength: 5,
    children: [
      {
        ...baseNode(),
        id: 'near',
        name: 'Близкий щит',
        cableLength: 10,
        children: [
          { ...baseNode(), id: 'near-leaf', hasOwnLoad: true, known: 'power', knownValue: 3000, cableLength: 40, children: [] },
        ],
      },
    ],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  const leaf = calc.children[0].children[0];
  const { thermalCheck, disconnection, i3 } = leaf.shortCircuit;
  assert.ok(disconnection.ok);
  assert.ok(thermalCheck);
  assert.equal(thermalCheck.time, 0.1);
  assert.ok(Math.abs(thermalCheck.minSection - (i3 * Math.sqrt(0.1)) / 115) < 1e-6);
  assert.equal(thermalCheck.ok, true);
});

test('annotateShortCircuit: термостойкость — при негарантированном мгновенном отключении время принимается 5 с', () => {
  // Тот же сценарий, что и для проверки disconnection.ok === false в schemeWarnings.test.js.
  const tree = baseNode({
    transformerPowerKva: 100,
    transformerUkPercent: 4.5,
    children: [{ ...baseNode(), id: 'far', hasOwnLoad: true, known: 'current', knownValue: 30, cableLength: 250, children: [] }],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  const leaf = calc.children[0];
  const { thermalCheck, disconnection, i3 } = leaf.shortCircuit;
  assert.equal(disconnection.ok, false);
  assert.ok(thermalCheck);
  assert.equal(thermalCheck.time, 5);
  assert.ok(Math.abs(thermalCheck.minSection - (i3 * Math.sqrt(5)) / 115) < 1e-6);
});

test('annotateShortCircuit: без указания системы заземления принимается TN-C-S', () => {
  const tree = baseNode({
    transformerPowerKva: 1000,
    transformerUkPercent: 4,
    children: [{ ...baseNode(), id: 'a', hasOwnLoad: true, known: 'power', knownValue: 2000, cableLength: 2, children: [] }],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  assert.equal(calc.children[0].shortCircuit.earthingSystem, 'TN-C-S');
});

test('annotateShortCircuit: система TN-S — отключение по максимально-токовой защите (без требования УЗО)', () => {
  const tree = baseNode({
    transformerPowerKva: 1000,
    transformerUkPercent: 4,
    earthingSystem: 'TN-S',
    children: [{ ...baseNode(), id: 'a', hasOwnLoad: true, known: 'power', knownValue: 2000, cableLength: 2, children: [] }],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  const d = calc.children[0].shortCircuit.disconnection;
  assert.equal(d.requiresRcd, undefined);
  assert.equal(typeof d.ok, 'boolean');
});

test('annotateShortCircuit: система TT — отключение требует УЗО (requiresRcd), не максимально-токовой защиты', () => {
  const tree = baseNode({
    transformerPowerKva: 1000,
    transformerUkPercent: 4,
    earthingSystem: 'TT',
    children: [{ ...baseNode(), id: 'a', hasOwnLoad: true, known: 'power', knownValue: 2000, cableLength: 2, children: [] }],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  const sc = calc.children[0].shortCircuit;
  assert.equal(sc.earthingSystem, 'TT');
  assert.equal(sc.disconnection.requiresRcd, true);
  assert.equal(sc.disconnection.ok, undefined);
});

test('annotateShortCircuit: петля «фаза–PE» учитывает уменьшенное сечение PE при сечении фазы > 16 мм²', () => {
  // Большой ток (200 А) → сечение фазы > 16 мм², а PE по ПУЭ-7 табл. 1.7.5 меньше
  // фазного, поэтому сопротивление защитного проводника выше и Iкз(1) по петле
  // «фаза–PE» ниже прежней оценки Uф/(Zт + 2·Rфаз).
  const tree = baseNode({
    transformerPowerKva: 1000,
    transformerUkPercent: 4,
    children: [{ ...baseNode(), id: 'a', hasOwnLoad: true, known: 'current', knownValue: 200, cableLength: 20, children: [] }],
  });
  const calc = calculateTree(tree);
  annotateShortCircuit(tree, calc);
  const { resistance, peResistance, i1, zT } = calc.children[0].shortCircuit;
  assert.ok(peResistance > resistance, 'сопротивление PE при уменьшенном сечении больше фазного');
  const phaseVoltage = 380 / Math.sqrt(3);
  assert.ok(Math.abs(i1 - phaseVoltage / (zT + resistance + peResistance)) < 1e-9);
  assert.ok(i1 < phaseVoltage / (zT + 2 * resistance));
});

test('phaseBalance: равные доли → симметрия, ток фазы равен линейному, нейтраль ноль', () => {
  const pb = phaseBalance(20, NETWORK_TYPES.AC3, [1, 1, 1]);
  assert.ok(pb);
  pb.currents.forEach((c) => assert.ok(Math.abs(c - 20) < 1e-9));
  assert.ok(Math.abs(pb.neutral) < 1e-9);
  assert.ok(Math.abs(pb.maxPhase - 20) < 1e-9);
});

test('phaseBalance: вся нагрузка на одной фазе → её ток втрое больше, нейтраль равна ему', () => {
  const pb = phaseBalance(20, NETWORK_TYPES.AC3, [1, 0, 0]);
  assert.ok(Math.abs(pb.currents[0] - 60) < 1e-9);
  assert.equal(pb.currents[1], 0);
  assert.equal(pb.currents[2], 0);
  assert.ok(Math.abs(pb.neutral - 60) < 1e-9);
  assert.ok(Math.abs(pb.maxPhase - 60) < 1e-9);
});

test('phaseBalance: доли нормируются (любые относительные веса)', () => {
  const pb = phaseBalance(30, NETWORK_TYPES.AC3, [2, 2, 2]);
  pb.currents.forEach((c) => assert.ok(Math.abs(c - 30) < 1e-9));
  assert.ok(Math.abs(pb.shares[0] - 1 / 3) < 1e-9);
});

test('phaseBalance: не трёхфазная сеть или нулевой ток → null', () => {
  assert.equal(phaseBalance(20, NETWORK_TYPES.AC1, [1, 1, 1]), null);
  assert.equal(phaseBalance(0, NETWORK_TYPES.AC3, [1, 1, 1]), null);
  assert.equal(phaseBalance(20, NETWORK_TYPES.AC3, [0, 0, 0]), null);
});

test('calculateNode: трёхфазный узел получает распределение по фазам и ток нейтрали', () => {
  const calc = calculateNode({
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    powerFactor: 1,
    hasOwnLoad: true,
    known: 'current',
    knownValue: 20,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    phaseShares: [2, 1, 0],
  });
  assert.ok(calc.phaseBalance);
  // Несимметрия → ток нейтрали больше нуля.
  assert.ok(calc.phaseBalance.neutral > 0);
  // Самая загруженная фаза превышает симметричный ток узла.
  assert.ok(calc.phaseBalance.maxPhase > calc.result.I);
});

test('annotateVoltageDrop: суммирует потерю напряжения по сегментам от точки ввода до узла', () => {
  const tree = baseNode({
    cableLength: 5,
    children: [
      {
        ...baseNode(),
        id: 'mid',
        name: 'Щит 2',
        hasOwnLoad: false,
        cableLength: 20,
        children: [
          { ...baseNode(), id: 'leaf', hasOwnLoad: true, known: 'power', knownValue: 5000, cableLength: 30, children: [] },
        ],
      },
    ],
  });
  const calc = calculateTree(tree);
  annotateVoltageDrop(tree, calc);
  const mid = calc.children[0];
  const leaf = mid.children[0];

  assert.ok(Math.abs(calc.cumulativeVoltageDropPercent - calc.voltageDrop.dropPercent) < 1e-9);
  assert.ok(Math.abs(mid.cumulativeVoltageDropPercent - (calc.voltageDrop.dropPercent + mid.voltageDrop.dropPercent)) < 1e-9);
  assert.ok(
    Math.abs(
      leaf.cumulativeVoltageDropPercent -
        (calc.voltageDrop.dropPercent + mid.voltageDrop.dropPercent + leaf.voltageDrop.dropPercent),
    ) < 1e-9,
  );
  assert.ok(leaf.cumulativeVoltageDropPercent > leaf.voltageDrop.dropPercent);
});

test('annotateVoltageDrop: ошибка узла не блокирует накопление в исправном поддереве ниже по дереву', () => {
  const tree = baseNode({
    children: [
      {
        ...baseNode(),
        id: 'mid',
        name: 'Щит 2',
        hasOwnLoad: false,
        simultaneityFactor: 1.5, // некорректное значение — calculateNode выбросит ошибку
        children: [
          { ...baseNode(), id: 'leaf', hasOwnLoad: true, known: 'power', knownValue: 5000, cableLength: 30, children: [] },
        ],
      },
    ],
  });
  const calc = calculateTree(tree);
  annotateVoltageDrop(tree, calc);
  const mid = calc.children[0];
  const leaf = mid.children[0];

  assert.ok(calc.error);
  assert.ok(mid.error);
  assert.equal(calc.cumulativeVoltageDropPercent, null);
  assert.equal(mid.cumulativeVoltageDropPercent, null);
  assert.equal(leaf.error, null);
  assert.ok(Math.abs(leaf.cumulativeVoltageDropPercent - leaf.voltageDrop.dropPercent) < 1e-9);
});
