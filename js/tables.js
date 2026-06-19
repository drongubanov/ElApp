// Справочные таблицы допустимых токовых нагрузок кабелей и номинальных
// токов автоматических выключателей. Значения приближены к таблицам ПУЭ
// гл. 1.3 (двухжильные провода/кабели с ПВХ-изоляцией, базовая прокладка —
// одиночный кабель открыто в воздухе) и предназначены только для
// предварительной ориентировки. Способ прокладки и число кабелей рядом
// учитываются приближёнными поправочными коэффициентами.

export const CABLE_TABLE_SOURCE =
  'ПУЭ, 7-е издание, Глава 1.3 — допустимые длительные токовые нагрузки на провода и кабели ' +
  'с ПВХ-изоляцией с медными и алюминиевыми жилами';

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

export const INSTALLATION_METHODS = {
  AIR: 'air',
  CONDUIT: 'conduit',
  TRAY: 'tray',
};

export const INSTALLATION_LABELS = {
  [INSTALLATION_METHODS.AIR]: 'Открыто в воздухе',
  [INSTALLATION_METHODS.CONDUIT]: 'В трубе / кабель-канале / штукатурке',
  [INSTALLATION_METHODS.TRAY]: 'На лотке / в пучке',
};

// Приближённые поправочные коэффициенты к базовой таблице (одиночный
// кабель открыто в воздухе). Условные значения для предварительной
// оценки — для точного проектирования используйте полные таблицы ПУЭ
// гл. 1.3 (1.3.4–1.3.12) с учётом реальных условий прокладки.
const INSTALLATION_FACTORS = {
  [INSTALLATION_METHODS.AIR]: 1,
  [INSTALLATION_METHODS.CONDUIT]: 0.85,
  [INSTALLATION_METHODS.TRAY]: 0.9,
};

// Поправочный коэффициент на число кабелей, проложенных рядом друг с другом.
const GROUPING_FACTORS = [1, 0.9, 0.85, 0.8, 0.78, 0.75];

function groupingFactor(cableCount) {
  const count = Math.max(1, Math.round(cableCount || 1));
  return GROUPING_FACTORS[Math.min(count, GROUPING_FACTORS.length) - 1];
}

/**
 * Подбирает автомат по расчётному току и кабели (медь/алюминий), способные
 * выдержать ток самого автомата — это гарантирует, что автомат защищает кабель.
 * Учитывает приближённые поправочные коэффициенты на способ прокладки и
 * количество кабелей, проложенных рядом (см. INSTALLATION_FACTORS).
 */
export function recommendProtection(current, { installationMethod = INSTALLATION_METHODS.AIR, cableCount = 1 } = {}) {
  const methodFactor = INSTALLATION_FACTORS[installationMethod] ?? 1;
  const groupFactor = groupingFactor(cableCount);
  const correction = methodFactor * groupFactor;

  const breaker = selectBreaker(current);
  const target = (breaker ?? current) / correction;
  return {
    current,
    breaker,
    correction,
    copperCable: selectCable(target, 'copper'),
    aluminumCable: selectCable(target, 'aluminum'),
  };
}
