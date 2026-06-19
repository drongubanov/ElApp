import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBreaker, selectCable, recommendProtection, BREAKER_RATINGS } from '../js/tables.js';

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
