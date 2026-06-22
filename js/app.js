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
import { DEFAULT_TARGET_POWER_FACTOR } from './reactiveCompensation.js';
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
import { buildBom, buildBomCsv, breakerSpecLabel, cableSpecLabel } from './schemeBom.js';
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

// Порядок и подписи фильтров сводки проверок (см. category в collectSchemeWarnings).
const WARNING_CATEGORY_LABELS = [
  ['error', 'Ошибки расчёта'],
  ['balance', 'Баланс нагрузки'],
  ['voltage-drop', 'Потеря напряжения'],
  ['short-circuit', 'Отключение при КЗ'],
  ['thermal', 'Термостойкость КЗ'],
  ['phase-balance', 'Перекос фаз'],
  ['selectivity', 'Селективность'],
];

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
const networkTreeWrapperEl = document.getElementById('network-tree-wrapper');
const netZoomOutBtn = document.getElementById('net-zoom-out-btn');
const netZoomInBtn = document.getElementById('net-zoom-in-btn');
const netZoomResetBtn = document.getElementById('net-zoom-reset-btn');
const netZoomFitBtn = document.getElementById('net-zoom-fit-btn');
const netMinimap = document.getElementById('net-minimap');
const netMinimapThumb = document.getElementById('net-minimap-thumb');
const netCanvasHint = document.getElementById('net-canvas-hint');
const netCanvasHintClose = document.getElementById('net-canvas-hint-close');
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
const exportBomBtn = document.getElementById('export-bom-btn');
const resetNetworkBtn = document.getElementById('reset-network-btn');
const netToast = document.getElementById('net-toast');
const netToastMessage = document.getElementById('net-toast-message');
const netToastAction = document.getElementById('net-toast-action');
const netToastClose = document.getElementById('net-toast-close');
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
const netWarningsFilters = document.getElementById('net-warnings-filters');
const netWarningsList = document.getElementById('net-warnings-list');
const networkBom = document.getElementById('network-bom');
const netBomCount = document.getElementById('net-bom-count');
const netBomBody = document.getElementById('net-bom-body');
const netEmptyState = document.getElementById('net-empty-state');
const netEmptyCalcBtn = document.getElementById('net-empty-calc-btn');
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
const netPanelSection = document.getElementById('net-panel-section');
const netPanelSummaryName = document.getElementById('net-panel-summary-name');
const netPanelTitle = document.getElementById('net-panel-title');
const netPanelCollapseBtn = document.getElementById('net-panel-collapse-btn');
const netBreadcrumb = document.getElementById('net-breadcrumb');

// Уважаем системную настройку «уменьшить движение»: плавную прокрутку заменяем
// мгновенной (CSS-анимации/переходы глушит media-запрос в styles.css).
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
function scrollBehavior() {
  return reducedMotionQuery.matches ? 'auto' : 'smooth';
}

// Кнопка «Свернуть» в липком заголовке панели — сворачивает секцию параметров
// прямо из глубины длинной формы и возвращает к её заголовку, чтобы не
// прокручивать вручную.
if (netPanelCollapseBtn && netPanelSection) {
  netPanelCollapseBtn.addEventListener('click', () => {
    netPanelSection.open = false;
    netPanelSection.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
  });
}

const nodeNameInput = document.getElementById('node-name');
const nodeHasOwnLoadInput = document.getElementById('node-has-own-load');
const nodeLoadFields = document.getElementById('node-load-fields');
const nodeNetworkTypeSelect = document.getElementById('node-network-type');
const nodeVoltageInput = document.getElementById('node-voltage');
const nodePfField = document.getElementById('node-pf-field');
const nodePfInput = document.getElementById('node-pf');
const nodeLoadModeGroupInput = document.getElementById('node-load-mode-group');
const nodeKnownField = document.getElementById('node-known-field');
const nodePowerField = document.getElementById('node-power-field');
const nodePowerValueInput = document.getElementById('node-power-value');
const nodePowerUnitSelect = document.getElementById('node-power-unit');
const nodeCurrentField = document.getElementById('node-current-field');
const nodeCurrentValueInput = document.getElementById('node-current-value');
const nodeRealLoadFieldset = document.getElementById('node-realload-fieldset');
const nodeGroupFields = document.getElementById('node-group-fields');
const nodeReceiversList = document.getElementById('node-receivers-list');
const nodeAddReceiverBtn = document.getElementById('node-add-receiver-btn');
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
const nodeTargetPfField = document.getElementById('node-target-pf-field');
const nodeTargetPfInput = document.getElementById('node-target-pf');
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
    maybeShowCanvasHint();
  }
}

// Подсказка про pan/зум показывается один раз — при первом заходе на вкладку
// «Конструктор сети». Флаг хранится в localStorage по принятому в проекте
// соглашению elapp.<feature>.v1, поэтому после закрытия (кнопкой или первым
// жестом панорамирования/зума) она больше не появляется.
const NET_CANVAS_HINT_KEY = 'elapp.netCanvasHintDismissed.v1';

function isCanvasHintDismissed() {
  try {
    return localStorage.getItem(NET_CANVAS_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function maybeShowCanvasHint() {
  if (!netCanvasHint || isCanvasHintDismissed()) return;
  netCanvasHint.hidden = false;
}

function dismissCanvasHint() {
  if (!netCanvasHint || netCanvasHint.hidden) return;
  netCanvasHint.hidden = true;
  try {
    localStorage.setItem(NET_CANVAS_HINT_KEY, '1');
  } catch {
    /* приватный режим / переполнение — просто скрываем на эту сессию */
  }
}

if (netCanvasHintClose) {
  netCanvasHintClose.addEventListener('click', dismissCanvasHint);
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

window.addEventListener('resize', () => drawConnectors());

// Масштаб дерева конструктора: CSS-трансформация всего .net-tree (узлы и SVG-слой
// линий масштабируются вместе как один слой) — линии пересчитываются заново из
// getBoundingClientRect, который уже учитывает масштаб, так что отдельной
// геометрии для зума не нужно.
const TREE_ZOOM_MIN = 0.4;
const TREE_ZOOM_MAX = 2;
const TREE_ZOOM_STEP = 0.1;

function setTreeZoom(value) {
  treeZoom = Math.min(TREE_ZOOM_MAX, Math.max(TREE_ZOOM_MIN, Math.round(value * 10) / 10));
  networkTreeEl.style.transform = treeZoom === 1 ? '' : `scale(${treeZoom})`;
  netZoomResetBtn.textContent = `${Math.round(treeZoom * 100)}%`;
  netZoomOutBtn.disabled = treeZoom <= TREE_ZOOM_MIN;
  netZoomInBtn.disabled = treeZoom >= TREE_ZOOM_MAX;
  requestAnimationFrame(() => drawConnectors());
}

netZoomInBtn.addEventListener('click', () => {
  dismissCanvasHint();
  setTreeZoom(treeZoom + TREE_ZOOM_STEP);
});
netZoomOutBtn.addEventListener('click', () => {
  dismissCanvasHint();
  setTreeZoom(treeZoom - TREE_ZOOM_STEP);
});
netZoomResetBtn.addEventListener('click', () => {
  dismissCanvasHint();
  setTreeZoom(1);
});

// «Вписать в экран»: масштаб подбирается так, чтобы всё дерево (включая самые
// широкие/глубокие ветви) уместилось в видимую область без горизонтальной и
// вертикальной прокрутки. offsetWidth/offsetHeight у .net-tree не зависят от
// CSS transform (transform — чисто визуальное искажение поверх layout-бокса),
// поэтому это «природный» размер дерева при масштабе 100%, от которого и
// считаем нужный коэффициент. Округляем вниз до шага зума, чтобы дерево не
// перекрывало края даже при округлении.
netZoomFitBtn.addEventListener('click', () => {
  dismissCanvasHint();
  const naturalWidth = networkTreeEl.offsetWidth;
  const naturalHeight = networkTreeEl.offsetHeight;
  if (!naturalWidth || !naturalHeight) return;

  networkTreeWrapperEl.scrollIntoView({ block: 'start' });
  const wrapperRect = networkTreeWrapperEl.getBoundingClientRect();
  const availableWidth = networkTreeWrapperEl.clientWidth - 16;
  const availableHeight = window.innerHeight - wrapperRect.top - 24;

  const rawScale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);

  // Когда дерево шире wrapper'а, его layout-бокс начинается у левого края
  // wrapper'а и тянется вправо (min-width: max-content) — transform-origin
  // «top center» масштабирует его вокруг СВОЕЙ середины, а не середины
  // видимой области, поэтому после уменьшения масштаба дерево может остаться
  // смещённым и вылезать за правый край. Отключаем transition для точного
  // синхронного замера новой геометрии и довыравниваем прокруткой по центру.
  const prevTransition = networkTreeEl.style.transition;
  networkTreeEl.style.transition = 'none';
  setTreeZoom(Math.floor(rawScale * 10) / 10);
  const treeRect = networkTreeEl.getBoundingClientRect();
  networkTreeWrapperEl.scrollLeft += treeRect.left + treeRect.width / 2 - (wrapperRect.left + wrapperRect.width / 2);
  networkTreeEl.style.transition = prevTransition;
});

// Колесо мыши с Ctrl/⌘ — зум к курсору (а не к центру дерева); также перехватывает
// pinch-жест трекпада, который браузер сообщает как wheel-событие с ctrlKey=true.
// Без модификатора preventDefault не вызывается — это оставляет обычную прокрутку
// страницы/блока браузеру. transform-origin у .net-tree — «top center», поэтому
// вместо вывода формулы сдвига вручную точка под курсором фиксируется через
// повторный замер getBoundingClientRect до и после смены масштаба.
networkTreeWrapperEl.addEventListener(
  'wheel',
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    dismissCanvasHint();
    const direction = event.deltaY < 0 ? 1 : -1;
    const newZoom = Math.min(
      TREE_ZOOM_MAX,
      Math.max(TREE_ZOOM_MIN, Math.round((treeZoom + direction * TREE_ZOOM_STEP) * 10) / 10)
    );
    if (newZoom === treeZoom) return;

    const beforeRect = networkTreeEl.getBoundingClientRect();
    const fracX = beforeRect.width ? (event.clientX - beforeRect.left) / beforeRect.width : 0.5;
    const fracY = beforeRect.height ? (event.clientY - beforeRect.top) / beforeRect.height : 0.5;

    // .net-tree анимирует transform через CSS transition, поэтому сразу после
    // смены масштаба getBoundingClientRect() ещё вернёт старую (дотранзишн)
    // геометрию. На время замера отключаем transition, чтобы новая геометрия
    // была доступна синхронно, как при обычном клике по кнопкам зума.
    const prevTransition = networkTreeEl.style.transition;
    networkTreeEl.style.transition = 'none';
    setTreeZoom(newZoom);
    const afterRect = networkTreeEl.getBoundingClientRect();
    networkTreeWrapperEl.scrollLeft += afterRect.left + fracX * afterRect.width - event.clientX;
    window.scrollBy(0, afterRect.top + fracY * afterRect.height - event.clientY);
    networkTreeEl.style.transition = prevTransition;
  },
  { passive: false }
);

// Перемещение по дереву зажатой левой кнопкой мыши (pan) — полезно при увеличенном
// масштабе или широкой схеме. Не перехватывает клики по узлам, кнопкам и другим
// интерактивным элементам, чтобы не мешать их собственным обработчикам (выбор
// узла, drag-and-drop переноса узла, кнопки панели).
let isPanningTree = false;
let panStartX = 0;
let panStartY = 0;
let panStartScrollLeft = 0;
let panStartScrollTop = 0;

networkTreeWrapperEl.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  if (event.target.closest('.net-node, button, input, select, textarea, a')) return;
  dismissCanvasHint();
  isPanningTree = true;
  networkTreeWrapperEl.classList.add('is-panning');
  panStartX = event.clientX;
  panStartY = event.clientY;
  panStartScrollLeft = networkTreeWrapperEl.scrollLeft;
  panStartScrollTop = window.scrollY;
  event.preventDefault();
});

window.addEventListener('mousemove', (event) => {
  if (!isPanningTree) return;
  networkTreeWrapperEl.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
  window.scrollTo(window.scrollX, panStartScrollTop - (event.clientY - panStartY));
});

window.addEventListener('mouseup', () => {
  if (!isPanningTree) return;
  isPanningTree = false;
  networkTreeWrapperEl.classList.remove('is-panning');
});

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
  refCableTableBody.querySelector('tr.highlight')?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
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
    loadInputMode: 'direct',
    receivers: [],
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
    targetPowerFactor: DEFAULT_TARGET_POWER_FACTOR,
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
        kind: 'lighting',
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
let warningsByNode = new Map(); // nodeId -> массив замечаний для бейджа-точки на карточке
let changedValueIds = new Set(); // узлы с изменившимся бейджем — для подсветки при пересчёте
let activeProjectId = null;
let draggedNodeId = null;
let searchQuery = '';
let searchMatchIds = new Set();
let searchPathIds = new Set();
let addMenuParentId = null;
let addMenuAnchor = null;
let heatMapEnabled = false;
let treeZoom = 1;
let activeWarningFilter = null; // category из collectSchemeWarnings, null — показывать все

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
  const expanded = expandAncestors(nodeId);
  if (expanded) persistNetworkScheme();
  selectNode(nodeId);
  // selectNode() пропускает перерисовку, если узел уже был единственным
  // выбранным — но раскрытие свёрнутых предков всё равно нужно отразить в DOM.
  if (expanded) renderTree();
  requestAnimationFrame(() => {
    networkTreeEl
      .querySelector(`.net-node-wrap[data-id="${nodeId}"]`)
      ?.scrollIntoView({ behavior: scrollBehavior(), block: 'center', inline: 'center' });
  });
}

/**
 * Обратная навигация к замечанию: по клику на бейдж-точку карточки прокручивает
 * к сводной панели проверок и подсвечивает пункты выбранного узла. Сбрасывает
 * активный фильтр, чтобы нужное замечание точно присутствовало в списке.
 */
function revealWarning(nodeId) {
  if (networkWarnings.hidden) return;
  if (activeWarningFilter) {
    activeWarningFilter = null;
    renderWarnings();
  }
  networkWarnings.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  requestAnimationFrame(() => {
    const items = netWarningsList.querySelectorAll(`.net-warning-item[data-node-id="${nodeId}"]`);
    items.forEach((item) => {
      item.classList.remove('flash');
      void item.offsetWidth; // перезапуск анимации, если точку нажали повторно
      item.classList.add('flash');
    });
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

// Визуальный тип узла для иконки на карточке. Структура важнее сохранённого
// kind: узел с дочерними — это всегда щит, даже если создавался по шаблону
// потребителя; двигатель определяется по load, поэтому работает и для старых
// схем без поля kind. Освещение и розеточную группу электрически не отличить,
// поэтому для них опираемся на сохранённый при создании по шаблону kind, а без
// него показываем обобщённую иконку нагрузки.
function nodeKind(node) {
  if (networkTree && node.id === networkTree.id) return 'input';
  if (node.children.length) return 'panel';
  if (node.loadType === 'motor' || node.kind === 'motor') return 'motor';
  if (node.kind === 'lighting') return 'lighting';
  if (node.kind === 'socket') return 'socket';
  return 'load';
}

// Иконки типов узлов — компактные inline-SVG на currentColor, чтобы наследовать
// цвет/тему и масштаб шрифта. stroke-обводка для единообразия с остальными
// глифами интерфейса; «ввод» залит, чтобы читаться как акцентный источник.
const NODE_KIND_ICON_PATHS = {
  input: '<path d="M8.5 1.5 3.5 9H7l-.5 5.5L12.5 7H9l-.5-5.5Z" fill="currentColor" stroke="none"/>',
  panel:
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><line x1="5" y1="5.5" x2="11" y2="5.5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="10.5" x2="11" y2="10.5"/>',
  motor: '<circle cx="8" cy="8" r="6"/><path d="M5.5 10.5V6l2.5 3 2.5-3v4.5"/>',
  lighting:
    '<path d="M5 7.5a3 3 0 1 1 6 0c0 1.2-.8 1.9-1.3 2.6-.3.4-.4.7-.4 1.2H6.7c0-.5-.1-.8-.4-1.2C5.8 9.4 5 8.7 5 7.5Z"/><line x1="6.7" y1="13.5" x2="9.3" y2="13.5"/>',
  socket:
    '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><circle cx="6.3" cy="8" r="0.9"/><circle cx="9.7" cy="8" r="0.9"/>',
  load: '<rect x="3" y="4.5" width="10" height="9" rx="2"/><line x1="6" y1="2" x2="6" y2="4.5"/><line x1="10" y1="2" x2="10" y2="4.5"/>',
};

function nodeKindIconSvg(kind) {
  const inner = NODE_KIND_ICON_PATHS[kind] || NODE_KIND_ICON_PATHS.load;
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

const NODE_KIND_TITLES = {
  input: 'Ввод питания',
  panel: 'Распределительный щит',
  motor: 'Электродвигатель',
  lighting: 'Освещение',
  socket: 'Розеточная группа',
  load: 'Потребитель',
};

// Текст бейджа результата узла (ток · номинал автомата либо «ошибка расчёта»).
// Вынесен, чтобы один и тот же текст использовался и при отрисовке карточки, и
// при сравнении «до/после» для подсветки изменившихся значений.
function nodeBadgeText(calc) {
  if (!calc) return '';
  if (calc.error) return 'ошибка расчёта';
  const breakerText = calc.protection.breaker ? `АВ ${calc.protection.breaker} А` : 'АВ вне диапазона';
  return `${formatCurrent(calc.result.I)} · ${breakerText}`;
}

// Множество узлов, у которых отображаемый бейдж (ток/номинал) изменился по
// сравнению с предыдущим расчётом — для микро-анимации при пересчёте. При
// первом расчёте (prev отсутствует) ничего не подсвечиваем.
function computeChangedValueIds(prevMap, nextMap) {
  const ids = new Set();
  if (!prevMap) return ids;
  nextMap.forEach((calc, id) => {
    const before = prevMap.get(id);
    if (before && nodeBadgeText(before) !== nodeBadgeText(calc)) ids.add(id);
  });
  return ids;
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

/**
 * Переименование узла прямо на блоке по двойному клику на названии — без
 * открытия панели свойств. Подменяет текст на текстовое поле; Enter и потеря
 * фокуса сохраняют новое имя, Escape отменяет правку без изменений.
 */
function startRenameNode(node, nameEl) {
  if (nameEl.querySelector('input')) return;
  const original = node.name;
  nameEl.textContent = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'net-node-name-input';
  input.value = original;
  input.draggable = false;
  nameEl.appendChild(input);
  input.focus();
  input.select();

  let cancelled = false;

  const commit = () => {
    node.name = input.value.trim() || 'Узел';
    persistNetworkScheme();
    renderTree();
    if (node.id === selectedNodeId) nodeNameInput.value = node.name;
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelled = true;
      renderTree();
    }
  });
  input.addEventListener('blur', () => {
    if (cancelled) return;
    commit();
  });
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('mousedown', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
}

function renderNodeEl(node, level = 1) {
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
  card.setAttribute('role', 'treeitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-level', String(level));
  if (node.children.length) card.setAttribute('aria-expanded', node.collapsed ? 'false' : 'true');
  const isSelected = node.id === selectedNodeId || (selectedNodeIds.size > 1 && selectedNodeIds.has(node.id));
  card.setAttribute('aria-selected', isSelected ? 'true' : 'false');
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
  const kind = nodeKind(node);
  tag.dataset.kind = kind;
  const tagIcon = document.createElement('span');
  tagIcon.className = 'net-node-kind-icon';
  tagIcon.title = NODE_KIND_TITLES[kind] || NODE_KIND_TITLES.load;
  tagIcon.setAttribute('aria-hidden', 'true');
  tagIcon.innerHTML = nodeKindIconSvg(kind);
  const tagText = document.createElement('span');
  tagText.className = 'net-node-tag-text';
  tagText.textContent = nodeTag(node);
  tag.append(tagIcon, tagText);

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
  name.title = 'Двойной клик — переименовать';
  name.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    startRenameNode(node, name);
  });

  const meta = document.createElement('span');
  meta.className = 'net-node-meta';
  meta.textContent = nodeMeta(node);

  card.append(header, tag, name, meta);

  if (calc) {
    const badge = document.createElement('span');
    badge.className = 'net-node-badge';
    if (calc.error) badge.classList.add('warn');
    badge.textContent = nodeBadgeText(calc);
    // Микро-анимация: подсвечиваем бейджи, чьи ток/номинал изменились после
    // пересчёта. changedValueIds наполняется только на момент расчёта и сразу
    // очищается, поэтому подсветка не повторяется при обычных перерисовках.
    if (changedValueIds.has(node.id)) badge.classList.add('changed');
    card.appendChild(badge);
  }

  // Бейдж проверок — цветная точка в углу карточки, если по узлу есть замечания
  // (любой категории: баланс, потеря напряжения, КЗ, перекос фаз, селективность,
  // ошибка расчёта). Клик ведёт к этому замечанию в сводной панели проверок.
  const nodeWarnings = warningsByNode.get(node.id);
  if (nodeWarnings && nodeWarnings.length) {
    const hasError = nodeWarnings.some((w) => w.severity === 'error');
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'net-node-check-dot';
    dot.dataset.severity = hasError ? 'error' : 'warn';
    if (nodeWarnings.length > 1) dot.textContent = String(nodeWarnings.length);
    dot.title = nodeWarnings.map((w) => `• ${w.message}`).join('\n');
    const word = pluralize(nodeWarnings.length, 'замечание', 'замечания', 'замечаний');
    dot.setAttribute('aria-label', `${nodeWarnings.length} ${word} по узлу — открыть в сводке проверок`);
    dot.addEventListener('click', (event) => {
      event.stopPropagation();
      revealWarning(node.id);
    });
    card.appendChild(dot);
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
    ul.setAttribute('role', 'group');
    node.children.forEach((child) => ul.appendChild(renderNodeEl(child, level + 1)));
    li.appendChild(ul);
  }

  return li;
}

function renderTree() {
  networkTreeEl.innerHTML = '';
  if (!networkTree) return;

  // Группируем замечания по узлам для бейджа-точки на карточках. Источник — то
  // же дерево результатов, что и у сводной панели проверок, поэтому точка на
  // карточке и пункт в сводке всегда согласованы.
  warningsByNode = new Map();
  if (lastResultTree) {
    collectSchemeWarnings(lastResultTree).forEach((w) => {
      const list = warningsByNode.get(w.nodeId);
      if (list) list.push(w);
      else warningsByNode.set(w.nodeId, [w]);
    });
  }

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
 * список с чипами-фильтрами по типу замечания. Показывается только после
 * расчёта (lastResultTree); до него скрыта.
 */
function renderWarnings() {
  // Пустое состояние видно, пока сеть не рассчитана, и зовёт нажать «Рассчитать».
  if (netEmptyState) netEmptyState.hidden = Boolean(lastResultTree);
  if (!lastResultTree) {
    networkWarnings.hidden = true;
    return;
  }
  networkWarnings.hidden = false;
  netWarningsFilters.innerHTML = '';
  netWarningsList.innerHTML = '';

  const warnings = collectSchemeWarnings(lastResultTree);
  if (!warnings.length) {
    activeWarningFilter = null;
    netWarningsCount.textContent = '';
    const li = document.createElement('li');
    li.className = 'net-warning-item ok';
    li.textContent = '✓ Все проверки пройдены: ошибок, перегрузок и превышений не обнаружено.';
    netWarningsList.appendChild(li);
    return;
  }

  const counts = new Map();
  warnings.forEach((w) => counts.set(w.category, (counts.get(w.category) || 0) + 1));
  // Если выбранный ранее фильтр больше не встречается среди текущих замечаний — сбрасываем на «Все».
  if (activeWarningFilter && !counts.has(activeWarningFilter)) activeWarningFilter = null;

  if (counts.size > 1) {
    const makeChip = (key, label, count) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'net-warning-chip';
      if (key === activeWarningFilter) chip.classList.add('active');
      chip.textContent = `${label} (${count})`;
      chip.addEventListener('click', () => {
        activeWarningFilter = activeWarningFilter === key ? null : key;
        renderWarnings();
      });
      netWarningsFilters.appendChild(chip);
    };
    makeChip(null, 'Все', warnings.length);
    WARNING_CATEGORY_LABELS.forEach(([key, label]) => {
      if (counts.has(key)) makeChip(key, label, counts.get(key));
    });
  }

  const visibleWarnings = activeWarningFilter ? warnings.filter((w) => w.category === activeWarningFilter) : warnings;
  netWarningsCount.textContent =
    activeWarningFilter && visibleWarnings.length !== warnings.length
      ? `(${visibleWarnings.length} из ${warnings.length})`
      : `(${warnings.length})`;
  visibleWarnings.forEach((warning) => {
    const li = document.createElement('li');
    li.className = `net-warning-item ${warning.severity}`;
    li.dataset.nodeId = warning.nodeId;
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

/**
 * Сводная спецификация оборудования: группирует автоматы и кабели по типам
 * с количеством/суммарной длиной (см. js/schemeBom.js). Показывается только
 * после расчёта, как и панель проверок.
 */
function renderBom() {
  if (!lastResultTree) {
    networkBom.hidden = true;
    return;
  }
  networkBom.hidden = false;
  netBomBody.innerHTML = '';

  const bom = buildBom(networkTree);
  const totalItems = bom.breakers.length + bom.cables.length;
  netBomCount.textContent = totalItems ? `(${totalItems})` : '';

  if (!totalItems) {
    const empty = document.createElement('p');
    empty.className = 'net-bom-empty';
    empty.textContent = 'Нет узлов с подобранным оборудованием.';
    netBomBody.appendChild(empty);
    return;
  }

  const addSection = (title, rows, renderRow) => {
    if (!rows.length) return;
    const heading = document.createElement('p');
    heading.className = 'net-bom-group-title';
    heading.textContent = title;
    netBomBody.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'net-bom-table';
    const tbody = document.createElement('tbody');
    rows.forEach((row) => tbody.appendChild(renderRow(row)));
    table.appendChild(tbody);
    netBomBody.appendChild(table);
  };

  addSection('Автоматические выключатели', bom.breakers, (b) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = breakerSpecLabel(b);
    const qtyTd = document.createElement('td');
    qtyTd.className = 'net-bom-qty';
    qtyTd.textContent = `${b.count} шт.`;
    tr.append(nameTd, qtyTd);
    return tr;
  });

  addSection('Кабели', bom.cables, (c) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = cableSpecLabel(c);
    const qtyTd = document.createElement('td');
    qtyTd.className = 'net-bom-qty';
    qtyTd.textContent = `${c.totalLength} м (${c.count} ${c.count === 1 ? 'линия' : 'линии(й)'})`;
    tr.append(nameTd, qtyTd);
    return tr;
  });

  const unresolved = bom.unresolvedBreakers + bom.unresolvedCables;
  if (unresolved) {
    const note = document.createElement('p');
    note.className = 'net-bom-note';
    note.textContent = `Для ${unresolved} ${unresolved === 1 ? 'линии' : 'линий'} не удалось подобрать оборудование — см. панель проверок.`;
    netBomBody.appendChild(note);
  }
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

  // .net-tree может быть масштабирован CSS-трансформацией (зум). SVG-слой лежит
  // ВНУТРИ масштабируемого элемента, поэтому его внутренние координаты должны быть
  // в немасштабированной системе (layout-px): иначе getBoundingClientRect (он уже
  // учитывает масштаб) даёт двойное масштабирование — линии «разъезжаются» и
  // частично уходят за пределы слоя. Масштаб берём как отношение видимой ширины к
  // layout-ширине (offsetWidth трансформацию игнорирует) и делим на него все
  // измерения из getBoundingClientRect.
  const scale = tree.offsetWidth ? treeRect.width / tree.offsetWidth : 1;
  const toLocal = (screenDelta) => screenDelta / scale;

  const w = Math.ceil(tree.offsetWidth);
  const h = Math.ceil(tree.offsetHeight);
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
    const px = toLocal(pr.left - treeRect.left + pr.width / 2);
    const py = toLocal(pr.top - treeRect.top + pr.height);

    childUl.querySelectorAll(':scope > li > .net-node-wrap').forEach((childWrap) => {
      const cr = childWrap.getBoundingClientRect();
      const cx = toLocal(cr.left - treeRect.left + cr.width / 2);
      const cy = toLocal(cr.top - treeRect.top);
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
  updateMinimap();
}

/**
 * Индикатор «вы здесь»: показывает видимую долю широкого дерева и её
 * положение по горизонтали. scrollWidth/clientWidth здесь не годятся —
 * scrollWidth не уменьшается вместе с transform: scale() (масштаб дерева),
 * поэтому видимую долю считаем через getBoundingClientRect (отражает
 * реальный, уже отмасштабированный размер) дерева и пересечение с
 * видимой областью wrapper'а.
 */
function updateMinimap() {
  const treeRect = networkTreeEl.getBoundingClientRect();
  const wrapperRect = networkTreeWrapperEl.getBoundingClientRect();
  if (!treeRect.width || treeRect.width <= wrapperRect.width + 1) {
    netMinimap.hidden = true;
    return;
  }

  const visibleLeft = Math.max(treeRect.left, wrapperRect.left);
  const visibleRight = Math.min(treeRect.right, wrapperRect.right);
  const visibleWidth = Math.max(0, visibleRight - visibleLeft);

  netMinimap.hidden = false;
  netMinimapThumb.style.width = `${Math.max(0, (visibleWidth / treeRect.width) * 100)}%`;
  netMinimapThumb.style.left = `${Math.min(100, Math.max(0, ((visibleLeft - treeRect.left) / treeRect.width) * 100))}%`;
}

networkTreeWrapperEl.addEventListener('scroll', () => updateMinimap());
window.addEventListener('resize', () => updateMinimap());
// Клик по кнопкам зума (+/−/100%) меняет transform с CSS-transition (0.15s) —
// геометрия на момент rAF в setTreeZoom ещё промежуточная, поэтому уточняем
// индикатор повторно, когда transition действительно закончится.
networkTreeEl.addEventListener('transitionend', (event) => {
  if (event.propertyName === 'transform') updateMinimap();
});

// --- Клавиатурная навигация по дереву (паттерн WAI-ARIA tree) ---------------
// Делегируется на контейнер дерева, поэтому переживает перерисовки карточек.
// ↑/↓ — между видимыми узлами (в порядке обхода), Home/End — к краям,
// → — раскрыть ветвь либо перейти к первому ребёнку, ← — свернуть либо перейти
// к родителю. Enter/Пробел (выбор) остаются на самой карточке.
function visibleCardIds() {
  return [...networkTreeEl.querySelectorAll('.net-node-wrap')].map((w) => w.dataset.id);
}

function focusNodeCard(id) {
  requestAnimationFrame(() => {
    networkTreeEl.querySelector(`.net-node-wrap[data-id="${id}"] .net-node`)?.focus();
  });
}

function selectAndFocusCard(id) {
  selectNode(id);
  focusNodeCard(id);
}

networkTreeEl.addEventListener('keydown', (event) => {
  const card = event.target.closest('.net-node');
  if (!card) return;
  const id = card.closest('.net-node-wrap')?.dataset.id;
  const node = id && findNode(networkTree, id);
  if (!node) return;

  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      event.preventDefault();
      const ids = visibleCardIds();
      const next = ids[ids.indexOf(id) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) selectAndFocusCard(next);
      break;
    }
    case 'Home':
    case 'End': {
      event.preventDefault();
      const ids = visibleCardIds();
      const target = event.key === 'Home' ? ids[0] : ids[ids.length - 1];
      if (target && target !== id) selectAndFocusCard(target);
      break;
    }
    case 'ArrowRight': {
      event.preventDefault();
      if (node.children.length && node.collapsed) {
        node.collapsed = false;
        persistNetworkScheme();
        renderTree();
        focusNodeCard(id);
      } else if (node.children.length) {
        selectAndFocusCard(node.children[0].id);
      }
      break;
    }
    case 'ArrowLeft': {
      event.preventDefault();
      if (node.children.length && !node.collapsed) {
        node.collapsed = true;
        persistNetworkScheme();
        renderTree();
        focusNodeCard(id);
      } else {
        const parent = findParentNode(networkTree, id);
        if (parent) selectAndFocusCard(parent.id);
      }
      break;
    }
    default:
      break;
  }
});

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
      // Выбранный узел: инлайн-цвет нагрузки перекрыл бы рамку выделения из CSS,
      // а тёплый цвет шкалы совпадает с акцентным — выделение стало бы незаметным.
      // Поэтому сохраняем свечение цвета нагрузки, но добавляем яркое контрастное
      // кольцо (цвет текста), чтобы выбранный узел был виден при любом цвете шкалы.
      const isSelected = card.classList.contains('selected') || card.classList.contains('multi-selected');
      card.style.borderColor = color.solid;
      card.style.boxShadow = isSelected
        ? `0 0 0 2px var(--color-text), 0 0 10px 3px rgba(${color.r}, ${color.g}, ${color.b}, 0.5)`
        : `0 0 0 1px ${color.solid}, 0 0 8px 2px rgba(${color.r}, ${color.g}, ${color.b}, 0.35)`;
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
  const isGroup = nodeLoadModeGroupInput.checked;
  nodeKnownField.hidden = isGroup;
  nodePowerField.hidden = isGroup || known !== 'power';
  nodeCurrentField.hidden = isGroup || known !== 'current';
  nodePfField.hidden = nodeNetworkTypeSelect.value === NETWORK_TYPES.DC;
  nodeVoltageInput.placeholder = VOLTAGE_PLACEHOLDERS[nodeNetworkTypeSelect.value] ?? '';
  nodeUtilizationField.hidden = isGroup || known !== 'power';
  nodeRealLoadFieldset.hidden = isGroup;
  nodeGroupFields.hidden = !isGroup;
  nodeTargetPfField.hidden = nodeNetworkTypeSelect.value === NETWORK_TYPES.DC;
}

/**
 * Перестраивает редактор списка приёмников группы (метод Ки/Кр): для каждого
 * приёмника — поля установленной мощности (кВт) и коэффициента использования
 * Ки, кнопка удаления. node.receivers хранит мощность в Вт (как knownValue), а
 * поле ввода — в кВт, по той же логике, что node-power-value/node-power-unit.
 */
function renderReceiversList(node) {
  nodeReceiversList.replaceChildren();
  const receivers = Array.isArray(node.receivers) ? node.receivers : [];
  receivers.forEach((receiver, index) => {
    const row = document.createElement('div');
    row.className = 'receiver-row';

    const powerField = document.createElement('div');
    powerField.className = 'field';
    const powerLabel = document.createElement('label');
    powerLabel.textContent = `Приёмник ${index + 1}: Pн, кВт`;
    const powerInput = document.createElement('input');
    powerInput.type = 'number';
    powerInput.inputMode = 'decimal';
    powerInput.step = 'any';
    powerInput.min = '0';
    powerInput.value = receiver.installedP ? receiver.installedP / 1000 : '';
    powerInput.addEventListener('input', () => {
      receiver.installedP = (Number(powerInput.value) || 0) * 1000;
      onReceiversChange();
    });
    powerField.append(powerLabel, powerInput);

    const kuField = document.createElement('div');
    kuField.className = 'field';
    const kuLabel = document.createElement('label');
    kuLabel.textContent = 'Ки';
    const kuInput = document.createElement('input');
    kuInput.type = 'number';
    kuInput.inputMode = 'decimal';
    kuInput.step = '0.05';
    kuInput.min = '0.01';
    kuInput.max = '1';
    kuInput.value = receiver.ku ?? '';
    kuInput.addEventListener('input', () => {
      receiver.ku = Number(kuInput.value) || 0;
      onReceiversChange();
    });
    kuField.append(kuLabel, kuInput);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'receiver-remove-btn';
    removeBtn.title = 'Удалить приёмник';
    removeBtn.setAttribute('aria-label', 'Удалить приёмник');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      node.receivers.splice(index, 1);
      renderReceiversList(node);
      onReceiversChange();
    });

    row.append(powerField, kuField, removeBtn);
    nodeReceiversList.appendChild(row);
  });
}

function onReceiversChange() {
  persistNetworkScheme();
  renderTree();
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
  const { result, protection, voltageDrop, sumOfChildBreakers, maxOfChildBreakers, selectivity, installed, startCurrent, groupDemand, compensation } = calc;
  nodeResP.textContent = formatPower(result.P);
  nodeResS.textContent = formatApparentPower(result.S);
  nodeResQ.textContent = formatReactivePower(result.Q);
  nodeResI.textContent = formatCurrent(result.I);

  nodeResDetails.replaceChildren();

  if (node.loadInputMode === 'group' && groupDemand) {
    addResultItem(nodeResDetails, {
      label: 'Групповая нагрузка (метод Ки/Кр)',
      value: `Pр ≈ ${formatPower(groupDemand.calculatedP)}`,
      note:
        `${groupDemand.count} приёмников, ΣPн = ${formatPower(groupDemand.installedTotal)}, ` +
        `Pср = ${formatPower(groupDemand.averageP)}, nэ ≈ ${groupDemand.nEffective.toFixed(2)}, ` +
        `Ки.гр ≈ ${groupDemand.groupKu.toFixed(2)}, Кс.гр ≈ ${groupDemand.supplyFactor.toFixed(2)} ` +
        '(приближённая формула, не табличный Кр из РТМ 36.18.32.4-92 / СП 256).',
    });
  } else if (installed && node.utilizationFactor < 1) {
    addResultItem(nodeResDetails, {
      label: 'Расчётная нагрузка',
      value: formatPower(calc.ownP),
      note:
        `Установленная (паспортная) мощность собственной нагрузки узла — ${formatPower(installed.P)}; ` +
        `расчётная (с учётом Ku = ${node.utilizationFactor}) используется для подбора защиты и кабеля.`,
    });
  }

  if (compensation) {
    const { targetPowerFactor, currentPowerFactor, requiredQc, compensatedQ, compensatedS } = compensation;
    addResultItem(nodeResDetails, {
      label: 'Компенсация реактивной мощности',
      value: `Qc ≈ ${formatReactivePower(requiredQc)}`,
      status: 'warn',
      note:
        `Фактический cosφ узла ≈ ${currentPowerFactor.toFixed(2)} ниже целевого ${targetPowerFactor.toFixed(2)}. ` +
        `Конденсаторная батарея мощностью Qc ≈ ${formatReactivePower(requiredQc)} снизит реактивную мощность узла ` +
        `до Q ≈ ${formatReactivePower(compensatedQ)} и полную мощность — до S ≈ ${formatApparentPower(compensatedS)} ` +
        `(cosφ ≈ ${targetPowerFactor.toFixed(2)}), что уменьшит ток линии и потери в кабеле и трансформаторе. Автомат и ` +
        'кабель ниже подобраны по фактическому (не скомпенсированному) току.',
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
    netPanelSummaryName.textContent = '';
    return;
  }
  networkPanel.hidden = false;
  netPanelSummaryName.textContent = node.name;
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
  nodeLoadModeGroupInput.checked = node.loadInputMode === 'group';
  renderReceiversList(node);
  nodeInstallationSelect.value = node.installationMethod;
  nodeCableCountInput.value = node.cableCount;
  nodeAmbientTempInput.value = node.ambientTemp ?? 25;
  nodeInsulationSelect.value = node.insulation ?? 'pvc';
  nodeCableLengthInput.value = node.cableLength || '';
  nodeKcInput.value = node.simultaneityFactor;
  nodeTargetPfInput.value = node.targetPowerFactor ?? DEFAULT_TARGET_POWER_FACTOR;
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
  validatePanelFields();
  renderNodeResult(node);
}

function selectNode(id) {
  // Выбор узла раскрывает сворачиваемую секцию параметров — даже при повторном
  // клике по уже выбранному узлу (открытие <details> не перестраивает дерево,
  // поэтому это безопасно делать до проверки ниже и не ломает двойной клик).
  if (netPanelSection) netPanelSection.open = true;
  // Если узел уже единственный выбранный — состояние не меняется, и полную
  // перерисовку дерева можно пропустить. Помимо лишней работы, без этой
  // проверки второй клик двойного клика всегда перестраивал бы DOM прямо
  // перед событием dblclick, и оно срабатывало бы на уже отсоединённом узле
  // (актуально для переименования по двойному клику на названии блока).
  if (selectedNodeId === id && selectedNodeIds.size === 1 && selectedNodeIds.has(id)) return;
  selectedNodeId = id;
  selectedNodeIds = new Set([id]); // обычный клик сбрасывает множественный выбор
  renderTree();
  renderPanel();
}

// --- Инлайн-валидация полей панели параметров ------------------------------
// Каждое числовое поле проверяется на разумный диапазон прямо во время ввода;
// при нарушении поле подсвечивается, а под ним появляется пояснение. Пустое
// значение у диапазонных полей не считается ошибкой (пользователь может стирать
// и набирать заново), кроме напряжения — без него расчёт бессмысленен.
const rangeOk = (min, max) => (raw) => raw === '' || (Number(raw) >= min && Number(raw) <= max);
const nonNegativeOk = (raw) => raw === '' || Number(raw) >= 0;

const NODE_FIELD_VALIDATORS = [
  [nodeVoltageInput, (raw) => raw !== '' && Number(raw) > 0, 'Напряжение должно быть больше 0.'],
  [nodePfInput, rangeOk(0.01, 1), 'cos φ — в диапазоне 0,01–1.'],
  [nodePowerValueInput, nonNegativeOk, 'Мощность не может быть отрицательной.'],
  [nodeCurrentValueInput, nonNegativeOk, 'Ток не может быть отрицательным.'],
  [nodeUtilizationInput, rangeOk(0.05, 1), 'Коэффициент использования Ku — в диапазоне 0,05–1.'],
  [nodeStartRatioInput, rangeOk(1, 12), 'Кратность пускового тока — в диапазоне 1–12.'],
  [nodeCableCountInput, (raw) => raw === '' || (Number.isInteger(Number(raw)) && Number(raw) >= 1), 'Число кабелей — целое не меньше 1.'],
  [nodeAmbientTempInput, rangeOk(-40, 89), 'Температура — в диапазоне от −40 до 89 °C.'],
  [nodeCableLengthInput, nonNegativeOk, 'Длина линии не может быть отрицательной.'],
  [nodeKcInput, rangeOk(0.1, 1), 'Коэффициент одновременности Кс — в диапазоне 0,1–1.'],
  [nodeTargetPfInput, rangeOk(0.8, 1), 'Целевой cos φ — в диапазоне 0,8–1.'],
  [nodeTransformerPowerInput, nonNegativeOk, 'Мощность трансформатора не может быть отрицательной.'],
  [nodeTransformerUkInput, nonNegativeOk, 'Напряжение короткого замыкания не может быть отрицательным.'],
  [nodePhaseL1Input, nonNegativeOk, 'Доля фазы не может быть отрицательной.'],
  [nodePhaseL2Input, nonNegativeOk, 'Доля фазы не может быть отрицательной.'],
  [nodePhaseL3Input, nonNegativeOk, 'Доля фазы не может быть отрицательной.'],
];

function setFieldValidity(el, message) {
  const field = el.closest('.field') || el.parentElement;
  el.classList.toggle('input-invalid', Boolean(message));
  el.setAttribute('aria-invalid', message ? 'true' : 'false');
  let msgEl = field.querySelector('.field-error');
  if (message) {
    if (!msgEl) {
      msgEl = document.createElement('p');
      msgEl.className = 'field-error';
      msgEl.setAttribute('role', 'alert');
      field.appendChild(msgEl);
    }
    msgEl.textContent = message;
  } else if (msgEl) {
    msgEl.remove();
  }
}

function validatePanelFields() {
  NODE_FIELD_VALIDATORS.forEach(([el, check, message]) => {
    if (!el) return;
    // Скрытые поля (свёрнутые/неприменимые группы) не валидируем — снимаем метку.
    if (el.offsetParent === null) {
      setFieldValidity(el, '');
      return;
    }
    setFieldValidity(el, check(el.value.trim()) ? '' : message);
  });
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
  node.loadInputMode = nodeLoadModeGroupInput.checked ? 'group' : 'direct';
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
  node.targetPowerFactor = Number(nodeTargetPfInput.value) || DEFAULT_TARGET_POWER_FACTOR;
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
  validatePanelFields();
  persistNetworkScheme();
  renderTree();
}

nodeNetworkTypeSelect.addEventListener('change', () => {
  applyDefaultVoltage(nodeNetworkTypeSelect.value, nodeVoltageInput);
  onPanelChange();
});

[
  nodeNameInput, nodeHasOwnLoadInput, nodeVoltageInput, nodePfInput, nodeLoadModeGroupInput,
  nodePowerValueInput, nodePowerUnitSelect, nodeCurrentValueInput, nodeInstallationSelect,
  nodeCableCountInput, nodeAmbientTempInput, nodeInsulationSelect, nodeCableLengthInput, nodeKcInput,
  nodeTargetPfInput, nodePhaseL1Input, nodePhaseL2Input, nodePhaseL3Input,
  nodeUtilizationInput, nodeLoadTypeSelect, nodeStartRatioInput,
  nodeTransformerPowerInput, nodeTransformerUkInput, nodeEarthingSystemSelect,
  ...document.querySelectorAll('input[name="node-known"]'),
].forEach((el) => {
  el.addEventListener('input', onPanelChange);
  el.addEventListener('change', onPanelChange);
});

nodeAddReceiverBtn.addEventListener('click', () => {
  const node = findNode(networkTree, selectedNodeId);
  if (!node) return;
  if (!Array.isArray(node.receivers)) node.receivers = [];
  node.receivers.push({ installedP: 0, ku: 1 });
  renderReceiversList(node);
  persistNetworkScheme();
});

calcNetworkBtn.addEventListener('click', () => {
  if (!networkTree) return;
  const prevCalcMap = lastCalcMap;
  const resultTree = annotateVoltageDrop(networkTree, annotateShortCircuit(networkTree, calculateTree(networkTree)));
  lastResultTree = resultTree;
  lastCalcMap = flattenCalc(resultTree);
  // Какие бейджи изменились с прошлого расчёта — подсветим их разово при отрисовке.
  changedValueIds = computeChangedValueIds(prevCalcMap, lastCalcMap);
  const errors = collectErrors(resultTree);
  networkErrorMessage.textContent = errors.length ? `Не удалось рассчитать: ${errors.join('; ')}.` : '';
  renderTree();
  renderPanel();
  renderWarnings();
  renderBom();
  // Сбрасываем, чтобы подсветка проигралась один раз, а не при каждом ререндере.
  changedValueIds = new Set();
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
  activeWarningFilter = null;
  networkErrorMessage.textContent = '';
  clearSearch();
  updateUndoButtonUI();
  persistNetworkScheme();
  renderTree();
  renderPanel();
  renderWarnings();
  renderBom();
  renderProjectList();
}

undoNetworkBtn.addEventListener('click', performUndo);

// CTA пустого состояния запускает тот же расчёт, что и кнопка тулбара.
if (netEmptyCalcBtn) netEmptyCalcBtn.addEventListener('click', () => calcNetworkBtn.click());

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

exportBomBtn.addEventListener('click', () => {
  if (!networkTree) return;
  try {
    const csv = buildBomCsv(networkTree);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${sanitizeFileName(networkTree.name)} — спецификация.csv`);
    networkErrorMessage.textContent = '';
  } catch (err) {
    networkErrorMessage.textContent = `Не удалось построить спецификацию: ${err.message}`;
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
    renderBom();
    renderProjectList();
  };
  reader.onerror = () => {
    networkErrorMessage.textContent = 'Не удалось прочитать файл проекта.';
  };
  reader.readAsText(file);
});

// --- Немодальный тост с откатом --------------------------------------------
let netToastTimer = null;
let netToastActionHandler = null;

function hideToast() {
  if (netToastTimer) {
    clearTimeout(netToastTimer);
    netToastTimer = null;
  }
  if (netToast) netToast.hidden = true;
  netToastActionHandler = null;
}

function showUndoToast(message, actionLabel, onAction, timeout = 7000) {
  if (!netToast) return;
  netToastMessage.textContent = message;
  netToastAction.textContent = actionLabel;
  netToastAction.hidden = !onAction;
  netToastActionHandler = onAction || null;
  netToast.hidden = false;
  if (netToastTimer) clearTimeout(netToastTimer);
  netToastTimer = setTimeout(hideToast, timeout);
}

if (netToast) {
  netToastAction.addEventListener('click', () => {
    const handler = netToastActionHandler;
    hideToast();
    if (handler) handler();
  });
  netToastClose.addEventListener('click', hideToast);
}

resetNetworkBtn.addEventListener('click', () => {
  // Обратимая операция: вместо блокирующего confirm() сразу сбрасываем сеть и
  // показываем немодальный тост с кнопкой «Отменить» (сброс уже снят в undo).
  pushUndo();
  networkTree = buildDefaultTree();
  selectedNodeId = networkTree.id;
  activeProjectId = null;
  lastCalcMap = null;
  lastResultTree = null;
  activeWarningFilter = null;
  networkErrorMessage.textContent = '';
  clearSearch();
  persistNetworkScheme();
  renderTree();
  renderPanel();
  renderWarnings();
  renderBom();
  renderProjectList();
  showUndoToast('Сеть сброшена к схеме по умолчанию.', 'Отменить', performUndo);
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
  activeWarningFilter = null;
  networkErrorMessage.textContent = '';
  clearSearch();
  persistNetworkScheme();
  renderTree();
  renderPanel();
  renderWarnings();
  renderBom();
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
    document.getElementById(targetId)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
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
