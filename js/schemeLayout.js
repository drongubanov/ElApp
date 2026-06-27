// Преобразует дерево узлов конструктора сети в геометрическую модель
// однолинейной электрической схемы: прямоугольники щитов/нагрузок и
// соединяющие их линии с подписями автомата и кабеля, в физических
// координатах (мм). Не зависит от формата экспорта (PDF/DXF) и от DOM —
// поэтому проверяется обычными модульными тестами.

import { calculateTree } from './network.js';
import { NETWORK_TYPES } from './calculations.js';
import { formatPower, formatCurrent } from './format.js';

export const BOX_W = 56;
export const BOX_H = 24;
const H_GAP = 16;
const V_GAP = 28;
const BOX_W_MAX = 120; // верхний предел ширины блока — очень длинные названия усекаются масштабом, а не растягивают лист бесконечно
const BOX_PAD = 6; // суммарный горизонтальный отступ текста от границ блока, мм

// Оценка ширины блока (мм) по самой длинной его подписи, чтобы длинное название
// щита не вылезало за рамку блока. Текст в блоке schemeSheet рисует высотой
// ≈2,4 мм (первая строка — название — чуть крупнее), средняя ширина символа
// шрифта Arial ≈0,52 высоты; берётся наибольшая строка плюс отступы, но не уже
// базовой ширины BOX_W и не шире BOX_W_MAX. Та же модель размера, что и при
// отрисовке листа, поэтому блок и его текст масштабируются согласованно.
function boxWidthForLines(lines) {
  const estimate = (line, fontH) => line.length * fontH * 0.58 + BOX_PAD;
  let width = BOX_W;
  lines.forEach((line, idx) => {
    width = Math.max(width, estimate(line, idx === 0 ? 2.52 : 2.4));
  });
  return Math.min(width, BOX_W_MAX);
}

const NETWORK_TYPE_LABEL = {
  [NETWORK_TYPES.DC]: '⎓',
  [NETWORK_TYPES.AC1]: '1~',
  [NETWORK_TYPES.AC3]: '3~',
};

function nodeBoxLines(node, calc) {
  const lines = [node.name, `${NETWORK_TYPE_LABEL[node.networkType] ?? ''} ${node.voltage} В`];
  if (calc?.error) {
    lines.push('ошибка расчёта');
  } else if (calc?.result) {
    lines.push(`P=${formatPower(calc.result.P)}; I=${formatCurrent(calc.result.I)}`);
  }
  return lines;
}

function edgeLines(calc) {
  if (!calc || calc.error || !calc.protection) return [];
  const lines = [calc.protection.breaker ? `QF ${calc.protection.breaker} А` : 'QF — вне диапазона'];
  const cable = calc.protection.copperCable
    ? `Cu ${calc.protection.copperCable.section} мм²`
    : calc.protection.aluminumCable
      ? `Al ${calc.protection.aluminumCable.section} мм²`
      : null;
  if (cable) lines.push(cable);
  return lines;
}

// Ширина поддерева (для раскладки) считается с учётом фактической ширины блока
// узла (boxWidths), а не фиксированной BOX_W — иначе широкие блоки с длинными
// названиями накладывались бы на соседей.
function computeWidths(node, widths, boxWidths) {
  const boxW = boxWidths.get(node.id);
  if (!node.children.length) {
    widths.set(node.id, boxW);
    return boxW;
  }
  const sum = node.children.reduce((acc, child) => acc + computeWidths(child, widths, boxWidths), 0) + H_GAP * (node.children.length - 1);
  const width = Math.max(sum, boxW);
  widths.set(node.id, width);
  return width;
}

function place(node, left, top, widths, boxWidths, calcMap, boxes, edges) {
  const width = widths.get(node.id);
  const cx = left + width / 2;
  const boxW = boxWidths.get(node.id);
  const calc = calcMap.get(node.id);
  boxes.push({
    id: node.id,
    x: cx - boxW / 2,
    y: top,
    w: boxW,
    h: BOX_H,
    lines: nodeBoxLines(node, calc),
    hasError: Boolean(calc?.error),
  });

  let childLeft = left;
  const childTop = top + BOX_H + V_GAP;
  const midY = top + BOX_H + V_GAP / 2;
  node.children.forEach((child) => {
    const childWidth = widths.get(child.id);
    const childCx = childLeft + childWidth / 2;
    place(child, childLeft, childTop, widths, boxWidths, calcMap, boxes, edges);
    edges.push({
      points: [
        { x: cx, y: top + BOX_H },
        { x: cx, y: midY },
        { x: childCx, y: midY },
        { x: childCx, y: childTop },
      ],
      lines: edgeLines(calcMap.get(child.id)),
      // Подпись (автомат/кабель) — справа от вертикального спуска к блоку,
      // ниже горизонтальной линии, чтобы не пересекаться с ней.
      labelX: childCx + 2,
      labelY: midY + (childTop - midY) * 0.35,
    });
    childLeft += childWidth + H_GAP;
  });
}

function flattenCalc(calcNode, map) {
  map.set(calcNode.id, calcNode);
  calcNode.children.forEach((child) => flattenCalc(child, map));
}

/**
 * Строит геометрию однолинейной схемы по дереву узлов конструктора сети.
 * Расчёт (calculateTree) выполняется заново при каждом построении, поэтому
 * экспорт всегда отражает актуальные параметры узлов, даже если пользователь
 * не нажимал «Рассчитать сеть». Исходное дерево не модифицируется.
 *
 * Помимо связей между узлом и его дочерними узлами, схема дополнительно
 * показывает вводную линию, питающую корневой щит (ВРУ) от внешней сети —
 * короткий отрезок над его блоком с тем же подписями автомата и кабеля, что
 * и у остальных связей. Автомат и кабель для него берутся из расчёта самого
 * корневого узла: calculateNode/calculateTree уже подбирают их по суммарному
 * току всего дерева (собственная нагрузка ВРУ, если есть, плюс нагрузка всех
 * дочерних узлов с учётом коэффициента одновременности) — здесь это значение
 * просто визуализируется на схеме, а не пересчитывается.
 */
export function buildSchemeLayout(tree) {
  const calcTree = calculateTree(tree);
  const calcMap = new Map();
  flattenCalc(calcTree, calcMap);

  // Фактическая ширина каждого блока — по его подписям (название/параметры),
  // чтобы длинные названия щитов не вылезали за рамку блока.
  const boxWidths = new Map();
  const collectBoxWidths = (node) => {
    boxWidths.set(node.id, boxWidthForLines(nodeBoxLines(node, calcMap.get(node.id))));
    node.children.forEach(collectBoxWidths);
  };
  collectBoxWidths(tree);

  const widths = new Map();
  computeWidths(tree, widths, boxWidths);

  const boxes = [];
  const edges = [];
  place(tree, 0, V_GAP, widths, boxWidths, calcMap, boxes, edges);

  const root = boxes[0];
  const rootCx = root.x + root.w / 2;
  edges.push({
    points: [
      { x: rootCx, y: 0 },
      { x: rootCx, y: root.y },
    ],
    lines: ['Вводной кабель', ...edgeLines(calcMap.get(tree.id))],
    labelX: rootCx + 2,
    labelY: root.y * 0.3,
  });

  const width = Math.max(...boxes.map((b) => b.x + b.w));
  const height = Math.max(...boxes.map((b) => b.y + b.h));

  return { boxes, edges, width, height, hasErrors: boxes.some((b) => b.hasError) };
}
