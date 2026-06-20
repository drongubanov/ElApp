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

// Стандартный ряд сечений жил (мм²) — берётся из таблицы допустимых токов.
export const STANDARD_SECTIONS = CABLE_TABLE.map((row) => row.section);

/**
 * Минимальное сечение защитного (PE) или совмещённого (PEN) проводника по
 * сечению фазного проводника S (ПУЭ-7, табл. 1.7.5 / ГОСТ Р 50571.5.54):
 *   S ≤ 16 мм²        → сечение PE равно фазному;
 *   16 < S ≤ 35 мм²   → сечение PE принимается 16 мм²;
 *   S > 35 мм²        → сечение PE не менее половины фазного.
 * Для S > 35 результат округляется вверх до ближайшего стандартного сечения.
 */
export function recommendPeSection(phaseSection) {
  if (!(phaseSection > 0)) return null;
  let minSection;
  if (phaseSection <= 16) minSection = phaseSection;
  else if (phaseSection <= 35) minSection = 16;
  else minSection = phaseSection / 2;
  return STANDARD_SECTIONS.find((section) => section >= minSection) ?? minSection;
}

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

// Кратность тока срабатывания электромагнитного расцепителя (отсечки) для
// стандартных характеристик автоматов по ГОСТ Р 50345 / IEC 60898 — указан
// верхний предел диапазона каждой характеристики (B: 3–5, C: 5–10, D: 10–20),
// т.е. максимальная кратность тока, которую расцепитель данной характеристики
// гарантированно не воспримет как короткое замыкание (только пусковой ток).
export const BREAKER_CURVES = { B: 5, C: 10, D: 20 };

/**
 * Подбирает наименее «острую» стандартную характеристику автомата (B/C/D),
 * при которой пусковой ток нагрузки не вызовет ложного срабатывания
 * электромагнитного расцепителя при пуске. Возвращает null, если пусковой
 * ток выходит за пределы даже характеристики D — нужен автомат со спец.
 * уставкой расцепителя или устройство плавного пуска/частотный преобразователь.
 */
export function recommendBreakerCurve(startCurrent, breakerRating) {
  if (!(startCurrent > 0) || !breakerRating) return null;
  const type = Object.keys(BREAKER_CURVES).find((key) => BREAKER_CURVES[key] * breakerRating >= startCurrent);
  return type ?? null;
}

/**
 * Подбирает автомат по расчётному току и кабели (медь/алюминий), способные
 * выдержать ток самого автомата — это гарантирует, что автомат защищает кабель.
 * Учитывает приближённые поправочные коэффициенты на способ прокладки и
 * количество кабелей, проложенных рядом (см. INSTALLATION_FACTORS).
 * Если передан пусковой ток нагрузки (startCurrent, например для
 * электродвигателя), дополнительно подбирает характеристику автомата (B/C/D),
 * устойчивую к этому пусковому току без ложного срабатывания.
 */
export function recommendProtection(
  current,
  { installationMethod = INSTALLATION_METHODS.AIR, cableCount = 1, startCurrent = null } = {},
) {
  const methodFactor = INSTALLATION_FACTORS[installationMethod] ?? 1;
  const groupFactor = groupingFactor(cableCount);
  const correction = methodFactor * groupFactor;

  const breaker = selectBreaker(current);
  const target = (breaker ?? current) / correction;
  const hasStartCurrent = startCurrent > 0 && breaker;
  const recommendedCurve = hasStartCurrent ? recommendBreakerCurve(startCurrent, breaker) : null;
  return {
    current,
    breaker,
    correction,
    copperCable: selectCable(target, 'copper'),
    aluminumCable: selectCable(target, 'aluminum'),
    startCurrent: startCurrent > 0 ? startCurrent : null,
    recommendedCurve,
    curveOverRange: hasStartCurrent && recommendedCurve === null,
  };
}

// Приближённое практическое правило токовой селективности пары автоматов
// без использования времятоковых характеристик конкретных производителей.
export const SELECTIVITY_SAFE_RATIO = 2;

/**
 * Проверяет токовую селективность вышестоящего автомата по отношению к
 * нижестоящим: если его номинал не менее чем в SELECTIVITY_SAFE_RATIO раз
 * больше наибольшего номинала нижестоящих линий — селективность считается
 * обеспеченной по приближённому правилу. Это упрощённая оценка: полную
 * проверку выполняйте по времятоковым характеристикам аппаратов конкретного
 * производителя (зависит также от типов характеристик B/C/D и наличия
 * выдержки времени у вышестоящего аппарата).
 */
export function checkSelectivity(upstreamBreaker, downstreamBreakers = []) {
  const values = downstreamBreakers.filter((b) => b != null && b > 0);
  if (!upstreamBreaker || !values.length) return null;
  const maxDownstream = Math.max(...values);
  const ratio = upstreamBreaker / maxDownstream;
  const level = ratio >= SELECTIVITY_SAFE_RATIO ? 'selective' : ratio > 1 ? 'uncertain' : 'not-selective';
  return { ratio, maxDownstream, level };
}
