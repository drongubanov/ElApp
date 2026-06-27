// Геометрия полноценной однолинейной схемы ОТДЕЛЬНОГО щита (узла с отходящими
// линиями): ввод с автоматическим выключателем и кабелем сверху, сборная шина,
// и отходящие линии — каждая со своим автоматом, маркой/сечением кабеля,
// обозначением (QF1, QF2…) и нагрузкой/назначением внизу. В отличие от
// js/schemeLayout.js (один блок-граф всего дерева), здесь на каждый щит — своя
// подробная схема с условными графическими обозначениями (УГО): прямоугольник
// с наклонной ручкой — автоматический выключатель, утолщённая горизонталь —
// шина, прямоугольник снизу — отходящая нагрузка или подчинённый щит.
//
// Возвращает чистую геометрию в миллиметрах (origin — верхний левый угол, ось Y
// вниз): { segments, texts, width, height }. Не зависит от DOM и формата
// экспорта — оформляется в лист в js/schemeNodeSheets.js и проверяется
// модульными тестами.

import { NETWORK_TYPES } from './calculations.js';
import { formatPower, formatCurrent } from './format.js';

const NETWORK_TYPE_LABEL = {
  [NETWORK_TYPES.DC]: '⎓',
  [NETWORK_TYPES.AC1]: '1~',
  [NETWORK_TYPES.AC3]: '3~',
};

// Размеры элементов схемы (мм).
const D = {
  pad: 6, // внешний отступ диаграммы
  headerH: 13, // блок заголовка щита сверху
  feederH: 20, // высота участка ввода (над шиной)
  busExtendLeft: 4, // вынос шины влево от ввода
  busExtendRight: 14, // вынос шины вправо от последней линии
  feederOffsetX: 10, // смещение ввода от левого края шины
  wayPitch: 48, // шаг отходящих линий
  wayDrop: 22, // длина вертикали отходящей линии до блока нагрузки
  brW: 6, // ширина символа автомата
  brH: 9, // высота символа автомата
  loadW: 42, // ширина блока нагрузки/подщита
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
 * @param {object} node      узел дерева (как в network.js), node.children — отходящие линии
 * @param {object} calc      результат расчёта этого узла (calcMap.get(node.id))
 * @param {Map}    calcMap   карта id→результат расчёта (для дочерних линий)
 * @param {Map}    [sheetNoByNodeId]  id подчинённого щита → номер его листа (для перекрёстной ссылки)
 * @returns {{ segments:Array, texts:Array, width:number, height:number }}
 */
export function buildNodeDiagram(node, calc, calcMap, sheetNoByNodeId = new Map()) {
  const segments = [];
  const texts = [];
  const seg = (x1, y1, x2, y2, weight = 0.35) => segments.push({ x1, y1, x2, y2, weight, layer: 'SCHEME' });
  const rect = (x, y, w, h, weight = 0.4) => {
    seg(x, y, x + w, y, weight);
    seg(x + w, y, x + w, y + h, weight);
    seg(x + w, y + h, x, y + h, weight);
    seg(x, y + h, x, y, weight);
  };
  const text = (x, y, value, h, halign = 'left', valign = 'middle') =>
    texts.push({ x, y, text: String(value), h, halign, valign, layer: 'TEXT' });

  // Символ автоматического выключателя: прямоугольник на вертикали с наклонной
  // «ручкой». cx — координата вертикали, cyTop — верх символа.
  const breaker = (cx, cyTop) => {
    rect(cx - D.brW / 2, cyTop, D.brW, D.brH, 0.4);
    seg(cx - D.brW / 2, cyTop + D.brH, cx + D.brW / 2, cyTop, 0.4);
  };

  const children = node.children ?? [];
  const n = children.length;

  const busY = D.pad + D.headerH + D.feederH;
  const firstWayX = D.pad + 24;
  const wayX = (i) => firstWayX + i * D.wayPitch;
  const busX0 = D.pad + 2;
  const busX1 = (n > 0 ? wayX(n - 1) : firstWayX) + D.busExtendRight;
  const feederX = busX0 + D.feederOffsetX;

  // --- Заголовок щита ---
  const phase = NETWORK_TYPE_LABEL[node.networkType] ?? '';
  text(D.pad, D.pad + 2, node.name, 3.4, 'left', 'middle');
  const sub = [`${phase} ${node.voltage} В`.trim()];
  if (calc?.result) sub.push(`P=${formatPower(calc.result.P)}  I=${formatCurrent(calc.result.I)}`);
  text(D.pad, D.pad + 8.5, sub.join('   •   '), 2.6, 'left', 'middle');

  // --- Ввод (питающая линия щита) ---
  const feederTopY = D.pad + D.headerH;
  text(feederX, feederTopY - 1.5, node.isRoot ? 'Ввод от сети' : 'Ввод от вышестоящего щита', 2.4, 'left', 'bottom');
  seg(feederX, feederTopY, feederX, busY, 0.5); // вертикаль ввода
  breaker(feederX, feederTopY + 4);
  const feederLabelX = feederX + D.brW / 2 + 3;
  text(feederLabelX, feederTopY + 5.5, breakerLabel(calc?.protection), 2.4, 'left', 'middle');
  const feederCable = cableLabel(calc?.protection);
  if (feederCable) text(feederLabelX, feederTopY + 9.5, feederCable, 2.4, 'left', 'middle');

  // --- Сборная шина ---
  seg(busX0, busY, busX1, busY, 0.9);

  // --- Отходящие линии ---
  children.forEach((child, i) => {
    const x = wayX(i);
    const childCalc = calcMap.get(child.id);
    const dropTop = busY;
    const dropBottom = busY + D.wayDrop;
    seg(x, dropTop, x, dropBottom, 0.5); // вертикаль отходящей линии
    breaker(x, dropTop + 3);

    // Подписи отходящей линии — справа от вертикали.
    const lx = x + D.brW / 2 + 2.5;
    text(lx, dropTop + 4.5, `QF${i + 1} ${childCalc?.protection?.breaker != null ? childCalc.protection.breaker + ' А' : '—'}`, 2.3, 'left', 'middle');
    const cable = cableLabel(childCalc?.protection);
    if (cable) text(lx, dropTop + 8, cable, 2.3, 'left', 'middle');

    // Блок назначения: подчинённый щит (со ссылкой на лист) или нагрузка (P, I).
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

  // Если у щита нет отходящих линий (только собственная нагрузка) — короткая
  // шина с пометкой, чтобы лист не выглядел пустым.
  if (n === 0) {
    text(firstWayX, busY + 8, 'Отходящих линий нет (только собственная нагрузка щита).', 2.4, 'left', 'middle');
  }

  const width = busX1 + D.pad;
  const height = busY + D.wayDrop + D.loadH + D.pad;
  return { segments, texts, width, height };
}

export const NODE_DIAGRAM_INTERNAL = { D, cableLabel, breakerLabel };
