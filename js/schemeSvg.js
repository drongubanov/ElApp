// Отрисовка листа схемы (js/schemeSheet.js / js/specSheet.js — отрезки и тексты
// в миллиметрах, начало координат в левом верхнем углу, ось Y вниз) в виде
// инлайнового SVG для предпросмотра прямо на странице, без скачивания файла.
// Геометрия та же, что уходит в PDF/DXF, поэтому предпросмотр совпадает с тем,
// что получит пользователь при экспорте (WYSIWYG). Лист рисуется как «бумага»
// (белый фон, тёмные линии) независимо от темы интерфейса — так же, как он
// выглядит на печати и в экспортированных PDF/DXF. Модуль не зависит от DOM
// (возвращает строку), поэтому проверяется обычными модульными тестами.

const INK = '#16202c'; // цвет линий и текста на «бумаге»
const PAPER = '#ffffff';

const TEXT_ANCHOR = { left: 'start', center: 'middle', right: 'end' };
const BASELINE = { top: 'text-before-edge', middle: 'central', bottom: 'text-after-edge', baseline: 'alphabetic' };

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Преобразует один лист в SVG-разметку. Размеры viewBox заданы в миллиметрах
 * листа, а сам элемент тянется по ширине контейнера (width:100%, height:auto),
 * сохраняя пропорции на любом экране — предпросмотр адаптивен.
 *
 * @param {{ w:number, h:number, segments:Array, texts:Array, name?:string }} sheet
 * @param {{ title?: string }} [opts]  title — доступная подпись для screen reader
 * @returns {string} разметка <svg>…</svg>
 */
export function renderSheetToSvg(sheet, opts = {}) {
  if (!sheet || !(sheet.w > 0) || !(sheet.h > 0)) {
    throw new Error('renderSheetToSvg: некорректный лист');
  }
  const title = escapeXml(opts.title || `Лист ${sheet.name || ''}`.trim());
  const parts = [];
  parts.push(
    `<svg class="scheme-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheet.w} ${sheet.h}" ` +
      `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${title}">`,
  );
  parts.push(`<rect x="0" y="0" width="${sheet.w}" height="${sheet.h}" fill="${PAPER}" />`);

  // Линии: толщина задаётся в мм (как вес линии на чертеже), но не тоньше
  // 0.12 мм, иначе при сильном уменьшении масштаба штрихи исчезают.
  sheet.segments.forEach((s) => {
    const w = Math.max(0.12, Number(s.weight) || 0.25);
    parts.push(
      `<line x1="${fmt(s.x1)}" y1="${fmt(s.y1)}" x2="${fmt(s.x2)}" y2="${fmt(s.y2)}" ` +
        `stroke="${s.color || INK}" stroke-width="${fmt(w)}" stroke-linecap="round" />`,
    );
  });

  sheet.texts.forEach((t) => {
    const anchor = TEXT_ANCHOR[t.halign] || 'start';
    const baseline = BASELINE[t.valign] || 'alphabetic';
    parts.push(
      `<text x="${fmt(t.x)}" y="${fmt(t.y)}" font-size="${fmt(t.h)}" font-family="Arial, sans-serif" ` +
        `text-anchor="${anchor}" dominant-baseline="${baseline}" fill="${t.color || INK}">${escapeXml(t.text)}</text>`,
    );
  });

  parts.push('</svg>');
  return parts.join('');
}

function fmt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export const SCHEME_SVG_INTERNAL = { INK, PAPER, escapeXml };
