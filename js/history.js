// Хранение истории расчётов в localStorage браузера.

const STORAGE_KEY = 'elapp.history.v1';
const MAX_ENTRIES = 50;

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadHistory() {
  return readRaw();
}

export function saveHistoryEntry(entry) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const history = [{ ...entry, id, timestamp: Date.now() }, ...readRaw()].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  return history;
}

export function deleteHistoryEntry(id) {
  const history = readRaw().filter((entry) => entry.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  return history;
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}
