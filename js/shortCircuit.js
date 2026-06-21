// Приближённый расчёт тока короткого замыкания (КЗ) в сети напряжением до 1 кВ.
//
// Метод упрощённый и предназначен только для предварительной оценки:
// учитываются активные сопротивления трансформатора (через напряжение КЗ uк)
// и кабеля от источника до точки КЗ; индуктивные сопротивления, сопротивление
// дуги, переходные сопротивления контактов и параметры питающей сети выше
// трансформатора не учитываются. Для проектных решений ток КЗ рассчитывают
// по ГОСТ Р 50571.4.3 / методикам расчёта токов КЗ в электроустановках до 1 кВ.

// Удельное сопротивление жил, Ом·мм²/м (как в calculations.js / RESISTIVITY).
export const SC_RESISTIVITY = {
  copper: 0.0175,
  aluminum: 0.028,
};

/**
 * Эквивалентное сопротивление трансформатора, приведённое к стороне НН (Ом
 * на фазу): Zт = (uк/100) · Uл² / Sт. Полученное значение отражает, насколько
 * «жёсткий» источник питает сеть — чем мощнее трансформатор и ниже uк, тем
 * меньше Zт и больше ток КЗ.
 */
export function transformerImpedance({ ratedPowerKva, shortCircuitVoltagePercent, lineVoltage }) {
  if (!(ratedPowerKva > 0)) throw new Error('Мощность трансформатора должна быть больше нуля');
  if (!(shortCircuitVoltagePercent > 0)) throw new Error('Напряжение КЗ трансформатора должно быть больше нуля');
  if (!(lineVoltage > 0)) throw new Error('Напряжение должно быть больше нуля');
  const ratedPowerVa = ratedPowerKva * 1000;
  return (shortCircuitVoltagePercent / 100) * (lineVoltage * lineVoltage) / ratedPowerVa;
}

/** Активное сопротивление одной жилы кабеля (Ом): R = ρ · L / S. */
export function cableResistance({ length, section, material }) {
  if (!(length >= 0)) throw new Error('Длина линии не может быть отрицательной');
  if (!(section > 0)) throw new Error('Сечение кабеля должно быть больше нуля');
  const resistivity = SC_RESISTIVITY[material];
  if (!resistivity) throw new Error('Неизвестный материал жилы');
  return (resistivity * length) / section;
}

/**
 * Приближённый расчёт токов КЗ в конце кабельной линии.
 *
 * Трёхфазное КЗ (наибольший ток — для проверки отключающей способности
 * автомата Icu): Iкз(3) = Uф / (Zт + Rкаб), где Uф = Uл/√3.
 *
 * Однофазное КЗ «фаза–ноль» (наименьший ток — для проверки времени
 * автоматического отключения в системах TN): петля включает фазную и нулевую
 * жилы того же сечения, поэтому Iкз(1) = Uф / (Zт + 2·Rкаб). Это грубая оценка
 * снизу: реальное сопротивление петли «фаза–нуль/PE» зависит от сечения
 * защитного проводника и сопротивления нулевой обмотки трансформатора.
 */
export function calculateShortCircuit({
  lineVoltage,
  ratedPowerKva,
  shortCircuitVoltagePercent,
  length,
  section,
  material = 'copper',
}) {
  const zT = transformerImpedance({ ratedPowerKva, shortCircuitVoltagePercent, lineVoltage });
  const rCable = cableResistance({ length, section, material });
  const phaseVoltage = lineVoltage / Math.sqrt(3);
  const i3 = phaseVoltage / (zT + rCable);
  const i1 = phaseVoltage / (zT + 2 * rCable);
  return { zT, rCable, phaseVoltage, i3, i1 };
}

// Верхняя граница кратности тока срабатывания электромагнитного расцепителя
// для характеристик B/C/D (как BREAKER_CURVES в tables.js) — выше этого тока
// автомат гарантированно отключается мгновенно (< 0,1 с).
const CURVE_TRIP_MULTIPLIER = { B: 5, C: 10, D: 20 };

/**
 * Проверяет, обеспечит ли однофазный ток КЗ мгновенное срабатывание
 * электромагнитного расцепителя автомата (а значит, отключение заведомо
 * быстрее нормативных 0,4 с / 0,2 с для систем TN). Условие: Iкз(1) ≥ k·Iн,
 * где k — верхняя граница кратности характеристики B/C/D.
 */
export function checkDisconnectionByCurve({ singlePhaseCurrent, breakerRating, curve }) {
  const multiplier = CURVE_TRIP_MULTIPLIER[curve];
  if (!multiplier || !(breakerRating > 0) || !(singlePhaseCurrent > 0)) return null;
  const tripThreshold = multiplier * breakerRating;
  return { tripThreshold, ok: singlePhaseCurrent >= tripThreshold };
}

// Коэффициент термической стойкости жилы при КЗ (IEC 60364-4-43, табл. 43A /
// ГОСТ Р 50571.4.43, формула S = I·√t/k) для жил с ПВХ-изоляцией — той же, для
// которой даны допустимые токи в CABLE_TABLE (tables.js); приложение не
// различает типы изоляции, поэтому отдельной таблицы под XLPE/EPR здесь нет.
export const THERMAL_WITHSTAND_K = {
  copper: 115,
  aluminum: 76,
};

/**
 * Минимальное по термической стойкости при КЗ сечение жилы (мм²):
 * Sмин = Iкз·√t / k, где Iкз — ток КЗ (А), t — время отключения защитой (с),
 * k — коэффициент материала жилы (THERMAL_WITHSTAND_K). Приближение не
 * учитывает начальную температуру жилы перед КЗ (формула рассчитана на нагрев
 * от номинальной рабочей температуры до предельно допустимой при КЗ).
 */
export function minThermalSection({ current, time, material }) {
  const k = THERMAL_WITHSTAND_K[material];
  if (!k || !(current > 0) || !(time > 0)) return null;
  return (current * Math.sqrt(time)) / k;
}
