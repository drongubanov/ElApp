// Хранение именованных проектов схемы сети в localStorage — отдельно от
// автосохранения текущей рабочей схемы конструктора (см. networkStorage.js).
// Позволяет сохранять схему под именем и впоследствии открывать её снова.

const STORAGE_KEY = 'elapp.network.projects.v1';

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(projects) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function loadProjects() {
  return readRaw().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id) {
  return readRaw().find((project) => project.id === id) ?? null;
}

export function saveProject({ id, name, tree }) {
  const projects = readRaw();
  const now = Date.now();
  const existing = id ? projects.find((project) => project.id === id) : null;

  if (existing) {
    existing.name = name;
    existing.tree = tree;
    existing.updatedAt = now;
    writeRaw(projects);
    return existing;
  }

  const project = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    tree,
    createdAt: now,
    updatedAt: now,
  };
  projects.push(project);
  writeRaw(projects);
  return project;
}

export function deleteProject(id) {
  const projects = readRaw().filter((project) => project.id !== id);
  writeRaw(projects);
  return projects;
}

/**
 * Добавляет проект как есть (с сохранением исходного id/createdAt/updatedAt) —
 * используется при восстановлении из резервной копии, где важно отличать уже
 * восстановленные записи от новых при повторном импорте того же файла.
 * Ничего не делает, если проект с таким id уже есть.
 */
export function restoreProject(project) {
  const projects = readRaw();
  if (projects.some((p) => p.id === project.id)) return null;
  projects.push(project);
  writeRaw(projects);
  return project;
}
