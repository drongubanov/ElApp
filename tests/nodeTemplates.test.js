import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE_TEMPLATES } from '../js/nodeTemplates.js';
import { calculateTree } from '../js/network.js';

// Дополняет частичные параметры шаблона до полного узла дерева (как createNode в app.js).
function buildNode(overrides) {
  return {
    id: 'n',
    name: 'n',
    networkType: 'ac1',
    voltage: 220,
    powerFactor: 1,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 1000,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    simultaneityFactor: 1,
    utilizationFactor: 1,
    loadType: 'general',
    startCurrentRatio: 6,
    children: [],
    ...overrides,
  };
}

test('NODE_TEMPLATES: каждый пресет рассчитывается без ошибок и подбирает автомат', () => {
  for (const tpl of NODE_TEMPLATES) {
    const calc = calculateTree(buildNode(tpl.node));
    assert.equal(calc.error, null, `шаблон «${tpl.id}» не должен давать ошибку расчёта`);
    assert.ok(calc.protection && calc.protection.breaker > 0, `шаблон «${tpl.id}» должен подбирать автомат`);
  }
});

test('NODE_TEMPLATES: пресет двигателя помечен типом нагрузки motor и получает характеристику автомата', () => {
  const motor = NODE_TEMPLATES.find((t) => t.id === 'motor');
  assert.equal(motor.node.loadType, 'motor');
  const calc = calculateTree(buildNode(motor.node));
  assert.ok(calc.protection.recommendedCurve, 'для двигателя должна подбираться характеристика B/C/D');
  assert.ok(calc.startCurrent > 0, 'для двигателя должен считаться пусковой ток');
});

test('NODE_TEMPLATES: уникальные идентификаторы и заполненные подписи/подсказки', () => {
  const ids = NODE_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'идентификаторы шаблонов должны быть уникальны');
  for (const tpl of NODE_TEMPLATES) {
    assert.ok(tpl.label, `у шаблона «${tpl.id}» должна быть подпись`);
    assert.ok(tpl.hint, `у шаблона «${tpl.id}» должна быть подсказка`);
    assert.ok(tpl.node && tpl.node.name, `у шаблона «${tpl.id}» должно быть имя узла`);
  }
});
