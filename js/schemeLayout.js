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
    ? `Cu ${calc.protection.copperCable.section} мм2`
    : calc.protection.aluminumCable
      ? `Al ${calc.protection.aluminumCable.section} мм2`
      : null;
  if (cable) lines.push(cable);
  return lines;
}

function computeWidths(node, widths) {
  if (!node.children.length) {
    widths.set(node.id, BOX_W);
    return BOX_W;
  }
  const sum = node.children.reduce((acc, child) => acc + computeWidths(child, widths), 0) + H_GAP * (node.children.length - 1);
  const width = Math.max(sum, BOX_W);
  widths.set(node.id, width);
  return width;
}

function place(node, left, top, widths, calcMap, boxes, edges) {
  const width = widths.get(node.id);
  const cx = left + width / 2;
  const calc = calcMap.get(node.id);
  boxes.push({
    id: node.id,
    x: cx - BOX_W / 2,
    y: top,
    w: BOX_W,
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
    place(child, childLeft, childTop, widths, calcMap, boxes, edges);
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
 */
export function buildSchemeLayout(tree) {
  const calcTree = calculateTree(tree);
  const calcMap = new Map();
  flattenCalc(calcTree, calcMap);

  const widths = new Map();
  computeWidths(tree, widths);

  const boxes = [];
  const edges = [];
  place(tree, 0, 0, widths, calcMap, boxes, edges);

  const width = Math.max(...boxes.map((b) => b.x + b.w));
  const height = Math.max(...boxes.map((b) => b.y + b.h));

  return { boxes, edges, width, height, hasErrors: boxes.some((b) => b.hasError) };
}
