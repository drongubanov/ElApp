// Оформленная табличная ведомость линий сети для печати/PDF: та же геометрия
// листа (отрезки и тексты в мм, начало координат — верхний левый угол), что и у
// js/schemeSheet.js, поэтому её можно отрисовать тем же buildSchemePdf. В отличие
// от CSV-ведомости (js/schemeSpec.js, для Excel) здесь — готовый лист со штампом
// по ГОСТ для приложения к проектной документации. Модуль не зависит от DOM и
// проверяется модульными тестами.

import { buildSpecRows } from './schemeSpec.js';
import { addTitleBlock, SHEET_INTERNAL } from './schemeSheet.js';

const { FRAME, TITLE_H, SHEETS } = SHEET_INTERNAL;

const TABLE_GAP = 6; // зазор между таблицей и основной надписью
const HEADING_H = 9; // место под заголовок ведомости над таблицей
const HEADER_H = 9; // высота строки заголовков столбцов
const ROW_H = 7; // высота строки данных по умолчанию
const MIN_ROW_H = 3.5;
const PAD = 2; // отступ текста от границы ячейки

// Столбцы ведомости: ключ из buildSpecRows, заголовок, ширина (мм), выравнивание.
const COLUMNS = [
  { key: 'name', title: 'Линия / узел', w: 72, align: 'left' },
  { key: 'voltage', title: 'U, В', w: 14, align: 'center' },
  { key: 'power', title: 'P', w: 22, align: 'right' },
  { key: 'current', title: 'I', w: 20, align: 'right' },
  { key: 'breaker', title: 'Автомат', w: 22, align: 'center' },
  { key: 'curve', title: 'Хар-ка', w: 16, align: 'center' },
  { key: 'cable', title: 'Кабель', w: 30, align: 'center' },
  { key: 'length', title: 'L, м', w: 14, align: 'center' },
  { key: 'voltageDrop', title: 'ΔU', w: 16, align: 'center' },
];

const TABLE_W = COLUMNS.reduce((sum, col) => sum + col.w, 0);

/** Подбирает наименьший стандартный формат, в который влезает вся таблица; иначе ужимает строки. */
function chooseSheet(rowCount) {
  const need = HEADER_H + rowCount * ROW_H;
  for (const sheet of SHEETS) {
    const avail = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - TABLE_GAP - HEADING_H;
    if (need <= avail && TABLE_W <= sheet.w - FRAME.left - FRAME.right) {
      return { sheet, rowH: ROW_H };
    }
  }
  const sheet = SHEETS[SHEETS.length - 1];
  const avail = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - TABLE_GAP - HEADING_H;
  return { sheet, rowH: Math.max(MIN_ROW_H, (avail - HEADER_H) / Math.max(rowCount, 1)) };
}

/**
 * Строит лист ведомости линий сети по дереву.
 * @param {object} tree  корневой узел сети (как в network.js)
 * @param {object} meta   { title, date, sheet, sheets, designation, author }
 * @returns {{ name, w, h, scale, segments, texts }}
 */
export function buildSpecSheet(tree, meta = {}) {
  const rows = buildSpecRows(tree);
  const { sheet, rowH } = chooseSheet(rows.length);

  const segments = [];
  const texts = [];
  const seg = (x1, y1, x2, y2, weight = 0.25, layer = 'TABLE') =>
    segments.push({ x1, y1, x2, y2, weight, layer });
  const rect = (x, y, w, h, weight, layer) => {
    seg(x, y, x + w, y, weight, layer);
    seg(x + w, y, x + w, y + h, weight, layer);
    seg(x + w, y + h, x, y + h, weight, layer);
    seg(x, y + h, x, y, weight, layer);
  };
  const text = (x, y, value, h, halign, valign, layer = 'TEXT') =>
    texts.push({ x, y, text: String(value), h, halign, valign, layer });

  // Рамка чертежа.
  rect(FRAME.left, FRAME.top, sheet.w - FRAME.left - FRAME.right, sheet.h - FRAME.top - FRAME.bottom, 0.7, 'FRAME');

  // Заголовок ведомости над таблицей.
  text(FRAME.left, FRAME.top + 4, 'Ведомость линий питающей сети', 3.5, 'left', 'middle', 'TEXT');

  // Таблица: координаты столбцов.
  const tableX = FRAME.left;
  const tableY = FRAME.top + HEADING_H;
  const colX = [];
  let acc = tableX;
  COLUMNS.forEach((col) => {
    colX.push(acc);
    acc += col.w;
  });
  const tableRight = acc;
  const tableBottom = tableY + HEADER_H + rows.length * rowH;

  // Внешняя рамка таблицы и вертикали столбцов.
  rect(tableX, tableY, TABLE_W, HEADER_H + rows.length * rowH, 0.5, 'TABLE');
  for (let i = 1; i < COLUMNS.length; i += 1) seg(colX[i], tableY, colX[i], tableBottom, 0.25, 'TABLE');

  // Горизонталь под заголовком (потолще) и линии между строками данных.
  seg(tableX, tableY + HEADER_H, tableRight, tableY + HEADER_H, 0.5, 'TABLE');
  for (let r = 1; r < rows.length; r += 1) {
    const y = tableY + HEADER_H + r * rowH;
    seg(tableX, y, tableRight, y, 0.18, 'TABLE');
  }

  const cellText = (col, colIndex, value, cy, h) => {
    if (value === '' || value == null) return;
    let x;
    if (col.align === 'left') x = colX[colIndex] + PAD;
    else if (col.align === 'right') x = colX[colIndex] + col.w - PAD;
    else x = colX[colIndex] + col.w / 2;
    text(x, cy, value, h, col.align, 'middle', 'TEXT');
  };

  // Заголовки столбцов.
  const headerCy = tableY + HEADER_H / 2;
  COLUMNS.forEach((col, i) => cellText(col, i, col.title, headerCy, 2.4));

  // Строки данных.
  const cellH = Math.min(2.6, rowH - 1.5);
  rows.forEach((row, r) => {
    const cy = tableY + HEADER_H + r * rowH + rowH / 2;
    COLUMNS.forEach((col, i) => cellText(col, i, row[col.key], cy, cellH));
  });

  addTitleBlock({
    sheet,
    scale: 1,
    segments,
    texts,
    meta: { docName: 'Ведомость линий сети', ...meta },
    seg,
    rect,
    text,
  });

  return { name: sheet.name, w: sheet.w, h: sheet.h, scale: 1, segments, texts };
}

export const SPEC_SHEET_INTERNAL = { COLUMNS, TABLE_W };
