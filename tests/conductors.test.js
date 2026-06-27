import test from 'node:test';
import assert from 'node:assert/strict';
import { conductorsFor, mapConductorToBus, CONDUCTOR_COLORS } from '../js/conductors.js';
import { NETWORK_TYPES } from '../js/calculations.js';
import { buildNodeDiagram } from '../js/schemeNodeDiagram.js';
import { buildDxf } from '../js/exportDxf.js';

test('conductorsFor: 3-фазная линия — L1, L2, L3, N, PE', () => {
  const labels = conductorsFor(NETWORK_TYPES.AC3).map((c) => c.label);
  assert.deepEqual(labels, ['L1', 'L2', 'L3', 'N', 'PE']);
});

test('conductorsFor: однофазная линия — L, N, PE', () => {
  const labels = conductorsFor(NETWORK_TYPES.AC1).map((c) => c.label);
  assert.deepEqual(labels, ['L', 'N', 'PE']);
});

test('conductorsFor: PE помечен isPe и идёт последним', () => {
  const cs = conductorsFor(NETWORK_TYPES.AC3);
  assert.equal(cs[cs.length - 1].label, 'PE');
  assert.equal(cs[cs.length - 1].isPe, true);
  assert.equal(cs[0].isPe, false);
});

test('цвета проводников соответствуют ГОСТ/ПУЭ (L1 жёлтый, N голубой, PE жёлто-зелёный)', () => {
  assert.equal(CONDUCTOR_COLORS.L1, '#E0B400');
  assert.equal(CONDUCTOR_COLORS.L3, '#D23B3B');
  assert.equal(CONDUCTOR_COLORS.N, '#2F7BD6');
  assert.ok(CONDUCTOR_COLORS.PE);
});

test('mapConductorToBus: фаза L однофазной линии подключается к L1 трёхфазной шины', () => {
  const bus = ['L1', 'L2', 'L3', 'N', 'PE'];
  assert.equal(mapConductorToBus('L', bus), 0);
  assert.equal(mapConductorToBus('N', bus), 3);
  assert.equal(mapConductorToBus('PE', bus), 4);
});

function ac3(id, name, children = [], kw = 0) {
  return {
    id, name, networkType: NETWORK_TYPES.AC3, voltage: 380, powerFactor: 0.9,
    hasOwnLoad: children.length === 0, known: 'power', knownValue: kw || 4000,
    installationMethod: 'air', cableCount: 1, cableLength: 15, ambientTemp: 25,
    insulation: 'pvc', phaseShares: [1, 1, 1], simultaneityFactor: 1, utilizationFactor: 1,
    loadType: 'general', children,
  };
}

test('buildNodeDiagram: жилы окрашены, в легенде есть L1…PE', () => {
  const tree = ac3('root', 'ВРУ', [ac3('l1', 'Нагрузка', [], 3000)]);
  // Геометрия не зависит от расчёта линий — calcMap может быть пустым.
  const d = buildNodeDiagram({ ...tree, isRoot: true }, null, new Map());
  const colored = d.segments.filter((s) => s.color);
  assert.ok(colored.length >= 5, 'должны быть цветные жилы');
  const labels = d.conductors.map((c) => c.label);
  assert.deepEqual(labels, ['L1', 'L2', 'L3', 'N', 'PE']);
  // у каждого проводника легенды есть цвет
  d.conductors.forEach((c) => assert.match(c.color, /^#[0-9A-Fa-f]{6}$/));
});

test('buildDxf: цветные жилы получают истинный цвет (группа 420)', () => {
  const tree = ac3('root', 'ВРУ', [ac3('l1', 'Нагрузка', [], 3000)]);
  const d = buildNodeDiagram({ ...tree, isRoot: true }, null, new Map());
  const sheet = { name: 'A4', w: 297, h: 210, scale: 1, segments: d.segments, texts: d.texts };
  const dxf = buildDxf(sheet);
  assert.match(dxf, /\n420\n/); // присутствует группа истинного цвета
});
