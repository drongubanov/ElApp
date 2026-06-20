import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectBreaker,
  selectCable,
  recommendProtection,
  recommendBreakerCurve,
  checkSelectivity,
  BREAKER_RATINGS,
  SELECTIVITY_SAFE_RATIO,
} from '../js/tables.js';

test('selectBreaker выбирает ближайший номинал не меньше тока', () => {
  assert.equal(selectBreaker(14.5), 16);
  assert.equal(selectBreaker(16), 16);
  assert.equal(selectBreaker(16.1), 20);
  assert.equal(selectBreaker(BREAKER_RATINGS[0]), BREAKER_RATINGS[0]);
});

test('selectBreaker возвращает null за пределами таблицы', () => {
  assert.equal(selectBreaker(10000), null);
});

test('selectCable подбирает наименьшее достаточное сечение для меди', () => {
  const cable = selectCable(25, 'copper');
  assert.equal(cable.section, 2.5);
  assert.equal(cable.ratedCurrent, 27);
});

test('selectCable пропускает сечения, не указанные для алюминия', () => {
  const cable = selectCable(15, 'aluminum');
  assert.equal(cable.section, 2.5);
  assert.equal(cable.ratedCurrent, 20);
});

test('selectCable возвращает null, если ток превышает диапазон таблицы', () => {
  assert.equal(selectCable(10000, 'copper'), null);
});

test('recommendProtection подбирает автомат и кабели, выдерживающие его номинал', () => {
  const result = recommendProtection(14.2);
  assert.equal(result.breaker, 16);
  assert.ok(result.copperCable.ratedCurrent >= result.breaker);
  assert.ok(result.aluminumCable.ratedCurrent >= result.breaker);
});

test('recommendProtection при токе вне диапазона возвращает null-рекомендации', () => {
  const result = recommendProtection(10000);
  assert.equal(result.breaker, null);
  assert.equal(result.copperCable, null);
  assert.equal(result.aluminumCable, null);
});

test('recommendProtection без опций использует прокладку в воздухе без поправки', () => {
  const result = recommendProtection(14.2);
  assert.equal(result.correction, 1);
});

test('recommendProtection учитывает поправочный коэффициент способа прокладки и числа кабелей', () => {
  const result = recommendProtection(30, { installationMethod: 'conduit', cableCount: 4 });
  assert.equal(result.breaker, 32);
  assert.ok(Math.abs(result.correction - 0.68) < 1e-9);
  assert.equal(result.copperCable.section, 10);
  assert.equal(result.copperCable.ratedCurrent, 70);
});

test('recommendProtection с неизвестным способом прокладки не применяет поправку', () => {
  const result = recommendProtection(14.2, { installationMethod: 'unknown' });
  assert.equal(result.correction, 1);
});

test('recommendProtection без пускового тока не указывает характеристику автомата', () => {
  const result = recommendProtection(14.2);
  assert.equal(result.startCurrent, null);
  assert.equal(result.recommendedCurve, null);
  assert.equal(result.curveOverRange, false);
});

test('recommendProtection подбирает характеристику автомата по пусковому току', () => {
  // breaker = 16 А; пусковой ток 70 А -> кратность 70/16 = 4.375 -> укладывается в B (≤5)
  const result = recommendProtection(14.2, { startCurrent: 70 });
  assert.equal(result.breaker, 16);
  assert.equal(result.recommendedCurve, 'B');
  assert.equal(result.curveOverRange, false);
});

test('recommendProtection: пусковой ток вне диапазона характеристики D даёт предупреждение', () => {
  // breaker = 16 А; характеристика D покрывает максимум 20×16=320 А
  const result = recommendProtection(14.2, { startCurrent: 400 });
  assert.equal(result.recommendedCurve, null);
  assert.equal(result.curveOverRange, true);
});

test('recommendBreakerCurve выбирает наименее острую подходящую характеристику', () => {
  assert.equal(recommendBreakerCurve(60, 16), 'B'); // 60/16=3.75 ≤ 5
  assert.equal(recommendBreakerCurve(100, 16), 'C'); // 100/16=6.25 ≤ 10
  assert.equal(recommendBreakerCurve(200, 16), 'D'); // 200/16=12.5 ≤ 20
  assert.equal(recommendBreakerCurve(400, 16), null); // 400/16=25 > 20
});

test('checkSelectivity: достаточный запас номинала — селективность обеспечена', () => {
  const result = checkSelectivity(32, [10, 16]);
  assert.equal(result.maxDownstream, 16);
  assert.equal(result.ratio, 2);
  assert.equal(result.level, 'selective');
  assert.equal(SELECTIVITY_SAFE_RATIO, 2);
});

test('checkSelectivity: близкие номиналы — селективность не гарантирована', () => {
  const result = checkSelectivity(20, [16]);
  assert.equal(result.level, 'uncertain');
});

test('checkSelectivity: номинал вышестоящего не больше нижестоящего — не селективно', () => {
  const result = checkSelectivity(16, [16]);
  assert.equal(result.level, 'not-selective');
});

test('checkSelectivity возвращает null без вышестоящего номинала или дочерних линий', () => {
  assert.equal(checkSelectivity(null, [16]), null);
  assert.equal(checkSelectivity(32, []), null);
});
