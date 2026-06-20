import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecSheet, SPEC_SHEET_INTERNAL } from '../js/specSheet.js';
import { NETWORK_TYPES } from '../js/calculations.js';

function sampleTree() {
  return {
    id: 'root',
    name: 'Главный щит',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 5,
    simultaneityFactor: 1,
    children: [
      {
        id: 'a',
        name: 'Освещение',
        networkType: NETWORK_TYPES.AC1,
        voltage: 220,
        hasOwnLoad: true,
        known: 'power',
        knownValue: 1000,
        installationMethod: 'conduit',
        cableCount: 1,
        cableLength: 10,
        children: [],
      },
    ],
  };
}

test('buildSpecSheet: возвращает лист стандартного формата с геометрией и текстами', () => {
  const sheet = buildSpecSheet(sampleTree(), { title: 'Тест' });
  assert.ok(sheet.w > 0 && sheet.h > 0);
  assert.ok(sheet.segments.length > 0, 'должны быть линии таблицы и рамки');
  assert.ok(sheet.texts.length > 0, 'должны быть тексты');
});

test('buildSpecSheet: содержит заголовок ведомости, заголовки столбцов и имена узлов', () => {
  const sheet = buildSpecSheet(sampleTree(), { title: 'Тест' });
  const allText = sheet.texts.map((t) => t.text);
  assert.ok(allText.some((t) => t.includes('Ведомость линий')));
  SPEC_SHEET_INTERNAL.COLUMNS.forEach((col) => {
    assert.ok(allText.includes(col.title), `должен быть заголовок столбца «${col.title}»`);
  });
  assert.ok(allText.includes('Главный щит'), 'имя корневого узла');
  assert.ok(allText.some((t) => t.includes('Освещение')), 'имя дочернего узла');
});

test('buildSpecSheet: основная надпись (штамп) указывает «Ведомость линий сети»', () => {
  const sheet = buildSpecSheet(sampleTree(), { title: 'Тест' });
  const allText = sheet.texts.map((t) => t.text);
  assert.ok(allText.includes('Ведомость линий сети'));
});

test('buildSpecSheet: большое дерево умещается на лист (строки ужимаются, не вылезают за штамп)', () => {
  const root = sampleTree();
  for (let i = 0; i < 80; i += 1) {
    root.children.push({
      id: `n${i}`, name: `Узел ${i}`, networkType: NETWORK_TYPES.AC1, voltage: 220,
      hasOwnLoad: true, known: 'power', knownValue: 500, installationMethod: 'air',
      cableCount: 1, cableLength: 1, children: [],
    });
  }
  const sheet = buildSpecSheet(root, {});
  const maxY = Math.max(...sheet.segments.flatMap((s) => [s.y1, s.y2]));
  assert.ok(maxY <= sheet.h, 'геометрия не должна выходить за пределы листа');
});
