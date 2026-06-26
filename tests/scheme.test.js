import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchemeLayout, BOX_W, BOX_H } from '../js/schemeLayout.js';
import { buildSheet } from '../js/schemeSheet.js';
import { buildDxf } from '../js/exportDxf.js';
import { NETWORK_TYPES } from '../js/calculations.js';

function leaf(id, name, knownValue, extra = {}) {
  return {
    id,
    name,
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: true,
    known: 'power',
    knownValue,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    children: [],
    ...extra,
  };
}

function sampleTree() {
  return {
    id: 'root',
    name: 'Главный щит',
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 5,
    simultaneityFactor: 1,
    children: [leaf('a', 'Освещение', 240), leaf('b', 'Розетки', 120)],
  };
}

test('buildSchemeLayout строит блок на каждый узел и связь на каждое ребро (плюс вводная линия ВРУ)', () => {
  const layout = buildSchemeLayout(sampleTree());
  assert.equal(layout.boxes.length, 3);
  // Связь на каждое ребро дерева (2) + вводная линия, питающая корневой щит.
  assert.equal(layout.edges.length, 3);
  assert.equal(layout.hasErrors, false);
  // Размер поля схемы положителен и кратен размеру блока.
  assert.ok(layout.width >= BOX_W);
  assert.ok(layout.height >= BOX_H);
});

test('buildSchemeLayout: вводная линия ВРУ подписана автоматом и кабелем по суммарной нагрузке дерева', () => {
  const layout = buildSchemeLayout(sampleTree());
  const root = layout.boxes.find((b) => b.id === 'root');
  const rootCx = root.x + root.w / 2;

  const incoming = layout.edges.find((e) => e.points[0].x === rootCx && e.points[0].y === 0);
  assert.ok(incoming, 'должна быть линия, входящая в верхнюю границу схемы над корневым блоком');
  assert.equal(incoming.points[incoming.points.length - 1].y, root.y);
  assert.match(incoming.lines.join(' '), /Вводной кабель/);
  assert.match(incoming.lines.join(' '), /QF/);
  assert.match(incoming.lines.join(' '), /мм2/);

  // Автомат и кабель вводной линии подбираются по суммарной нагрузке всего
  // дерева — без дочерних узлов (которые дают почти весь ток) номинал заметно
  // меньше, чем с ними.
  const withoutChildren = sampleTree();
  withoutChildren.children = [];
  withoutChildren.hasOwnLoad = true;
  withoutChildren.known = 'power';
  withoutChildren.knownValue = 24;
  const soloLayout = buildSchemeLayout(withoutChildren);
  const soloRoot = soloLayout.boxes.find((b) => b.id === 'root');
  const soloIncoming = soloLayout.edges.find((e) => e.points[0].x === soloRoot.x + soloRoot.w / 2 && e.points[0].y === 0);
  assert.notEqual(soloIncoming.lines.join(' '), incoming.lines.join(' '));
});

test('buildSchemeLayout: корневой блок центрирован над дочерними', () => {
  const layout = buildSchemeLayout(sampleTree());
  const root = layout.boxes.find((b) => b.id === 'root');
  const children = layout.boxes.filter((b) => b.id === 'a' || b.id === 'b');
  const rootCx = root.x + root.w / 2;
  const childrenCx = children.reduce((sum, b) => sum + b.x + b.w / 2, 0) / children.length;
  assert.ok(Math.abs(rootCx - childrenCx) < 1e-6);
});

test('buildSchemeLayout помечает ошибочные узлы и подписывает связи автоматом', () => {
  const layout = buildSchemeLayout(sampleTree());
  const edgeLabels = layout.edges.flatMap((e) => e.lines).join(' ');
  assert.match(edgeLabels, /QF/);
  assert.match(edgeLabels, /мм2/);

  const broken = sampleTree();
  broken.children[0].voltage = 0; // делает узел нерасчётным
  const badLayout = buildSchemeLayout(broken);
  assert.equal(badLayout.hasErrors, true);
});

test('buildSheet вписывает схему в стандартный формат с рамкой и основной надписью', () => {
  const sheet = buildSheet(buildSchemeLayout(sampleTree()), { title: 'Тест' });
  assert.ok(['A4', 'A3', 'A2', 'A1'].includes(sheet.name));
  assert.ok(sheet.segments.length > 0);
  assert.ok(sheet.texts.some((t) => t.text === 'Тест'));
  // Все примитивы лежат внутри листа.
  sheet.segments.forEach((s) => {
    assert.ok(s.x1 >= 0 && s.x1 <= sheet.w && s.y1 >= 0 && s.y1 <= sheet.h);
    assert.ok(s.x2 >= 0 && s.x2 <= sheet.w && s.y2 >= 0 && s.y2 <= sheet.h);
  });
});

test('buildDxf даёт корректную DXF-обёртку и переворачивает ось Y', () => {
  const sheet = buildSheet(buildSchemeLayout(sampleTree()), { title: 'Тест' });
  const dxf = buildDxf(sheet);
  assert.match(dxf, /^0\nSECTION\n2\nHEADER/);
  assert.match(dxf, /AC1009/);
  assert.match(dxf, /2\nENTITIES/);
  assert.ok(dxf.trimEnd().endsWith('EOF'));
  // Кириллица закодирована управляющими последовательностями \U+XXXX.
  assert.match(dxf, /\\U\+0422/); // «Т» из «Тест»
  assert.doesNotMatch(dxf, /Тест/);
  // Число сущностей LINE соответствует числу отрезков листа.
  const lineCount = (dxf.match(/\n0\nLINE\n/g) || []).length;
  assert.equal(lineCount, sheet.segments.length);
  // Толщина линии (группа 370) передаётся для каждого отрезка, а не одна на всех.
  const weightCodes = (dxf.match(/\n370\n(\d+)/g) || []).map((m) => Number(m.split('\n')[2]));
  assert.equal(weightCodes.length, sheet.segments.length);
  const distinctWeights = new Set(sheet.segments.map((s) => s.weight));
  if (distinctWeights.size > 1) {
    assert.ok(new Set(weightCodes).size > 1, 'разным толщинам линий должны соответствовать разные коды 370');
  }
});
