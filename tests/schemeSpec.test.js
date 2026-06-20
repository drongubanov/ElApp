import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecRows, buildSpecCsv } from '../js/schemeSpec.js';
import { NETWORK_TYPES } from '../js/calculations.js';

function sampleTree() {
  return {
    id: 'root',
    name: 'Главный щит',
    networkType: NETWORK_TYPES.DC,
    voltage: 24,
    hasOwnLoad: false,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 5,
    simultaneityFactor: 1,
    children: [
      {
        id: 'a',
        name: 'Освещение',
        networkType: NETWORK_TYPES.DC,
        voltage: 24,
        hasOwnLoad: true,
        known: 'power',
        knownValue: 240,
        installationMethod: 'air',
        cableCount: 1,
        cableLength: 10,
        children: [],
      },
    ],
  };
}

test('buildSpecRows: одна строка на узел, с отступом по глубине вложенности', () => {
  const rows = buildSpecRows(sampleTree());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Главный щит');
  assert.ok(rows[1].name.startsWith('— '));
  assert.equal(rows[1].breaker, '10 А');
  assert.equal(rows[1].cable, 'Cu 1.5 мм²');
});

test('buildSpecRows: ошибочный узел отражается в колонке «Ошибка»', () => {
  const tree = sampleTree();
  tree.children[0].voltage = 0; // делает узел нерасчитываемым
  const rows = buildSpecRows(tree);
  assert.ok(rows[1].error.length > 0);
});

test('buildSpecCsv: строит CSV с заголовком, BOM и разделителем «;»', () => {
  const csv = buildSpecCsv(sampleTree());
  assert.ok(csv.startsWith('﻿Узел;'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3); // заголовок + 2 узла
  assert.ok(lines[2].includes('Освещение'));
});

test('buildSpecCsv: экранирует значения, содержащие точку с запятой или кавычки', () => {
  const tree = sampleTree();
  tree.name = 'Щит "А"; резерв';
  const csv = buildSpecCsv(tree);
  assert.ok(csv.includes('"Щит ""А""; резерв"'));
});
