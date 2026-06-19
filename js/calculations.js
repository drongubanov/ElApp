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

// Удельное сопротивление жилы при +20°C, Ом·мм²/м.
export const RESISTIVITY = {
  copper: 0.0175,
  aluminum: 0.028,
};

/**
 * Потеря напряжения в кабельной линии (упрощённо, без учёта индуктивного
 * сопротивления — для протяжённых линий малого сечения это даёт
 * приемлемую точность для предварительной оценки).
 *
 * DC и однофазная сеть: ΔU = 2·ρ·L·I·cosφ/S (прямой и обратный провод)
 * Трёхфазная сеть:      ΔU = √3·ρ·L·I·cosφ/S (линейный провод)
 */
export function calculateVoltageDrop({ networkType, voltage, current, length, section, material, powerFactor = 1 }) {
  if (!Object.values(NETWORK_TYPES).includes(networkType)) {
    throw new Error('Неизвестный тип сети');
  }
  if (!(voltage > 0)) {
    throw new Error('Напряжение должно быть больше нуля');
  }
  if (!(current > 0)) {
    throw new Error('Ток должен быть больше нуля');
  }
  if (!(length > 0)) {
    throw new Error('Длина линии должна быть больше нуля');
  }
  if (!(section > 0)) {
    throw new Error('Сечение кабеля должно быть больше нуля');
  }
  const resistivity = RESISTIVITY[material];
  if (!resistivity) {
    throw new Error('Неизвестный материал жилы');
  }

  const pf = networkType === NETWORK_TYPES.DC ? 1 : powerFactor;
  const k = networkType === NETWORK_TYPES.AC3 ? Math.sqrt(3) : 2;
  const drop = (k * resistivity * length * current * pf) / section;
  const dropPercent = (drop / voltage) * 100;

  return { drop, dropPercent, material, length, section };
}
