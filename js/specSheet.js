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
const ROW_H = 7; // высота строки данных
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

/**
 * Подбирает наименьший стандартный формат, в который по ширине влезает таблица,
 * и считает, сколько строк данных помещается на одну страницу при штатной
 * высоте строки ROW_H. Высота строк больше не ужимается до нечитаемости —
 * лишние строки переносятся на следующие листы (см. buildSpecSheets).
 */
function choosePageFormat() {
  for (const sheet of SHEETS) {
    if (TABLE_W <= sheet.w - FRAME.left - FRAME.right) {
      const avail = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - TABLE_GAP - HEADING_H;
      const rowsPerPage = Math.max(1, Math.floor((avail - HEADER_H) / ROW_H));
      return { sheet, rowsPerPage };
    }
  }
  // Таблица шире любого формата (теоретически недостижимо при текущих столбцах) —
  // берём самый крупный и всё равно нарезаем по строкам.
  const sheet = SHEETS[SHEETS.length - 1];
  const avail = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - TABLE_GAP - HEADING_H;
  return { sheet, rowsPerPage: Math.max(1, Math.floor((avail - HEADER_H) / ROW_H)) };
}

/** Отрисовывает один лист ведомости с заданным набором строк и номером листа. */
function renderSpecPage(sheet, pageRows, meta, pageNo, totalPages) {
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

  // Заголовок ведомости над таблицей (на многостраничной — с пометкой листа).
  const heading = totalPages > 1
    ? `Ведомость линий питающей сети (лист ${pageNo} из ${totalPages})`
    : 'Ведомость линий питающей сети';
  text(FRAME.left, FRAME.top + 4, heading, 3.5, 'left', 'middle', 'TEXT');

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
  const tableBottom = tableY + HEADER_H + pageRows.length * ROW_H;

  // Внешняя рамка таблицы и вертикали столбцов.
  rect(tableX, tableY, TABLE_W, HEADER_H + pageRows.length * ROW_H, 0.5, 'TABLE');
  for (let i = 1; i < COLUMNS.length; i += 1) seg(colX[i], tableY, colX[i], tableBottom, 0.25, 'TABLE');

  // Горизонталь под заголовком (потолще) и линии между строками данных.
  seg(tableX, tableY + HEADER_H, tableRight, tableY + HEADER_H, 0.5, 'TABLE');
  for (let r = 1; r < pageRows.length; r += 1) {
    const y = tableY + HEADER_H + r * ROW_H;
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

  // Заголовки столбцов — повторяются на каждом листе.
  const headerCy = tableY + HEADER_H / 2;
  COLUMNS.forEach((col, i) => cellText(col, i, col.title, headerCy, 2.4));

  // Строки данных.
  const cellH = Math.min(2.6, ROW_H - 1.5);
  pageRows.forEach((row, r) => {
    const cy = tableY + HEADER_H + r * ROW_H + ROW_H / 2;
    COLUMNS.forEach((col, i) => cellText(col, i, row[col.key], cy, cellH));
  });

  addTitleBlock({
    sheet,
    scale: 1,
    segments,
    texts,
    meta: { docName: 'Ведомость линий сети', ...meta, sheet: pageNo, sheets: totalPages },
    seg,
    rect,
    text,
  });

  return { name: sheet.name, w: sheet.w, h: sheet.h, scale: 1, segments, texts };
}

/**
 * Строит ведомость линий сети как один или несколько листов: строки, не
 * умещающиеся на лист при штатной высоте строки, переносятся на следующий лист
 * (с повтором заголовков столбцов и сквозной нумерацией «Лист N / Листов M»).
 * @param {object} tree  корневой узел сети (как в network.js)
 * @param {object} meta   { title, date, designation, author }
 * @returns {Array<{ name, w, h, scale, segments, texts }>}
 */
export function buildSpecSheets(tree, meta = {}) {
  const rows = buildSpecRows(tree);
  const { sheet, rowsPerPage } = choosePageFormat();
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage));

  const pages = [];
  for (let p = 0; p < totalPages; p += 1) {
    const pageRows = rows.slice(p * rowsPerPage, (p + 1) * rowsPerPage);
    pages.push(renderSpecPage(sheet, pageRows, meta, p + 1, totalPages));
  }
  return pages;
}

/**
 * Совместимость: возвращает первый лист ведомости. Новый код использует
 * buildSpecSheets() для полной (многостраничной) ведомости.
 */
export function buildSpecSheet(tree, meta = {}) {
  return buildSpecSheets(tree, meta)[0];
}

export const SPEC_SHEET_INTERNAL = { COLUMNS, TABLE_W, ROW_H };
