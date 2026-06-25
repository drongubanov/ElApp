// Снимки (версии) схемы сети в localStorage — лёгкая «история версий» поверх
// текущей рабочей схемы: пользователь сохраняет именованные снимки и сравнивает
// их с текущей схемой (см. schemeDiff.js). Отдельно от именованных проектов
// (networkProjects.js) и автосохранения (networkStorage.js). Хранится не более
// MAX_SNAPSHOTS последних версий.

const STORAGE_KEY = 'elapp.network.snapshots.v1';
const MAX_SNAPSHOTS = 30;

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(snapshots) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

export function loadSnapshots() {
  return readRaw().sort((a, b) => b.createdAt - a.createdAt);
}

export function getSnapshot(id) {
  return readRaw().find((snapshot) => snapshot.id === id) ?? null;
}

export function saveSnapshot({ label, tree }) {
  const snapshots = readRaw();
  const snapshot = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label,
    tree,
    createdAt: Date.now(),
  };
  snapshots.push(snapshot);
  // Оставляем только MAX_SNAPSHOTS самых свежих.
  const trimmed = snapshots.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SNAPSHOTS);
  writeRaw(trimmed);
  return snapshot;
}

export function deleteSnapshot(id) {
  const snapshots = readRaw().filter((snapshot) => snapshot.id !== id);
  writeRaw(snapshots);
  return snapshots;
}

/**
 * Добавляет снимок как есть (с сохранением исходного id/createdAt) — для
 * восстановления из резервной копии, где важно отличать уже восстановленные
 * записи от новых при повторном импорте того же файла. Не учитывается в
 * лимите MAX_SNAPSHOTS — это восстановление существовавших данных, а не
 * создание новых снимков.
 */
export function restoreSnapshot(snapshot) {
  const snapshots = readRaw();
  if (snapshots.some((s) => s.id === snapshot.id)) return null;
  snapshots.push(snapshot);
  writeRaw(snapshots);
  return snapshot;
}
