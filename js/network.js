// Расчёт электрической сети, собранной как дерево узлов: корневой узел —
// точка ввода (главный щит), у него могут быть дочерние узлы — следующие
// щиты или непосредственно потребители. Узел может одновременно иметь
// собственную нагрузку и дочерние узлы (например, щит, часть нагрузки
// которого подключена напрямую, а часть — через под-щиты).

import { calculate, calculateVoltageDrop, NETWORK_TYPES } from './calculations.js';
import { recommendProtection } from './tables.js';

const PHASE_FACTOR = {
  [NETWORK_TYPES.DC]: 1,
  [NETWORK_TYPES.AC1]: 1,
  [NETWORK_TYPES.AC3]: Math.sqrt(3),
};

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
  childrenTotals = { P: 0, Q: 0 },
}) {
  if (!(simultaneityFactor > 0) || simultaneityFactor > 1) {
    throw new Error('Коэффициент одновременности должен быть в диапазоне от 0 (не включительно) до 1');
  }

  let ownP = 0;
  let ownQ = 0;
  if (hasOwnLoad) {
    const own = calculate({ networkType, voltage, powerFactor, known, knownValue });
    ownP = own.P;
    ownQ = own.Q;
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
  const protection = recommendProtection(I, { installationMethod, cableCount });
  const voltageDrop = calculateLineVoltageDrop(result, protection, cableLength);

  return { result, protection, voltageDrop, ownP, ownQ };
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

  return {
    id: node.id,
    name: node.name,
    error,
    result: calc?.result ?? null,
    protection: calc?.protection ?? null,
    voltageDrop: calc?.voltageDrop ?? null,
    ownP: calc?.ownP ?? 0,
    ownQ: calc?.ownQ ?? 0,
    sumOfChildBreakers,
    children,
  };
}
