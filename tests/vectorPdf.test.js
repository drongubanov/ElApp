import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import url from 'node:url';
import { parseTtf } from '../js/ttfFont.js';
import { VECTOR_PDF_INTERNAL } from '../js/vectorPdf.js';

const { buildVectorPdfBytes } = VECTOR_PDF_INTERNAL;

const fontPath = url.fileURLToPath(new URL('../assets/fonts/LiberationSans-Regular.ttf', import.meta.url));
const fontBuffer = fs.readFileSync(fontPath);
const arrayBuffer = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength);
const font = parseTtf(arrayBuffer);

function sheet({ w = 297, h = 210, segments = [], texts = [] } = {}) {
  return { name: 'A4', w, h, scale: 1, segments, texts };
}

function pdfText(bytes) {
  return Buffer.from(bytes).toString('latin1');
}

test('buildVectorPdfBytes: валидная структура PDF без растровых изображений', () => {
  const sheets = [
    sheet({
      segments: [{ x1: 10, y1: 10, x2: 100, y2: 10, weight: 0.5 }],
      texts: [{ x: 20, y: 30, text: 'Тест 123', h: 4, halign: 'left', valign: 'middle' }],
    }),
  ];
  const bytes = buildVectorPdfBytes(sheets, font);
  const text = pdfText(bytes);

  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('/Type /Catalog'));
  assert.ok(text.includes('/Subtype /Type0'));
  assert.ok(text.includes('/Subtype /CIDFontType2'));
  assert.ok(text.includes('/Encoding /Identity-H'));
  assert.ok(text.includes('/FontFile2'));
  assert.ok(text.includes('/ToUnicode'));
  assert.ok(text.includes('Tj'));
  assert.ok(!text.includes('/Subtype /Image'), 'векторный PDF не должен содержать растровых картинок');
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});

test('buildVectorPdfBytes: текст в content stream кодирует правильные GID для кириллицы', () => {
  const label = 'Щит ВРУ№1';
  const sheets = [sheet({ texts: [{ x: 20, y: 30, text: label, h: 4, halign: 'left', valign: 'middle' }] })];
  const bytes = buildVectorPdfBytes(sheets, font);
  const text = pdfText(bytes);

  const match = text.match(/<([0-9a-f]+)> Tj/);
  assert.ok(match, 'есть строка Tj с шестнадцатеричным кодом глифов');
  const hex = match[1];
  const gids = [];
  for (let i = 0; i < hex.length; i += 4) gids.push(parseInt(hex.slice(i, i + 4), 16));

  const expected = [...label].map((ch) => font.glyphIdForCodePoint(ch.codePointAt(0)));
  assert.deepEqual(gids, expected);
});

test('buildVectorPdfBytes: несколько листов — Count и Kids соответствуют числу страниц', () => {
  const sheets = [
    sheet({ texts: [{ x: 5, y: 5, text: 'Лист 1', h: 3, halign: 'left', valign: 'middle' }] }),
    sheet({ texts: [{ x: 5, y: 5, text: 'Лист 2', h: 3, halign: 'left', valign: 'middle' }] }),
    sheet({ texts: [{ x: 5, y: 5, text: 'Лист 3', h: 3, halign: 'left', valign: 'middle' }] }),
  ];
  const bytes = buildVectorPdfBytes(sheets, font);
  const text = pdfText(bytes);

  assert.ok(text.includes('/Count 3'));
  const kids = text.match(/\/Kids \[([^\]]*)\]/);
  assert.ok(kids);
  assert.equal((kids[1].match(/\d+ 0 R/g) || []).length, 3);
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 3);
});

test('buildVectorPdfBytes: таблица xref согласована со смещениями объектов', () => {
  const sheets = [
    sheet({ texts: [{ x: 5, y: 5, text: 'А', h: 3, halign: 'left', valign: 'middle' }] }),
    sheet({ texts: [{ x: 5, y: 5, text: 'Б', h: 3, halign: 'left', valign: 'middle' }] }),
  ];
  const bytes = buildVectorPdfBytes(sheets, font);
  const text = pdfText(bytes);

  const sizeMatch = text.match(/\/Size (\d+)/);
  assert.ok(sizeMatch);
  const size = Number(sizeMatch[1]);
  // 7 статических объектов (каталог/страницы/шрифт×5) + 2 на страницу×2 страницы + объект 0.
  assert.equal(size, 7 + 2 * 2 + 1);

  const xrefStart = text.indexOf('\nxref\n');
  assert.ok(xrefStart > 0);
  const lines = text.slice(xrefStart + 6).split('\n');
  for (let n = 1; n < size; n += 1) {
    const entry = lines[1 + n];
    const offset = Number(entry.slice(0, 10));
    const at = text.slice(offset, offset + 12);
    assert.ok(at.startsWith(`${n} 0 obj`), `объект ${n}: xref-смещение указывает на «${n} 0 obj», а не «${at}»`);
  }
});

test('buildVectorPdfBytes: встроенный шрифт — это весь файл LiberationSans без изменений', () => {
  const sheets = [sheet({ texts: [{ x: 5, y: 5, text: 'X', h: 3, halign: 'left', valign: 'middle' }] })];
  const bytes = buildVectorPdfBytes(sheets, font);

  const length1Match = pdfText(bytes).match(/\/Length1 (\d+)/);
  assert.ok(length1Match);
  assert.equal(Number(length1Match[1]), fontBuffer.length);
});

test('buildVectorPdfBytes: halign и valign смещают позицию текста, а не координаты узла', () => {
  const base = { x: 50, y: 50, text: 'Ширина', h: 5 };
  const sheets = [
    sheet({
      texts: [
        { ...base, halign: 'left', valign: 'middle' },
        { ...base, halign: 'right', valign: 'middle' },
      ],
    }),
  ];
  const bytes = buildVectorPdfBytes(sheets, font);
  const text = pdfText(bytes);
  const tds = [...text.matchAll(/([\d.-]+) ([\d.-]+) Td/g)].map((m) => Number(m[1]));
  assert.equal(tds.length, 2);
  assert.ok(tds[0] > tds[1], 'right-aligned текст должен начинаться левее, чем left-aligned для того же якоря');
});
