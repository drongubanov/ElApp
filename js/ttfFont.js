// Минимальный парсер TrueType-шрифта: читает только то, что нужно для
// встраивания шрифта в PDF (CIDFontType2/Identity-H) — таблицы 'head', 'hhea',
// 'maxp', 'hmtx' (метрики) и 'cmap' формата 4 (соответствие Unicode → GID для
// символов из базовой плоскости, чего достаточно для кириллицы и сопутствующих
// знаков). Сам файл шрифта встраивается в PDF целиком, без сабсеттинга —
// поэтому glyf/loca не разбираются.

function parseCmapFormat4(view, offset) {
  const segCountX2 = view.getUint16(offset + 6);
  const segCount = segCountX2 / 2;
  const endCodesOffset = offset + 14;
  const startCodesOffset = endCodesOffset + segCountX2 + 2; // +2 — reservedPad
  const idDeltaOffset = startCodesOffset + segCountX2;
  const idRangeOffsetOffset = idDeltaOffset + segCountX2;

  const map = new Map(); // codepoint -> glyphId
  for (let i = 0; i < segCount; i += 1) {
    const endCode = view.getUint16(endCodesOffset + i * 2);
    const startCode = view.getUint16(startCodesOffset + i * 2);
    if (startCode === 0xffff && endCode === 0xffff) continue;
    const idDelta = view.getInt16(idDeltaOffset + i * 2);
    const idRangeOffset = view.getUint16(idRangeOffsetOffset + i * 2);
    for (let c = startCode; c <= endCode; c += 1) {
      let gid;
      if (idRangeOffset === 0) {
        gid = (c + idDelta) & 0xffff;
      } else {
        const addr = idRangeOffsetOffset + i * 2 + idRangeOffset + (c - startCode) * 2;
        gid = view.getUint16(addr);
        if (gid !== 0) gid = (gid + idDelta) & 0xffff;
      }
      if (gid !== 0) map.set(c, gid);
    }
  }
  return map;
}

function findUnicodeCmapOffset(view, cmapOffset) {
  const numSubtables = view.getUint16(cmapOffset + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numSubtables; i += 1) {
    const rec = cmapOffset + 4 + i * 8;
    const platformID = view.getUint16(rec);
    const encodingID = view.getUint16(rec + 2);
    const subOffset = cmapOffset + view.getUint32(rec + 4);
    if (view.getUint16(subOffset) !== 4) continue; // нужен только формат 4 (BMP)
    const score = platformID === 3 && encodingID === 1 ? 2 : platformID === 0 ? 1 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = subOffset;
    }
  }
  if (best < 0) throw new Error('в шрифте не найдена подтаблица cmap формата 4 (Unicode BMP)');
  return best;
}

/** Разбирает TTF из ArrayBuffer и возвращает метрики, нужные для встраивания в PDF. */
export function parseTtf(buffer) {
  const view = new DataView(buffer);
  const numTables = view.getUint16(4);
  const tables = {};
  for (let i = 0; i < numTables; i += 1) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(
      view.getUint8(rec),
      view.getUint8(rec + 1),
      view.getUint8(rec + 2),
      view.getUint8(rec + 3),
    );
    tables[tag] = { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
  }
  for (const tag of ['head', 'hhea', 'maxp', 'hmtx', 'cmap']) {
    if (!tables[tag]) throw new Error(`в шрифте отсутствует обязательная таблица '${tag}'`);
  }

  const head = tables.head.offset;
  const unitsPerEm = view.getUint16(head + 18);
  const bbox = [
    view.getInt16(head + 36),
    view.getInt16(head + 38),
    view.getInt16(head + 40),
    view.getInt16(head + 42),
  ];

  const hhea = tables.hhea.offset;
  const ascender = view.getInt16(hhea + 4);
  const descender = view.getInt16(hhea + 6);
  const numberOfHMetrics = view.getUint16(hhea + 34);

  const numGlyphs = view.getUint16(tables.maxp.offset + 4);

  const hmtx = tables.hmtx.offset;
  const advanceWidth = (gid) => {
    const i = Math.min(gid, numberOfHMetrics - 1);
    return view.getUint16(hmtx + i * 4);
  };

  const cmap = parseCmapFormat4(view, findUnicodeCmapOffset(view, tables.cmap.offset));

  return {
    unitsPerEm,
    ascender,
    descender,
    numGlyphs,
    bbox,
    advanceWidth,
    glyphIdForCodePoint: (cp) => cmap.get(cp) || 0,
    raw: new Uint8Array(buffer),
  };
}

/** Загружает и разбирает TTF-шрифт по URL (для использования в браузере). */
export async function loadFont(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`не удалось загрузить шрифт: ${url}`);
  const buffer = await res.arrayBuffer();
  return parseTtf(buffer);
}

export const TTF_FONT_INTERNAL = { parseCmapFormat4, findUnicodeCmapOffset };
