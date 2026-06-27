import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeDiagram } from '../js/schemeNodeDiagram.js';
import { buildNodeSheets, mergeSheetsForDxf, NODE_SHEETS_INTERNAL } from '../js/schemeNodeSheets.js';
import { calculateTree } from '../js/network.js';
import { NETWORK_TYPES } from '../js/calculations.js';

function leaf(id, name, kw, extra = {}) {
  return {
    id, name, networkType: NETWORK_TYPES.AC3, voltage: 380, powerFactor: 0.9,
    hasOwnLoad: true, known: 'power', knownValue: kw,
    installationMethod: 'air', cableCount: 1, cableLength: 15,
    ambientTemp: 25, insulation: 'pvc', phaseShares: [1, 1, 1],
    simultaneityFactor: 1, utilizationFactor: 1, loadType: 'general',
    children: [], ...extra,
  };
}
function panel(id, name, children, extra = {}) {
  return { ...leaf(id, name, 0, { hasOwnLoad: false, ...extra }), children };
}

function sampleTree() {
  return panel('root', 'ВРУ', [
    panel('p1', 'ЩО-1', [leaf('l1', 'Освещение', 1500), leaf('l2', 'Розетки', 2000)]),
    leaf('s1', 'Прямой потребитель', 3000),
  ]);
}

function calcMapOf(tree) {
  const map = new Map();
  const flat = (n) => { map.set(n.id, n); n.children.forEach(flat); };
  flat(calculateTree(tree));
  return map;
}

test('collectPanelNodes: корень + все узлы с дочерними линиями', () => {
  const tree = sampleTree();
  const panels = NODE_SHEETS_INTERNAL.collectPanelNodes(tree);
  assert.deepEqual(panels.map((p) => p.node.id), ['root', 'p1']);
  assert.equal(panels[0].isRoot, true);
});

test('buildNodeDiagram: ввод, шина и отходящие линии присутствуют', () => {
  const tree = sampleTree();
  const calcMap = calcMapOf(tree);
  const sheetNo = new Map([['p1', 2]]);
  const d = buildNodeDiagram({ ...tree, isRoot: true }, calcMap.get('root'), calcMap, sheetNo);
  const allText = d.texts.map((t) => t.text).join(' | ');
  assert.match(allText, /Ввод от сети/);
  assert.match(allText, /QF1/);
  assert.match(allText, /ЩО-1/); // дочерний щит как назначение
  assert.match(allText, /см\. лист 2/); // перекрёстная ссылка на лист подщита
  assert.match(allText, /Прямой потребитель/);
  assert.ok(d.width > 0 && d.height > 0);
  // Шина — самый толстый горизонтальный отрезок.
  const bus = d.segments.find((s) => s.weight >= 0.9 && s.y1 === s.y2);
  assert.ok(bus, 'должна быть сборная шина');
});

test('buildNodeSheets: по листу на щит, сквозная нумерация', () => {
  const sheets = buildNodeSheets(sampleTree(), { title: 'ВРУ' });
  assert.equal(sheets.length, 2); // ВРУ и ЩО-1
  assert.equal(sheets[0].title, 'ВРУ');
  assert.equal(sheets[1].title, 'ЩО-1');
  sheets.forEach((s) => {
    assert.ok(s.segments.length > 0);
    assert.ok(s.texts.length > 0);
    assert.ok(['A4', 'A3', 'A2', 'A1'].includes(s.name));
  });
});

test('buildNodeSheets: корень без дочерних — один лист с пометкой', () => {
  const tree = leaf('root', 'Одиночный щит', 5000, { hasOwnLoad: true });
  const sheets = buildNodeSheets(tree, {});
  assert.equal(sheets.length, 1);
  const allText = sheets[0].texts.map((t) => t.text).join(' | ');
  assert.match(allText, /Отходящих линий нет/);
});

test('mergeSheetsForDxf: листы складываются стопкой в один', () => {
  const sheets = buildNodeSheets(sampleTree(), {});
  const merged = mergeSheetsForDxf(sheets, 10);
  const totalSeg = sheets.reduce((a, s) => a + s.segments.length, 0);
  const totalTxt = sheets.reduce((a, s) => a + s.texts.length, 0);
  assert.equal(merged.segments.length, totalSeg);
  assert.equal(merged.texts.length, totalTxt);
  assert.equal(merged.w, Math.max(...sheets.map((s) => s.w)));
  assert.ok(merged.h > sheets[0].h); // выше одного листа
});

test('mergeSheetsForDxf: пустой набор — ошибка', () => {
  assert.throws(() => mergeSheetsForDxf([]), /нет листов/);
});
