import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSchemeWarnings } from '../js/schemeWarnings.js';
import { calculateTree, annotateShortCircuit } from '../js/network.js';
import { NETWORK_TYPES } from '../js/calculations.js';

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

test('collectSchemeWarnings: исправная схема не даёт замечаний', () => {
  // Одиночный узел с собственной нагрузкой, короткая линия, без трансформатора:
  // нет ни дочерних узлов (селективность/баланс), ни длинной линии (ΔU), ни КЗ.
  const tree = baseNode({ hasOwnLoad: true, known: 'power', knownValue: 5000, cableLength: 2 });
  const warnings = collectSchemeWarnings(calculateTree(tree));
  assert.deepEqual(warnings, []);
});

test('collectSchemeWarnings: ошибка расчёта показывается у узла-первопричины, без дублей у предков', () => {
  const tree = baseNode({
    children: [
      // voltage 0 делает узел нерасчитываемым → ошибка распространяется на предков,
      // но в сводке должен быть только сам узел-первопричина.
      { ...baseNode(), id: 'bad', name: 'Плохой', hasOwnLoad: true, voltage: 0, known: 'power', knownValue: 1000, children: [] },
    ],
  });
  const warnings = collectSchemeWarnings(calculateTree(tree));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].nodeId, 'bad');
  assert.equal(warnings[0].severity, 'error');
  assert.equal(warnings[0].category, 'error');
});

test('collectSchemeWarnings: малый Кс, маскирующий перегрузку, попадает в сводку как баланс', () => {
  const tree = baseNode({
    simultaneityFactor: 0.3,
    cableLength: 1,
    children: [
      { ...baseNode(), id: 'a', name: 'A', hasOwnLoad: true, known: 'current', knownValue: 200, children: [] },
      { ...baseNode(), id: 'b', name: 'B', hasOwnLoad: true, known: 'current', knownValue: 200, children: [] },
    ],
  });
  const warnings = collectSchemeWarnings(calculateTree(tree));
  const balance = warnings.find((w) => w.category === 'balance');
  assert.ok(balance, 'ожидается замечание о балансе нагрузки');
  assert.equal(balance.severity, 'warn');
});

test('collectSchemeWarnings: превышение потери напряжения попадает в сводку', () => {
  // Длинная линия большого тока → ΔU заведомо больше 5%.
  const tree = baseNode({
    children: [
      {
        ...baseNode(),
        id: 'long',
        name: 'Дальний потребитель',
        hasOwnLoad: true,
        known: 'current',
        knownValue: 40,
        cableLength: 300,
        children: [],
      },
    ],
  });
  const warnings = collectSchemeWarnings(calculateTree(tree));
  const drop = warnings.find((w) => w.category === 'voltage-drop');
  assert.ok(drop, 'ожидается замечание о потере напряжения');
  assert.equal(drop.nodeId, 'long');
});

test('collectSchemeWarnings: негарантированное отключение при КЗ попадает в сводку', () => {
  // Удалённый узел на тонком длинном кабеле от слабого трансформатора →
  // ток однофазного КЗ ниже порога мгновенного расцепления.
  const tree = baseNode({
    transformerPowerKva: 100,
    transformerUkPercent: 4.5,
    children: [
      {
        ...baseNode(),
        id: 'far',
        name: 'Удалённый узел',
        hasOwnLoad: true,
        known: 'current',
        knownValue: 30,
        cableLength: 250,
        children: [],
      },
    ],
  });
  const calc = annotateShortCircuit(tree, calculateTree(tree));
  const warnings = collectSchemeWarnings(calc);
  const sc = warnings.find((w) => w.category === 'short-circuit');
  assert.ok(sc, 'ожидается замечание о времени отключения при КЗ');
});
