import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveReceiverCount, groupDemand } from '../js/demandFactor.js';

test('effectiveReceiverCount: один приёмник → nэ = 1 независимо от мощности', () => {
  assert.equal(effectiveReceiverCount([5000]), 1);
  assert.equal(effectiveReceiverCount([1]), 1);
});

test('effectiveReceiverCount: n равных приёмников → nэ = n', () => {
  const powers = Array.from({ length: 20 }, () => 1000);
  assert.equal(effectiveReceiverCount(powers), 20);
});

test('effectiveReceiverCount: неравные приёмники считаются по формуле (ΣPн)²/Σ(Pн²)', () => {
  const powers = [10000, 5000, 2000, 1000];
  const sum = powers.reduce((a, p) => a + p, 0);
  const sumSq = powers.reduce((a, p) => a + p * p, 0);
  assert.ok(Math.abs(effectiveReceiverCount(powers) - (sum * sum) / sumSq) < 1e-9);
});

test('effectiveReceiverCount: пустой список или только неположительные мощности → 0', () => {
  assert.equal(effectiveReceiverCount([]), 0);
  assert.equal(effectiveReceiverCount([-5, 0]), 0);
});

test('effectiveReceiverCount: отрицательные и нулевые значения отфильтровываются', () => {
  assert.equal(effectiveReceiverCount([-5, 0, 10]), 1);
});

test('groupDemand: единственный приёмник — Кс.гр = 1, Pр = ΣPн (вся установленная мощность)', () => {
  const r = groupDemand([{ installedP: 5000, ku: 0.6 }]);
  assert.equal(r.installedTotal, 5000);
  assert.equal(r.averageP, 3000);
  assert.equal(r.groupKu, 0.6);
  assert.equal(r.nEffective, 1);
  assert.ok(Math.abs(r.supplyFactor - 1) < 1e-12);
  assert.ok(Math.abs(r.calculatedP - 5000) < 1e-9);
  assert.equal(r.count, 1);
});

test('groupDemand: большая группа равных приёмников — Кс.гр > Ки.гр, но ближе к нему, чем при малой группе', () => {
  const receivers = Array.from({ length: 20 }, () => ({ installedP: 1000, ku: 0.5 }));
  const r = groupDemand(receivers);
  assert.equal(r.installedTotal, 20000);
  assert.equal(r.averageP, 10000);
  assert.equal(r.groupKu, 0.5);
  assert.equal(r.nEffective, 20);
  // Кс.гр = Ки.гр + (1 − Ки.гр)/√nэ = 0.5 + 0.5/√20.
  const expectedSupplyFactor = 0.5 + 0.5 / Math.sqrt(20);
  assert.ok(Math.abs(r.supplyFactor - expectedSupplyFactor) < 1e-9);
  assert.ok(r.supplyFactor > r.groupKu, 'Кс.гр должен быть больше Ки.гр при конечном nэ');
  assert.ok(Math.abs(r.calculatedP - r.supplyFactor * r.installedTotal) < 1e-6);
  assert.ok(Math.abs(r.demandFactor - r.calculatedP / r.averageP) < 1e-9);
});

test('groupDemand: смешанная группа разных приёмников считается точно по формулам nэ/Ки.гр и приближённо по Кс.гр', () => {
  const receivers = [
    { installedP: 10000, ku: 0.7 },
    { installedP: 5000, ku: 0.5 },
    { installedP: 2000, ku: 0.8 },
    { installedP: 1000, ku: 0.3 },
  ];
  const r = groupDemand(receivers);
  assert.equal(r.installedTotal, 18000);
  assert.equal(r.averageP, 11400);
  assert.ok(Math.abs(r.groupKu - 11400 / 18000) < 1e-12);
  assert.ok(Math.abs(r.nEffective - 2.4923076923076923) < 1e-9);
  assert.ok(Math.abs(r.supplyFactor - 0.8655912902979725) < 1e-9);
  assert.ok(Math.abs(r.calculatedP - 15580.643225363507) < 1e-6);
  assert.equal(r.count, 4);
});

test('groupDemand: приёмники с нулевой мощностью или Ки игнорируются', () => {
  const r = groupDemand([
    { installedP: 5000, ku: 0.6 },
    { installedP: 0, ku: 0.8 },
    { installedP: 1000, ku: 0 },
  ]);
  assert.equal(r.count, 1);
  assert.equal(r.installedTotal, 5000);
});

test('groupDemand: пустой список или отсутствие корректных приёмников → null', () => {
  assert.equal(groupDemand([]), null);
  assert.equal(
    groupDemand([
      { installedP: 0, ku: 0.5 },
      { installedP: 100, ku: 0 },
    ]),
    null,
  );
});
