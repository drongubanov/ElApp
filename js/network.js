// Расчёт электрической сети, собранной из блоков потребителей одного щита/ввода.
// Каждый блок — отдельная отходящая линия со своей нагрузкой и условиями прокладки;
// суммарная нагрузка блоков (с учётом коэффициента одновременности) определяет
// вводной автомат и сечение вводного кабеля.

import { calculate, calculateVoltageDrop, NETWORK_TYPES } from './calculations.js';
import { recommendProtection } from './tables.js';

const PHASE_FACTOR = {
  [NETWORK_TYPES.DC]: 1,
  [NETWORK_TYPES.AC1]: 1,
  [NETWORK_TYPES.AC3]: Math.sqrt(3),
};

/** Падение напряжения на линии, питающей блок/ввод, по фактически подобранному кабелю. */
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
 * Расчёт одного блока потребителя: P/S/Q/I, рекомендация по автомату и кабелю
 * отходящей линии, падение напряжения на ней (если задана длина).
 */
export function calculateBlock({
  networkType,
  voltage,
  powerFactor,
  known,
  knownValue,
  installationMethod,
  cableCount,
  cableLength,
}) {
  const result = calculate({ networkType, voltage, powerFactor, known, knownValue });
  const protection = recommendProtection(result.I, { installationMethod, cableCount });
  const voltageDrop = calculateLineVoltageDrop(result, protection, cableLength);
  return { result, protection, voltageDrop };
}

/**
 * Агрегирует суммарную нагрузку по уже рассчитанным блокам (см. calculateBlock) и
 * подбирает вводной автомат и кабель. Активная и реактивная мощности блоков
 * складываются (приближённо, без учёта несовпадения фаз cosφ во времени) и
 * умножаются на коэффициент одновременности — это стандартный приём
 * предварительной оценки нагрузки щита/ввода.
 */
export function aggregateIncoming({
  blocks,
  networkType,
  voltage,
  simultaneityFactor = 1,
  installationMethod,
  cableCount,
  cableLength,
}) {
  if (!Object.values(NETWORK_TYPES).includes(networkType)) {
    throw new Error('Неизвестный тип сети ввода');
  }
  if (!(voltage > 0)) {
    throw new Error('Напряжение ввода должно быть больше нуля');
  }
  if (!(simultaneityFactor > 0) || simultaneityFactor > 1) {
    throw new Error('Коэффициент одновременности должен быть в диапазоне от 0 (не включительно) до 1');
  }

  const totalsBeforeKc = blocks.reduce(
    (acc, b) => ({ P: acc.P + b.result.P, Q: acc.Q + b.result.Q }),
    { P: 0, Q: 0 },
  );
  const P = totalsBeforeKc.P * simultaneityFactor;
  const Q = totalsBeforeKc.Q * simultaneityFactor;
  const S = Math.sqrt(P * P + Q * Q);
  const k = PHASE_FACTOR[networkType];
  const I = networkType === NETWORK_TYPES.DC ? P / voltage : S / (k * voltage);
  const powerFactor = S > 0 ? Math.min(P / S, 1) : 1;

  const result = { networkType, voltage, powerFactor, P, S, Q, I };
  const protection = recommendProtection(I, { installationMethod, cableCount });
  const voltageDrop = calculateLineVoltageDrop(result, protection, cableLength);
  const sumOfBlockBreakers = blocks.reduce((sum, b) => sum + (b.protection.breaker ?? 0), 0);

  return { result, protection, voltageDrop, sumOfBlockBreakers };
}
