import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, NETWORK_TYPES } from '../js/calculations.js';

test('DC: ток по известной мощности', () => {
  const r = calculate({ networkType: NETWORK_TYPES.DC, voltage: 24, known: 'power', knownValue: 240 });
  assert.equal(r.I, 10);
  assert.equal(r.P, 240);
  assert.equal(r.S, 240);
  assert.equal(r.Q, 0);
});

test('DC: мощность по известному току', () => {
  const r = calculate({ networkType: NETWORK_TYPES.DC, voltage: 12, known: 'current', knownValue: 5 });
  assert.equal(r.P, 60);
});

test('Однофазная AC: ток и полная мощность по активной мощности с cosφ', () => {
  const r = calculate({ networkType: NETWORK_TYPES.AC1, voltage: 220, powerFactor: 0.8, known: 'power', knownValue: 2200 });
  assert.ok(Math.abs(r.I - 12.5) < 1e-9);
  assert.ok(Math.abs(r.S - 2750) < 1e-9);
  assert.ok(Math.abs(r.Q - 1650) < 1e-6);
});

test('Однофазная AC: cosφ = 1 даёт Q = 0', () => {
  const r = calculate({ networkType: NETWORK_TYPES.AC1, voltage: 220, powerFactor: 1, known: 'current', knownValue: 10 });
  assert.ok(Math.abs(r.Q) < 1e-9);
  assert.equal(r.P, 2200);
});

test('Трёхфазная AC: ток по активной мощности', () => {
  const r = calculate({ networkType: NETWORK_TYPES.AC3, voltage: 380, powerFactor: 0.8, known: 'power', knownValue: 10000 });
  assert.ok(Math.abs(r.I - 18.9917851707) < 1e-6);
});

test('Трёхфазная AC: мощность по известному току согласована с прямым расчётом', () => {
  const r = calculate({ networkType: NETWORK_TYPES.AC3, voltage: 380, powerFactor: 0.8, known: 'current', knownValue: 18.9917851707 });
  assert.ok(Math.abs(r.P - 10000) < 1e-3);
});

test('Ошибка: нулевое или отрицательное напряжение', () => {
  assert.throws(() => calculate({ networkType: NETWORK_TYPES.DC, voltage: 0, known: 'power', knownValue: 100 }));
  assert.throws(() => calculate({ networkType: NETWORK_TYPES.DC, voltage: -5, known: 'power', knownValue: 100 }));
});

test('Ошибка: некорректный cosφ вне диапазона (0, 1]', () => {
  assert.throws(() => calculate({ networkType: NETWORK_TYPES.AC1, voltage: 220, powerFactor: 1.5, known: 'power', knownValue: 100 }));
  assert.throws(() => calculate({ networkType: NETWORK_TYPES.AC1, voltage: 220, powerFactor: 0, known: 'power', knownValue: 100 }));
});

test('Ошибка: неизвестный тип сети', () => {
  assert.throws(() => calculate({ networkType: 'foo', voltage: 220, known: 'power', knownValue: 100 }));
});
