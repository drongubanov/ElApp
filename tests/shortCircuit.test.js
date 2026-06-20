import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transformerImpedance,
  cableResistance,
  calculateShortCircuit,
  checkDisconnectionByCurve,
} from '../js/shortCircuit.js';

test('transformerImpedance: Zт = (uк/100)·Uл²/Sт', () => {
  // 1000 кВА, uк = 5,5 %, Uл = 400 В: Zт = 0.055 · 160000 / 1_000_000 = 0.0088 Ом
  const z = transformerImpedance({ ratedPowerKva: 1000, shortCircuitVoltagePercent: 5.5, lineVoltage: 400 });
  assert.ok(Math.abs(z - 0.0088) < 1e-6);
});

test('transformerImpedance: на зажимах трансформатора Iкз ≈ Iном / (uк/100)', () => {
  const lineVoltage = 400;
  const ratedPowerKva = 630;
  const uk = 5.5;
  const z = transformerImpedance({ ratedPowerKva, shortCircuitVoltagePercent: uk, lineVoltage });
  const iSc = (lineVoltage / Math.sqrt(3)) / z; // ток КЗ на зажимах (Rкаб = 0)
  const iNom = (ratedPowerKva * 1000) / (Math.sqrt(3) * lineVoltage);
  assert.ok(Math.abs(iSc - iNom / (uk / 100)) < 1e-6);
});

test('transformerImpedance: некорректные данные → ошибка', () => {
  assert.throws(() => transformerImpedance({ ratedPowerKva: 0, shortCircuitVoltagePercent: 5, lineVoltage: 400 }));
  assert.throws(() => transformerImpedance({ ratedPowerKva: 400, shortCircuitVoltagePercent: 0, lineVoltage: 400 }));
  assert.throws(() => transformerImpedance({ ratedPowerKva: 400, shortCircuitVoltagePercent: 5, lineVoltage: 0 }));
});

test('cableResistance: R = ρ·L/S для меди и алюминия', () => {
  assert.ok(Math.abs(cableResistance({ length: 50, section: 10, material: 'copper' }) - 0.0875) < 1e-9);
  assert.ok(Math.abs(cableResistance({ length: 50, section: 10, material: 'aluminum' }) - 0.14) < 1e-9);
});

test('cableResistance: неизвестный материал → ошибка', () => {
  assert.throws(() => cableResistance({ length: 10, section: 4, material: 'gold' }));
});

test('calculateShortCircuit: трёхфазный ток больше однофазного, оба положительны', () => {
  const r = calculateShortCircuit({
    lineVoltage: 400,
    ratedPowerKva: 250,
    shortCircuitVoltagePercent: 4.5,
    length: 30,
    section: 16,
    material: 'copper',
  });
  assert.ok(r.i3 > 0 && r.i1 > 0);
  assert.ok(r.i3 > r.i1); // фаза–ноль слабее трёхфазного из-за удвоенного сопротивления кабеля
});

test('calculateShortCircuit: чем длиннее линия, тем меньше ток КЗ', () => {
  const base = {
    lineVoltage: 400, ratedPowerKva: 250, shortCircuitVoltagePercent: 4.5, section: 16, material: 'copper',
  };
  const near = calculateShortCircuit({ ...base, length: 10 });
  const far = calculateShortCircuit({ ...base, length: 100 });
  assert.ok(near.i3 > far.i3);
});

test('checkDisconnectionByCurve: ток КЗ выше порога k·Iн → отключение обеспечено', () => {
  const r = checkDisconnectionByCurve({ singlePhaseCurrent: 600, breakerRating: 25, curve: 'C' });
  assert.equal(r.tripThreshold, 250); // 10 · 25
  assert.equal(r.ok, true);
});

test('checkDisconnectionByCurve: ток КЗ ниже порога → не обеспечено', () => {
  const r = checkDisconnectionByCurve({ singlePhaseCurrent: 200, breakerRating: 25, curve: 'C' });
  assert.equal(r.ok, false);
});

test('checkDisconnectionByCurve: некорректные данные → null', () => {
  assert.equal(checkDisconnectionByCurve({ singlePhaseCurrent: 600, breakerRating: 25, curve: 'X' }), null);
  assert.equal(checkDisconnectionByCurve({ singlePhaseCurrent: 0, breakerRating: 25, curve: 'C' }), null);
});
