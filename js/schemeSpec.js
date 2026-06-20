// Сводная ведомость линий сети — построчная выгрузка дерева конструктора в
// CSV (открывается в Excel/LibreOffice): по одной строке на узел, с именем,
// нагрузкой, автоматом, кабелем и падением напряжения линии. В отличие от
// js/schemeLayout.js (геометрия однолинейной схемы), здесь не нужны координаты —
// только плоский список строк, поэтому модуль независим и от DOM, и от слоя
// раскладки, и проверяется обычными модульными тестами.

import { calculateTree } from './network.js';
import { formatPower, formatCurrent } from './format.js';

function cableLabel(protection) {
  if (!protection) return '';
  if (protection.copperCable) return `Cu ${protection.copperCable.section} мм²`;
  if (protection.aluminumCable) return `Al ${protection.aluminumCable.section} мм²`;
  return '';
}

function flatten(node, calc, depth, rows) {
  rows.push({ node, calc, depth });
  node.children.forEach((child, index) => flatten(child, calc.children[index], depth + 1, rows));
}

/** Строит плоский список строк ведомости по дереву узлов (пересчитывает дерево заново). */
export function buildSpecRows(tree) {
  const calcTree = calculateTree(tree);
  const flat = [];
  flatten(tree, calcTree, 0, flat);

  return flat.map(({ node, calc, depth }) => ({
    name: `${'— '.repeat(depth)}${node.name}`,
    voltage: calc.result?.voltage ?? node.voltage,
    power: calc.result ? formatPower(calc.result.P) : '',
    current: calc.result ? formatCurrent(calc.result.I) : '',
    breaker: calc.protection?.breaker ? `${calc.protection.breaker} А` : calc.protection ? 'вне диапазона' : '',
    curve: calc.protection?.recommendedCurve ?? '',
    cable: cableLabel(calc.protection),
    length: node.cableLength || '',
    voltageDrop: calc.voltageDrop ? `${calc.voltageDrop.dropPercent.toFixed(2)}%` : '',
    error: calc.error ?? '',
  }));
}

const HEADERS = [
  'Узел', 'U, В', 'P', 'I', 'Автомат', 'Характеристика', 'Кабель', 'Длина, м', 'ΔU', 'Ошибка',
];

function csvEscape(value) {
  const str = String(value ?? '');
  return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Сериализует ведомость в CSV (разделитель «;» — для прямого открытия в русской локали Excel). */
export function buildSpecCsv(tree) {
  const rows = buildSpecRows(tree);
  const lines = [
    HEADERS,
    ...rows.map((r) => [r.name, r.voltage, r.power, r.current, r.breaker, r.curve, r.cable, r.length, r.voltageDrop, r.error]),
  ];
  // BOM — чтобы Excel на Windows определил кодировку UTF-8 и не «съел» кириллицу.
  return `﻿${lines.map((line) => line.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}
