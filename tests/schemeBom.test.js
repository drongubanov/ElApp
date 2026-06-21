import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBom, buildBomCsv, breakerSpecLabel, cableSpecLabel } from '../js/schemeBom.js';
import { NETWORK_TYPES } from '../js/calculations.js';

function leaf(overrides) {
  return {
    networkType: NETWORK_TYPES.AC1,
    voltage: 220,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 1000,
    simultaneityFactor: 1,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    children: [],
    ...overrides,
  };
}

test('buildBom группирует одинаковые автоматы и кабели, суммируя количество и длину', () => {
  const tree = {
    id: 'root',
    name: 'ВРУ',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    simultaneityFactor: 1,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 5,
    children: [
      leaf({ id: 'a', name: 'Освещение', knownValue: 1000, cableLength: 20 }),
      leaf({ id: 'b', name: 'Розетки', knownValue: 1000, cableLength: 30 }),
      leaf({ id: 'c', name: 'Силовая', networkType: NETWORK_TYPES.AC3, voltage: 380, powerFactor: 0.85, known: 'current', knownValue: 25, cableLength: 15 }),
    ],
  };
  const bom = buildBom(tree);

  // Две одинаковые однофазные линии 1 кВт → один и тот же автомат 6 А, count 2.
  const b6 = bom.breakers.find((b) => b.breaker === 6);
  assert.ok(b6);
  assert.equal(b6.count, 2);
  assert.equal(b6.curve, null);

  // Кабель Cu 1.5 мм² используется этими двумя линиями: суммарная длина 20 + 30 = 50.
  const cable15 = bom.cables.find((c) => c.material === 'copper' && c.section === 1.5);
  assert.ok(cable15);
  assert.equal(cable15.count, 2);
  assert.equal(cable15.totalLength, 50);

  assert.equal(bom.unresolvedBreakers, 0);
  assert.equal(bom.unresolvedCables, 0);
});

test('buildBom сортирует автоматы по номиналу, а кабели по материалу и сечению', () => {
  const tree = {
    id: 'root',
    name: 'ВРУ',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    simultaneityFactor: 1,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 5,
    children: [
      leaf({ id: 'a', knownValue: 1000, cableLength: 20 }),
      leaf({ id: 'b', knownValue: 1000, cableLength: 30 }),
      leaf({ id: 'c', networkType: NETWORK_TYPES.AC3, voltage: 380, powerFactor: 0.85, known: 'current', knownValue: 25, cableLength: 15 }),
    ],
  };
  const bom = buildBom(tree);
  const ratings = bom.breakers.map((b) => b.breaker);
  assert.deepEqual(ratings, [...ratings].sort((x, y) => x - y));
  const sections = bom.cables.map((c) => c.section);
  assert.deepEqual(sections, [...sections].sort((x, y) => x - y));
});

test('buildBom: узлы 0-длины кабеля учитываются по количеству, но не добавляют метров', () => {
  const tree = leaf({
    id: 'root',
    name: 'ВРУ',
    knownValue: 1000,
    cableLength: 0,
    children: [leaf({ id: 'x', knownValue: 1000, cableLength: 0 })],
  });
  const bom = buildBom(tree);
  const cable15 = bom.cables.find((c) => c.section === 1.5);
  assert.ok(cable15);
  assert.equal(cable15.count, 2);
  assert.equal(cable15.totalLength, 0);
});

test('buildBom: узлы с ошибкой расчёта не попадают в спецификацию', () => {
  // Узел без собственной нагрузки и без нагруженных детей → ошибка расчёта,
  // и его родитель тоже не считается; оборудование для них не подбирается.
  const tree = leaf({
    id: 'root',
    name: 'ВРУ',
    hasOwnLoad: false,
    cableLength: 10,
    children: [leaf({ id: 'empty', hasOwnLoad: false, cableLength: 10 })],
  });
  const bom = buildBom(tree);
  assert.equal(bom.breakers.length, 0);
  assert.equal(bom.cables.length, 0);
});

test('buildBom различает автоматы одного номинала с разной характеристикой', () => {
  // Двигатель получает рекомендованную характеристику (C/D), обычная нагрузка — нет.
  const tree = {
    id: 'root',
    name: 'ВРУ',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    simultaneityFactor: 1,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 5,
    children: [
      leaf({ id: 'm', networkType: NETWORK_TYPES.AC3, voltage: 380, powerFactor: 0.85, known: 'current', knownValue: 10, loadType: 'motor', startCurrentRatio: 6, cableLength: 10 }),
    ],
  };
  const bom = buildBom(tree);
  const withCurve = bom.breakers.filter((b) => b.curve);
  assert.ok(withCurve.length >= 1, 'двигатель должен дать автомат с характеристикой');
});

test('breakerSpecLabel и cableSpecLabel дают читаемые наименования', () => {
  assert.equal(breakerSpecLabel({ breaker: 16, curve: null }), 'Автомат 16 А');
  assert.equal(breakerSpecLabel({ breaker: 16, curve: 'C' }), 'Автомат 16 А (характеристика C)');
  assert.equal(cableSpecLabel({ material: 'copper', section: 2.5 }), 'Кабель Cu 2.5 мм²');
  assert.equal(cableSpecLabel({ material: 'aluminum', section: 16 }), 'Кабель Al 16 мм²');
});

test('buildBomCsv формирует CSV с BOM-меткой, заголовками и обоими разделами', () => {
  const tree = {
    id: 'root',
    name: 'ВРУ',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    simultaneityFactor: 1,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 5,
    children: [leaf({ id: 'a', knownValue: 1000, cableLength: 20 })],
  };
  const csv = buildBomCsv(tree);
  assert.ok(csv.startsWith('﻿'), 'должна быть BOM-метка UTF-8');
  assert.ok(csv.includes('Раздел;Наименование;Кол-во;Ед.;Примечание'));
  assert.ok(csv.includes('Автоматические выключатели;'));
  assert.ok(csv.includes('Кабели;'));
  assert.ok(/\r\n/.test(csv), 'строки разделяются CRLF');
});
