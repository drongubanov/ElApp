// Превращает логическую геометрию схемы (js/schemeLayout.js) в оформленный
// лист чертежа: подбирает стандартный формат (A4…A1, ГОСТ 2.301), вписывает
// схему, добавляет рамку с полями и упрощённую основную надпись (ГОСТ 2.104,
// форма 1). Результат — набор отрезков и текстов в миллиметрах (начало
// координат — верхний левый угол, ось Y вниз). Модуль не зависит от DOM и от
// формата экспорта, поэтому одинаково используется для PDF и DXF и
// проверяется модульными тестами.

// Поля рамки по ГОСТ 2.301: слева 20 мм (для подшивки), с остальных сторон 5 мм.
const FRAME = { left: 20, top: 5, right: 5, bottom: 5 };
// Основная надпись (ГОСТ 2.104, форма 1) — 185×55 мм.
const TITLE_W = 185;
const TITLE_H = 55;
const SCHEME_GAP = 6; // зазор между полем схемы и основной надписью

// Горизонтальные форматы по ГОСТ 2.301 (мм).
const SHEETS = [
  { name: 'A4', w: 297, h: 210 },
  { name: 'A3', w: 420, h: 297 },
  { name: 'A2', w: 594, h: 420 },
  { name: 'A1', w: 841, h: 594 },
];

function chooseSheet(layout) {
  let fallback = null;
  for (const sheet of SHEETS) {
    const iw = sheet.w - FRAME.left - FRAME.right;
    const ih = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - SCHEME_GAP;
    const fit = Math.min(iw / Math.max(layout.width, 1), ih / Math.max(layout.height, 1));
    if (fit >= 1) return { sheet, scale: 1 };
    fallback = { sheet, scale: fit };
  }
  return fallback; // самый крупный формат — схема вписывается с уменьшением
}

function scaleLabel(scale) {
  if (scale >= 0.999) return '1:1';
  const denom = 1 / scale;
  return `1:${denom >= 10 ? Math.round(denom) : denom.toFixed(1)}`;
}

/**
 * @param {object} layout  результат buildSchemeLayout()
 * @param {object} meta     { title, docName, designation, date, sheet, sheets, author }
 */
export function buildSheet(layout, meta = {}) {
  const { sheet, scale } = chooseSheet(layout);
  const segments = [];
  const texts = [];

  const seg = (x1, y1, x2, y2, weight = 0.25, layer = 'SCHEME') =>
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

  // Размещение схемы в свободном поле над основной надписью.
  const iw = sheet.w - FRAME.left - FRAME.right;
  const regionH = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - SCHEME_GAP;
  const schemeW = layout.width * scale;
  const schemeH = layout.height * scale;
  const offX = FRAME.left + (iw - schemeW) / 2;
  const offY = FRAME.top + Math.max(0, (regionH - schemeH) / 2);
  const tx = (x) => offX + x * scale;
  const ty = (y) => offY + y * scale;

  // Линии (кабельные связи) — рисуем под блоками.
  const edgeTextH = Math.max(1.6, 2.0 * scale);
  layout.edges.forEach((edge) => {
    for (let i = 0; i < edge.points.length - 1; i += 1) {
      const a = edge.points[i];
      const b = edge.points[i + 1];
      seg(tx(a.x), ty(a.y), tx(b.x), ty(b.y), 0.35, 'SCHEME');
    }
    edge.lines.forEach((line, idx) => {
      text(tx(edge.labelX), ty(edge.labelY) + idx * edgeTextH * 1.3, line, edgeTextH, 'left', 'middle');
    });
  });

  // Блоки узлов.
  const boxTextH = Math.max(1.8, 2.4 * scale);
  layout.boxes.forEach((box) => {
    rect(tx(box.x), ty(box.y), box.w * scale, box.h * scale, 0.5, 'SCHEME');
    const cx = tx(box.x + box.w / 2);
    const cy = ty(box.y + box.h / 2);
    const lineH = boxTextH * 1.35;
    const startY = cy - ((box.lines.length - 1) * lineH) / 2;
    box.lines.forEach((line, idx) => {
      text(cx, startY + idx * lineH, line, idx === 0 ? boxTextH * 1.05 : boxTextH, 'center', 'middle');
    });
  });

  addTitleBlock({ sheet, scale, segments, texts, meta, seg, rect, text });

  return { name: sheet.name, w: sheet.w, h: sheet.h, scale, segments, texts };
}

function addTitleBlock({ sheet, scale, meta, seg, rect, text }) {
  const bw = TITLE_W;
  const bh = TITLE_H;
  const bx = sheet.w - FRAME.right - bw;
  const by = sheet.h - FRAME.bottom - bh;
  const L = 'TITLE';

  rect(bx, by, bw, bh, 0.7, L);

  // Граница между графами слева (штамп исполнителей) и областью наименования.
  const nameX = bx + 65;
  seg(nameX, by, nameX, by + bh, 0.5, L);

  // Левый штамп: строки «Разраб./Пров./…» и колонки (изм/лист/№докум/подп/дата).
  const leftCols = [7, 17, 40, 55]; // вертикали внутри штампа
  leftCols.forEach((dx) => seg(bx + dx, by, bx + dx, by + bh, 0.25, L));
  const stampRows = [5, 10, 15, 35, 40, 45, 50];
  stampRows.forEach((dy) => seg(bx, by + dy, nameX, by + dy, 0.25, L));
  text(bx + 8.5, by + 17.5, 'Разраб.', 2.2, 'left', 'middle', L);
  text(bx + 8.5, by + 22.5, 'Пров.', 2.2, 'left', 'middle', L);
  text(bx + 8.5, by + 47.5, 'Н.контр.', 2.2, 'left', 'middle', L);
  text(bx + 28, by + 17.5, meta.author || '', 2.2, 'center', 'middle', L);

  // Область наименования: верх — название изделия/схемы, низ — служебные графы.
  seg(nameX, by + 30, bx + bw, by + 30, 0.5, L);
  seg(nameX, by + 40, bx + bw, by + 40, 0.25, L);

  const title = meta.title || 'Схема электрическая';
  const docName = meta.docName || 'Однолинейная схема';
  text((nameX + bx + bw) / 2, by + 11, title, 3.5, 'center', 'middle', L);
  text((nameX + bx + bw) / 2, by + 22, docName, 3.0, 'center', 'middle', L);

  // Нижние графы: Стадия | Лист | Листов, ниже — Масштаб и обозначение.
  const c1 = nameX + 40;
  const c2 = nameX + 80;
  seg(c1, by + 30, c1, by + 40, 0.25, L);
  seg(c2, by + 30, c2, by + 40, 0.25, L);
  text(nameX + 20, by + 32.5, 'Стадия', 2.0, 'center', 'middle', L);
  text(c1 + 20, by + 32.5, 'Лист', 2.0, 'center', 'middle', L);
  text(c2 + 20, by + 32.5, 'Листов', 2.0, 'center', 'middle', L);
  text(nameX + 20, by + 37, 'Р', 2.8, 'center', 'middle', L);
  text(c1 + 20, by + 37, String(meta.sheet ?? 1), 2.8, 'center', 'middle', L);
  text(c2 + 20, by + 37, String(meta.sheets ?? 1), 2.8, 'center', 'middle', L);

  seg(c1, by + 40, c1, by + bh, 0.25, L);
  text(nameX + 20, by + 47.5, `Масштаб ${scaleLabel(scale)}`, 2.5, 'center', 'middle', L);
  text(c1 + 40, by + 47.5, meta.designation || 'ElApp', 2.5, 'center', 'middle', L);
}

export const SHEET_INTERNAL = { FRAME, TITLE_W, TITLE_H, SHEETS };
