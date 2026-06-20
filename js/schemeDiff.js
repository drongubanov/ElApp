// Сравнение двух версий схемы сети: что изменилось в расчётных величинах
// (активная мощность P, расчётный ток I, номинал автомата) по каждому узлу, а
// также какие узлы добавлены/удалены. Узлы сопоставляются по их id (он не
// меняется при редактировании и переносе узла, а у копий — новый), поэтому diff
// отражает эволюцию одной и той же схемы между сохранёнными версиями. Модуль
// независим от DOM и проверяется модульными тестами; форматирование значений —
// на стороне UI.

import { calculateTree } from './network.js';

function flatten(calcNode, map) {
  map.set(calcNode.id, calcNode);
  calcNode.children.forEach((child) => flatten(child, map));
  return map;
}

// Поля сравниваются с допуском, чтобы числовой шум с плавающей точкой не
// выдавался за изменение (номинал автомата дискретен — сравнивается точно).
const FIELD_EPS = { P: 0.5, I: 0.05 };

/**
 * @param {object} treeA  исходная версия схемы (корневой узел)
 * @param {object} treeB  сравниваемая версия схемы (корневой узел)
 * @returns {{ added: Array, removed: Array, changed: Array }}
 *   added/removed: [{ id, name }]; changed: [{ id, name, fields: [{ key, from, to }] }]
 */
export function diffSchemes(treeA, treeB) {
  const a = flatten(calculateTree(treeA), new Map());
  const b = flatten(calculateTree(treeB), new Map());

  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, na] of a) {
    if (!b.has(id)) removed.push({ id, name: na.name });
  }

  for (const [id, nb] of b) {
    const na = a.get(id);
    if (!na) {
      added.push({ id, name: nb.name });
      continue;
    }

    const fields = [];
    const pushNum = (key, from, to) => {
      const f = from ?? null;
      const t = to ?? null;
      if (f == null && t == null) return;
      if (f == null || t == null || Math.abs(f - t) > FIELD_EPS[key]) fields.push({ key, from: f, to: t });
    };

    pushNum('P', na.result?.P, nb.result?.P);
    pushNum('I', na.result?.I, nb.result?.I);

    const breakerFrom = na.protection?.breaker ?? null;
    const breakerTo = nb.protection?.breaker ?? null;
    if (breakerFrom !== breakerTo) fields.push({ key: 'breaker', from: breakerFrom, to: breakerTo });

    // Появление/исчезновение ошибки расчёта в узле — тоже значимое изменение.
    const errorFrom = na.error ?? null;
    const errorTo = nb.error ?? null;
    if ((errorFrom == null) !== (errorTo == null)) fields.push({ key: 'error', from: errorFrom, to: errorTo });

    if (fields.length) changed.push({ id, name: nb.name, fields });
  }

  return { added, removed, changed };
}

/** Есть ли вообще различия между версиями. */
export function hasDiff(diff) {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
