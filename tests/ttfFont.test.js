import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import url from 'node:url';
import { parseTtf } from '../js/ttfFont.js';

const fontPath = url.fileURLToPath(new URL('../assets/fonts/LiberationSans-Regular.ttf', import.meta.url));
const fontBuffer = fs.readFileSync(fontPath);
// Копируем в новый ArrayBuffer — parseTtf ожидает ArrayBuffer, а не Node Buffer.
const arrayBuffer = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength);

test('parseTtf: метрики шрифта читаются корректно', () => {
  const font = parseTtf(arrayBuffer);
  assert.equal(font.unitsPerEm, 2048);
  assert.ok(font.ascender > 0);
  assert.ok(font.descender < 0);
  assert.ok(font.numGlyphs > 100);
  assert.equal(font.bbox.length, 4);
  assert.ok(font.raw.length === fontBuffer.length, 'raw содержит весь файл шрифта');
});

test('parseTtf: cmap находит глифы для латиницы, кириллицы и спецсимволов', () => {
  const font = parseTtf(arrayBuffer);
  const covered = ['A', 'z', '0', 'А', 'я', 'Ё', 'Ў', '№', '²', '×', 'Δ', '—', '«', '»'];
  covered.forEach((ch) => {
    const gid = font.glyphIdForCodePoint(ch.codePointAt(0));
    assert.ok(gid > 0, `нет глифа для «${ch}» (U+${ch.codePointAt(0).toString(16)})`);
  });
});

test('parseTtf: отсутствующий символ даёт gid 0, а не падение', () => {
  const font = parseTtf(arrayBuffer);
  // U+1F600 (эмодзи) заведомо отсутствует в Liberation Sans.
  assert.equal(font.glyphIdForCodePoint(0x1f600), 0);
});

test('parseTtf: разные глифы имеют разную ширину (настоящие метрики, не плейсхолдер)', () => {
  const font = parseTtf(arrayBuffer);
  const gidI = font.glyphIdForCodePoint('i'.codePointAt(0));
  const gidM = font.glyphIdForCodePoint('M'.codePointAt(0));
  assert.ok(gidI > 0 && gidM > 0);
  assert.notEqual(font.advanceWidth(gidI), font.advanceWidth(gidM));
  assert.ok(font.advanceWidth(gidI) < font.advanceWidth(gidM));
});

test('parseTtf: один и тот же символ всегда даёт один и тот же gid', () => {
  const font = parseTtf(arrayBuffer);
  const a1 = font.glyphIdForCodePoint('А'.codePointAt(0));
  const a2 = font.glyphIdForCodePoint('А'.codePointAt(0));
  assert.equal(a1, a2);
});
