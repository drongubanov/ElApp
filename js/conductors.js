// Состав и цвета проводников линии для отображения на однолинейных схемах.
// Цвета — по ГОСТ Р 50462-2009 / ПУЭ п. 1.1.30 (буквенно-цветовая маркировка):
//   L1 (фаза A) — жёлтый, L2 (фаза B) — зелёный, L3 (фаза C) — красный,
//   N (нулевой рабочий) — голубой, PE (защитный) — жёлто-зелёный.
// Для однофазной линии фазный проводник L — коричневый (ГОСТ Р 50462 для жил
// кабелей), N — голубой, PE — жёлто-зелёный. Для сети постоянного тока —
// L+ (коричневый/красный) и L− (синий) плюс защитный PE.

import { NETWORK_TYPES } from './calculations.js';

export const CONDUCTOR_COLORS = {
  L1: '#E0B400', // жёлтый
  L2: '#1E8E3E', // зелёный
  L3: '#D23B3B', // красный
  L: '#8D5A2B', // коричневый (фаза однофазной линии)
  N: '#2F7BD6', // голубой
  PE: '#A6C000', // жёлто-зелёный (защитный)
  'L+': '#C0392B', // плюс (пост. ток)
  'L−': '#2F7BD6', // минус (пост. ток)
};

/**
 * Список проводников линии заданного типа сети — массив { label, color, isPe }
 * в порядке отображения. PE всегда последний и помечен isPe (защитный
 * проводник не коммутируется автоматом и на схеме обходит его).
 * @param {string} networkType  один из NETWORK_TYPES
 */
export function conductorsFor(networkType) {
  let labels;
  if (networkType === NETWORK_TYPES.AC3) labels = ['L1', 'L2', 'L3', 'N', 'PE'];
  else if (networkType === NETWORK_TYPES.DC) labels = ['L+', 'L−', 'PE'];
  else labels = ['L', 'N', 'PE']; // AC1 и значение по умолчанию
  return labels.map((label) => ({ label, color: CONDUCTOR_COLORS[label] ?? '#000000', isPe: label === 'PE' }));
}

// Сопоставляет проводник отходящей линии проводнику (бару) сборной шины щита:
// фаза однофазной линии 'L' подключается к первой фазе трёхфазной шины (L1),
// остальные — по совпадению обозначения; если точного совпадения нет — к первому.
export function mapConductorToBus(label, busLabels) {
  if (busLabels.includes(label)) return busLabels.indexOf(label);
  if (label === 'L') {
    const firstPhase = busLabels.findIndex((b) => b === 'L1' || b === 'L');
    return firstPhase >= 0 ? firstPhase : 0;
  }
  if (label === 'L1') {
    const l = busLabels.indexOf('L');
    if (l >= 0) return l;
  }
  return 0;
}
