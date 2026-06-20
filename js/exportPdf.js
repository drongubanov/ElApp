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
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#000000';
  ctx.lineCap = 'round';

  sheet.segments.forEach((s) => {
    ctx.lineWidth = Math.max(1, s.weight * PX_PER_MM);
    ctx.beginPath();
    ctx.moveTo(s.x1 * PX_PER_MM, s.y1 * PX_PER_MM);
    ctx.lineTo(s.x2 * PX_PER_MM, s.y2 * PX_PER_MM);
    ctx.stroke();
  });

  sheet.texts.forEach((t) => {
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

/** Собирает минимальный одностраничный PDF с одним изображением JPEG. */
function buildPdfWithJpeg(jpegBytes, pxWidth, pxHeight, pageWmm, pageHmm) {
  const pageW = (pageWmm * PT_PER_MM).toFixed(2);
  const pageH = (pageHmm * PT_PER_MM).toFixed(2);
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

  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  startObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObject(3);
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  );

  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  startObject(4);
  push(`<< /Length ${encoder.encode(content).length} >>\nstream\n`);
  push(content);
  push('endstream\nendobj\n');

  startObject(5);
  push(
    `<< /Type /XObject /Subtype /Image /Width ${pxWidth} /Height ${pxHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
  );
  push(jpegBytes);
  push('\nendstream\nendobj\n');

  const xrefOffset = length;
  const objectCount = 6; // объекты 0..5
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

/** Строит PDF-файл листа схемы и возвращает Blob. */
export function buildSchemePdf(sheet) {
  const canvas = renderSheetToCanvas(sheet);
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const jpegBytes = base64ToBytes(base64);
  return buildPdfWithJpeg(jpegBytes, canvas.width, canvas.height, sheet.w, sheet.h);
}
