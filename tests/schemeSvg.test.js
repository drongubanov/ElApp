import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSheetToSvg } from '../js/schemeSvg.js';

// Минимальный синтетический лист (та же структура, что у buildSheet/buildSpecSheets).
function sampleSheet() {
  return {
    name: 'A4',
    w: 297,
    h: 210,
    scale: 1,
    segments: [
      { x1: 0, y1: 0, x2: 100, y2: 0, weight: 0.5, layer: 'SCHEME' },
      { x1: 100, y1: 0, x2: 100, y2: 50, weight: 0.25, layer: 'SCHEME' },
    ],
    texts: [
      { x: 50, y: 25, text: 'Щит «А» <тест>', h: 3, halign: 'center', valign: 'middle', layer: 'TEXT' },
    ],
  };
}

test('renderSheetToSvg: viewBox в миллиметрах листа, корень — <svg>', () => {
  const svg = renderSheetToSvg(sampleSheet());
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 297 210"/);
  assert.match(svg, /<\/svg>$/);
});

test('renderSheetToSvg: по одному элементу на каждый отрезок и текст', () => {
  const sheet = sampleSheet();
  const svg = renderSheetToSvg(sheet);
  const lines = svg.match(/<line /g) || [];
  const texts = svg.match(/<text /g) || [];
  assert.equal(lines.length, sheet.segments.length);
  assert.equal(texts.length, sheet.texts.length);
});

test('renderSheetToSvg: спецсимволы текста экранируются (нет инъекции разметки)', () => {
  const svg = renderSheetToSvg(sampleSheet());
  assert.match(svg, /Щит &quot;А&quot; &lt;тест&gt;|Щит «А» &lt;тест&gt;/);
  assert.doesNotMatch(svg, /<тест>/);
});

test('renderSheetToSvg: толщина линии не опускается ниже видимого минимума', () => {
  const sheet = sampleSheet();
  sheet.segments = [{ x1: 0, y1: 0, x2: 10, y2: 0, weight: 0.01, layer: 'SCHEME' }];
  const svg = renderSheetToSvg(sheet);
  assert.match(svg, /stroke-width="0.120"/);
});

test('renderSheetToSvg: невалидный лист — ошибка', () => {
  assert.throws(() => renderSheetToSvg({ w: 0, h: 0 }), /некорректный лист/);
  assert.throws(() => renderSheetToSvg(null), /некорректный лист/);
});

test('renderSheetToSvg: есть роль img и aria-label для доступности', () => {
  const svg = renderSheetToSvg(sampleSheet(), { title: 'Моя схема' });
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Моя схема"/);
});
