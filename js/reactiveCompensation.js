// Рекомендация по компенсации реактивной мощности узла сети переменного тока:
// какая мощность конденсаторной батареи Qc нужна, чтобы повысить cosφ узла до
// заданного целевого значения. Стандартная (не табличная) формула из курса
// электроснабжения промышленных предприятий.

// Типичный целевой cosφ, который сетевые организации обычно требуют от
// промышленных потребителей (часто в диапазоне 0,92–0,95) — используется как
// значение по умолчанию, если для узла не указано иное; не привязан к
// конкретному нормативному документу и может быть изменён пользователем.
export const DEFAULT_TARGET_POWER_FACTOR = 0.95;

/**
 * Мощность компенсирующих конденсаторов для повышения cosφ узла от
 * фактического значения cosφ1 = P/√(P²+Q²) до целевого cosφ2 (targetPowerFactor):
 *   tgφ1 = Q/P,    tgφ2 = √(1 − cosφ2²)/cosφ2,    Qc = P·(tgφ1 − tgφ2).
 * После компенсации реактивная мощность узла снижается до Q2 = P·tgφ2, а
 * полная мощность — до S2 = √(P² + Q2²) (соответственно снижается и ток линии).
 * Возвращает null, если компенсация не нужна или невозможна: нет активной или
 * реактивной нагрузки (например, в сети постоянного тока Q всегда 0), либо
 * фактический cosφ уже не ниже целевого.
 */
export function recommendCompensation({ P, Q, targetPowerFactor = DEFAULT_TARGET_POWER_FACTOR }) {
  if (!(targetPowerFactor > 0) || targetPowerFactor > 1) {
    throw new Error('Целевой cosφ должен быть в диапазоне от 0 (не включительно) до 1');
  }
  if (!(P > 0) || !(Q > 0)) return null;

  const S = Math.sqrt(P * P + Q * Q);
  const currentPowerFactor = Math.min(P / S, 1);
  if (currentPowerFactor >= targetPowerFactor) return null;

  const tanPhi2 = Math.sqrt(Math.max(1 - targetPowerFactor * targetPowerFactor, 0)) / targetPowerFactor;
  const compensatedQ = P * tanPhi2;
  const requiredQc = Q - compensatedQ;
  const compensatedS = Math.sqrt(P * P + compensatedQ * compensatedQ);

  return { targetPowerFactor, currentPowerFactor, requiredQc, compensatedQ, compensatedS };
}
