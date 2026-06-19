// Справочные таблицы допустимых токовых нагрузок кабелей и номинальных
// токов автоматических выключателей. Значения приближены к таблицам ПУЭ
// (двухжильные провода/кабели с ПВХ-изоляцией, прокладка в воздухе) и
// предназначены только для предварительной ориентировки.

export const CABLE_TABLE = [
  { section: 1.5, copper: 19, aluminum: null },
  { section: 2.5, copper: 27, aluminum: 20 },
  { section: 4, copper: 38, aluminum: 28 },
  { section: 6, copper: 46, aluminum: 36 },
  { section: 10, copper: 70, aluminum: 50 },
  { section: 16, copper: 85, aluminum: 60 },
  { section: 25, copper: 115, aluminum: 90 },
  { section: 35, copper: 135, aluminum: 105 },
  { section: 50, copper: 175, aluminum: 135 },
  { section: 70, copper: 215, aluminum: 165 },
  { section: 95, copper: 265, aluminum: 205 },
  { section: 120, copper: 310, aluminum: 240 },
  { section: 150, copper: 350, aluminum: 270 },
  { section: 185, copper: 405, aluminum: 310 },
  { section: 240, copper: 490, aluminum: 370 },
];

export const BREAKER_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400];

/** Наименьший стандартный номинал автомата, не меньший расчётного тока. */
export function selectBreaker(current) {
  return BREAKER_RATINGS.find((rating) => rating >= current) ?? null;
}

/** Наименьшее сечение кабеля, выдерживающее заданный ток, для конкретного материала жил. */
export function selectCable(current, material) {
  const row = CABLE_TABLE.find((r) => (r[material] ?? 0) >= current);
  return row ? { section: row.section, ratedCurrent: row[material] } : null;
}

/**
 * Подбирает автомат по расчётному току и кабели (медь/алюминий), способные
 * выдержать ток самого автомата — это гарантирует, что автомат защищает кабель.
 */
export function recommendProtection(current) {
  const breaker = selectBreaker(current);
  const target = breaker ?? current;
  return {
    current,
    breaker,
    copperCable: selectCable(target, 'copper'),
    aluminumCable: selectCable(target, 'aluminum'),
  };
}
