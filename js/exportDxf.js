// Сериализация листа схемы (js/schemeSheet.js) в формат DXF R12 (AC1009) —
// открытый текстовый формат обмена чертежами, который AutoCAD и практически
// все CAD-программы открывают как обычный векторный чертёж (в том числе
// сохраняют затем в DWG). Кириллица кодируется управляющими последовательностями
// \U+XXXX, которые AutoCAD распознаёт независимо от кодовой страницы.

const LAYERS = [
  { name: 'FRAME', color: 7 },
  { name: 'SCHEME', color: 7 },
  { name: 'TEXT', color: 7 },
  { name: 'TITLE', color: 7 },
];

function num(value) {
  return Number(value).toFixed(3);
}

// Допустимые значения толщины линии в DXF (группа 370), сотые доли мм —
// выбираем ближайшее стандартное, чтобы AutoCAD и совместимые программы
// отрисовали линию её фактическим весом, а не одной толщиной для всех.
const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

function lineWeightCode(weightMm) {
  const target = Math.round(Number(weightMm) * 100);
  return LINEWEIGHTS.reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), LINEWEIGHTS[0]);
}

// Кодирование не-ASCII символов для DXF/AutoCAD (\U+XXXX).
function encodeText(value) {
  let out = '';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    out += code > 126 ? `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}` : ch;
  }
  return out;
}

const HALIGN = { left: 0, center: 1, right: 2 };
const VALIGN = { baseline: 0, bottom: 1, middle: 2, top: 3 };

// 24-битный «истинный цвет» DXF (группа 420) из HEX. Современные CAD (AutoCAD
// 2004+ и совместимые) отображают точный цвет; читатели, игнорирующие группу,
// используют цвет слоя (чёрный) — линия не теряется, лишь без цвета.
function trueColor(hex) {
  if (typeof hex !== 'string' || !/^#?[0-9a-f]{6}$/i.test(hex)) return null;
  return parseInt(hex.replace('#', ''), 16);
}

export function buildDxf(sheet) {
  const out = [];
  const pair = (code, value) => out.push(String(code), String(value));
  // В DXF ось Y направлена вверх — переворачиваем координаты листа.
  const fy = (y) => sheet.h - y;

  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1009');
  pair(9, '$INSUNITS');
  pair(70, 4); // миллиметры
  pair(9, '$EXTMIN');
  pair(10, num(0));
  pair(20, num(0));
  pair(9, '$EXTMAX');
  pair(10, num(sheet.w));
  pair(20, num(sheet.h));
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'TABLES');
  pair(0, 'TABLE');
  pair(2, 'LAYER');
  pair(70, LAYERS.length);
  LAYERS.forEach((layer) => {
    pair(0, 'LAYER');
    pair(2, layer.name);
    pair(70, 0);
    pair(62, layer.color);
    pair(6, 'CONTINUOUS');
  });
  pair(0, 'ENDTAB');
  pair(0, 'ENDSEC');

  pair(0, 'SECTION');
  pair(2, 'ENTITIES');

  sheet.segments.forEach((s) => {
    pair(0, 'LINE');
    pair(8, s.layer);
    const sColor = trueColor(s.color);
    if (sColor != null) pair(420, sColor);
    pair(370, lineWeightCode(s.weight));
    pair(10, num(s.x1));
    pair(20, num(fy(s.y1)));
    pair(11, num(s.x2));
    pair(21, num(fy(s.y2)));
  });

  sheet.texts.forEach((t) => {
    pair(0, 'TEXT');
    pair(8, t.layer);
    const tColor = trueColor(t.color);
    if (tColor != null) pair(420, tColor);
    pair(10, num(t.x));
    pair(20, num(fy(t.y)));
    pair(40, num(t.h));
    pair(1, encodeText(t.text));
    pair(72, HALIGN[t.halign] ?? 0);
    pair(73, VALIGN[t.valign] ?? 0);
    // При ненулевом выравнивании AutoCAD использует вторую точку привязки.
    pair(11, num(t.x));
    pair(21, num(fy(t.y)));
  });

  pair(0, 'ENDSEC');
  pair(0, 'EOF');

  return out.join('\n') + '\n';
}
