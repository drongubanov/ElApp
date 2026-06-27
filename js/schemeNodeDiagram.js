// Геометрия полноценной однолинейной схемы ОТДЕЛЬНОГО щита (узла с отходящими
// линиями): ввод с автоматическим выключателем и кабелем сверху, сборная шина и
// отходящие линии — каждая со своим автоматом, маркой/сечением кабеля,
// обозначением (QF1, QF2…) и нагрузкой/назначением внизу. В отличие от
// js/schemeLayout.js (один блок-граф всего дерева), здесь на каждый щит — своя
// подробная схема с условными графическими обозначениями (УГО).
//
// Линии показываются «по проводам»: каждый проводник линии рисуется отдельной
// цветной жилой по ГОСТ Р 50462 / ПУЭ (3-фазная линия — L1, L2, L3, N, PE;
// однофазная — L, N, PE; см. js/conductors.js). Защитный проводник PE обходит
// автоматический выключатель (не коммутируется). Сборная шина изображается
// набором цветных баров (по одному на проводник шины).
//
// Возвращает чистую геометрию в миллиметрах (origin — верхний левый угол, ось Y
// вниз): { segments, texts, width, height, conductors }. segments/texts могут
// нести поле color (HEX) — экспортеры отрисовывают цвет, без color используется
// основной цвет (чёрный). Не зависит от DOM и формата экспорта.

import { NETWORK_TYPES } from './calculations.js';
import { formatPower, formatCurrent } from './format.js';
import { conductorsFor, mapConductorToBus } from './conductors.js';

const NETWORK_TYPE_LABEL = {
  [NETWORK_TYPES.DC]: '⎓',
  [NETWORK_TYPES.AC1]: '1~',
  [NETWORK_TYPES.AC3]: '3~',
};

// Размеры элементов схемы (мм).
const D = {
  pad: 6,
  headerH: 13,
  feederH: 22, // высота участка ввода (над шиной)
  condPitch: 1.8, // расстояние между жилами в пучке
  busExtendLeft: 4,
  busExtendRight: 16,
  feederOffsetX: 16,
  wayPitch: 50,
  wayDrop: 22, // длина отходящей линии от шины до блока нагрузки
  brH: 8, // высота символа автомата
  brPad: 1.6, // запас рамки автомата по бокам от крайних коммутируемых жил
  loadW: 44,
  loadH: 18,
};

function cableLabel(protection) {
  if (!protection) return null;
  if (protection.copperCable) return `Cu ${protection.copperCable.section} мм²`;
  if (protection.aluminumCable) return `Al ${protection.aluminumCable.section} мм²`;
  return null;
}

function breakerLabel(protection) {
  if (!protection || protection.breaker == null) return 'QF —';
  const curve = protection.recommendedCurve ? ` ${protection.recommendedCurve}` : '';
  return `QF${curve} ${protection.breaker} А`;
}

/**
 * Строит геометрию схемы одного щита.
 * @param {object} node      узел дерева (node.children — отходящие линии); node.isRoot — корневой ли
 * @param {object} calc      результат расчёта этого узла
 * @param {Map}    calcMap   карта id→результат расчёта (для дочерних линий)
 * @param {Map}    [sheetNoByNodeId]  id подчинённого щита → номер его листа
 * @returns {{ segments, texts, width, height, conductors }}
 */
export function buildNodeDiagram(node, calc, calcMap, sheetNoByNodeId = new Map()) {
  const segments = [];
  const texts = [];
  const seg = (x1, y1, x2, y2, weight = 0.35, color) => segments.push({ x1, y1, x2, y2, weight, layer: 'SCHEME', ...(color ? { color } : {}) });
  const rect = (x, y, w, h, weight = 0.4, color) => {
    seg(x, y, x + w, y, weight, color);
    seg(x + w, y, x + w, y + h, weight, color);
    seg(x + w, y + h, x, y + h, weight, color);
    seg(x, y + h, x, y, weight, color);
  };
  const text = (x, y, value, h, halign = 'left', valign = 'middle', color) =>
    texts.push({ x, y, text: String(value), h, halign, valign, layer: 'TEXT', ...(color ? { color } : {}) });

  const children = node.children ?? [];
  const n = children.length;

  // Проводники шины щита (по типу сети самого щита).
  const busConductors = conductorsFor(node.networkType);
  const busLabels = busConductors.map((c) => c.label);
  const busK = busConductors.length;
  const busBandH = (busK - 1) * D.condPitch;

  const busTopY = D.pad + D.headerH + D.feederH;
  const busBarY = (i) => busTopY + i * D.condPitch;
  const firstWayX = D.pad + 30;
  const wayX = (i) => firstWayX + i * D.wayPitch;
  const busX0 = D.pad + 2;
  const busX1 = (n > 0 ? wayX(n - 1) : firstWayX) + D.busExtendRight;
  const feederX = busX0 + D.feederOffsetX;

  // Символ автоматического выключателя поперёк коммутируемых жил (все, кроме PE):
  // прямоугольник с наклонной «ручкой». xs — массив x коммутируемых жил, cyTop — верх.
  const breaker = (xs, cyTop) => {
    if (!xs.length) return;
    const x0 = Math.min(...xs) - D.brPad;
    const x1 = Math.max(...xs) + D.brPad;
    rect(x0, cyTop, x1 - x0, D.brH, 0.4);
    seg(x0, cyTop + D.brH, x1, cyTop, 0.4);
  };

  // --- Заголовок щита ---
  const phase = NETWORK_TYPE_LABEL[node.networkType] ?? '';
  text(D.pad, D.pad + 2, node.name, 3.4, 'left', 'middle');
  const sub = [`${phase} ${node.voltage} В`.trim()];
  if (calc?.result) sub.push(`P=${formatPower(calc.result.P)}  I=${formatCurrent(calc.result.I)}`);
  text(D.pad, D.pad + 8.5, sub.join('   •   '), 2.6, 'left', 'middle');

  // --- Ввод (питающая линия щита) — пучок цветных жил сверху в шину ---
  const feederTopY = D.pad + D.headerH;
  text(feederX, feederTopY - 1.5, node.isRoot ? 'Ввод от сети' : 'Ввод от вышестоящего щита', 2.4, 'left', 'bottom');
  const feederStrandX = (i) => feederX + (i - (busK - 1) / 2) * D.condPitch;
  const feederSwitchedXs = [];
  busConductors.forEach((c, i) => {
    const sx = feederStrandX(i);
    seg(sx, feederTopY, sx, busBarY(i), 0.5, c.color); // жила ввода до своего бара шины
    if (!c.isPe) feederSwitchedXs.push(sx);
  });
  breaker(feederSwitchedXs, feederTopY + 5);
  const feederLabelX = Math.max(...busConductors.map((_, i) => feederStrandX(i))) + 3;
  text(feederLabelX, feederTopY + 6.5, breakerLabel(calc?.protection), 2.4, 'left', 'middle');
  const feederCable = cableLabel(calc?.protection);
  if (feederCable) text(feederLabelX, feederTopY + 10.5, feederCable, 2.4, 'left', 'middle');

  // --- Сборная шина: по цветному бару на каждый проводник ---
  busConductors.forEach((c, i) => seg(busX0, busBarY(i), busX1, busBarY(i), c.isPe ? 0.6 : 0.9, c.color));

  // --- Отходящие линии ---
  const usedConductors = new Map(); // label -> {label,color} для легенды
  busConductors.forEach((c) => usedConductors.set(c.label, c));

  children.forEach((child, j) => {
    const x = wayX(j);
    const childCalc = calcMap.get(child.id);
    const childConductors = conductorsFor(child.networkType);
    const ck = childConductors.length;
    childConductors.forEach((c) => usedConductors.set(c.label, c));

    const dropBottom = busTopY + busBandH + D.wayDrop;
    const strandX = (k) => x + (k - (ck - 1) / 2) * D.condPitch;
    const switchedXs = [];
    childConductors.forEach((c, k) => {
      const sx = strandX(k);
      const bi = mapConductorToBus(c.label, busLabels);
      seg(sx, busBarY(bi), sx, dropBottom, 0.5, c.color); // жила от своего бара шины вниз
      if (!c.isPe) switchedXs.push(sx);
    });
    breaker(switchedXs, busTopY + busBandH + 4);

    // Подписи отходящей линии — справа от пучка.
    const lx = Math.max(...childConductors.map((_, k) => strandX(k))) + 2.5;
    text(lx, busTopY + busBandH + 5, `QF${j + 1} ${childCalc?.protection?.breaker != null ? childCalc.protection.breaker + ' А' : '—'}`, 2.3, 'left', 'middle');
    const cable = cableLabel(childCalc?.protection);
    if (cable) text(lx, busTopY + busBandH + 8.5, cable, 2.3, 'left', 'middle');

    // Блок назначения.
    const boxX = x - D.loadW / 2;
    const boxY = dropBottom;
    rect(boxX, boxY, D.loadW, D.loadH, 0.4);
    const isPanel = (child.children?.length ?? 0) > 0;
    text(x, boxY + 4.5, child.name, 2.4, 'center', 'middle');
    if (isPanel) {
      const sheetNo = sheetNoByNodeId.get(child.id);
      text(x, boxY + 9, 'распределительный щит', 2.1, 'center', 'middle');
      text(x, boxY + 13.5, sheetNo ? `см. лист ${sheetNo}` : 'см. отдельный лист', 2.1, 'center', 'middle');
    } else if (childCalc?.result) {
      text(x, boxY + 9.5, `P=${formatPower(childCalc.result.P)}`, 2.2, 'center', 'middle');
      text(x, boxY + 13.5, `I=${formatCurrent(childCalc.result.I)}`, 2.2, 'center', 'middle');
    } else if (childCalc?.error) {
      text(x, boxY + 11, 'ошибка расчёта', 2.1, 'center', 'middle');
    }
  });

  if (n === 0) {
    text(firstWayX, busTopY + busBandH + 8, 'Отходящих линий нет (только собственная нагрузка щита).', 2.4, 'left', 'middle');
  }

  const width = busX1 + D.pad;
  const height = busTopY + busBandH + D.wayDrop + D.loadH + D.pad;
  // Проводники для легенды — в каноническом порядке.
  const order = ['L1', 'L2', 'L3', 'L', 'L+', 'L−', 'N', 'PE'];
  const conductors = [...usedConductors.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return { segments, texts, width, height, conductors };
}

export const NODE_DIAGRAM_INTERNAL = { D, cableLabel, breakerLabel };
