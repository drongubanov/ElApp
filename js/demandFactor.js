// Метод коэффициента использования / расчётного коэффициента (Ки/Кр) для группы
// электроприёмников. Эффективное число приёмников nэ и групповой коэффициент
// использования Ки.гр считаются по стандартным формулам; сам расчётный
// коэффициент оценивается ПРОЗРАЧНОЙ ПРИБЛИЖЁННОЙ ФОРМУЛОЙ, а не табличными
// значениями Кр(nэ, Ки.гр) из РТМ 36.18.32.4-92 / СП 256 — это предварительная
// оценка, для точного проектирования используйте табличный метод.

/** Эффективное число электроприёмников nэ = (ΣPн)² / Σ(Pн²) (формула точная). */
export function effectiveReceiverCount(installedPowers) {
  const powers = installedPowers.filter((p) => p > 0);
  if (!powers.length) return 0;
  const sum = powers.reduce((acc, p) => acc + p, 0);
  const sumSq = powers.reduce((acc, p) => acc + p * p, 0);
  return (sum * sum) / sumSq;
}

/**
 * Сводный расчёт активной нагрузки группы по методу Ки/Кр.
 *
 * receivers: [{ installedP, ku }] — установленная (паспортная) активная мощность
 * приёмника Pн и его коэффициент использования Ки. Возвращает (или null, если
 * нет ни одного корректного приёмника):
 *  - installedTotal — ΣPн (установленная мощность группы);
 *  - averageP       — Pср = Σ(Ки·Pн) (средняя мощность за наиболее загруженную смену);
 *  - groupKu        — Ки.гр = Pср/ΣPн (групповой коэффициент использования, точно);
 *  - nEffective     — nэ (эффективное число приёмников, точно);
 *  - supplyFactor   — Кс.гр (расчётный коэффициент спроса к ΣPн, приближённо);
 *  - demandFactor   — Кр = Кс.гр/Ки.гр (расчётный коэффициент к Pср, для справки);
 *  - calculatedP    — Pр = Кс.гр·ΣPн (расчётная активная нагрузка группы);
 *  - count          — число приёмников в группе.
 *
 * Приближение: Кс.гр = Ки.гр + (1 − Ки.гр)/√nэ. При nэ = 1 Кс.гр = 1, то есть
 * Pр = ΣPн (единственный приёмник работает на полную установленную мощность);
 * при большом nэ Кс.гр → Ки.гр, то есть Pр → Pср (пики большой группы
 * усредняются). Это прозрачная инженерная аппроксимация табличного Кр.
 */
export function groupDemand(receivers) {
  const valid = receivers.filter((r) => r.installedP > 0 && r.ku > 0);
  if (!valid.length) return null;

  const installedTotal = valid.reduce((acc, r) => acc + r.installedP, 0);
  const averageP = valid.reduce((acc, r) => acc + r.ku * r.installedP, 0);
  const groupKu = averageP / installedTotal;
  const nEffective = effectiveReceiverCount(valid.map((r) => r.installedP));
  const supplyFactor = groupKu + (1 - groupKu) / Math.sqrt(nEffective);
  const calculatedP = supplyFactor * installedTotal;
  const demandFactor = averageP > 0 ? calculatedP / averageP : 1;

  return {
    installedTotal,
    averageP,
    groupKu,
    nEffective,
    supplyFactor,
    demandFactor,
    calculatedP,
    count: valid.length,
  };
}
