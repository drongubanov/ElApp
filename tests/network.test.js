import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBlock, calculateLineVoltageDrop, aggregateIncoming } from '../js/network.js';
import { NETWORK_TYPES } from '../js/calculations.js';

test('calculateBlock считает ток и подбирает защиту блока', () => {
  const block = calculateBlock({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  assert.equal(block.result.I, 10);
  assert.equal(block.protection.breaker, 10);
  assert.equal(block.voltageDrop, null);
});

test('calculateBlock считает падение напряжения, если задана длина линии', () => {
  const block = calculateBlock({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 20,
  });
  const cable = block.protection.copperCable;
  const expectedDrop = (2 * 0.0175 * 20 * block.result.I) / cable.section;
  assert.ok(Math.abs(block.voltageDrop.drop - expectedDrop) < 1e-9);
  assert.equal(block.voltageDrop.material, 'copper');
});

test('calculateLineVoltageDrop возвращает null без длины линии или без подобранного кабеля', () => {
  const result = { networkType: NETWORK_TYPES.DC, voltage: 24, I: 10, powerFactor: 1 };
  assert.equal(calculateLineVoltageDrop(result, { copperCable: { section: 2.5 } }, 0), null);
  assert.equal(calculateLineVoltageDrop(result, { copperCable: null, aluminumCable: null }, 10), null);
});

test('aggregateIncoming складывает P и Q блоков и считает ток ввода', () => {
  const blockA = calculateBlock({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  const blockB = calculateBlock({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    known: 'power',
    knownValue: 120,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });

  const incoming = aggregateIncoming({
    blocks: [blockA, blockB],
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    simultaneityFactor: 1,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });

  assert.equal(incoming.result.P, 360);
  assert.equal(incoming.result.I, 15);
  assert.equal(incoming.protection.breaker, 16);
  assert.equal(incoming.sumOfBlockBreakers, 16);
});

test('aggregateIncoming учитывает коэффициент одновременности', () => {
  const blockA = calculateBlock({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  const blockB = calculateBlock({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    known: 'power',
    knownValue: 120,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });

  const incoming = aggregateIncoming({
    blocks: [blockA, blockB],
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    simultaneityFactor: 0.5,
    installationMethod: 'air',
    cableCount: 1,
  });

  assert.equal(incoming.result.P, 180);
  assert.equal(incoming.result.I, 7.5);
  assert.equal(incoming.protection.breaker, 10);
});

test('aggregateIncoming для трёхфазной сети согласован с прямым расчётом одного блока', () => {
  const block = calculateBlock({
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    powerFactor: 0.8,
    known: 'power',
    knownValue: 10000,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });

  const incoming = aggregateIncoming({
    blocks: [block],
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    simultaneityFactor: 1,
    installationMethod: 'air',
    cableCount: 1,
  });

  assert.ok(Math.abs(incoming.result.I - block.result.I) < 1e-9);
  assert.ok(Math.abs(incoming.result.P - block.result.P) < 1e-9);
});

test('aggregateIncoming: ошибка при некорректном напряжении ввода или Кс', () => {
  const block = calculateBlock({
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    known: 'power',
    knownValue: 240,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
  assert.throws(() =>
    aggregateIncoming({ blocks: [block], networkType: NETWORK_TYPES.DC, voltage: 0, installationMethod: 'air', cableCount: 1 }),
  );
  assert.throws(() =>
    aggregateIncoming({
      blocks: [block],
      networkType: NETWORK_TYPES.DC,
      voltage: 24,
      simultaneityFactor: 1.5,
      installationMethod: 'air',
      cableCount: 1,
    }),
  );
});
