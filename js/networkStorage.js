// Хранение древовидной схемы конструктора сети в localStorage.

const STORAGE_KEY = 'elapp.network.v2';

export function loadNetworkScheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.tree && typeof parsed.tree === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveNetworkScheme(scheme) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scheme));
}
