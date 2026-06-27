// Экспорт листа схемы (js/schemeSheet.js) в PDF без серверов и сторонних
// библиотек. Геометрия и тексты отрисовываются на холсте высокого разрешения
// (браузер сам корректно выводит кириллицу системным шрифтом), затем холст
// вкладывается в одностраничный PDF как изображение JPEG (фильтр DCTDecode).
// Это даёт надёжный однокликовый PDF; для полноценного векторного
// редактирования предусмотрен экспорт в DXF.

const PX_PER_MM = 8; // ≈203 dpi — достаточно для печати схемы
const PT_PER_MM = 72 / 25.4;
const JPEG_QUALITY = 0.95;

const CANVAS_HALIGN = { left: 'left', center: 'center', right: 'right' };
const CANVAS_VALIGN = { top: 'top', middle: 'middle', baseline: 'alphabetic', bottom: 'bottom' };

/** Рисует лист (рамка, основная надпись, схема) на 2D-контексте холста. */
export function renderSheetToCanvas(sheet) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sheet.w * PX_PER_MM);
  canvas.height = Math.round(sheet.h * PX_PER_MM);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';

  sheet.segments.forEach((s) => {
    ctx.strokeStyle = s.color || '#000000';
    ctx.lineWidth = Math.max(1, s.weight * PX_PER_MM);
    ctx.beginPath();
    ctx.moveTo(s.x1 * PX_PER_MM, s.y1 * PX_PER_MM);
    ctx.lineTo(s.x2 * PX_PER_MM, s.y2 * PX_PER_MM);
    ctx.stroke();
  });

  sheet.texts.forEach((t) => {
    ctx.fillStyle = t.color || '#000000';
    ctx.font = `${t.h * PX_PER_MM}px Arial, sans-serif`;
    ctx.textAlign = CANVAS_HALIGN[t.halign] ?? 'left';
    ctx.textBaseline = CANVAS_VALIGN[t.valign] ?? 'alphabetic';
    ctx.fillText(t.text, t.x * PX_PER_MM, t.y * PX_PER_MM);
  });

  return canvas;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Собирает PDF из одного или нескольких изображений JPEG — по странице на
 * изображение. Объекты нумеруются динамически: общий каталог и узел дерева
 * страниц, затем на каждую страницу по три объекта (страница, поток с
 * содержимым, изображение-XObject).
 * @param {Array<{ jpegBytes: Uint8Array, pxWidth: number, pxHeight: number, pageWmm: number, pageHmm: number }>} pages
 */
function buildPdfWithJpegs(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;

  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (n) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  // Резервируем номера: 1 — каталог, 2 — дерево страниц, далее по 3 на страницу.
  const pageObjNums = pages.map((_, i) => 3 + i * 3); // объект /Page каждой страницы
  const objectCount = 2 + pages.length * 3 + 1; // +1 — служебный объект 0

  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  startObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  push(`<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const pageNum = 3 + i * 3;
    const contentNum = pageNum + 1;
    const imageNum = pageNum + 2;
    const pageW = (page.pageWmm * PT_PER_MM).toFixed(2);
    const pageH = (page.pageHmm * PT_PER_MM).toFixed(2);

    startObject(pageNum);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
        `/Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );

    const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
    startObject(contentNum);
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n`);
    push(content);
    push('endstream\nendobj\n');

    startObject(imageNum);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.pxWidth} /Height ${page.pxHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`,
    );
    push(page.jpegBytes);
    push('\nendstream\nendobj\n');
  });

  const xrefOffset = length;
  push(`xref\n0 ${objectCount}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n < objectCount; n += 1) {
    push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const pdf = new Uint8Array(length);
  let pos = 0;
  chunks.forEach((bytes) => {
    pdf.set(bytes, pos);
    pos += bytes.length;
  });
  return new Blob([pdf], { type: 'application/pdf' });
}

function sheetToPage(sheet) {
  const canvas = renderSheetToCanvas(sheet);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return {
    jpegBytes: base64ToBytes(base64),
    pxWidth: canvas.width,
    pxHeight: canvas.height,
    pageWmm: sheet.w,
    pageHmm: sheet.h,
  };
}

/**
 * Строит PDF-файл и возвращает Blob. Принимает один лист или массив листов
 * (например, многостраничную ведомость) — на каждый лист приходится страница.
 * @param {object|object[]} sheetOrSheets
 */
export function buildSchemePdf(sheetOrSheets) {
  const sheets = Array.isArray(sheetOrSheets) ? sheetOrSheets : [sheetOrSheets];
  if (!sheets.length) throw new Error('нет листов для экспорта');
  return buildPdfWithJpegs(sheets.map(sheetToPage));
}

// Сборка PDF-байтов не зависит от DOM (в отличие от renderSheetToCanvas) —
// экспортируем для модульной проверки таблицы xref и нумерации объектов на
// синтетических «изображениях».
export const EXPORT_PDF_INTERNAL = { buildPdfWithJpegs };
