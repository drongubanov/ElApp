import { calculate, calculateVoltageDrop, NETWORK_TYPES } from './calculations.js';
import {
  recommendProtection,
  recommendPeSection,
  INSTALLATION_LABELS,
  CABLE_TABLE,
  CABLE_TABLE_SOURCE,
  SELECTIVITY_SAFE_RATIO,
} from './tables.js';
import { calculateShortCircuit, checkDisconnectionByCurve } from './shortCircuit.js';
import { calculateTree, annotateShortCircuit, annotateVoltageDrop, DEFAULT_START_CURRENT_RATIO, EARTHING_SYSTEMS } from './network.js';
import { loadNetworkScheme, saveNetworkScheme } from './networkStorage.js';
import { loadProjects, getProject, saveProject, deleteProject } from './networkProjects.js';
import { loadSnapshots, getSnapshot, saveSnapshot, deleteSnapshot } from './schemeSnapshots.js';
import { diffSchemes, hasDiff } from './schemeDiff.js';
import { topMostSelectedIds } from './treeSelection.js';
import { buildSchemeLayout } from './schemeLayout.js';
import { buildSheet } from './schemeSheet.js';
import { buildSchemePdf } from './exportPdf.js';
import { buildDxf } from './exportDxf.js';
import { buildSpecCsv } from './schemeSpec.js';
import { buildSpecSheet } from './specSheet.js';
import { collectSchemeWarnings, VOLTAGE_DROP_LIMIT_PERCENT } from './schemeWarnings.js';
import { NODE_TEMPLATES } from './nodeTemplates.js';
import { loadHistory, saveHistoryEntry, deleteHistoryEntry, clearHistory } from './history.js';
import { formatPower, formatApparentPower, formatReactivePower, formatCurrent, formatDateTime } from './format.js';

const NETWORK_LABELS = {
  [NETWORK_TYPES.DC]: 'Постоянный ток',
  [NETWORK_TYPES.AC1]: 'Однофазная сеть',
  [NETWORK_TYPES.AC3]: 'Трёхфазная сеть',
};

const NETWORK_SHORT_LABELS = {
  [NETWORK_TYPES.DC]: 'DC',
  [NETWORK_TYPES.AC1]: '1~',
  [NETWORK_TYPES.AC3]: '3~',
};

/**
 * Текст рекомендации по сечению PE/PEN-проводника для рассчитанной защиты:
 * по правилу ПУЭ-7 (табл. 1.7.5) от сечения фазного проводника. Для меди и
 * алюминия фазные сечения различаются, поэтому показываем оба, если оба
 * подобраны. Пустая строка — если ни одно сечение не подобрано.
 */
function buildPeSectionText(protection) {
  const parts = [];
  const copperSection = protection.copperCable?.section;
  const aluminumSection = protection.aluminumCable?.section;
  if (copperSection != null) parts.push(`медь ${copperSection} мм² → не менее ${recommendPeSection(copperSection)} мм²`);
  if (aluminumSection != null) parts.push(`алюминий ${aluminumSection} мм² → не менее ${recommendPeSection(aluminumSection)} мм²`);
  if (!parts.length) return '';
  return `Минимальное сечение PE/PEN-проводника (по ПУЭ-7, табл. 1.7.5): ${parts.join('; ')}.`;
}

function pluralize(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const VOLTAGE_PLACEHOLDERS = {
  [NETWORK_TYPES.DC]: '24',
  [NETWORK_TYPES.AC1]: '220',
  [NETWORK_TYPES.AC3]: '380',
};

const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const tabNetworkPanel = document.getElementById('tab-network');

const form = document.getElementById('calc-form');
const networkTypeSelect = document.getElementById('network-type');
const voltageInput = document.getElementById('voltage');
const pfField = document.getElementById('pf-field');
const pfInput = document.getElementById('power-factor');
const pfPresetButtons = document.querySelectorAll('.pf-preset');
const knownRadios = document.querySelectorAll('input[name="known"]');
const powerField = document.getElementById('power-field');
const powerValueInput = document.getElementById('power-value');
const powerUnitSelect = document.getElementById('power-unit');
const currentField = document.getElementById('current-field');
const currentValueInput = document.getElementById('current-value');
const utilizationField = document.getElementById('utilization-field');
const utilizationInput = document.getElementById('utilization-factor');
const loadTypeSelect = document.getElementById('load-type');
const startRatioField = document.getElementById('start-ratio-field');
const startRatioInput = document.getElementById('start-ratio');
const installationMethodSelect = document.getElementById('installation-method');
const cableCountInput = document.getElementById('cable-count');
const cableLengthInput = document.getElementById('cable-length');
const errorMessage = document.getElementById('error-message');
const resultsSection = document.getElementById('results');

const resP = document.getElementById('res-p');
const resS = document.getElementById('res-s');
const resQ = document.getElementById('res-q');
const resI = document.getElementById('res-i');
const resLoadDiagram = document.getElementById('res-load-diagram');
const resBreaker = document.getElementById('res-breaker');
const resCable = document.getElementById('res-cable');
const resPeSection = document.getElementById('res-pe-section');
const resCorrection = document.getElementById('res-correction');
const resVoltageDrop = document.getElementById('res-voltage-drop');
const resPueCheck = document.getElementById('res-pue-check');
const gotoRefTableBtn = document.getElementById('goto-ref-table-btn');
const refTableSource = document.getElementById('ref-table-source');
const refCableTableBody = document.getElementById('ref-cable-table-body');

const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const clearHistoryBtn = document.getElementById('clear-history-btn');

const networkTreeEl = document.getElementById('network-tree');
const calcNetworkBtn = document.getElementById('calc-network-btn');
const undoNetworkBtn = document.getElementById('undo-network-btn');
const heatmapToggleBtn = document.getElementById('heatmap-toggle-btn');
const heatmapLegend = document.getElementById('heatmap-legend');
const heatmapLegendMin = document.getElementById('heatmap-legend-min');
const heatmapLegendMax = document.getElementById('heatmap-legend-max');
const heatmapLegendBar = document.getElementById('heatmap-legend-bar');
const netProjectsSection = document.getElementById('net-projects-section');
const netVersionsSection = document.getElementById('net-versions-section');
const exportMenuBtn = document.getElementById('export-menu-btn');
const exportDropdown = document.getElementById('export-dropdown');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportDxfBtn = document.getElementById('export-dxf-btn');
const exportSpecBtn = document.getElementById('export-spec-btn');
const exportSpecPdfBtn = document.getElementById('export-spec-pdf-btn');
const resetNetworkBtn = document.getElementById('reset-network-btn');
const networkProjectSelect = document.getElementById('network-project-select');
const openProjectBtn = document.getElementById('open-project-btn');
const saveProjectAsBtn = document.getElementById('save-project-as-btn');
const saveProjectBtn = document.getElementById('save-project-btn');
const deleteProjectBtn = document.getElementById('delete-project-btn');
const exportProjectBtn = document.getElementById('export-project-btn');
const importProjectBtn = document.getElementById('import-project-btn');
const importProjectInput = document.getElementById('import-project-input');
const networkProjectStatus = document.getElementById('network-project-status');
const saveVersionBtn = document.getElementById('save-version-btn');
const networkVersionSelect = document.getElementById('network-version-select');
const compareVersionBtn = document.getElementById('compare-version-btn');
const deleteVersionBtn = document.getElementById('delete-version-btn');
const networkDiff = document.getElementById('network-diff');
const networkDiffTitle = document.getElementById('network-diff-title');
const networkDiffList = document.getElementById('network-diff-list');
const networkErrorMessage = document.getElementById('network-error-message');
const networkWarnings = document.getElementById('network-warnings');
const netWarningsCount = document.getElementById('net-warnings-count');
const netWarningsList = document.getElementById('net-warnings-list');
const networkSearchInput = document.getElementById('network-search');
const networkSearchStatus = document.getElementById('network-search-status');
const nodeAddMenu = document.getElementById('node-add-menu');
const nodeContextMenu = document.getElementById('node-context-menu');
const contextDuplicateBtn = document.getElementById('context-duplicate-btn');
const contextDeleteBtn = document.getElementById('context-delete-btn');
const netMultiActions = document.getElementById('net-multi-actions');
const netMultiCount = document.getElementById('net-multi-count');
const multiDuplicateBtn = document.getElementById('multi-duplicate-btn');
const multiDeleteBtn = document.getElementById('multi-delete-btn');
const multiClearBtn = document.getElementById('multi-clear-btn');
const networkPanel = document.getElementById('network-panel');
const netPanelTitle = document.getElementById('net-panel-title');
const netBreadcrumb = document.getElementById('net-breadcrumb');

const nodeNameInput = document.getElementById('node-name');
const nodeHasOwnLoadInput = document.getElementById('node-has-own-load');
const nodeLoadFields = document.getElementById('node-load-fields');
const nodeNetworkTypeSelect = document.getElementById('node-network-type');
const nodeVoltageInput = document.getElementById('node-voltage');
const nodePfField = document.getElementById('node-pf-field');
const nodePfInput = document.getElementById('node-pf');
const nodePowerField = document.getElementById('node-power-field');
const nodePowerValueInput = document.getElementById('node-power-value');
const nodePowerUnitSelect = document.getElementById('node-power-unit');
const nodeCurrentField = document.getElementById('node-current-field');
const nodeCurrentValueInput = document.getElementById('node-current-value');
const nodeUtilizationField = document.getElementById('node-utilization-field');
const nodeUtilizationInput = document.getElementById('node-utilization-factor');
const nodeLoadTypeSelect = document.getElementById('node-load-type');
const nodeStartRatioField = document.getElementById('node-start-ratio-field');
const nodeStartRatioInput = document.getElementById('node-start-ratio');
const nodeTransformerField = document.getElementById('node-transformer-field');
const nodeTransformerPowerInput = document.getElementById('node-transformer-power');
const nodeTransformerUkInput = document.getElementById('node-transformer-uk');
const nodeEarthingSystemSelect = document.getElementById('node-earthing-system');
const nodeCableLegend = document.getElementById('node-cable-legend');
const nodeInstallationSelect = document.getElementById('node-installation');
const nodeCableCountInput = document.getElementById('node-cable-count');
const nodeAmbientTempInput = document.getElementById('node-ambient-temp');
const nodeInsulationSelect = document.getElementById('node-insulation');
const nodeCableLengthInput = document.getElementById('node-cable-length');
const nodePhaseField = document.getElementById('node-phase-field');
const nodePhaseL1Input = document.getElementById('node-phase-l1');
const nodePhaseL2Input = document.getElementById('node-phase-l2');
const nodePhaseL3Input = document.getElementById('node-phase-l3');
const nodeKcField = document.getElementById('node-kc-field');
const nodeKcInput = document.getElementById('node-kc');
const nodeErrorMessage = document.getElementById('node-error-message');

const nodeResultEl = document.getElementById('node-result');
const nodeResP = document.getElementById('node-res-p');
const nodeResS = document.getElementById('node-res-s');
const nodeResQ = document.getElementById('node-res-q');
const nodeResI = document.getElementById('node-res-i');
const nodeResDetails = document.getElementById('node-res-details');

function switchTab(tabName) {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
  if (tabName === 'network') {
    // Дерево было скрыто — пересчитываем координаты bezier-линий после показа.
    requestAnimationFrame(() => drawConnectors());
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

window.addEventListener('resize', () => drawConnectors());

function updateNetworkTypeUI() {
  const type = networkTypeSelect.value;
  pfField.hidden = type === NETWORK_TYPES.DC;
  voltageInput.placeholder = VOLTAGE_PLACEHOLDERS[type] ?? '';
}

function applyDefaultVoltage(type, input) {
  if (type === NETWORK_TYPES.AC1) input.value = '220';
  else if (type === NETWORK_TYPES.AC3) input.value = '380';
}

networkTypeSelect.addEventListener('change', () => {
  updateNetworkTypeUI();
  applyDefaultVoltage(networkTypeSelect.value, voltageInput);
});
updateNetworkTypeUI();

function updateKnownFieldUI() {
  const known = form.querySelector('input[name="known"]:checked').value;
  powerField.hidden = known !== 'power';
  currentField.hidden = known !== 'current';
  // Ku осмыслен только как отношение расчётной нагрузки к введённой
  // установленной мощности — для прямо заданного тока он не применяется.
  utilizationField.hidden = known !== 'power';
}

function updateLoadTypeUI() {
  startRatioField.hidden = loadTypeSelect.value !== 'motor';
}

knownRadios.forEach((radio) => radio.addEventListener('change', updateKnownFieldUI));
updateKnownFieldUI();

loadTypeSelect.addEventListener('change', updateLoadTypeUI);
updateLoadTypeUI();

pfPresetButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    pfInput.value = btn.dataset.pf;
  });
});

refTableSource.textContent = CABLE_TABLE_SOURCE;
CABLE_TABLE.forEach((row) => {
  const tr = document.createElement('tr');
  tr.dataset.section = row.section;
  tr.innerHTML = `<td>${row.section}</td><td>${row.copper}</td><td>${row.aluminum ?? '—'}</td>`;
  refCableTableBody.appendChild(tr);
});

gotoRefTableBtn.addEventListener('click', () => {
  switchTab('about');
  refCableTableBody.querySelector('tr.highlight')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

function createNode(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: 'Новый узел',
    networkType: NETWORK_TYPES.AC1,
    voltage: 220,
    powerFactor: 1,
    hasOwnLoad: true,
    known: 'power',
    knownValue: 1000,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
    ambientTemp: 25,
    insulation: 'pvc',
    phaseShares: [1, 1, 1],
    simultaneityFactor: 1,
    utilizationFactor: 1,
    loadType: 'general',
    startCurrentRatio: DEFAULT_START_CURRENT_RATIO,
    transformerPowerKva: null,
    transformerUkPercent: null,
    earthingSystem: 'TN-C-S',
    collapsed: false,
    children: [],
    ...overrides,
  };
}

function buildDefaultTree() {
  return createNode({
    name: 'Главный щит (ВРУ)',
    networkType: NETWORK_TYPES.AC3,
    voltage: 380,
    hasOwnLoad: false,
    simultaneityFactor: 0.8,
    children: [
      createNode({
        name: 'Освещение',
        networkType: NETWORK_TYPES.AC1,
        voltage: 220,
        knownValue: 1000,
      }),
      createNode({
        name: 'Силовая группа',
        networkType: NETWORK_TYPES.AC3,
        voltage: 380,
        powerFactor: 0.85,
        known: 'current',
        knownValue: 25,
        installationMethod: 'conduit',
        cableCount: 2,
        cableLength: 15,
      }),
    ],
  });
}

let networkTree = null;
let selectedNodeId = null;
let selectedNodeIds = new Set();
let lastCalcMap = null;
let lastResultTree = null;
let activeProjectId = null;
let draggedNodeId = null;
let searchQuery = '';
let searchMatchIds = new Set();
let searchPathIds = new Set();
let addMenuParentId = null;
let addMenuAnchor = null;
let heatMapEnabled = false;

const UNDO_LIMIT = 20;
let undoStack = [];

/** Сохраняет снимок дерева в стек отмены — вызывается перед деструктивными операциями (удаление, перенос, замена). */
function pushUndo() {
  if (!networkTree) return;
  undoStack.push(structuredClone(networkTree));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoButtonUI();
}

function updateUndoButtonUI() {
  undoNetworkBtn.disabled = undoStack.length === 0;
}

function findNode(node, id) {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParentNode(node, id) {
  for (const child of node.children) {
    if (child.id === id) return node;
    const found = findParentNode(child, id);
    if (found) return found;
  }
  return null;
}

function countDescendants(node) {
  return node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);
}

function isDescendantOrSelf(node, id) {
  if (node.id === id) return true;
  return node.children.some((child) => isDescendantOrSelf(child, id));
}

/** ID узла и всех его предков вплоть до корня — путь, который подсвечивается при наведении. */
function getAncestorChainIds(id) {
  const ids = new Set();
  let currentId = id;
  while (currentId) {
    ids.add(currentId);
    const parent = findParentNode(networkTree, currentId);
    currentId = parent ? parent.id : null;
  }
  return ids;
}

/** ID узла и всех его потомков на любую глубину — для подсветки всего дерева при наведении на корень. */
function collectDescendantIds(node, ids = new Set()) {
  ids.add(node.id);
  node.children.forEach((child) => collectDescendantIds(child, ids));
  return ids;
}

/** Разворачивает все свёрнутые ветви на пути от корня к узлу, чтобы он стал виден в дереве. Возвращает true, если что-то изменилось. */
function expandAncestors(nodeId) {
  let changed = false;
  let parent = findParentNode(networkTree, nodeId);
  while (parent) {
    if (parent.collapsed) {
      parent.collapsed = false;
      changed = true;
    }
    parent = findParentNode(networkTree, parent.id);
  }
  return changed;
}

/** Хлебные крошки «корень → ... → текущий узел» в заголовке панели параметров — показывают глубину/положение узла в дереве; клик по предку выделяет и прокручивает к нему. */
function renderBreadcrumb(node) {
  netBreadcrumb.innerHTML = '';
  const chainIds = Array.from(getAncestorChainIds(node.id)).reverse();
  chainIds.forEach((id, index) => {
    const ancestor = findNode(networkTree, id);
    if (!ancestor) return;
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'net-breadcrumb-sep';
      sep.textContent = '›';
      sep.setAttribute('aria-hidden', 'true');
      netBreadcrumb.appendChild(sep);
    }
    if (index === chainIds.length - 1) {
      const current = document.createElement('span');
      current.className = 'net-breadcrumb-current';
      current.textContent = ancestor.name;
      current.setAttribute('aria-current', 'true');
      netBreadcrumb.appendChild(current);
    } else {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'net-breadcrumb-link';
      link.textContent = ancestor.name;
      link.addEventListener('click', () => revealNode(ancestor.id));
      netBreadcrumb.appendChild(link);
    }
  });
}

/** Выбирает узел и прокручивает его карточку в зону видимости, разворачивая свёрнутые ветви на пути к нему. */
function revealNode(nodeId) {
  if (expandAncestors(nodeId)) persistNetworkScheme();
  selectNode(nodeId);
  requestAnimationFrame(() => {
    networkTreeEl
      .querySelector(`.net-node-wrap[data-id="${nodeId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  });
}

/**
 * По поисковому запросу собирает множества id: matchIds — узлы, чьё название
 * содержит запрос; pathIds — сами совпадения и все их предки (путь от корня),
 * которые остаются яркими, тогда как остальные узлы притеняются.
 */
function computeSearchSets(query) {
  const matchIds = new Set();
  const pathIds = new Set();
  const walk = (node, ancestors) => {
    if (node.name.toLowerCase().includes(query)) {
      matchIds.add(node.id);
      pathIds.add(node.id);
      ancestors.forEach((id) => pathIds.add(id));
    }
    node.children.forEach((child) => walk(child, [...ancestors, node.id]));
  };
  walk(networkTree, []);
  return { matchIds, pathIds };
}

/** Разворачивает свёрнутые ветви, в поддереве которых есть совпадение с запросом. Возвращает true, если что-то изменилось. */
function ensureMatchesVisible(query) {
  let changed = false;
  const walk = (node) => {
    const selfMatch = node.name.toLowerCase().includes(query);
    let descendantMatch = false;
    node.children.forEach((child) => {
      if (walk(child)) descendantMatch = true;
    });
    if (descendantMatch && node.collapsed) {
      node.collapsed = false;
      changed = true;
    }
    return selfMatch || descendantMatch;
  };
  walk(networkTree);
  return changed;
}

/** Сбрасывает поисковый фильтр (при смене дерева — открытии/импорте/сбросе/отмене). */
function clearSearch() {
  searchQuery = '';
  searchMatchIds = new Set();
  searchPathIds = new Set();
  networkSearchInput.value = '';
  networkSearchStatus.textContent = '';
}

function persistNetworkScheme() {
  if (networkTree) saveNetworkScheme({ tree: networkTree, activeProjectId });
}

function renderProjectList() {
  const projects = loadProjects();
  const previousValue = networkProjectSelect.value;
  networkProjectSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = projects.length ? '— выберите проект —' : '— нет сохранённых проектов —';
  networkProjectSelect.appendChild(placeholder);
  projects.forEach((project) => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = `${project.name} — ${formatDateTime(project.updatedAt)}`;
    networkProjectSelect.appendChild(option);
  });
  const toSelect = activeProjectId ?? previousValue;
  if (projects.some((project) => project.id === toSelect)) networkProjectSelect.value = toSelect;
  updateProjectControlsUI(projects);
}

function updateProjectControlsUI(projects = loadProjects()) {
  if (activeProjectId && !projects.some((project) => project.id === activeProjectId)) activeProjectId = null;
  const selectedId = networkProjectSelect.value;
  openProjectBtn.disabled = !selectedId;
  deleteProjectBtn.disabled = !selectedId;
  const activeProject = activeProjectId ? projects.find((project) => project.id === activeProjectId) : null;
  saveProjectBtn.hidden = !activeProject;
  networkProjectStatus.textContent = activeProject
    ? `Текущая схема — проект «${activeProject.name}», сохранён ${formatDateTime(activeProject.updatedAt)}.`
    : 'Текущая схема не сохранена как проект — нажмите «Сохранить как новый проект…», чтобы не потерять её.';
}

// --- Версии схемы и сравнение ----------------------------------------------
function renderVersionList() {
  const snapshots = loadSnapshots();
  const previousValue = networkVersionSelect.value;
  networkVersionSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = snapshots.length ? '— выберите версию —' : '— нет сохранённых версий —';
  networkVersionSelect.appendChild(placeholder);
  snapshots.forEach((snapshot) => {
    const option = document.createElement('option');
    option.value = snapshot.id;
    option.textContent = `${snapshot.label} — ${formatDateTime(snapshot.createdAt)}`;
    networkVersionSelect.appendChild(option);
  });
  if (snapshots.some((snapshot) => snapshot.id === previousValue)) networkVersionSelect.value = previousValue;
  updateVersionControlsUI();
}

function updateVersionControlsUI() {
  const selectedId = networkVersionSelect.value;
  compareVersionBtn.disabled = !selectedId;
  deleteVersionBtn.disabled = !selectedId;
}

const DIFF_FIELD_LABELS = { P: 'мощность P', I: 'ток I', breaker: 'автомат', error: 'расчёт' };

function formatDiffValue(key, value) {
  if (value == null) return '—';
  if (key === 'P') return formatPower(value);
  if (key === 'I') return formatCurrent(value);
  if (key === 'breaker') return `${value} А`;
  if (key === 'error') return 'ошибка';
  return String(value);
}

function renderDiff(diff, label) {
  networkDiff.hidden = false;
  networkDiffList.innerHTML = '';
  networkDiffTitle.textContent = `Сравнение версии «${label}» с текущей схемой`;

  if (!hasDiff(diff)) {
    const li = document.createElement('li');
    li.className = 'net-diff-item ok';
    li.textContent = '✓ Различий нет — текущая схема совпадает с этой версией.';
    networkDiffList.appendChild(li);
    return;
  }

  const addItem = (cls, text) => {
    const li = document.createElement('li');
    li.className = `net-diff-item ${cls}`;
    li.textContent = text;
    networkDiffList.appendChild(li);
  };

  diff.added.forEach((node) => addItem('added', `+ Добавлен узел «${node.name}»`));
  diff.removed.forEach((node) => addItem('removed', `− Удалён узел «${node.name}»`));
  diff.changed.forEach((node) => {
    const parts = node.fields.map((field) => {
      if (field.key === 'error') {
        return field.to ? 'появилась ошибка расчёта' : 'ошибка расчёта устранена';
      }
      return `${DIFF_FIELD_LABELS[field.key]}: ${formatDiffValue(field.key, field.from)} → ${formatDiffValue(field.key, field.to)}`;
    });
    addItem('changed', `~ «${node.name}»: ${parts.join('; ')}`);
  });
}

function nodeTag(node) {
  const isRoot = node.id === networkTree.id;
  if (isRoot) return 'Ввод';
  if (node.children.length && node.hasOwnLoad) return 'Щит + нагрузка';
  if (node.children.length) return 'Щит';
  return 'Нагрузка';
}

function nodeMeta(node) {
  if (node.hasOwnLoad) return `${NETWORK_SHORT_LABELS[node.networkType] ?? ''} ${node.voltage} В`;
  if (node.children.length) {
    const word = pluralize(node.children.length, 'дочерний узел', 'дочерних узла', 'дочерних узлов');
    return node.collapsed ? `${node.children.length} ${word} (свёрнуто)` : `${node.children.length} ${word}`;
  }
  return '';
}

function flattenCalc(calcNode, map = new Map()) {
  map.set(calcNode.id, calcNode);
  calcNode.children.forEach((child) => flattenCalc(child, map));
  return map;
}

function collectErrors(calcNode, acc = []) {
  if (calcNode.error && !calcNode.children.some((child) => child.error)) {
    acc.push(`«${calcNode.name}»: ${calcNode.error}`);
  }
  calcNode.children.forEach((child) => collectErrors(child, acc));
  return acc;
}

function addChildToNode(parentId, overrides = {}) {
  const parent = findNode(networkTree, parentId);
  if (!parent) return;
  const child = createNode(overrides);
  parent.children.push(child);
  selectedNodeId = child.id;
  selectedNodeIds = new Set([child.id]);
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

// --- Меню добавления узла (пустой узел + шаблоны типовых узлов) -------------
// Одно общее всплывающее меню на всё дерево: при клике по «+» позиционируется
// у нажатой кнопки. Пункты строятся один раз из NODE_TEMPLATES.
function buildAddMenu() {
  const items = [
    { id: 'blank', label: 'Пустой узел', hint: 'Параметры по умолчанию', node: {} },
    ...NODE_TEMPLATES,
  ];
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.className = 'net-add-menu-label';
    label.textContent = item.label;
    const hint = document.createElement('span');
    hint.className = 'net-add-menu-hint';
    hint.textContent = item.hint;
    button.append(label, hint);
    button.addEventListener('click', () => {
      const parentId = addMenuParentId;
      closeAddMenu();
      if (parentId) addChildToNode(parentId, { ...item.node });
    });
    nodeAddMenu.appendChild(button);
  });
}

// Меню позиционируется фиксированно у кнопки «+». Чтобы оно не «отрывалось»
// при прокрутке (а клик по «+» сам по себе подкручивает кнопку в зону
// видимости), меню не закрывается на скролл, а пересчитывает позицию у якоря.
function positionAddMenu() {
  if (!addMenuAnchor) return;
  const anchorRect = addMenuAnchor.getBoundingClientRect();
  const menuRect = nodeAddMenu.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + 4;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (top + menuRect.height > window.innerHeight - 8) top = anchorRect.top - menuRect.height - 4;
  nodeAddMenu.style.left = `${Math.max(8, left)}px`;
  nodeAddMenu.style.top = `${Math.max(8, top)}px`;
}

function openAddMenu(parentId, anchor) {
  addMenuParentId = parentId;
  addMenuAnchor = anchor;
  nodeAddMenu.hidden = false;
  positionAddMenu();
}

function closeAddMenu() {
  nodeAddMenu.hidden = true;
  addMenuParentId = null;
  addMenuAnchor = null;
}

buildAddMenu();

document.addEventListener('click', (event) => {
  if (!nodeAddMenu.hidden && !event.target.closest('#node-add-menu') && !event.target.closest('.net-node-add-btn')) {
    closeAddMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !nodeAddMenu.hidden) closeAddMenu();
});

window.addEventListener('scroll', () => {
  if (!nodeAddMenu.hidden) positionAddMenu();
}, true);
window.addEventListener('resize', () => {
  if (!nodeAddMenu.hidden) positionAddMenu();
});

// --- Контекстное меню карточки узла (редкие действия: дублировать, удалить) -
// Правый клик или долгое нажатие на карточке открывает компактное меню у
// точки клика — так с тулбара карточки убраны редко нужные ⧉/− и остаются
// только частые действия: параметры (⚙), свернуть/развернуть (▾/▸), добавить (+).
let contextMenuNodeId = null;
let contextMenuPoint = null;

function positionContextMenu(x, y) {
  const menuRect = nodeContextMenu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (top + menuRect.height > window.innerHeight - 8) top = window.innerHeight - menuRect.height - 8;
  nodeContextMenu.style.left = `${Math.max(8, left)}px`;
  nodeContextMenu.style.top = `${Math.max(8, top)}px`;
}

function openContextMenu(nodeId, x, y) {
  contextMenuNodeId = nodeId;
  contextMenuPoint = { x, y };
  nodeContextMenu.hidden = false;
  positionContextMenu(x, y);
}

function closeContextMenu() {
  nodeContextMenu.hidden = true;
  contextMenuNodeId = null;
  contextMenuPoint = null;
}

contextDuplicateBtn.addEventListener('click', () => {
  const id = contextMenuNodeId;
  closeContextMenu();
  if (id) duplicateNode(id);
});

contextDeleteBtn.addEventListener('click', () => {
  const id = contextMenuNodeId;
  closeContextMenu();
  if (id) deleteNode(id);
});

document.addEventListener('click', (event) => {
  if (!nodeContextMenu.hidden && !event.target.closest('#node-context-menu')) closeContextMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !nodeContextMenu.hidden) closeContextMenu();
});

// Меню — position: fixed и привязано к точке клика, а не к карточке, поэтому
// при скролле/ресайзе его не закрываем (как и меню добавления), а просто
// пересчитываем позицию у той же точки — иначе случайный скролл, вызванный
// тем же действием, что открыло меню, закрывал бы его сразу после открытия.
window.addEventListener('scroll', () => {
  if (!nodeContextMenu.hidden && contextMenuPoint) positionContextMenu(contextMenuPoint.x, contextMenuPoint.y);
}, true);
window.addEventListener('resize', () => {
  if (!nodeContextMenu.hidden && contextMenuPoint) positionContextMenu(contextMenuPoint.x, contextMenuPoint.y);
});

function deleteNode(id) {
  if (id === networkTree.id) return;
  const node = findNode(networkTree, id);
  const parent = findParentNode(networkTree, id);
  if (!node || !parent) return;
  const descendants = countDescendants(node);
  if (descendants > 0) {
    const word = pluralize(descendants, 'дочерний узел', 'дочерних узла', 'дочерних узлов');
    if (!confirm(`Удалить узел «${node.name}» и ${descendants} ${word}?`)) return;
  }
  pushUndo();
  parent.children = parent.children.filter((child) => child.id !== node.id);
  if (isDescendantOrSelf(node, selectedNodeId)) {
    selectedNodeId = parent.id;
  }
  selectedNodeIds = new Set([selectedNodeId]);
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

function cloneNodeDeepInner(node) {
  return {
    ...node,
    id: crypto.randomUUID(),
    children: node.children.map((child) => cloneNodeDeepInner(child)),
  };
}

/** Дублирует узел вместе со всем поддеревом, вставляя копию следующим соседом сразу после оригинала. */
function duplicateNode(id) {
  if (id === networkTree.id) return;
  const node = findNode(networkTree, id);
  const parent = findParentNode(networkTree, id);
  if (!node || !parent) return;
  pushUndo();
  const clone = cloneNodeDeepInner(node);
  clone.name = `${node.name} (копия)`;
  const index = parent.children.findIndex((child) => child.id === node.id);
  parent.children.splice(index + 1, 0, clone);
  selectedNodeId = clone.id;
  selectedNodeIds = new Set([clone.id]);
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

/** Переносит узел (вместе с поддеревом) под другого родителя — основа drag-and-drop в дереве. */
function moveNode(nodeId, newParentId) {
  if (nodeId === newParentId || nodeId === networkTree.id) return;
  const node = findNode(networkTree, nodeId);
  const newParent = findNode(networkTree, newParentId);
  const oldParent = findParentNode(networkTree, nodeId);
  if (!node || !newParent || !oldParent || oldParent.id === newParent.id) return;
  if (isDescendantOrSelf(node, newParentId)) return; // нельзя перенести узел в его же поддерево
  pushUndo();
  oldParent.children = oldParent.children.filter((child) => child.id !== node.id);
  newParent.children.push(node);
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

// --- Групповые операции над множественным выбором --------------------------
/** Верхние выбранные узлы (без корня) — те, чей предок не выбран; чтобы не обработать узел дважды. */
function effectiveSelectedIds() {
  return topMostSelectedIds(networkTree, selectedNodeIds).filter((id) => id !== networkTree.id);
}

function deleteSelected() {
  const ids = effectiveSelectedIds();
  if (!ids.length) return;
  const total = ids.reduce((sum, id) => sum + 1 + countDescendants(findNode(networkTree, id)), 0);
  if (!confirm(`Удалить выбранные узлы (${ids.length}) вместе с поддеревьями — всего ${total}?`)) return;
  pushUndo();
  ids.forEach((id) => {
    const parent = findParentNode(networkTree, id);
    if (parent) parent.children = parent.children.filter((child) => child.id !== id);
  });
  selectedNodeId = findNode(networkTree, selectedNodeId) ? selectedNodeId : networkTree.id;
  selectedNodeIds = new Set([selectedNodeId]);
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

function duplicateSelected() {
  const ids = effectiveSelectedIds();
  if (!ids.length) return;
  pushUndo();
  const newIds = new Set();
  ids.forEach((id) => {
    const node = findNode(networkTree, id);
    const parent = findParentNode(networkTree, id);
    if (!node || !parent) return;
    const clone = cloneNodeDeepInner(node);
    clone.name = `${node.name} (копия)`;
    const index = parent.children.findIndex((child) => child.id === id);
    parent.children.splice(index + 1, 0, clone);
    newIds.add(clone.id);
  });
  if (newIds.size) {
    selectedNodeIds = newIds;
    selectedNodeId = [...newIds][0];
  }
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

/** Переносит группу выбранных узлов под нового родителя (для группового drag-and-drop). */
function moveNodes(ids, newParentId) {
  const newParent = findNode(networkTree, newParentId);
  if (!newParent) return;
  const valid = ids.filter((id) => {
    if (id === networkTree.id) return false;
    const node = findNode(networkTree, id);
    return node && !isDescendantOrSelf(node, newParentId);
  });
  if (!valid.length) return;
  pushUndo();
  valid.forEach((id) => {
    const node = findNode(networkTree, id);
    const oldParent = findParentNode(networkTree, id);
    if (!node || !oldParent || oldParent.id === newParentId) return;
    oldParent.children = oldParent.children.filter((child) => child.id !== id);
    newParent.children.push(node);
  });
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

/** Переключает узел в множественном выборе (Ctrl+клик). */
function toggleMultiSelect(id) {
  if (selectedNodeIds.has(id) && selectedNodeIds.size > 1) {
    selectedNodeIds.delete(id);
  } else {
    selectedNodeIds.add(id);
  }
  selectedNodeId = id;
  renderTree();
  renderPanel();
}

function renderNodeEl(node) {
  const li = document.createElement('li');

  const wrap = document.createElement('div');
  wrap.className = 'net-node-wrap';
  wrap.dataset.id = node.id;
  if (node.children.length) wrap.classList.add('has-children');
  if (searchQuery) {
    if (searchMatchIds.has(node.id)) wrap.classList.add('search-match');
    if (!searchPathIds.has(node.id)) wrap.classList.add('search-dim');
  }
  wrap.addEventListener('mouseenter', () => highlightHoverPath(node.id));
  wrap.addEventListener('mouseleave', clearHoverPath);

  const isRoot = node.id === networkTree.id;

  const card = document.createElement('div');
  card.className = 'net-node';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  if (node.id === selectedNodeId) card.classList.add('selected');
  if (selectedNodeIds.size > 1 && selectedNodeIds.has(node.id)) card.classList.add('multi-selected');

  const calc = lastCalcMap?.get(node.id);
  if (calc?.error) card.classList.add('has-error');

  if (!isRoot) {
    card.draggable = true;
    card.addEventListener('dragstart', (event) => {
      draggedNodeId = node.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      draggedNodeId = null;
      card.classList.remove('dragging');
    });

    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(node.id, event.clientX, event.clientY);
    });

    let longPressTimer = null;
    card.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      const { clientX, clientY } = event.touches[0];
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        openContextMenu(node.id, clientX, clientY);
      }, 550);
    });
    card.addEventListener('touchend', () => clearTimeout(longPressTimer));
    card.addEventListener('touchmove', () => clearTimeout(longPressTimer));
  }

  card.addEventListener('dragover', (event) => {
    if (!draggedNodeId || draggedNodeId === node.id) return;
    const draggedNode = findNode(networkTree, draggedNodeId);
    if (!draggedNode || isDescendantOrSelf(draggedNode, node.id)) return;
    event.preventDefault();
    card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('drag-over');
    if (!draggedNodeId) return;
    // Если тащим один из выделенных узлов — переносим всю группу выбранных.
    if (selectedNodeIds.size > 1 && selectedNodeIds.has(draggedNodeId)) {
      moveNodes(effectiveSelectedIds(), node.id);
    } else {
      moveNode(draggedNodeId, node.id);
    }
  });

  const header = document.createElement('div');
  header.className = 'net-node-header';

  const tag = document.createElement('span');
  tag.className = 'net-node-tag';
  tag.textContent = nodeTag(node);

  const toolbar = document.createElement('div');
  toolbar.className = 'net-node-toolbar';

  const paramsBtn = document.createElement('button');
  paramsBtn.type = 'button';
  paramsBtn.className = 'net-node-icon-btn net-node-params-btn';
  paramsBtn.title = 'Параметры узла';
  paramsBtn.setAttribute('aria-label', 'Параметры узла');
  paramsBtn.textContent = '⚙';
  paramsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    selectNode(node.id);
  });
  toolbar.appendChild(paramsBtn);

  if (node.children.length) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'net-node-icon-btn net-node-toggle-btn';
    const toggleLabel = node.collapsed ? 'Развернуть ветвь' : 'Свернуть ветвь';
    toggleBtn.title = toggleLabel;
    toggleBtn.setAttribute('aria-label', toggleLabel);
    toggleBtn.textContent = node.collapsed ? '▸' : '▾';
    toggleBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      node.collapsed = !node.collapsed;
      persistNetworkScheme();
      renderTree();
    });
    toolbar.appendChild(toggleBtn);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'net-node-icon-btn net-node-add-btn';
  addBtn.title = 'Добавить дочерний узел (пустой или по шаблону)';
  addBtn.setAttribute('aria-label', 'Добавить дочерний узел');
  addBtn.setAttribute('aria-haspopup', 'true');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openAddMenu(node.id, addBtn);
  });
  toolbar.appendChild(addBtn);

  header.append(toolbar);

  const name = document.createElement('span');
  name.className = 'net-node-name';
  name.textContent = node.name;

  const meta = document.createElement('span');
  meta.className = 'net-node-meta';
  meta.textContent = nodeMeta(node);

  card.append(header, tag, name, meta);

  if (calc) {
    const badge = document.createElement('span');
    badge.className = 'net-node-badge';
    if (calc.error) {
      badge.classList.add('warn');
      badge.textContent = 'ошибка расчёта';
    } else {
      const breakerText = calc.protection.breaker ? `АВ ${calc.protection.breaker} А` : 'АВ вне диапазона';
      badge.textContent = `${formatCurrent(calc.result.I)} · ${breakerText}`;
    }
    card.appendChild(badge);
  }

  if (calc?.balance) {
    const balanceBadge = document.createElement('span');
    balanceBadge.className = 'net-node-badge caution';
    balanceBadge.textContent = '⚠ баланс нагрузки';
    card.appendChild(balanceBadge);
  }

  card.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey) toggleMultiSelect(node.id);
    else selectNode(node.id);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode(node.id);
    }
  });
  wrap.appendChild(card);
  li.appendChild(wrap);

  if (node.children.length && !node.collapsed) {
    const ul = document.createElement('ul');
    node.children.forEach((child) => ul.appendChild(renderNodeEl(child)));
    li.appendChild(ul);
  }

  return li;
}

function renderTree() {
  networkTreeEl.innerHTML = '';
  if (!networkTree) return;

  if (searchQuery) {
    const { matchIds, pathIds } = computeSearchSets(searchQuery);
    searchMatchIds = matchIds;
    searchPathIds = pathIds;
    networkTreeEl.classList.add('is-searching');
    networkSearchStatus.textContent = matchIds.size
      ? `Найдено узлов: ${matchIds.size}.`
      : 'Узлы с таким названием не найдены.';
  } else {
    networkTreeEl.classList.remove('is-searching');
    networkSearchStatus.textContent = '';
  }

  networkTreeEl.appendChild(renderNodeEl(networkTree));
  drawConnectors();
  renderMultiActions();
  renderHeatMap();
}

/** Панель групповых операций — видна, когда выбрано более одного узла. */
function renderMultiActions() {
  // Убираем из выбора узлы, которых уже нет в дереве (после смены схемы/удаления).
  for (const id of selectedNodeIds) {
    if (!findNode(networkTree, id)) selectedNodeIds.delete(id);
  }
  if (selectedNodeIds.size === 0 && selectedNodeId) selectedNodeIds.add(selectedNodeId);

  if (selectedNodeIds.size > 1) {
    netMultiActions.hidden = false;
    const count = effectiveSelectedIds().length;
    netMultiCount.textContent = `Выбрано узлов: ${selectedNodeIds.size}`;
    // Если в выборе остались только корень/вложенные — групповые операции недоступны.
    multiDuplicateBtn.disabled = count === 0;
    multiDeleteBtn.disabled = count === 0;
  } else {
    netMultiActions.hidden = true;
  }
}

/**
 * Сводная панель проверок: собирает все замечания дерева (ошибки, баланс,
 * потеря напряжения, время отключения КЗ, селективность) в один кликабельный
 * список. Показывается только после расчёта (lastResultTree); до него скрыта.
 */
function renderWarnings() {
  if (!lastResultTree) {
    networkWarnings.hidden = true;
    return;
  }
  networkWarnings.hidden = false;
  netWarningsList.innerHTML = '';

  const warnings = collectSchemeWarnings(lastResultTree);
  if (!warnings.length) {
    netWarningsCount.textContent = '';
    const li = document.createElement('li');
    li.className = 'net-warning-item ok';
    li.textContent = '✓ Все проверки пройдены: ошибок, перегрузок и превышений не обнаружено.';
    netWarningsList.appendChild(li);
    return;
  }

  netWarningsCount.textContent = `(${warnings.length})`;
  warnings.forEach((warning) => {
    const li = document.createElement('li');
    li.className = `net-warning-item ${warning.severity}`;
    li.setAttribute('role', 'button');
    li.tabIndex = 0;

    const icon = document.createElement('span');
    icon.className = 'net-warning-icon';
    icon.textContent = warning.severity === 'error' ? '✗' : '⚠';

    const body = document.createElement('span');
    body.className = 'net-warning-body';
    const name = document.createElement('strong');
    name.textContent = warning.nodeName;
    body.append(name, document.createTextNode(` — ${warning.message}`));

    li.append(icon, body);
    li.addEventListener('click', () => revealNode(warning.nodeId));
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        revealNode(warning.nodeId);
      }
    });
    netWarningsList.appendChild(li);
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Рисует кабельные линии между блоками в виде плавных bezier-кривых на
 * SVG-слое поверх дерева. Координаты считаются относительно `.net-tree`,
 * поэтому слой корректно совмещается с узлами при любой ширине и скролле.
 * Если дерево скрыто (вкладка неактивна), getBoundingClientRect даёт нули —
 * в этом случае перерисовка откладывается до показа вкладки.
 */
function drawConnectors() {
  const tree = networkTreeEl;
  let svg = tree.querySelector(':scope > .net-connectors');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'net-connectors');
    tree.insertBefore(svg, tree.firstChild);
  }
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const treeRect = tree.getBoundingClientRect();
  if (treeRect.width === 0 || treeRect.height === 0) return;

  const w = Math.ceil(treeRect.width);
  const h = Math.ceil(treeRect.height);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Кружки тока собираются отдельно и добавляются вторым проходом — после
  // всех линий, чтобы непрозрачная заливка кружка всегда перекрывала любую
  // линию (в т.ч. участки соседних ветвей), а не наоборот.
  const currentMarks = [];

  tree.querySelectorAll('.net-node-wrap.has-children').forEach((wrap) => {
    const li = wrap.parentElement;
    const childUl = li.querySelector(':scope > ul');
    if (!childUl) return;

    const pr = wrap.getBoundingClientRect();
    const px = pr.left - treeRect.left + pr.width / 2;
    const py = pr.top - treeRect.top + pr.height;

    childUl.querySelectorAll(':scope > li > .net-node-wrap').forEach((childWrap) => {
      const cr = childWrap.getBoundingClientRect();
      const cx = cr.left - treeRect.left + cr.width / 2;
      const cy = cr.top - treeRect.top;
      const midY = (py + cy) / 2;
      const childId = childWrap.dataset.id;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'net-connector');
      path.setAttribute('d', `M ${px} ${py} C ${px} ${midY}, ${cx} ${midY}, ${cx} ${cy}`);
      path.dataset.parent = wrap.dataset.id;
      path.dataset.child = childId;
      svg.appendChild(path);

      const calc = lastCalcMap?.get(childId);
      if (calc && !calc.error) {
        const midX = (px + cx) / 2;
        currentMarks.push(buildConnectorCurrentMark(childId, midX, midY, calc.result.I));
      }
    });
  });

  currentMarks.forEach((mark) => svg.appendChild(mark));
}

// Компактное представление тока для надписи внутри кружка на линии —
// без единицы измерения (не помещается рядом с числом в круге малого
// радиуса), точность снижается для больших значений, чтобы текст влезал.
function formatConnectorCurrent(amps) {
  const decimals = amps < 10 ? 2 : amps < 100 ? 1 : 0;
  return amps.toLocaleString('ru-RU', { maximumFractionDigits: decimals });
}

function buildConnectorCurrentMark(childId, x, y, amps) {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'net-connector-current');
  group.dataset.child = childId;

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', String(x));
  circle.setAttribute('cy', String(y));
  circle.setAttribute('r', '15');

  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(y));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.textContent = formatConnectorCurrent(amps);

  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = `Расчётный ток линии: ${formatCurrent(amps)}`;

  group.append(circle, text, title);
  return group;
}

// Тепловая шкала нагрузки: от холодного/бледного (малый ток) к тёплому/яркому
// (большой ток). Опорные цвета от синего к красному через циан/зелёный/жёлтый.
const LOAD_COLOR_STOPS = [
  [96, 165, 250], // #60a5fa — холодный синий (минимальная нагрузка)
  [34, 211, 238], // #22d3ee — циан
  [74, 222, 128], // #4ade80 — зелёный
  [250, 204, 21], // #facc15 — жёлтый
  [249, 115, 22], // #f97316 — оранжевый
  [239, 68, 68], //  #ef4444 — тёплый красный (максимальная нагрузка)
];

/** Цвет [r,g,b] по нормированной нагрузке t∈[0,1] (интерполяция между опорными цветами). */
function loadColorRgb(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (LOAD_COLOR_STOPS.length - 1);
  const i = Math.min(Math.floor(scaled), LOAD_COLOR_STOPS.length - 2);
  const f = scaled - i;
  const a = LOAD_COLOR_STOPS[i];
  const b = LOAD_COLOR_STOPS[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
}

// Градиент легенды строится из тех же опорных цветов, что и сама раскраска
// (LOAD_COLOR_STOPS), а не задаётся отдельно в CSS — так оба места гарантированно
// не расходятся, если шкалу когда-нибудь поменяют.
heatmapLegendBar.style.background =
  `linear-gradient(to right, ${LOAD_COLOR_STOPS.map((c, i) => `rgb(${c[0]}, ${c[1]}, ${c[2]}) ${(i / (LOAD_COLOR_STOPS.length - 1)) * 100}%`).join(', ')})`;

/** Показывает легенду тепловой карты с фактическим диапазоном токов дерева. */
function updateHeatMapLegend(range) {
  heatmapLegendMin.textContent = formatCurrent(range.min);
  heatmapLegendMax.textContent = range.max > range.min ? formatCurrent(range.max) : '';
  heatmapLegend.hidden = false;
}

function hideHeatMapLegend() {
  heatmapLegend.hidden = true;
}

/** Диапазон расчётных токов по всем рассчитанным узлам — основа для нормировки нагрузки. */
function currentRange() {
  if (!lastCalcMap) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const calc of lastCalcMap.values()) {
    if (calc.error || !calc.result) continue;
    const { I } = calc.result;
    if (I < min) min = I;
    if (I > max) max = I;
  }
  return min === Infinity ? null : { min, max };
}

/** Нормирует ток в [0,1] относительно диапазона; при равных значениях — середина шкалы. */
function normLoad(value, range) {
  if (!range || range.max <= range.min) return 0.5;
  return (value - range.min) / (range.max - range.min);
}

/** Цвет нагрузки узла/линии по его расчётному току (null — если ток не рассчитан). */
function nodeLoadColor(id, range) {
  if (!range) return null;
  const calc = lastCalcMap?.get(id);
  if (!calc || calc.error || !calc.result) return null;
  const [r, g, b] = loadColorRgb(normLoad(calc.result.I, range));
  return { solid: `rgb(${r}, ${g}, ${b})`, r, g, b };
}

/**
 * При наведении на узел подсвечивает цепочку «узел → ... → корень»: сами
 * блоки и соединяющие их линии остаются полностью видимыми, а всё
 * остальное дерево затухает (см. .is-hovering / .on-hover-path в CSS).
 * На линиях этой цепочки также появляются кружки с расчётным током.
 * При наведении на корневой узел (ВРУ) подсвечивается всё дерево целиком —
 * у корня нет предков, поэтому вместо цепочки к корню берётся поддерево.
 * Цвет линий и контуров узлов отражает нагрузку: чем выше ток на участке,
 * тем теплее (ярче) цвет; чем ниже — тем холоднее (бледнее).
 */
function highlightHoverPath(id) {
  clearHoverInlineStyles();
  const chain = id === networkTree.id ? collectDescendantIds(networkTree) : getAncestorChainIds(id);
  const range = currentRange();
  networkTreeEl.classList.add('is-hovering');

  networkTreeEl.querySelectorAll('.net-node-wrap').forEach((wrap) => {
    const on = chain.has(wrap.dataset.id);
    wrap.classList.toggle('on-hover-path', on);
    const card = wrap.querySelector('.net-node');
    const color = on ? nodeLoadColor(wrap.dataset.id, range) : null;
    if (card && color) {
      card.style.borderColor = color.solid;
      card.style.boxShadow = `0 0 0 1px ${color.solid}, 0 0 10px 2px rgba(${color.r}, ${color.g}, ${color.b}, 0.55), 0 0 26px 6px rgba(${color.r}, ${color.g}, ${color.b}, 0.3)`;
    }
  });

  networkTreeEl.querySelectorAll('.net-connector').forEach((path) => {
    const on = chain.has(path.dataset.child);
    path.classList.toggle('on-hover-path', on);
    const color = on ? nodeLoadColor(path.dataset.child, range) : null;
    if (color) {
      path.style.stroke = color.solid;
      path.style.filter = `drop-shadow(0 0 3px rgba(${color.r}, ${color.g}, ${color.b}, 0.9)) drop-shadow(0 0 10px rgba(${color.r}, ${color.g}, ${color.b}, 0.55))`;
    }
  });

  networkTreeEl.querySelectorAll('.net-connector-current').forEach((group) => {
    const on = chain.has(group.dataset.child);
    group.classList.toggle('on-hover-path', on);
    const color = on ? nodeLoadColor(group.dataset.child, range) : null;
    if (color) {
      const circle = group.querySelector('circle');
      const text = group.querySelector('text');
      if (circle) circle.style.stroke = color.solid;
      if (text) text.style.fill = color.solid;
    }
  });
}

/** Сбрасывает инлайн-цвета тепловой шкалы, возвращая элементы к стилям из CSS. */
function clearHoverInlineStyles() {
  networkTreeEl.querySelectorAll('.net-connector').forEach((path) => {
    path.style.stroke = '';
    path.style.filter = '';
  });
  networkTreeEl.querySelectorAll('.net-node').forEach((card) => {
    card.style.borderColor = '';
    card.style.boxShadow = '';
  });
  networkTreeEl.querySelectorAll('.net-connector-current circle').forEach((circle) => {
    circle.style.stroke = '';
  });
  networkTreeEl.querySelectorAll('.net-connector-current text').forEach((text) => {
    text.style.fill = '';
  });
}

function clearHoverPath() {
  networkTreeEl.classList.remove('is-hovering');
  networkTreeEl.querySelectorAll('.on-hover-path').forEach((el) => el.classList.remove('on-hover-path'));
  clearHoverInlineStyles();
  renderHeatMap();
}

/**
 * Постоянный режим тепловой карты: красит все узлы и линии дерева по их
 * расчётному току сразу после расчёта, без необходимости наводить курсор
 * на каждый узел по отдельности. Включается кнопкой «Тепловая карта» в
 * тулбаре; при наведении на узел временно перехватывается hover-подсветкой
 * (highlightHoverPath/clearHoverPath), которая по выходу курсора вызывает
 * эту функцию снова, чтобы вернуть постоянную раскраску.
 */
function renderHeatMap() {
  if (!heatMapEnabled) {
    hideHeatMapLegend();
    return;
  }
  const range = currentRange();
  if (!range) {
    hideHeatMapLegend();
    return;
  }
  updateHeatMapLegend(range);

  networkTreeEl.querySelectorAll('.net-node-wrap').forEach((wrap) => {
    const card = wrap.querySelector('.net-node');
    const color = nodeLoadColor(wrap.dataset.id, range);
    if (card && color) {
      card.style.borderColor = color.solid;
      card.style.boxShadow = `0 0 0 1px ${color.solid}, 0 0 8px 2px rgba(${color.r}, ${color.g}, ${color.b}, 0.35)`;
    }
  });

  networkTreeEl.querySelectorAll('.net-connector').forEach((path) => {
    const color = nodeLoadColor(path.dataset.child, range);
    if (color) path.style.stroke = color.solid;
  });

  networkTreeEl.querySelectorAll('.net-connector-current').forEach((group) => {
    const color = nodeLoadColor(group.dataset.child, range);
    if (color) {
      const circle = group.querySelector('circle');
      const text = group.querySelector('text');
      if (circle) circle.style.stroke = color.solid;
      if (text) text.style.fill = color.solid;
    }
  });
}

function updateNodeLoadFieldsUI() {
  nodeLoadFields.hidden = !nodeHasOwnLoadInput.checked;
}

function updateNodeKnownFieldsUI() {
  const known = document.querySelector('input[name="node-known"]:checked').value;
  nodePowerField.hidden = known !== 'power';
  nodeCurrentField.hidden = known !== 'current';
  nodePfField.hidden = nodeNetworkTypeSelect.value === NETWORK_TYPES.DC;
  nodeVoltageInput.placeholder = VOLTAGE_PLACEHOLDERS[nodeNetworkTypeSelect.value] ?? '';
  nodeUtilizationField.hidden = known !== 'power';
}

function updateNodeLoadTypeUI() {
  nodeStartRatioField.hidden = nodeLoadTypeSelect.value !== 'motor';
}

/**
 * Добавляет в панель результатов одну структурированную строку: заголовок
 * проверки, краткое значение и развёрнутое пояснение. status ('ok'|'warn'|null)
 * красит левую границу и значок — так длинный «простыни» текст превращается в
 * набор читаемых блоков с понятным статусом каждой проверки.
 */
function addResultItem(container, { label, value, note, status }) {
  const item = document.createElement('div');
  item.className = 'result-item';
  if (status) item.classList.add(status);

  const head = document.createElement('div');
  head.className = 'result-item-head';

  if (status) {
    const badge = document.createElement('span');
    badge.className = 'result-item-status';
    badge.textContent = status === 'ok' ? '✓' : '⚠';
    badge.setAttribute('aria-hidden', 'true');
    head.appendChild(badge);
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'result-item-label';
  labelEl.textContent = label;
  head.appendChild(labelEl);

  if (value) {
    const valueEl = document.createElement('span');
    valueEl.className = 'result-item-value';
    valueEl.textContent = value;
    head.appendChild(valueEl);
  }

  item.appendChild(head);

  if (note) {
    const noteEl = document.createElement('p');
    noteEl.className = 'result-item-note';
    noteEl.textContent = note;
    item.appendChild(noteEl);
  }

  container.appendChild(item);
}

function renderNodeResult(node) {
  const calc = lastCalcMap?.get(node.id);
  nodeErrorMessage.textContent = '';
  if (!calc) {
    nodeResultEl.hidden = true;
    return;
  }
  if (calc.error) {
    nodeErrorMessage.textContent = calc.error;
    nodeResultEl.hidden = true;
    return;
  }

  nodeResultEl.hidden = false;
  const { result, protection, voltageDrop, sumOfChildBreakers, maxOfChildBreakers, selectivity, installed, startCurrent } = calc;
  nodeResP.textContent = formatPower(result.P);
  nodeResS.textContent = formatApparentPower(result.S);
  nodeResQ.textContent = formatReactivePower(result.Q);
  nodeResI.textContent = formatCurrent(result.I);

  nodeResDetails.replaceChildren();

  if (installed && node.utilizationFactor < 1) {
    addResultItem(nodeResDetails, {
      label: 'Расчётная нагрузка',
      value: formatPower(calc.ownP),
      note:
        `Установленная (паспортная) мощность собственной нагрузки узла — ${formatPower(installed.P)}; ` +
        `расчётная (с учётом Ku = ${node.utilizationFactor}) используется для подбора защиты и кабеля.`,
    });
  }

  if (protection.breaker) {
    let note = '';
    let status = null;
    if (startCurrent) {
      if (protection.curveOverRange) {
        note =
          `Пусковой ток ${startCurrent.toFixed(2)} А выходит за пределы стандартных характеристик B/C/D для ` +
          'этого номинала — нужен автомат со специальной уставкой расцепителя или устройство плавного пуска.';
        status = 'warn';
      } else {
        note =
          `Пусковой ток ${startCurrent.toFixed(2)} А (Кп = ${node.startCurrentRatio}) — характеристика не ниже ` +
          `${protection.recommendedCurve} (электромагнитный расцепитель не сработает ложно при пуске).`;
      }
    }
    addResultItem(nodeResDetails, { label: 'Автоматический выключатель', value: `${protection.breaker} А`, note, status });
  } else {
    addResultItem(nodeResDetails, {
      label: 'Автоматический выключатель',
      value: '—',
      note: `Расчётный ток (${result.I.toFixed(2)} А) превышает диапазон таблицы — требуется индивидуальный подбор оборудования.`,
      status: 'warn',
    });
  }

  const cableSections = [];
  const cableAmpacities = [];
  if (protection.copperCable) {
    cableSections.push(`медь ${protection.copperCable.section} мм²`);
    cableAmpacities.push(`медь — ${protection.copperCable.ratedCurrent} А`);
  }
  if (protection.aluminumCable) {
    cableSections.push(`алюминий ${protection.aluminumCable.section} мм²`);
    cableAmpacities.push(`алюминий — ${protection.aluminumCable.ratedCurrent} А`);
  }
  const insulationLabel = node.insulation === 'xlpe' ? 'сшитый полиэтилен' : 'ПВХ';
  if (protection.tempFactor === null) {
    addResultItem(nodeResDetails, {
      label: 'Сечение кабеля',
      value: '—',
      note:
        `Температура среды ${node.ambientTemp} °C недопустима для изоляции «${insulationLabel}» — длительная ` +
        'работа кабеля невозможна (температура жилы достигнет предельной). Снизьте температуру среды или выберите ' +
        'изоляцию с более высокой допустимой температурой.',
      status: 'warn',
    });
  } else if (cableSections.length) {
    let note = `Допустимый длительный ток: ${cableAmpacities.join(', ')}.`;
    if (protection.correction < 0.999) {
      note +=
        ` Сечение подобрано с учётом поправочного коэффициента ×${protection.correction.toFixed(2)} ` +
        `(способ прокладки, число кабелей рядом, температура среды ${node.ambientTemp} °C, изоляция «${insulationLabel}»).`;
    }
    addResultItem(nodeResDetails, { label: 'Сечение кабеля', value: cableSections.join(' · '), note });
  } else {
    addResultItem(nodeResDetails, {
      label: 'Сечение кабеля',
      value: '—',
      note: 'Расчётный ток превышает диапазон табличных сечений — требуется индивидуальный подбор кабеля.',
      status: 'warn',
    });
  }

  const peText = buildPeSectionText(protection);
  if (peText) {
    addResultItem(nodeResDetails, { label: 'Защитный проводник (PE/PEN)', note: peText });
  }

  if (voltageDrop) {
    const materialLabel = voltageDrop.material === 'copper' ? 'медь' : 'алюминий';
    let note =
      `На линии ${node.cableLength} м (сечение ${voltageDrop.section} мм², ${materialLabel}): ` +
      `${voltageDrop.drop.toFixed(2)} В (${voltageDrop.dropPercent.toFixed(2)}%).`;
    let value = `${voltageDrop.dropPercent.toFixed(2)}%`;
    let status = null;
    if (calc.cumulativeVoltageDropPercent != null) {
      const withinLimit = calc.cumulativeVoltageDropPercent <= VOLTAGE_DROP_LIMIT_PERCENT;
      value = `${calc.cumulativeVoltageDropPercent.toFixed(2)}% от ввода`;
      note +=
        ` Суммарно от точки ввода: ${calc.cumulativeVoltageDropPercent.toFixed(2)}% — ` +
        `${withinLimit ? 'в пределах общепринятой нормы (≤5%)' : 'превышает общепринятую норму (≤5%), увеличьте сечение на этом или предыдущих участках'}.`;
      status = withinLimit ? 'ok' : 'warn';
    }
    addResultItem(nodeResDetails, { label: 'Падение напряжения', value, note, status });
  }

  if (node.children.length) {
    if (selectivity) {
      const verdict = {
        selective: 'обеспечена (приближённо)',
        uncertain: 'не гарантирована',
        'not-selective': 'не обеспечена',
      }[selectivity.level];
      addResultItem(nodeResDetails, {
        label: 'Селективность',
        value: verdict,
        status: selectivity.level === 'selective' ? 'ok' : 'warn',
        note:
          `Автомат узла ${protection.breaker} А, наибольший номинал среди дочерних линий — ` +
          `${selectivity.maxDownstream} А (отношение ×${selectivity.ratio.toFixed(2)}; по приближённому правилу ` +
          `селективность гарантируется при отношении ≥ ${SELECTIVITY_SAFE_RATIO}). Сумма номиналов дочерних линий — ` +
          `${sumOfChildBreakers} А (узел рассчитан по нагрузке с учётом Кс = ${node.simultaneityFactor}, а не по этой ` +
          'сумме). Полную проверку селективности выполняйте по времятоковым характеристикам аппаратов производителя.',
      });
    } else {
      addResultItem(nodeResDetails, {
        label: 'Селективность',
        value: '—',
        note:
          `Наибольший номинал среди дочерних линий — ${maxOfChildBreakers} А; сумма номиналов дочерних линий — ` +
          `${sumOfChildBreakers} А. Автомат этого узла не подобран (расчётный ток вне диапазона таблицы) — проверка ` +
          'селективности невозможна.',
      });
    }
  }

  if (calc.balance) {
    const { rawCurrent, breaker, cableAmpacity, overBreaker, overCable } = calc.balance;
    const exceeded = [];
    if (overBreaker) exceeded.push(`автомат узла (${breaker} А)`);
    if (overCable) exceeded.push(`допустимый ток кабеля (${cableAmpacity} А)`);
    addResultItem(nodeResDetails, {
      label: 'Баланс нагрузки',
      value: `${rawCurrent.toFixed(2)} А без Кс`,
      status: 'warn',
      note:
        `Без учёта коэффициента одновременности (Кс = ${node.simultaneityFactor}) суммарный ток дочерних узлов ` +
        `составил бы ${rawCurrent.toFixed(2)} А — это больше, чем ${exceeded.join(' и ')}. Защита узла держится ` +
        'только на справедливости принятого Кс, без запаса: проверьте, действительно ли дочерние линии не работают ' +
        'одновременно на полную нагрузку.',
    });
  }

  if (calc.phaseBalance) {
    const { currents, neutral, maxPhase } = calc.phaseBalance;
    const balanced = neutral < 0.01 * maxPhase;
    const overloaded = protection.breaker != null && maxPhase > protection.breaker;
    let note =
      `Токи фаз L1/L2/L3: ${currents.map((c) => `${c.toFixed(1)} А`).join(' · ')}. ` +
      `Ток в нейтрали Iн ≈ ${neutral.toFixed(1)} А (геометрическая сумма по основной гармонике; ` +
      'высшие гармоники не учитываются).';
    if (overloaded) {
      note +=
        ` ✗ Самая загруженная фаза (${maxPhase.toFixed(1)} А) превышает номинал автомата ` +
        `${protection.breaker} А, подобранного по симметричному току, — выровняйте нагрузку или увеличьте номинал.`;
    } else if (!balanced) {
      note += ' Нейтральный проводник должен быть рассчитан на этот ток (особенно PEN в системах TN-C).';
    }
    addResultItem(nodeResDetails, {
      label: 'Распределение по фазам',
      value: balanced ? 'симметрично' : `Iн ≈ ${neutral.toFixed(1)} А`,
      note,
      status: overloaded ? 'warn' : balanced ? 'ok' : null,
    });
  }

  if (calc.shortCircuit) {
    const { i3, i1, curve, earthingSystem, disconnection, thermalCheck } = calc.shortCircuit;
    let note =
      `Система заземления ${earthingSystem}. Приближённая оценка: Iкз(3) ≈ ${formatShortCircuitCurrent(i3)}, ` +
      `Iкз(1) ≈ ${formatShortCircuitCurrent(i1)} по петле «фаза–защитный проводник» (сопротивление кабелей выше ` +
      'по дереву накоплено от трансформатора; индуктивные составляющие и сопротивление выше трансформатора не ' +
      'учитываются).';
    let warn = false;
    if (disconnection?.requiresRcd) {
      note +=
        ' ⚠ В системе TT ток однофазного замыкания на землю ограничен сопротивлением заземлителей и ' +
        'максимально-токовой защитой за нормативное время не отключается — автоматическое отключение должно ' +
        'обеспечиваться УЗО (RCD).';
      warn = true;
    } else if (disconnection) {
      note += disconnection.ok
        ? ` ✓ При характеристике ${curve} отключение заведомо быстрее нормативных 0,4 с / 0,2 с.`
        : ` ✗ При характеристике ${curve} быстрое отключение не гарантировано — см. мини-калькулятор КЗ на ` +
          'вкладке «Справка».';
      warn = warn || !disconnection.ok;
    }
    if (thermalCheck) {
      note += thermalCheck.ok
        ? ` ✓ Термическая стойкость кабеля при КЗ обеспечена (мин. сечение по нагреву ` +
          `${thermalCheck.minSection.toFixed(2)} мм² ≤ фактического ${thermalCheck.actualSection} мм², ` +
          `время отключения принято ${thermalCheck.time} с).`
        : ` ✗ Термическая стойкость кабеля при КЗ не обеспечена: по нагреву требуется сечение не менее ` +
          `${thermalCheck.minSection.toFixed(2)} мм² (сейчас ${thermalCheck.actualSection} мм², время ` +
          `отключения принято ${thermalCheck.time} с) — увеличьте сечение или ускорьте отключение.`;
      warn = warn || !thermalCheck.ok;
    }
    const status = disconnection || thermalCheck ? (warn ? 'warn' : 'ok') : null;
    addResultItem(nodeResDetails, {
      label: 'Ток короткого замыкания',
      value: `Iкз(3) ≈ ${formatShortCircuitCurrent(i3)}`,
      note,
      status,
    });
  }
}

function renderPanel() {
  const node = findNode(networkTree, selectedNodeId);
  if (!node) {
    networkPanel.hidden = true;
    return;
  }
  networkPanel.hidden = false;
  netPanelTitle.textContent = node.name;
  renderBreadcrumb(node);
  nodeNameInput.value = node.name;
  nodeHasOwnLoadInput.checked = node.hasOwnLoad;
  nodeNetworkTypeSelect.value = node.networkType;
  nodeVoltageInput.value = node.voltage;
  nodePfInput.value = node.powerFactor;
  document.getElementById(node.known === 'power' ? 'node-known-power' : 'node-known-current').checked = true;
  if (node.known === 'power') {
    nodePowerUnitSelect.value = '1';
    nodePowerValueInput.value = node.knownValue || '';
  } else {
    nodeCurrentValueInput.value = node.knownValue || '';
  }
  nodeInstallationSelect.value = node.installationMethod;
  nodeCableCountInput.value = node.cableCount;
  nodeAmbientTempInput.value = node.ambientTemp ?? 25;
  nodeInsulationSelect.value = node.insulation ?? 'pvc';
  nodeCableLengthInput.value = node.cableLength || '';
  nodeKcInput.value = node.simultaneityFactor;
  nodeUtilizationInput.value = node.utilizationFactor ?? 1;
  nodeLoadTypeSelect.value = node.loadType ?? 'general';
  nodeStartRatioInput.value = node.startCurrentRatio ?? DEFAULT_START_CURRENT_RATIO;

  const isRoot = node.id === networkTree.id;
  nodeCableLegend.textContent = isRoot ? 'Вводной кабель' : 'Кабель от родительского узла';
  nodeKcField.hidden = node.children.length === 0;

  nodeTransformerField.hidden = !isRoot;
  if (isRoot) {
    nodeTransformerPowerInput.value = node.transformerPowerKva || '';
    nodeTransformerUkInput.value = node.transformerUkPercent || '';
    nodeEarthingSystemSelect.value = node.earthingSystem ?? 'TN-C-S';
  }

  const shares = Array.isArray(node.phaseShares) && node.phaseShares.length === 3 ? node.phaseShares : [1, 1, 1];
  nodePhaseField.hidden = node.networkType !== NETWORK_TYPES.AC3;
  nodePhaseL1Input.value = shares[0];
  nodePhaseL2Input.value = shares[1];
  nodePhaseL3Input.value = shares[2];

  updateNodeLoadFieldsUI();
  updateNodeKnownFieldsUI();
  updateNodeLoadTypeUI();
  renderNodeResult(node);
}

function selectNode(id) {
  selectedNodeId = id;
  selectedNodeIds = new Set([id]); // обычный клик сбрасывает множественный выбор
  renderTree();
  renderPanel();
}

function onPanelChange() {
  const node = findNode(networkTree, selectedNodeId);
  if (!node) return;
  node.name = nodeNameInput.value || 'Узел';
  node.hasOwnLoad = nodeHasOwnLoadInput.checked;
  node.networkType = nodeNetworkTypeSelect.value;
  node.voltage = Number(nodeVoltageInput.value);
  node.powerFactor = Number(nodePfInput.value);
  node.known = document.querySelector('input[name="node-known"]:checked').value;
  node.knownValue = node.known === 'power'
    ? Number(nodePowerValueInput.value) * Number(nodePowerUnitSelect.value)
    : Number(nodeCurrentValueInput.value);
  node.installationMethod = nodeInstallationSelect.value;
  node.cableCount = Number(nodeCableCountInput.value) || 1;
  node.ambientTemp = nodeAmbientTempInput.value === '' ? 25 : Number(nodeAmbientTempInput.value);
  node.insulation = nodeInsulationSelect.value;
  node.cableLength = Number(nodeCableLengthInput.value) || 0;
  node.phaseShares = [
    Number(nodePhaseL1Input.value) || 0,
    Number(nodePhaseL2Input.value) || 0,
    Number(nodePhaseL3Input.value) || 0,
  ];
  node.simultaneityFactor = Number(nodeKcInput.value) || 1;
  node.utilizationFactor = Number(nodeUtilizationInput.value) || 1;
  node.loadType = nodeLoadTypeSelect.value;
  node.startCurrentRatio = Number(nodeStartRatioInput.value) || DEFAULT_START_CURRENT_RATIO;
  if (node.id === networkTree.id) {
    node.transformerPowerKva = Number(nodeTransformerPowerInput.value) || null;
    node.transformerUkPercent = Number(nodeTransformerUkInput.value) || null;
    node.earthingSystem = nodeEarthingSystemSelect.value;
  }

  netPanelTitle.textContent = node.name;
  renderBreadcrumb(node);
  nodePhaseField.hidden = node.networkType !== NETWORK_TYPES.AC3;
  updateNodeLoadFieldsUI();
  updateNodeKnownFieldsUI();
  updateNodeLoadTypeUI();
  persistNetworkScheme();
  renderTree();
}

nodeNetworkTypeSelect.addEventListener('change', () => {
  applyDefaultVoltage(nodeNetworkTypeSelect.value, nodeVoltageInput);
  onPanelChange();
});

[
  nodeNameInput, nodeHasOwnLoadInput, nodeVoltageInput, nodePfInput,
  nodePowerValueInput, nodePowerUnitSelect, nodeCurrentValueInput, nodeInstallationSelect,
  nodeCableCountInput, nodeAmbientTempInput, nodeInsulationSelect, nodeCableLengthInput, nodeKcInput,
  nodePhaseL1Input, nodePhaseL2Input, nodePhaseL3Input,
  nodeUtilizationInput, nodeLoadTypeSelect, nodeStartRatioInput,
  nodeTransformerPowerInput, nodeTransformerUkInput, nodeEarthingSystemSelect,
  ...document.querySelectorAll('input[name="node-known"]'),
].forEach((el) => {
  el.addEventListener('input', onPanelChange);
  el.addEventListener('change', onPanelChange);
});

calcNetworkBtn.addEventListener('click', () => {
  if (!networkTree) return;
  const resultTree = annotateVoltageDrop(networkTree, annotateShortCircuit(networkTree, calculateTree(networkTree)));
  lastResultTree = resultTree;
  lastCalcMap = flattenCalc(resultTree);
  const errors = collectErrors(resultTree);
  networkErrorMessage.textContent = errors.length ? `Не удалось рассчитать: ${errors.join('; ')}.` : '';
  renderTree();
  renderPanel();
  renderWarnings();
});

networkSearchInput.addEventListener('input', () => {
  searchQuery = networkSearchInput.value.trim().toLowerCase();
  // Развернём свёрнутые ветви, в которых есть совпадение, чтобы их было видно.
  if (searchQuery && ensureMatchesVisible(searchQuery)) persistNetworkScheme();
  renderTree();
});

networkSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    clearSearch();
    renderTree();
  }
});

function performUndo() {
  if (!undoStack.length) return;
  networkTree = undoStack.pop();
  if (!findNode(networkTree, selectedNodeId)) selectedNodeId = networkTree.id;
  lastCalcMap = null;
  lastResultTree = null;
  networkErrorMessage.textContent = '';
  clearSearch();
  updateUndoButtonUI();
  persistNetworkScheme();
  renderTree();
  renderPanel();
  renderWarnings();
  renderProjectList();
}

undoNetworkBtn.addEventListener('click', performUndo);

heatmapToggleBtn.addEventListener('click', () => {
  heatMapEnabled = !heatMapEnabled;
  heatmapToggleBtn.setAttribute('aria-pressed', String(heatMapEnabled));
  heatmapToggleBtn.classList.toggle('is-active', heatMapEnabled);
  if (heatMapEnabled) renderHeatMap();
  else {
    clearHoverInlineStyles();
    hideHeatMapLegend();
  }
});

multiDuplicateBtn.addEventListener('click', duplicateSelected);
multiDeleteBtn.addEventListener('click', deleteSelected);
multiClearBtn.addEventListener('click', () => {
  selectedNodeIds = new Set([selectedNodeId]);
  renderTree();
});

// Клавиатурные сокращения на активной вкладке конструктора (и только вне полей
// ввода, чтобы не мешать редактированию текста): Delete — удалить выбранный
// узел, Ctrl/Cmd+D — дублировать его, Ctrl/Cmd+Z — отменить последнее действие.
function isEditableTarget(el) {
  if (!el) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
}

document.addEventListener('keydown', (event) => {
  if (!tabNetworkPanel.classList.contains('active') || isEditableTarget(event.target) || !networkTree) return;

  const ctrl = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const hasSelectedChild = selectedNodeId && selectedNodeId !== networkTree.id;

  if (ctrl && key === 'z' && !event.shiftKey) {
    if (undoStack.length) {
      event.preventDefault();
      performUndo();
    }
  } else if (ctrl && key === 'd') {
    event.preventDefault();
    if (selectedNodeIds.size > 1) duplicateSelected();
    else if (hasSelectedChild) duplicateNode(selectedNodeId);
  } else if (event.key === 'Delete') {
    if (selectedNodeIds.size > 1) {
      event.preventDefault();
      deleteSelected();
    } else if (hasSelectedChild) {
      event.preventDefault();
      deleteNode(selectedNodeId);
    }
  }
});

function sanitizeFileName(name) {
  return (name || 'Схема сети').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Схема сети';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildSchemeSheet() {
  const layout = buildSchemeLayout(networkTree);
  return buildSheet(layout, {
    title: networkTree.name,
    docName: 'Схема электрическая однолинейная',
    date: formatDateTime(Date.now()),
    sheet: 1,
    sheets: 1,
  });
}

// Выпадающее меню экспорта: открывается по кнопке, закрывается по выбору
// пункта, клику вне меню или клавише Esc.
function setExportMenuOpen(open) {
  exportDropdown.hidden = !open;
  exportMenuBtn.setAttribute('aria-expanded', String(open));
  exportMenuBtn.classList.toggle('is-open', open);
}

exportMenuBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  setExportMenuOpen(exportDropdown.hidden);
});

exportDropdown.addEventListener('click', () => setExportMenuOpen(false));

document.addEventListener('click', (event) => {
  if (!exportDropdown.hidden && !event.target.closest('.net-export-menu')) {
    setExportMenuOpen(false);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !exportDropdown.hidden) {
    setExportMenuOpen(false);
    exportMenuBtn.focus();
  }
});

exportPdfBtn.addEventListener('click', () => {
  if (!networkTree) return;
  try {
    const blob = buildSchemePdf(buildSchemeSheet());
    downloadBlob(blob, `${sanitizeFileName(networkTree.name)}.pdf`);
    networkErrorMessage.textContent = '';
  } catch (err) {
    networkErrorMessage.textContent = `Не удалось построить PDF: ${err.message}`;
  }
});

exportDxfBtn.addEventListener('click', () => {
  if (!networkTree) return;
  try {
    const dxf = buildDxf(buildSchemeSheet());
    downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `${sanitizeFileName(networkTree.name)}.dxf`);
    networkErrorMessage.textContent = '';
  } catch (err) {
    networkErrorMessage.textContent = `Не удалось построить DXF: ${err.message}`;
  }
});

exportSpecBtn.addEventListener('click', () => {
  if (!networkTree) return;
  try {
    const csv = buildSpecCsv(networkTree);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${sanitizeFileName(networkTree.name)} — ведомость.csv`);
    networkErrorMessage.textContent = '';
  } catch (err) {
    networkErrorMessage.textContent = `Не удалось построить ведомость: ${err.message}`;
  }
});

exportSpecPdfBtn.addEventListener('click', () => {
  if (!networkTree) return;
  try {
    const sheet = buildSpecSheet(networkTree, {
      title: networkTree.name,
      date: formatDateTime(Date.now()),
      sheet: 1,
      sheets: 1,
    });
    const blob = buildSchemePdf(sheet);
    downloadBlob(blob, `${sanitizeFileName(networkTree.name)} — ведомость.pdf`);
    networkErrorMessage.textContent = '';
  } catch (err) {
    networkErrorMessage.textContent = `Не удалось построить ведомость PDF: ${err.message}`;
  }
});

const PROJECT_FILE_FORMAT = 'elapp-network-project';

exportProjectBtn.addEventListener('click', () => {
  if (!networkTree) return;
  const data = JSON.stringify({ format: PROJECT_FILE_FORMAT, version: 1, tree: networkTree }, null, 2);
  downloadBlob(new Blob([data], { type: 'application/json' }), `${sanitizeFileName(networkTree.name)}.json`);
});

importProjectBtn.addEventListener('click', () => importProjectInput.click());

importProjectInput.addEventListener('change', () => {
  const file = importProjectInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importProjectInput.value = ''; // позволяет повторно выбрать тот же файл
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      networkErrorMessage.textContent = 'Не удалось загрузить проект: файл не является корректным JSON.';
      return;
    }
    const tree = parsed?.tree;
    if (!tree || typeof tree !== 'object' || !Array.isArray(tree.children)) {
      networkErrorMessage.textContent = 'Не удалось загрузить проект: файл не содержит схему сети в ожидаемом формате.';
      return;
    }
    if (!confirm('Загрузить схему из файла? Текущая схема будет заменена.')) return;
    pushUndo();
    networkTree = tree;
    selectedNodeId = networkTree.id;
    activeProjectId = null; // загруженный из файла проект не привязан к сохранённому
    lastCalcMap = null;
    lastResultTree = null;
    networkErrorMessage.textContent = '';
    clearSearch();
    persistNetworkScheme();
    renderTree();
    renderPanel();
    renderWarnings();
    renderProjectList();
  };
  reader.onerror = () => {
    networkErrorMessage.textContent = 'Не удалось прочитать файл проекта.';
  };
  reader.readAsText(file);
});

resetNetworkBtn.addEventListener('click', () => {
  if (!confirm('Удалить все узлы и параметры сети и начать сначала?')) return;
  pushUndo();
  networkTree = buildDefaultTree();
  selectedNodeId = networkTree.id;
  activeProjectId = null;
  lastCalcMap = null;
  lastResultTree = null;
  networkErrorMessage.textContent = '';
  clearSearch();
  persistNetworkScheme();
  renderTree();
  renderPanel();
  renderWarnings();
  renderProjectList();
});

networkProjectSelect.addEventListener('change', () => updateProjectControlsUI());

openProjectBtn.addEventListener('click', () => {
  const project = networkProjectSelect.value ? getProject(networkProjectSelect.value) : null;
  if (!project) return;
  if (!confirm(`Открыть проект «${project.name}»? Текущая схема будет заменена схемой проекта.`)) return;
  pushUndo();
  networkTree = project.tree;
  selectedNodeId = networkTree.id;
  activeProjectId = project.id;
  lastCalcMap = null;
  lastResultTree = null;
  networkErrorMessage.textContent = '';
  clearSearch();
  persistNetworkScheme();
  renderTree();
  renderPanel();
  renderWarnings();
  renderProjectList();
});

saveProjectAsBtn.addEventListener('click', () => {
  if (!networkTree) return;
  const name = prompt('Название проекта:', networkTree.name || 'Новый проект');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const project = saveProject({ name: trimmed, tree: networkTree });
  activeProjectId = project.id;
  persistNetworkScheme();
  renderProjectList();
});

saveProjectBtn.addEventListener('click', () => {
  if (!activeProjectId) return;
  const existing = getProject(activeProjectId);
  if (!existing) return;
  saveProject({ id: activeProjectId, name: existing.name, tree: networkTree });
  renderProjectList();
});

deleteProjectBtn.addEventListener('click', () => {
  const project = networkProjectSelect.value ? getProject(networkProjectSelect.value) : null;
  if (!project) return;
  if (!confirm(`Удалить проект «${project.name}»? Это действие нельзя отменить.`)) return;
  deleteProject(project.id);
  if (activeProjectId === project.id) activeProjectId = null;
  persistNetworkScheme();
  renderProjectList();
});

saveVersionBtn.addEventListener('click', () => {
  if (!networkTree) return;
  const defaultLabel = `${networkTree.name} — ${formatDateTime(Date.now())}`;
  const label = prompt('Название версии:', defaultLabel);
  if (label === null) return;
  const trimmed = label.trim() || defaultLabel;
  saveSnapshot({ label: trimmed, tree: structuredClone(networkTree) });
  renderVersionList();
});

networkVersionSelect.addEventListener('change', () => updateVersionControlsUI());

compareVersionBtn.addEventListener('click', () => {
  const snapshot = networkVersionSelect.value ? getSnapshot(networkVersionSelect.value) : null;
  if (!snapshot || !networkTree) return;
  renderDiff(diffSchemes(snapshot.tree, networkTree), snapshot.label);
});

deleteVersionBtn.addEventListener('click', () => {
  const snapshot = networkVersionSelect.value ? getSnapshot(networkVersionSelect.value) : null;
  if (!snapshot) return;
  if (!confirm(`Удалить версию «${snapshot.label}»? Это действие нельзя отменить.`)) return;
  deleteSnapshot(snapshot.id);
  networkDiff.hidden = true;
  renderVersionList();
});

// --- Сворачиваемые секции «Проекты сети» и «Версии и сравнение» -------------
// По умолчанию обе свёрнуты, чтобы не отвлекать от дерева; состояние каждой
// запоминается в localStorage, чтобы постоянно открытая у конкретного
// пользователя секция не сворачивалась при каждой перезагрузке.
const NET_SECTIONS_KEY = 'elapp.netSections.v1';

function loadNetSectionsState() {
  try {
    return JSON.parse(localStorage.getItem(NET_SECTIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function persistNetSectionsState() {
  const state = { projects: netProjectsSection.open, versions: netVersionsSection.open };
  localStorage.setItem(NET_SECTIONS_KEY, JSON.stringify(state));
}

const netSectionsState = loadNetSectionsState();
netProjectsSection.open = Boolean(netSectionsState.projects);
netVersionsSection.open = Boolean(netSectionsState.versions);
netProjectsSection.addEventListener('toggle', persistNetSectionsState);
netVersionsSection.addEventListener('toggle', persistNetSectionsState);

const savedNetworkScheme = loadNetworkScheme();
networkTree = savedNetworkScheme ? savedNetworkScheme.tree : buildDefaultTree();
selectedNodeId = networkTree.id;
selectedNodeIds = new Set([networkTree.id]);
activeProjectId = savedNetworkScheme?.activeProjectId ?? null;
if (!savedNetworkScheme) persistNetworkScheme();
updateUndoButtonUI();
renderTree();
renderPanel();
renderProjectList();
renderVersionList();

function showError(message) {
  errorMessage.textContent = message;
  resultsSection.hidden = true;
}

function renderResults(result, protection, line, extra = {}) {
  const { installed, utilizationFactor = 1, startCurrent = null, startCurrentRatio = null } = extra;
  resP.textContent = formatPower(result.P);
  resS.textContent = formatApparentPower(result.S);
  resQ.textContent = formatReactivePower(result.Q);
  resI.textContent = formatCurrent(result.I);

  resLoadDiagram.textContent =
    installed && utilizationFactor < 1
      ? `Установленная (паспортная) мощность: ${formatPower(installed.P)}; расчётная мощность с учётом Ku = ` +
        `${utilizationFactor}: ${formatPower(result.P)} — используется для подбора защиты и кабеля.`
      : '';

  let breakerText = protection.breaker
    ? `Рекомендуемый автоматический выключатель: ${protection.breaker} А (расчётный ток ${result.I.toFixed(2)} А)`
    : `Расчётный ток (${result.I.toFixed(2)} А) превышает диапазон таблицы — требуется индивидуальный подбор оборудования.`;
  if (startCurrent) {
    breakerText += protection.curveOverRange
      ? ` Пусковой ток ${startCurrent.toFixed(2)} А выходит за пределы стандартных характеристик B/C/D для этого ` +
        'номинала — нужен автомат со специальной уставкой расцепителя или устройство плавного пуска.'
      : ` Пусковой ток ${startCurrent.toFixed(2)} А (Кп = ${startCurrentRatio}) — характеристика не ниже ` +
        `${protection.recommendedCurve} (электромагнитный расцепитель не сработает ложно при пуске).`;
  }
  resBreaker.textContent = breakerText;

  const cableParts = [];
  if (protection.copperCable) {
    cableParts.push(`медь — ${protection.copperCable.section} мм² (доп. ток ${protection.copperCable.ratedCurrent} А)`);
  }
  if (protection.aluminumCable) {
    cableParts.push(`алюминий — ${protection.aluminumCable.section} мм² (доп. ток ${protection.aluminumCable.ratedCurrent} А)`);
  }
  resCable.textContent = cableParts.length
    ? `Рекомендуемое сечение кабеля: ${cableParts.join('; ')}`
    : 'Расчётный ток превышает диапазон табличных сечений — требуется индивидуальный подбор кабеля.';

  resPeSection.textContent = buildPeSectionText(protection);

  const methodLabel = INSTALLATION_LABELS[line.installationMethod] ?? '';
  resCorrection.textContent = protection.correction < 1
    ? `Условия прокладки: ${methodLabel}, кабелей рядом — ${line.cableCount} (поправочный коэффициент ×${protection.correction.toFixed(2)}).`
    : `Условия прокладки: ${methodLabel}, кабелей рядом — ${line.cableCount}.`;

  resVoltageDrop.textContent = '';
  resVoltageDrop.classList.remove('warn');
  const dropCable = protection.copperCable ?? protection.aluminumCable;
  if (line.cableLength > 0 && dropCable) {
    const material = protection.copperCable ? 'copper' : 'aluminum';
    const drop = calculateVoltageDrop({
      networkType: result.networkType,
      voltage: result.voltage,
      current: result.I,
      length: line.cableLength,
      section: dropCable.section,
      material,
      powerFactor: result.powerFactor,
    });
    const withinLimit = drop.dropPercent <= VOLTAGE_DROP_LIMIT_PERCENT;
    const materialLabel = material === 'copper' ? 'медь' : 'алюминий';
    resVoltageDrop.textContent =
      `Потеря напряжения на линии ${line.cableLength} м (сечение ${dropCable.section} мм², ${materialLabel}): ` +
      `${drop.drop.toFixed(2)} В (${drop.dropPercent.toFixed(2)}%) — ` +
      `${withinLimit ? 'в пределах общепринятой нормы (≤5%)' : 'превышает общепринятую норму (≤5%), увеличьте сечение'}.`;
    resVoltageDrop.classList.toggle('warn', !withinLimit);
  }

  refCableTableBody.querySelectorAll('tr.highlight').forEach((tr) => tr.classList.remove('highlight'));
  const matchedSections = [protection.copperCable?.section, protection.aluminumCable?.section].filter((s) => s != null);
  matchedSections.forEach((section) => {
    refCableTableBody.querySelector(`tr[data-section="${section}"]`)?.classList.add('highlight');
  });

  if (matchedSections.length) {
    resPueCheck.textContent =
      `✓ Соответствует таблице ПУЭ-7 (гл. 1.3): расчётный ток ${result.I.toFixed(2)} А не превышает ` +
      'допустимый ток выбранного сечения — см. выделенную строку на вкладке «Справка».';
    gotoRefTableBtn.hidden = false;
  } else {
    resPueCheck.textContent = '';
    gotoRefTableBtn.hidden = true;
  }

  resultsSection.hidden = false;
}

function buildHistorySummary(result) {
  const label = NETWORK_LABELS[result.networkType];
  return `${label}: ${formatPower(result.P)}, ${formatCurrent(result.I)} при ${result.voltage} В`;
}

function renderHistory() {
  const entries = loadHistory();
  historyList.innerHTML = '';
  historyEmpty.hidden = entries.length > 0;

  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.dataset.id = entry.id;

    const main = document.createElement('div');
    main.className = 'history-main';

    const time = document.createElement('div');
    time.className = 'history-time';
    time.textContent = formatDateTime(entry.timestamp);

    const summary = document.createElement('div');
    summary.className = 'history-summary';
    summary.textContent = entry.summary;

    main.append(time, summary);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-entry-btn';
    deleteBtn.type = 'button';
    deleteBtn.setAttribute('aria-label', 'Удалить запись');
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteHistoryEntry(entry.id);
      renderHistory();
    });

    li.append(main, deleteBtn);
    li.addEventListener('click', () => restoreFromHistory(entry));
    historyList.appendChild(li);
  });
}

function runCalculation(
  {
    networkType, voltage, powerFactor, known, knownValue, installationMethod, cableCount, cableLength,
    utilizationFactor = 1, loadType = 'general', startCurrentRatio = DEFAULT_START_CURRENT_RATIO,
  },
  { persist },
) {
  errorMessage.textContent = '';
  try {
    const installed = calculate({ networkType, voltage, powerFactor, known, knownValue });
    const ku = known === 'power' && utilizationFactor > 0 && utilizationFactor <= 1 ? utilizationFactor : 1;
    const result = ku === 1
      ? installed
      : { ...installed, P: installed.P * ku, Q: installed.Q * ku, S: installed.S * ku, I: installed.I * ku };

    const startCurrent = loadType === 'motor'
      ? result.I * (startCurrentRatio > 0 ? startCurrentRatio : DEFAULT_START_CURRENT_RATIO)
      : null;

    const protection = recommendProtection(result.I, { installationMethod, cableCount, startCurrent });
    renderResults(result, protection, { installationMethod, cableCount, cableLength }, {
      installed: ku < 1 ? installed : null,
      utilizationFactor: ku,
      startCurrent,
      startCurrentRatio,
    });

    if (persist) {
      saveHistoryEntry({
        input: {
          networkType, voltage, powerFactor, known, knownValue, installationMethod, cableCount, cableLength,
          utilizationFactor: ku, loadType, startCurrentRatio,
        },
        summary: buildHistorySummary(result),
      });
      renderHistory();
    }
  } catch (err) {
    showError(err.message);
  }
}

function restoreFromHistory(entry) {
  const { input } = entry;
  networkTypeSelect.value = input.networkType;
  updateNetworkTypeUI();
  voltageInput.value = input.voltage;
  pfInput.value = input.powerFactor;
  form.querySelector(`input[name="known"][value="${input.known}"]`).checked = true;
  updateKnownFieldUI();
  if (input.known === 'power') {
    powerUnitSelect.value = '1';
    powerValueInput.value = input.knownValue;
  } else {
    currentValueInput.value = input.knownValue;
  }
  const installationMethod = input.installationMethod ?? 'air';
  const cableCount = input.cableCount ?? 1;
  const cableLength = input.cableLength ?? 0;
  const utilizationFactor = input.utilizationFactor ?? 1;
  const loadType = input.loadType ?? 'general';
  const startCurrentRatio = input.startCurrentRatio ?? DEFAULT_START_CURRENT_RATIO;
  installationMethodSelect.value = installationMethod;
  cableCountInput.value = cableCount;
  cableLengthInput.value = cableLength || '';
  utilizationInput.value = utilizationFactor;
  loadTypeSelect.value = loadType;
  startRatioInput.value = startCurrentRatio;
  updateLoadTypeUI();
  switchTab('calc');
  runCalculation({ ...input, installationMethod, cableCount, cableLength, utilizationFactor, loadType, startCurrentRatio }, { persist: false });
}

clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Удалить всю историю расчётов?')) {
    clearHistory();
    renderHistory();
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const networkType = networkTypeSelect.value;
  const voltage = Number(voltageInput.value);
  const powerFactor = Number(pfInput.value);
  const known = form.querySelector('input[name="known"]:checked').value;
  const knownValue = known === 'power'
    ? Number(powerValueInput.value) * Number(powerUnitSelect.value)
    : Number(currentValueInput.value);
  const installationMethod = installationMethodSelect.value;
  const cableCount = Number(cableCountInput.value) || 1;
  const cableLength = Number(cableLengthInput.value) || 0;
  const utilizationFactor = Number(utilizationInput.value) || 1;
  const loadType = loadTypeSelect.value;
  const startCurrentRatio = Number(startRatioInput.value) || DEFAULT_START_CURRENT_RATIO;

  runCalculation(
    {
      networkType, voltage, powerFactor, known, knownValue, installationMethod, cableCount, cableLength,
      utilizationFactor, loadType, startCurrentRatio,
    },
    { persist: true },
  );
});

// --- Перекрёстные ссылки из калькулятора в справочник -----------------------
// Ссылки с классом ref-link открывают вкладку «Справка» и прокручивают к
// нужной главе (внутри неактивной вкладки якоря не работают сами по себе).
document.addEventListener('click', (event) => {
  const link = event.target.closest('a.ref-link');
  if (!link) return;
  event.preventDefault();
  const targetId = (link.getAttribute('href') || '').replace('#', '');
  if (!targetId) return;
  switchTab('about');
  requestAnimationFrame(() => {
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// --- Мини-калькулятор тока КЗ ------------------------------------------------
const scLineVoltageInput = document.getElementById('sc-line-voltage');
const scTransformerPowerInput = document.getElementById('sc-transformer-power');
const scUkInput = document.getElementById('sc-uk');
const scMaterialSelect = document.getElementById('sc-material');
const scLengthInput = document.getElementById('sc-length');
const scSectionInput = document.getElementById('sc-section');
const scBreakerInput = document.getElementById('sc-breaker');
const scCurveSelect = document.getElementById('sc-curve');
const scIcuInput = document.getElementById('sc-icu');
const scCalcBtn = document.getElementById('sc-calc-btn');
const scError = document.getElementById('sc-error');
const scResult = document.getElementById('sc-result');
const scResImpedance = document.getElementById('sc-res-impedance');
const scResI3 = document.getElementById('sc-res-i3');
const scResI1 = document.getElementById('sc-res-i1');
const scResIcu = document.getElementById('sc-res-icu');
const scResTime = document.getElementById('sc-res-time');

/** Ток КЗ в А или кА (для крупных значений) с разделителями разрядов. */
function formatShortCircuitCurrent(amps) {
  if (amps >= 1000) {
    return `${(amps / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} кА (${amps.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} А)`;
  }
  return `${amps.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} А`;
}

function runShortCircuitCalculation() {
  scError.textContent = '';
  const lineVoltage = Number(scLineVoltageInput.value);
  const ratedPowerKva = Number(scTransformerPowerInput.value);
  const shortCircuitVoltagePercent = Number(scUkInput.value);
  const material = scMaterialSelect.value;
  const length = Number(scLengthInput.value);
  const section = Number(scSectionInput.value);

  if (!(lineVoltage > 0) || !(ratedPowerKva > 0) || !(shortCircuitVoltagePercent > 0)
    || !(length > 0) || !(section > 0)) {
    scResult.hidden = true;
    scError.textContent =
      'Заполните напряжение, мощность и uк трансформатора, длину и сечение кабеля положительными числами.';
    return;
  }

  let r;
  try {
    r = calculateShortCircuit({ lineVoltage, ratedPowerKva, shortCircuitVoltagePercent, length, section, material });
  } catch (err) {
    scResult.hidden = true;
    scError.textContent = err.message;
    return;
  }

  scResImpedance.textContent =
    `Сопротивление трансформатора Zт ≈ ${r.zT.toFixed(4)} Ом, сопротивление кабеля Rкаб ≈ ` +
    `${r.rCable.toFixed(4)} Ом (на одну жилу).`;
  scResI3.textContent = `Ток трёхфазного КЗ Iкз(3) ≈ ${formatShortCircuitCurrent(r.i3)} — для проверки отключающей способности автомата.`;
  scResI1.textContent = `Ток однофазного КЗ «фаза — ноль» Iкз(1) ≈ ${formatShortCircuitCurrent(r.i1)} — для проверки времени автоматического отключения.`;

  // Проверка отключающей способности Icu ≥ Iкз(3).
  const icuKa = Number(scIcuInput.value);
  scResIcu.classList.remove('warn');
  if (icuKa > 0) {
    const ok = icuKa * 1000 >= r.i3;
    scResIcu.textContent = ok
      ? `✓ Отключающая способность Icu = ${icuKa} кА ≥ Iкз(3) (${formatShortCircuitCurrent(r.i3)}) — автомат подходит по Icu.`
      : `✗ Отключающая способность Icu = ${icuKa} кА меньше Iкз(3) (${formatShortCircuitCurrent(r.i3)}) — нужен автомат с большей Icu.`;
    scResIcu.classList.toggle('warn', !ok);
  } else {
    scResIcu.textContent = '';
  }

  // Проверка времени отключения по характеристике автомата.
  const breakerRating = Number(scBreakerInput.value);
  scResTime.classList.remove('warn');
  if (breakerRating > 0) {
    const check = checkDisconnectionByCurve({ singlePhaseCurrent: r.i1, breakerRating, curve: scCurveSelect.value });
    if (check) {
      scResTime.textContent = check.ok
        ? `✓ Iкз(1) (${formatShortCircuitCurrent(r.i1)}) ≥ порога мгновенного расцепления ${Math.round(check.tripThreshold)} А ` +
          `(${scCurveSelect.value}·${breakerRating}) — отключение заведомо быстрее нормативных 0,4 с / 0,2 с.`
        : `✗ Iкз(1) (${formatShortCircuitCurrent(r.i1)}) ниже порога мгновенного расцепления ${Math.round(check.tripThreshold)} А ` +
          `(${scCurveSelect.value}·${breakerRating}) — быстрое отключение не гарантировано: уменьшите длину, увеличьте сечение ` +
          'или выберите характеристику с меньшей кратностью (C→B) либо примените УЗО.';
      scResTime.classList.toggle('warn', !check.ok);
    } else {
      scResTime.textContent = '';
    }
  } else {
    scResTime.textContent = '';
  }

  scResult.hidden = false;
}

scCalcBtn.addEventListener('click', runShortCircuitCalculation);

// --- Поиск по глоссарию -----------------------------------------------------
const glossarySearchInput = document.getElementById('glossary-search');
const glossaryItems = Array.from(document.querySelectorAll('#glossary-list .glossary-item'));
const glossaryEmpty = document.getElementById('glossary-empty');

glossarySearchInput.addEventListener('input', () => {
  const query = glossarySearchInput.value.trim().toLowerCase();
  let visibleCount = 0;
  glossaryItems.forEach((item) => {
    const match = !query || item.textContent.toLowerCase().includes(query);
    item.hidden = !match;
    if (match) visibleCount += 1;
  });
  glossaryEmpty.hidden = visibleCount > 0;
});

renderHistory();
