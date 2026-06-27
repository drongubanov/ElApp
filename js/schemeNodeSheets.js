// Превращает дерево сети в НАБОР листов однолинейных схем — по листу на каждый
// щит (узел с отходящими линиями): геометрию каждого щита (js/schemeNodeDiagram.js)
// вписывает в стандартный формат (A4…A1, ГОСТ 2.301) с рамкой и основной
// надписью (ГОСТ 2.104), как и одиночный лист в js/schemeSheet.js. Номера листов
// сквозные, у подчинённых щитов в схеме вышестоящего проставляется ссылка
// «см. лист N». Результат — массив листов { name, w, h, scale, segments, texts },
// который напрямую принимают экспортеры PDF (js/exportPdf.js, js/vectorPdf.js).
// Модуль не зависит от DOM и проверяется модульными тестами.

import { calculateTree } from './network.js';
import { buildNodeDiagram } from './schemeNodeDiagram.js';
import { addTitleBlock, SHEET_INTERNAL } from './schemeSheet.js';

const { FRAME, TITLE_H, SHEETS } = SHEET_INTERNAL;
const SCHEME_GAP = 6; // зазор между полем схемы и основной надписью

function flatten(calcNode, map) {
  map.set(calcNode.id, calcNode);
  calcNode.children.forEach((c) => flatten(c, map));
}

// Собирает узлы-щиты (с отходящими линиями) в порядке обхода сверху вниз.
// Корень включается всегда (даже без дочерних — будет лист с пометкой об
// отсутствии отходящих линий), чтобы экспорт никогда не оказывался пустым.
function collectPanelNodes(root) {
  const panels = [];
  const walk = (node, isRoot) => {
    if (isRoot || (node.children?.length ?? 0) > 0) panels.push({ node, isRoot });
    (node.children ?? []).forEach((child) => walk(child, false));
  };
  walk(root, true);
  return panels;
}

function chooseSheet(diagram) {
  let fallback = null;
  for (const sheet of SHEETS) {
    const iw = sheet.w - FRAME.left - FRAME.right;
    const ih = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - SCHEME_GAP;
    const fit = Math.min(iw / Math.max(diagram.width, 1), ih / Math.max(diagram.height, 1));
    if (fit >= 1) return { sheet, scale: Math.min(fit, 1) };
    fallback = { sheet, scale: fit };
  }
  return fallback;
}

function scaleLabel(scale) {
  if (scale >= 0.999) return '1:1';
  const denom = 1 / scale;
  return `1:${denom >= 10 ? Math.round(denom) : denom.toFixed(1)}`;
}

function renderPanelSheet(diagram, meta, pageNo, totalPages, panelTitle) {
  const { sheet, scale } = chooseSheet(diagram);
  const segments = [];
  const texts = [];
  const seg = (x1, y1, x2, y2, weight = 0.25, layer = 'SCHEME', color) => segments.push({ x1, y1, x2, y2, weight, layer, ...(color ? { color } : {}) });
  const rect = (x, y, w, h, weight, layer, color) => {
    seg(x, y, x + w, y, weight, layer, color);
    seg(x + w, y, x + w, y + h, weight, layer, color);
    seg(x + w, y + h, x, y + h, weight, layer, color);
    seg(x, y + h, x, y, weight, layer, color);
  };
  const text = (x, y, value, h, halign, valign, layer = 'TEXT', color) =>
    texts.push({ x, y, text: String(value), h, halign, valign, layer, ...(color ? { color } : {}) });

  // Рамка чертежа.
  rect(FRAME.left, FRAME.top, sheet.w - FRAME.left - FRAME.right, sheet.h - FRAME.top - FRAME.bottom, 0.7, 'FRAME');

  // Размещение схемы щита над основной надписью.
  const iw = sheet.w - FRAME.left - FRAME.right;
  const regionH = sheet.h - FRAME.top - FRAME.bottom - TITLE_H - SCHEME_GAP;
  const schemeW = diagram.width * scale;
  const schemeH = diagram.height * scale;
  const offX = FRAME.left + (iw - schemeW) / 2;
  const offY = FRAME.top + Math.max(0, (regionH - schemeH) / 2);
  const tx = (x) => offX + x * scale;
  const ty = (y) => offY + y * scale;

  diagram.segments.forEach((s) => seg(tx(s.x1), ty(s.y1), tx(s.x2), ty(s.y2), s.weight * Math.max(scale, 0.5), 'SCHEME', s.color));
  diagram.texts.forEach((t) =>
    text(tx(t.x), ty(t.y), t.text, Math.max(1.6, t.h * scale), t.halign, t.valign, 'TEXT', t.color),
  );

  // Легенда цветовой маркировки проводников (ГОСТ Р 50462 / ПУЭ) — в правом
  // верхнем углу поля чертежа, фиксированным размером (не масштабируется).
  if (diagram.conductors?.length) {
    const legendW = 34;
    const lx = sheet.w - FRAME.right - legendW - 2;
    let ly = FRAME.top + 4;
    text(lx, ly, 'Проводники:', 2.4, 'left', 'middle', 'TEXT');
    ly += 4.5;
    diagram.conductors.forEach((c) => {
      seg(lx, ly, lx + 6, ly, 0.9, 'SCHEME', c.color);
      text(lx + 8, ly, c.label, 2.4, 'left', 'middle', 'TEXT', c.color);
      ly += 4;
    });
  }

  addTitleBlock({
    sheet,
    scale,
    segments,
    texts,
    meta: {
      docName: 'Схема электрическая однолинейная',
      ...meta,
      title: panelTitle,
      sheet: pageNo,
      sheets: totalPages,
    },
    seg,
    rect,
    text,
  });

  return { name: sheet.name, w: sheet.w, h: sheet.h, scale, scaleLabel: scaleLabel(scale), segments, texts, title: panelTitle };
}

/**
 * Строит набор листов схем по щитам для всего дерева сети.
 * @param {object} tree   корневой узел сети (как в network.js)
 * @param {object} meta    { title, date, designation, author }
 * @returns {Array<{ name, w, h, scale, segments, texts, title }>}
 */
export function buildNodeSheets(tree, meta = {}) {
  const calcTree = calculateTree(tree);
  const calcMap = new Map();
  flatten(calcTree, calcMap);

  const panels = collectPanelNodes(tree);
  const sheetNoByNodeId = new Map();
  panels.forEach((p, i) => sheetNoByNodeId.set(p.node.id, i + 1));

  const total = panels.length;
  return panels.map((p, i) => {
    const diagram = buildNodeDiagram(
      { ...p.node, isRoot: p.isRoot },
      calcMap.get(p.node.id),
      calcMap,
      sheetNoByNodeId,
    );
    return renderPanelSheet(diagram, meta, i + 1, total, p.node.name);
  });
}

/**
 * Объединяет несколько листов в один «лист» для DXF: формат DXF не имеет
 * страниц, поэтому листы складываются стопкой сверху вниз с зазором, а рамки и
 * штампы каждого листа смещаются по Y. Получившуюся геометрию принимает buildDxf
 * как обычный одиночный лист (один файл со всеми схемами по щитам).
 * @param {Array} sheets  результат buildNodeSheets()
 * @param {number} [gap]   вертикальный зазор между листами, мм
 */
export function mergeSheetsForDxf(sheets, gap = 12) {
  if (!sheets.length) throw new Error('нет листов для DXF');
  const segments = [];
  const texts = [];
  let yOffset = 0;
  let maxW = 0;
  sheets.forEach((sheet) => {
    sheet.segments.forEach((s) => segments.push({ ...s, y1: s.y1 + yOffset, y2: s.y2 + yOffset }));
    sheet.texts.forEach((t) => texts.push({ ...t, y: t.y + yOffset }));
    maxW = Math.max(maxW, sheet.w);
    yOffset += sheet.h + gap;
  });
  return { name: 'multi', w: maxW, h: yOffset - gap, scale: 1, segments, texts };
}

export const NODE_SHEETS_INTERNAL = { collectPanelNodes, chooseSheet };
