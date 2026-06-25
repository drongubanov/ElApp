import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecSheet, buildSpecSheets, SPEC_SHEET_INTERNAL } from '../js/specSheet.js';
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

test('buildSpecSheets: маленькое дерево — одна страница', () => {
  const pages = buildSpecSheets(sampleTree(), { title: 'Тест' });
  assert.equal(pages.length, 1);
});

function bigTree(childCount) {
  const root = sampleTree();
  for (let i = 0; i < childCount; i += 1) {
    root.children.push({
      id: `n${i}`, name: `Узел ${i}`, networkType: NETWORK_TYPES.AC1, voltage: 220,
      hasOwnLoad: true, known: 'power', knownValue: 500, installationMethod: 'air',
      cableCount: 1, cableLength: 1, children: [],
    });
  }
  return root;
}

test('buildSpecSheets: большое дерево нарезается на несколько страниц, строки не ужимаются', () => {
  const pages = buildSpecSheets(bigTree(80), {});
  assert.ok(pages.length > 1, 'должно получиться больше одной страницы');
  // Геометрия каждой страницы не выходит за пределы листа.
  pages.forEach((page) => {
    const maxY = Math.max(...page.segments.flatMap((s) => [s.y1, s.y2]));
    assert.ok(maxY <= page.h, 'геометрия страницы не должна выходить за пределы листа');
  });
});

test('buildSpecSheets: каждая страница нумеруется «Лист N / Листов M» и повторяет заголовки столбцов', () => {
  const pages = buildSpecSheets(bigTree(80), {});
  const total = pages.length;
  pages.forEach((page, i) => {
    const allText = page.texts.map((t) => t.text);
    // Номер листа и общее число листов из штампа (ГОСТ): «Р», N, M рядом.
    assert.ok(allText.includes(String(i + 1)), `на странице должен быть её номер ${i + 1}`);
    assert.ok(allText.includes(String(total)), `на странице должно быть общее число листов ${total}`);
    // Заголовки столбцов повторяются на каждом листе.
    SPEC_SHEET_INTERNAL.COLUMNS.forEach((col) => {
      assert.ok(allText.includes(col.title), `столбец «${col.title}» должен повторяться на каждом листе`);
    });
  });
});

test('buildSpecSheets: все строки данных распределены по страницам без потерь', () => {
  const childCount = 80;
  const pages = buildSpecSheets(bigTree(childCount), {});
  // Узлов всего childCount + 1 корень. Считаем строки с именами узлов на всех листах.
  const nameCells = pages.flatMap((page) =>
    page.texts.filter((t) => t.text === 'Главный щит' || /Узел \d+/.test(t.text) || t.text.includes('Освещение')),
  );
  assert.equal(nameCells.length, childCount + 2, 'корень + Освещение + узлы должны присутствовать ровно по разу');
});

test('buildSpecSheet: совместимость — возвращает первый лист', () => {
  const first = buildSpecSheet(bigTree(80), {});
  const pages = buildSpecSheets(bigTree(80), {});
  assert.equal(first.texts.length, pages[0].texts.length);
});
