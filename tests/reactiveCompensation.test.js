import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendCompensation, DEFAULT_TARGET_POWER_FACTOR } from '../js/reactiveCompensation.js';

test('recommendCompensation: cosφ1=0.6 (P=300, Q=400) до cosφ2=0.8 — Qc по формуле P·(tgφ1 − tgφ2)', () => {
  const r = recommendCompensation({ P: 300, Q: 400, targetPowerFactor: 0.8 });
  assert.ok(r);
  assert.ok(Math.abs(r.currentPowerFactor - 0.6) < 1e-12);
  assert.equal(r.targetPowerFactor, 0.8);
  // tgφ1 = 400/300, tgφ2 = √(1−0.64)/0.8 = 0.75 → Qc = 300·(4/3 − 0.75) = 175.
  assert.ok(Math.abs(r.requiredQc - 175) < 1e-9);
  assert.ok(Math.abs(r.compensatedQ - 225) < 1e-9);
  assert.ok(Math.abs(r.compensatedS - 375) < 1e-9);
});

test('recommendCompensation: целевой cosφ = 1 — полная компенсация (Q становится 0)', () => {
  const r = recommendCompensation({ P: 100, Q: 75, targetPowerFactor: 1 });
  assert.ok(r);
  assert.equal(r.currentPowerFactor, 0.8);
  assert.equal(r.requiredQc, 75);
  assert.equal(r.compensatedQ, 0);
  assert.equal(r.compensatedS, 100);
});

test('recommendCompensation: фактический cosφ уже не ниже целевого — компенсация не нужна (null)', () => {
  assert.equal(recommendCompensation({ P: 300, Q: 400, targetPowerFactor: 0.6 }), null);
  assert.equal(recommendCompensation({ P: 300, Q: 400, targetPowerFactor: 0.5 }), null);
  assert.equal(recommendCompensation({ P: 100, Q: 0, targetPowerFactor: DEFAULT_TARGET_POWER_FACTOR }), null);
});

test('recommendCompensation: нет активной или реактивной нагрузки → null', () => {
  assert.equal(recommendCompensation({ P: 0, Q: 100, targetPowerFactor: 0.95 }), null);
  assert.equal(recommendCompensation({ P: 100, Q: -5, targetPowerFactor: 0.95 }), null);
  assert.equal(recommendCompensation({ P: -100, Q: 100, targetPowerFactor: 0.95 }), null);
});

test('recommendCompensation: недопустимый целевой cosφ выбрасывает ошибку', () => {
  assert.throws(() => recommendCompensation({ P: 100, Q: 100, targetPowerFactor: 0 }));
  assert.throws(() => recommendCompensation({ P: 100, Q: 100, targetPowerFactor: 1.1 }));
  assert.throws(() => recommendCompensation({ P: 100, Q: 100, targetPowerFactor: -0.5 }));
});

test('DEFAULT_TARGET_POWER_FACTOR — разумное значение по умолчанию (0 < x ≤ 1)', () => {
  assert.ok(DEFAULT_TARGET_POWER_FACTOR > 0 && DEFAULT_TARGET_POWER_FACTOR <= 1);
});
