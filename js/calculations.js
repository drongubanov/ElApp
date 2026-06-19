// Базовые электротехнические формулы для расчёта мощности и тока.

export const NETWORK_TYPES = {
  DC: 'dc',
  AC1: 'ac1',
  AC3: 'ac3',
};

const PHASE_FACTOR = {
  [NETWORK_TYPES.DC]: 1,
  [NETWORK_TYPES.AC1]: 1,
  [NETWORK_TYPES.AC3]: Math.sqrt(3),
};

/**
 * Рассчитывает P, S, Q, I по известному напряжению и одной из величин (P или I).
 *
 * DC:   P = U·I,             Q = 0
 * AC1:  P = U·I·cosφ,        S = U·I,        Q = √(S²−P²)
 * AC3:  P = √3·U·I·cosφ,     S = √3·U·I,     Q = √(S²−P²)
 */
export function calculate({ networkType, voltage, powerFactor = 1, known, knownValue }) {
  if (!Object.values(NETWORK_TYPES).includes(networkType)) {
    throw new Error('Неизвестный тип сети');
  }
  if (!(voltage > 0)) {
    throw new Error('Напряжение должно быть больше нуля');
  }
  if (!(knownValue > 0)) {
    throw new Error('Введённое значение должно быть больше нуля');
  }
  if (known !== 'power' && known !== 'current') {
    throw new Error('Неизвестный тип входной величины');
  }

  const pf = networkType === NETWORK_TYPES.DC ? 1 : powerFactor;
  if (!(pf > 0) || pf > 1) {
    throw new Error('cosφ должен быть в диапазоне от 0 (не включительно) до 1');
  }

  const k = PHASE_FACTOR[networkType];
  let P;
  let I;

  if (known === 'power') {
    P = knownValue;
    I = P / (k * voltage * pf);
  } else {
    I = knownValue;
    P = k * voltage * I * pf;
  }

  const S = k * voltage * I;
  const Q = networkType === NETWORK_TYPES.DC ? 0 : Math.sqrt(Math.max(S * S - P * P, 0));

  return { networkType, voltage, powerFactor: pf, P, I, S, Q };
}
