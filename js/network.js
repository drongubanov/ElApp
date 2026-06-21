// Расчёт электрической сети, собранной как дерево узлов: корневой узел —
// точка ввода (главный щит), у него могут быть дочерние узлы — следующие
// щиты или непосредственно потребители. Узел может одновременно иметь
// собственную нагрузку и дочерние узлы (например, щит, часть нагрузки
// которого подключена напрямую, а часть — через под-щиты).

import { calculate, calculateVoltageDrop, NETWORK_TYPES } from './calculations.js';
import { recommendProtection, checkSelectivity } from './tables.js';
import { transformerImpedance, cableResistance, checkDisconnectionByCurve, minThermalSection } from './shortCircuit.js';

// Время отключения (с), принимаемое для проверки термической стойкости кабеля
// при КЗ, в зависимости от того, гарантирует ли расчётный ток КЗ мгновенное
// срабатывание электромагнитного расцепителя (см. checkDisconnectionByCurve):
// 0,1 с — консервативная верхняя оценка для «мгновенного» отключения (реальное
// время отсечки обычно ощутимо меньше); 5 с — нормативный максимум для систем
// TN по ПУЭ-7 п. 1.7.79 для распределительных линий, принимается как
// консервативная оценка сверху, если мгновенное срабатывание не гарантировано
// и точное время отключения по времятоковой характеристике аппарата неизвестно.
const THERMAL_TRIP_TIME = { instant: 0.1, delayed: 5 };

const PHASE_FACTOR = {
  [NETWORK_TYPES.DC]: 1,
  [NETWORK_TYPES.AC1]: 1,
  [NETWORK_TYPES.AC3]: Math.sqrt(3),
};

// Типовая кратность пускового тока асинхронного двигателя при прямом пуске
// (Iп/Iном ≈ 4–7 по паспортным данным большинства двигателей общего
// назначения) — используется как значение по умолчанию, если для узла с
// типом нагрузки «электродвигатель» не указано иное.
export const DEFAULT_START_CURRENT_RATIO = 6;

/** Падение напряжения на линии, питающей узел, по фактически подобранному кабелю. */
export function calculateLineVoltageDrop(result, protection, cableLength) {
  const cable = protection.copperCable ?? protection.aluminumCable;
  if (!(cableLength > 0) || !cable) {
    return null;
  }
  const material = protection.copperCable ? 'copper' : 'aluminum';
  const drop = calculateVoltageDrop({
    networkType: result.networkType,
    voltage: result.voltage,
    current: result.I,
    length: cableLength,
    section: cable.section,
    material,
    powerFactor: result.powerFactor,
  });
  return { ...drop, material };
}

/**
 * Расчёт одного узла дерева сети по его собственным параметрам и уже
 * посчитанной суммарной нагрузке дочерних узлов (childrenTotals: P, Q).
 * Считает P/S/Q/I узла (собственная нагрузка + дочерние, с учётом
 * коэффициента одновременности), подбирает автомат и кабель линии,
 * питающей узел от родителя, и падение напряжения на ней.
 *
 * Собственная нагрузка узла дополнительно учитывает коэффициент
 * использования (utilizationFactor, Ku) — отношение реальной (расчётной)
 * нагрузки к установленной (паспортной) мощности приёмника, приближённо
 * отражающее «реальную диаграмму нагрузки» вместо постоянной работы на
 * полную паспортную мощность. Если узел представляет электродвигатель
 * (loadType: 'motor'), дополнительно считается пусковой ток собственной
 * нагрузки по кратности startCurrentRatio — он передаётся в подбор защиты
 * для выбора характеристики автомата (B/C/D), устойчивой к пуску.
 */
export function calculateNode({
  networkType,
  voltage,
  powerFactor,
  hasOwnLoad,
  known,
  knownValue,
  installationMethod,
  cableCount,
  cableLength,
  simultaneityFactor = 1,
  utilizationFactor = 1,
  loadType = 'general',
  startCurrentRatio = DEFAULT_START_CURRENT_RATIO,
  childrenTotals = { P: 0, Q: 0 },
}) {
  if (!(simultaneityFactor > 0) || simultaneityFactor > 1) {
    throw new Error('Коэффициент одновременности должен быть в диапазоне от 0 (не включительно) до 1');
  }
  if (!(utilizationFactor > 0) || utilizationFactor > 1) {
    throw new Error('Коэффициент использования должен быть в диапазоне от 0 (не включительно) до 1');
  }

  let ownP = 0;
  let ownQ = 0;
  let installed = null;
  let startCurrent = null;
  if (hasOwnLoad) {
    const own = calculate({ networkType, voltage, powerFactor, known, knownValue });
    ownP = own.P * utilizationFactor;
    ownQ = own.Q * utilizationFactor;
    installed = { P: own.P, S: own.S, I: own.I };

    if (loadType === 'motor') {
      const k = PHASE_FACTOR[networkType];
      const ownS = Math.sqrt(ownP * ownP + ownQ * ownQ);
      const ownI = networkType === NETWORK_TYPES.DC ? ownP / voltage : ownS / (k * voltage);
      const ratio = startCurrentRatio > 0 ? startCurrentRatio : DEFAULT_START_CURRENT_RATIO;
      startCurrent = ownI * ratio;
    }
  } else {
    if (!Object.values(NETWORK_TYPES).includes(networkType)) {
      throw new Error('Неизвестный тип сети узла');
    }
    if (!(voltage > 0)) {
      throw new Error('Напряжение узла должно быть больше нуля');
    }
  }

  if (!hasOwnLoad && childrenTotals.P === 0 && childrenTotals.Q === 0) {
    throw new Error('У узла нет ни собственной нагрузки, ни дочерних узлов с нагрузкой');
  }

  const P = (ownP + childrenTotals.P) * simultaneityFactor;
  const Q = (ownQ + childrenTotals.Q) * simultaneityFactor;
  const S = Math.sqrt(P * P + Q * Q);
  const k = PHASE_FACTOR[networkType];
  const I = networkType === NETWORK_TYPES.DC ? P / voltage : S / (k * voltage);
  const nodePowerFactor = S > 0 ? Math.min(P / S, 1) : 1;

  const result = { networkType, voltage, powerFactor: nodePowerFactor, P, Q, S, I };
  const protection = recommendProtection(I, { installationMethod, cableCount, startCurrent });
  const voltageDrop = calculateLineVoltageDrop(result, protection, cableLength);

  return { result, protection, voltageDrop, ownP, ownQ, installed, startCurrent, utilizationFactor, loadType };
}

/**
 * Рекурсивно считает всё дерево узлов от листьев к корню: сначала дочерние
 * узлы, затем сам узел — по сумме их P/Q. Ошибка в узле делает невозможным
 * расчёт его самого и всех его предков, но не мешает рассчитать соседние,
 * не связанные с ним ветви дерева.
 */
export function calculateTree(node) {
  const children = (node.children ?? []).map((child) => calculateTree(child));
  const failedChild = children.find((child) => child.error);

  const childrenTotals = children.reduce(
    (acc, child) => (child.error ? acc : { P: acc.P + child.result.P, Q: acc.Q + child.result.Q }),
    { P: 0, Q: 0 },
  );

  let calc = null;
  let error = null;
  if (failedChild) {
    error = 'Расчёт невозможен: ошибка в дочернем узле ниже по дереву';
  } else {
    try {
      calc = calculateNode({ ...node, childrenTotals });
    } catch (err) {
      error = err.message;
    }
  }

  const sumOfChildBreakers = children.reduce((sum, child) => sum + (child.protection?.breaker ?? 0), 0);
  const childBreakerValues = children.map((child) => child.protection?.breaker ?? null).filter((b) => b != null);
  const maxOfChildBreakers = childBreakerValues.length ? Math.max(...childBreakerValues) : 0;
  const selectivity =
    calc?.protection?.breaker && childBreakerValues.length
      ? checkSelectivity(calc.protection.breaker, childBreakerValues)
      : null;

  // Проверка баланса: автомат и кабель узла подбираются по нагрузке с учётом
  // принятого коэффициента одновременности Кс дочерних узлов (childrenTotals
  // уже умножен на Кс при расчёте calc). Если бы все дочерние линии работали
  // одновременно на полную расчётную нагрузку (Кс = 1, т.е. без диверсификации),
  // ток мог бы превысить номинал автомата узла или допустимый ток его кабеля —
  // тогда защита узла держится только на справедливости принятого Кс, без запаса.
  let balance = null;
  if (calc?.protection && !failedChild && node.voltage > 0) {
    const k = PHASE_FACTOR[node.networkType] ?? 1;
    const rawS = Math.sqrt(childrenTotals.P * childrenTotals.P + childrenTotals.Q * childrenTotals.Q);
    const rawCurrent = node.networkType === NETWORK_TYPES.DC ? childrenTotals.P / node.voltage : rawS / (k * node.voltage);
    const cableAmpacity = calc.protection.copperCable?.ratedCurrent ?? calc.protection.aluminumCable?.ratedCurrent ?? null;
    const overBreaker = calc.protection.breaker != null && rawCurrent > calc.protection.breaker;
    const overCable = cableAmpacity != null && rawCurrent > cableAmpacity;
    if (overBreaker || overCable) {
      balance = { rawCurrent, breaker: calc.protection.breaker, cableAmpacity, overBreaker, overCable };
    }
  }

  return {
    id: node.id,
    name: node.name,
    error,
    result: calc?.result ?? null,
    protection: calc?.protection ?? null,
    voltageDrop: calc?.voltageDrop ?? null,
    ownP: calc?.ownP ?? 0,
    ownQ: calc?.ownQ ?? 0,
    installed: calc?.installed ?? null,
    startCurrent: calc?.startCurrent ?? null,
    sumOfChildBreakers,
    maxOfChildBreakers,
    selectivity,
    balance,
    shortCircuit: null,
    children,
  };
}

function chosenCable(protection) {
  if (protection?.copperCable) return { section: protection.copperCable.section, material: 'copper' };
  if (protection?.aluminumCable) return { section: protection.aluminumCable.section, material: 'aluminum' };
  return null;
}

/**
 * Дополняет результат calculateTree оценкой тока короткого замыкания в каждом
 * узле. Активное сопротивление кабелей накапливается по пути от точки ввода
 * (трансформатора) до узла — так же, как физически складывается петля КЗ, в
 * отличие от calculateLineVoltageDrop, который учитывает только одну линию.
 * Требует параметры трансформатора на корневом узле (transformerPowerKva,
 * transformerUkPercent); без них дерево возвращается без изменений (у каждого
 * узла shortCircuit остаётся null). Расчёт приближённый (см. js/shortCircuit.js):
 * сопротивления выше трансформатора и индуктивные составляющие не учитываются.
 * Проверка времени отключения проводится по характеристике автомата C, если
 * для узла не подобрана другая (см. recommendedCurve для электродвигателей) —
 * это наиболее распространённая характеристика, но не единственно возможная.
 * Дополнительно проверяется термическая стойкость выбранного сечения кабеля
 * тепловому воздействию тока КЗ (Iкз(3), как наибольшего из двух) за принятое
 * время отключения (THERMAL_TRIP_TIME) — см. minThermalSection в
 * js/shortCircuit.js.
 */
export function annotateShortCircuit(rootNode, rootCalc) {
  const { transformerPowerKva, transformerUkPercent } = rootNode;
  if (!(transformerPowerKva > 0) || !(transformerUkPercent > 0)) return rootCalc;

  let zT;
  try {
    zT = transformerImpedance({
      ratedPowerKva: transformerPowerKva,
      shortCircuitVoltagePercent: transformerUkPercent,
      lineVoltage: rootNode.voltage,
    });
  } catch {
    return rootCalc;
  }
  const phaseVoltage = rootNode.voltage / Math.sqrt(3);

  const walk = (node, calcNode, parentResistance) => {
    const cable = chosenCable(calcNode.protection);
    const resistance =
      parentResistance + (cable && node.cableLength > 0
        ? cableResistance({ length: node.cableLength, section: cable.section, material: cable.material })
        : 0);

    if (calcNode.result && !calcNode.error) {
      const i3 = phaseVoltage / (zT + resistance);
      const i1 = phaseVoltage / (zT + 2 * resistance);
      const curve = calcNode.protection?.recommendedCurve ?? 'C';
      const disconnection = calcNode.protection?.breaker
        ? checkDisconnectionByCurve({ singlePhaseCurrent: i1, breakerRating: calcNode.protection.breaker, curve })
        : null;

      let thermalCheck = null;
      if (disconnection && cable) {
        const time = disconnection.ok ? THERMAL_TRIP_TIME.instant : THERMAL_TRIP_TIME.delayed;
        const minSection = minThermalSection({ current: i3, time, material: cable.material });
        if (minSection != null) {
          thermalCheck = { time, minSection, actualSection: cable.section, ok: cable.section >= minSection };
        }
      }

      calcNode.shortCircuit = { zT, resistance, i3, i1, curve, disconnection, thermalCheck };
    }

    node.children.forEach((child, index) => walk(child, calcNode.children[index], resistance));
  };

  walk(rootNode, rootCalc, 0);
  return rootCalc;
}

/**
 * Дополняет результат calculateTree накопленной потерей напряжения от точки
 * ввода до узла — суммой dropPercent всех линий по пути от корня, а не только
 * последней (calc.voltageDrop учитывает лишь линию, питающую узел от
 * родителя). Именно суммарную потерю у самого удалённого потребителя сравнивают
 * с общепринятой нормой ≤5% (ПУЭ, ГОСТ 32144) — потеря на одном участке может
 * быть в норме, а итоговая до конечного приёмника — превышать её. Суммирование
 * процентов, а не вольт, позволяет складывать потери на участках с разным
 * напряжением (например, ввод 380 В и однофазный отвод 220 В) — стандартное
 * инженерное приближение, не учитывающее приведение фаз к общему вектору.
 * У узла с ошибкой расчёта собственная линия не подобрана, поэтому её вклад
 * принимается равным нулю (как сопротивление кабеля в annotateShortCircuit) —
 * накопление продолжается дальше по дереву без искусственной блокировки
 * поддерева, а cumulativeVoltageDropPercent самого этого узла — null.
 */
export function annotateVoltageDrop(rootNode, rootCalc) {
  const walk = (node, calcNode, parentDropPercent) => {
    const ownDropPercent = calcNode.voltageDrop?.dropPercent ?? 0;
    const cumulative = parentDropPercent + ownDropPercent;
    calcNode.cumulativeVoltageDropPercent = calcNode.result && !calcNode.error ? cumulative : null;
    node.children.forEach((child, index) => walk(child, calcNode.children[index], cumulative));
  };

  walk(rootNode, rootCalc, 0);
  return rootCalc;
}
