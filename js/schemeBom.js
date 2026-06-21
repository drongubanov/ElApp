// Сводная спецификация оборудования (ведомость материалов, BOM) по дереву
// сети: в отличие от построчной ведомости линий (js/schemeSpec.js, одна строка
// на узел) здесь оборудование сгруппировано по типам и просуммировано —
// автоматические выключатели по номиналу и характеристике (сколько штук),
// кабели по материалу и сечению (суммарная длина и число линий). Это то, что
// нужно для закупки. Модуль независим от DOM и проверяется модульными тестами;
// визуальное представление и выгрузка в CSV — в app.js.

import { calculateTree } from './network.js';

// Какой кабель из подобранной пары (медь/алюминий) считать выбранным для
// спецификации — та же конвенция, что в chosenCable (network.js) и cableLabel
// (schemeSpec.js): по умолчанию медь, при её отсутствии — алюминий.
function chosenCable(protection) {
  if (protection?.copperCable) return { material: 'copper', section: protection.copperCable.section };
  if (protection?.aluminumCable) return { material: 'aluminum', section: protection.aluminumCable.section };
  return null;
}

/**
 * Агрегирует оборудование дерева сети в сводную спецификацию (пересчитывает
 * дерево заново). Учитываются только успешно рассчитанные узлы; узлы с ошибкой
 * расчёта или без подобранной защиты в суммы не попадают, но число последних
 * возвращается отдельно (unresolvedBreakers / unresolvedCables) — как напоминание,
 * что для них оборудование подобрать не удалось.
 *
 * Возвращает:
 *   breakers: [{ breaker, curve, count }]            — автоматы по номиналу+характеристике
 *   cables:   [{ material, section, count, totalLength }] — кабели по материалу+сечению
 *   unresolvedBreakers, unresolvedCables             — число линий без подбора
 */
export function buildBom(tree) {
  const calcTree = calculateTree(tree);
  const breakers = new Map();
  const cables = new Map();
  let unresolvedBreakers = 0;
  let unresolvedCables = 0;

  const walk = (node, calc) => {
    if (calc.result && !calc.error && calc.protection) {
      const p = calc.protection;
      if (p.breaker) {
        const curve = p.recommendedCurve ?? null;
        const key = `${p.breaker}|${curve ?? ''}`;
        const entry = breakers.get(key) ?? { breaker: p.breaker, curve, count: 0 };
        entry.count += 1;
        breakers.set(key, entry);
      } else {
        unresolvedBreakers += 1;
      }

      const cable = chosenCable(p);
      if (cable) {
        const key = `${cable.material}|${cable.section}`;
        const entry = cables.get(key) ?? { material: cable.material, section: cable.section, count: 0, totalLength: 0 };
        entry.count += 1;
        entry.totalLength += node.cableLength > 0 ? node.cableLength : 0;
        cables.set(key, entry);
      } else {
        unresolvedCables += 1;
      }
    }
    node.children.forEach((child, index) => walk(child, calc.children[index]));
  };

  walk(tree, calcTree);

  const breakerList = [...breakers.values()].sort(
    (a, b) => a.breaker - b.breaker || (a.curve ?? '').localeCompare(b.curve ?? ''),
  );
  const cableList = [...cables.values()].sort(
    (a, b) => a.material.localeCompare(b.material) || a.section - b.section,
  );

  return { breakers: breakerList, cables: cableList, unresolvedBreakers, unresolvedCables };
}

const MATERIAL_LABELS = { copper: 'Cu', aluminum: 'Al' };

/** Человекочитаемое наименование автомата для спецификации. */
export function breakerSpecLabel({ breaker, curve }) {
  return `Автомат ${breaker} А${curve ? ` (характеристика ${curve})` : ''}`;
}

/** Человекочитаемое наименование кабеля для спецификации. */
export function cableSpecLabel({ material, section }) {
  return `Кабель ${MATERIAL_LABELS[material] ?? material} ${section} мм²`;
}

const HEADERS = ['Раздел', 'Наименование', 'Кол-во', 'Ед.', 'Примечание'];

function csvEscape(value) {
  const str = String(value ?? '');
  return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Сериализует сводную спецификацию в CSV (разделитель «;» — для прямого
 * открытия в русской локали Excel; BOM в начале — чтобы определилась UTF-8).
 */
export function buildBomCsv(tree) {
  const { breakers, cables } = buildBom(tree);
  const lines = [HEADERS];

  breakers.forEach((b) => {
    lines.push(['Автоматические выключатели', breakerSpecLabel(b), b.count, 'шт.', '']);
  });
  cables.forEach((c) => {
    // Суммарная длина имеет смысл только если хотя бы у части линий задана длина;
    // число линий приводится в примечании всегда (полезно, даже когда длины не заданы).
    const note = `${c.count} ${c.count === 1 ? 'линия' : 'линии(й)'}`;
    lines.push(['Кабели', cableSpecLabel(c), c.totalLength, 'м', note]);
  });

  return `﻿${lines.map((line) => line.map(csvEscape).join(';')).join('\r\n')}\r\n`;
}
