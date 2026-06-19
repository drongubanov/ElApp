// Хранение схемы конструктора сети (ввод + блоки потребителей) в localStorage.

const STORAGE_KEY = 'elapp.network.v1';

export function loadNetworkScheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.blocks) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveNetworkScheme(scheme) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scheme));
}
