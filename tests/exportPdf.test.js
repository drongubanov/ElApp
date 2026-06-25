import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_PDF_INTERNAL } from '../js/exportPdf.js';

const { buildPdfWithJpegs } = EXPORT_PDF_INTERNAL;

// Минимальные «JPEG»-байты (содержимое не парсится сборщиком — он лишь
// вкладывает их как поток DCTDecode и считает длину).
function fakeJpeg(n) {
  return new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7) % 256));
}

function page(bytesLen, w = 297, h = 210) {
  return { jpegBytes: fakeJpeg(bytesLen), pxWidth: 100, pxHeight: 70, pageWmm: w, pageHmm: h };
}

async function pdfText(blob) {
  // Декодируем как latin1, чтобы бинарные потоки не ломали поиск по структуре.
  const buf = Buffer.from(await blob.arrayBuffer());
  return buf.toString('latin1');
}

test('buildPdfWithJpegs: одна страница — валидная структура PDF', async () => {
  const blob = buildPdfWithJpegs([page(64)]);
  const text = await pdfText(blob);
  assert.ok(text.startsWith('%PDF-1.4'), 'заголовок PDF');
  assert.ok(text.includes('/Type /Catalog'));
  assert.ok(text.includes('/Count 1'));
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 1);
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});

test('buildPdfWithJpegs: три страницы — три объекта Page и Count 3', async () => {
  const blob = buildPdfWithJpegs([page(32), page(48), page(64)]);
  const text = await pdfText(blob);
  assert.ok(text.includes('/Count 3'));
  assert.equal((text.match(/\/Type \/Page\b/g) || []).length, 3);
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 3);
  // Kids перечисляет ровно три страницы.
  const kids = text.match(/\/Kids \[([^\]]*)\]/);
  assert.ok(kids, 'есть массив Kids');
  assert.equal((kids[1].match(/\d+ 0 R/g) || []).length, 3);
});

test('buildPdfWithJpegs: таблица xref согласована со смещениями объектов', async () => {
  const blob = buildPdfWithJpegs([page(40), page(50)]);
  const text = await pdfText(blob);

  // Число объектов: 2 (каталог+дерево) + 3*страниц + служебный 0 = 2+6+1 = 9.
  const sizeMatch = text.match(/\/Size (\d+)/);
  assert.ok(sizeMatch);
  const size = Number(sizeMatch[1]);
  assert.equal(size, 9);

  // Раздел xref: первая запись — свободный объект 0, далее n записей «n».
  const xrefStart = text.indexOf('\nxref\n');
  assert.ok(xrefStart > 0, 'есть таблица xref');
  const header = text.slice(xrefStart + 6, xrefStart + 6 + 20);
  assert.ok(header.startsWith(`0 ${size}`), 'заголовок xref: 0 <Size>');

  // Проверяем, что записанное в xref смещение каждого объекта реально
  // указывает на «<n> 0 obj» в теле файла.
  const lines = text.slice(xrefStart + 6).split('\n');
  // lines[0] = "0 <size>", lines[1] = свободный объект 0, далее по объекту.
  for (let n = 1; n < size; n += 1) {
    const entry = lines[1 + n];
    const offset = Number(entry.slice(0, 10));
    const at = text.slice(offset, offset + 12);
    assert.ok(at.startsWith(`${n} 0 obj`), `объект ${n}: xref-смещение указывает на «${n} 0 obj», а не «${at}»`);
  }
});

test('buildSchemePdf-style вызов: длина потока изображения совпадает с числом байт', async () => {
  const bytes = 123;
  const blob = buildPdfWithJpegs([page(bytes)]);
  const text = await pdfText(blob);
  assert.ok(text.includes(`/Length ${bytes} >>\nstream`), 'длина изображения в словаре = числу байт JPEG');
});
