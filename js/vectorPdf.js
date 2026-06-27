// Полностью векторный экспорт листа схемы/ведомости (js/schemeSheet.js,
// js/specSheet.js) в PDF: линии и текст — настоящие PDF-операторы (m/l/S,
// BT/Tf/Tj/ET), а не растровая картинка. Для кириллицы шрифт встраивается
// целиком как составной (Type0/CIDFontType2, Identity-H, CIDToGIDMap
// /Identity) — таким образом код символа в потоке содержимого равен номеру
// глифа (GID), который для каждого символа находится через cmap шрифта
// (js/ttfFont.js). Это отдельный экспорт рядом с растровым (js/exportPdf.js):
// тот совместим с любым системным шрифтом «из коробки», этот даёт
// масштабируемый текст и меньший вес страницы за счёт отсутствия картинки.

import { loadFont } from './ttfFont.js';

const PT_PER_MM = 72 / 25.4;
const FONT_URL = new URL('../assets/fonts/LiberationSans-Regular.ttf', import.meta.url).href;
const FONT_PSNAME = 'LiberationSans';
const FONT_UNITS_TO_1000 = 1000;

let fontPromise = null;
function getEmbeddedFont() {
  if (!fontPromise) fontPromise = loadFont(FONT_URL);
  return fontPromise;
}

function glyphsForText(font, str) {
  const gids = [];
  for (const ch of str) gids.push(font.glyphIdForCodePoint(ch.codePointAt(0)) || 0);
  return gids;
}

function buildToUnicodeCMap(gidToUnicode) {
  const entries = [...gidToUnicode.entries()].sort((a, b) => a[0] - b[0]);
  const chunkSize = 100; // предел записей в одном блоке beginbfchar по спецификации PDF
  let body = '';
  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    body += `${chunk.length} beginbfchar\n`;
    chunk.forEach(([gid, cp]) => {
      body += `<${gid.toString(16).padStart(4, '0')}> <${cp.toString(16).padStart(4, '0')}>\n`;
    });
    body += 'endbfchar\n';
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n' +
    body +
    'endcmap\nend\nend\n'
  );
}

// PDF-оператор задания цвета (обводки RG или заливки rg) из HEX; без цвета —
// чёрный. Значения компонент в диапазоне 0..1.
function colorOp(hex, op) {
  let r = 0;
  let g = 0;
  let b = 0;
  if (typeof hex === 'string' && /^#?[0-9a-f]{6}$/i.test(hex)) {
    const h = hex.replace('#', '');
    r = parseInt(h.slice(0, 2), 16) / 255;
    g = parseInt(h.slice(2, 4), 16) / 255;
    b = parseInt(h.slice(4, 6), 16) / 255;
  }
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} ${op}`;
}

/** Строит поток содержимого одной страницы: линии и текст в PDF-операторах. */
function buildPageContent(sheet, font) {
  const pageHPt = sheet.h * PT_PER_MM;
  const toX = (mm) => (mm * PT_PER_MM).toFixed(2);
  const toY = (mm) => (pageHPt - mm * PT_PER_MM).toFixed(2);

  const lines = [];
  let lastWeightPt = null;
  let lastStroke = null;
  sheet.segments.forEach((s) => {
    const weightPt = s.weight * PT_PER_MM;
    if (weightPt !== lastWeightPt) {
      lines.push(`${weightPt.toFixed(3)} w`);
      lastWeightPt = weightPt;
    }
    const stroke = colorOp(s.color, 'RG');
    if (stroke !== lastStroke) {
      lines.push(stroke);
      lastStroke = stroke;
    }
    lines.push(`${toX(s.x1)} ${toY(s.y1)} m`);
    lines.push(`${toX(s.x2)} ${toY(s.y2)} l`);
    lines.push('S');
  });

  let lastFill = null;
  sheet.texts.forEach((t) => {
    const gids = glyphsForText(font, t.text);
    if (!gids.length) return;
    const fill = colorOp(t.color, 'rg');
    if (fill !== lastFill) {
      lines.push(fill);
      lastFill = fill;
    }
    const fontSizePt = t.h * PT_PER_MM;
    const scale = fontSizePt / font.unitsPerEm;
    const ascentPt = font.ascender * scale;
    const descentPt = font.descender * scale;
    const widthPt = gids.reduce((sum, gid) => sum + font.advanceWidth(gid), 0) * scale;

    const dx = t.halign === 'center' ? -widthPt / 2 : t.halign === 'right' ? -widthPt : 0;
    let dy;
    if (t.valign === 'top') dy = -ascentPt;
    else if (t.valign === 'bottom') dy = -descentPt;
    else if (t.valign === 'baseline') dy = 0;
    else dy = -(ascentPt + descentPt) / 2; // middle (используется по умолчанию)

    const x = (t.x * PT_PER_MM + dx).toFixed(2);
    const y = (pageHPt - t.y * PT_PER_MM + dy).toFixed(2);
    const hex = gids.map((g) => g.toString(16).padStart(4, '0')).join('');

    lines.push('BT');
    lines.push(`/F1 ${fontSizePt.toFixed(3)} Tf`);
    lines.push(`${x} ${y} Td`);
    lines.push(`<${hex}> Tj`);
    lines.push('ET');
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Собирает векторный PDF из листов (geometria в мм — тот же формат, что и в
 * js/exportPdf.js): встраивает шрифт один раз и пишет на каждую страницу
 * линии и текст PDF-операторами, без растровых изображений.
 */
function buildVectorPdfBytes(sheets, font) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (n) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  // Глифы, реально встречающиеся хотя бы в одном тексте — нужны для /W
  // (ширины по CID) и ToUnicode (обратное соответствие для копирования текста).
  const usedWidths = new Map(); // gid -> ширина в тысячных доль em
  const usedUnicode = new Map(); // gid -> codepoint
  sheets.forEach((sheet) => {
    sheet.texts.forEach((t) => {
      for (const ch of t.text) {
        const cp = ch.codePointAt(0);
        const gid = font.glyphIdForCodePoint(cp) || 0;
        if (!usedWidths.has(gid)) {
          usedWidths.set(gid, Math.round((font.advanceWidth(gid) * FONT_UNITS_TO_1000) / font.unitsPerEm));
          usedUnicode.set(gid, cp);
        }
      }
    });
  });

  const pageCount = sheets.length;
  // Статические объекты 1-7 (каталог/дерево страниц/шрифт), затем по 2 на страницу.
  const pageObjNums = sheets.map((_, i) => 8 + i * 2);
  const objectCount = 7 + pageCount * 2 + 1; // +1 — служебный объект 0

  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  startObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`);

  startObject(3);
  push(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${FONT_PSNAME} /Encoding /Identity-H ` +
      '/DescendantFonts [4 0 R] /ToUnicode 7 0 R >>\nendobj\n',
  );

  const sortedGids = [...usedWidths.keys()].sort((a, b) => a - b);
  const wEntries = sortedGids.map((gid) => `${gid} [${usedWidths.get(gid)}]`).join(' ');

  startObject(4);
  push(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${FONT_PSNAME} ` +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ' +
      `/FontDescriptor 5 0 R /CIDToGIDMap /Identity /W [ ${wEntries} ] >>\nendobj\n`,
  );

  const toThousandths = FONT_UNITS_TO_1000 / font.unitsPerEm;
  const fontBBox = font.bbox.map((v) => Math.round(v * toThousandths));
  const ascent = Math.round(font.ascender * toThousandths);
  const descent = Math.round(font.descender * toThousandths);

  startObject(5);
  push(
    `<< /Type /FontDescriptor /FontName /${FONT_PSNAME} /Flags 32 /FontBBox [${fontBBox.join(' ')}] ` +
      `/ItalicAngle 0 /Ascent ${ascent} /Descent ${descent} /CapHeight ${ascent} /StemV 80 ` +
      '/FontFile2 6 0 R >>\nendobj\n',
  );

  startObject(6);
  push(`<< /Length ${font.raw.length} /Length1 ${font.raw.length} >>\nstream\n`);
  push(font.raw);
  push('\nendstream\nendobj\n');

  const toUnicode = buildToUnicodeCMap(usedUnicode);
  startObject(7);
  push(`<< /Length ${encoder.encode(toUnicode).length} >>\nstream\n`);
  push(toUnicode);
  push('endstream\nendobj\n');

  sheets.forEach((sheet, i) => {
    const pageNum = 8 + i * 2;
    const contentNum = pageNum + 1;
    const pageW = (sheet.w * PT_PER_MM).toFixed(2);
    const pageH = (sheet.h * PT_PER_MM).toFixed(2);

    startObject(pageNum);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    const content = buildPageContent(sheet, font);
    startObject(contentNum);
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n`);
    push(content);
    push('endstream\nendobj\n');
  });

  const xrefOffset = length;
  push(`xref\n0 ${objectCount}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n < objectCount; n += 1) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const pdf = new Uint8Array(length);
  let pos = 0;
  chunks.forEach((bytes) => {
    pdf.set(bytes, pos);
    pos += bytes.length;
  });
  return pdf;
}

/**
 * Строит векторный PDF-файл и возвращает Blob. Принимает один лист или
 * массив листов — на каждый лист приходится страница. Шрифт загружается и
 * разбирается один раз и кэшируется на время жизни страницы приложения.
 * @param {object|object[]} sheetOrSheets
 */
export async function buildVectorSchemePdf(sheetOrSheets) {
  const sheets = Array.isArray(sheetOrSheets) ? sheetOrSheets : [sheetOrSheets];
  if (!sheets.length) throw new Error('нет листов для экспорта');
  const font = await getEmbeddedFont();
  const bytes = buildVectorPdfBytes(sheets, font);
  return new Blob([bytes], { type: 'application/pdf' });
}

// Сборка PDF-байтов не зависит от DOM/fetch — экспортируем для модульной
// проверки на разобранном шрифте без сети и без браузера.
export const VECTOR_PDF_INTERNAL = { buildVectorPdfBytes, buildToUnicodeCMap, glyphsForText };
