import { calculate, calculateVoltageDrop, NETWORK_TYPES } from './calculations.js';
import { recommendProtection, INSTALLATION_LABELS, CABLE_TABLE, CABLE_TABLE_SOURCE } from './tables.js';
import { calculateTree } from './network.js';
import { loadNetworkScheme, saveNetworkScheme } from './networkStorage.js';
import { buildSchemeLayout } from './schemeLayout.js';
import { buildSheet } from './schemeSheet.js';
import { buildSchemePdf } from './exportPdf.js';
import { buildDxf } from './exportDxf.js';
import { loadHistory, saveHistoryEntry, deleteHistoryEntry, clearHistory } from './history.js';
import { formatPower, formatApparentPower, formatReactivePower, formatCurrent, formatDateTime } from './format.js';

const VOLTAGE_DROP_LIMIT_PERCENT = 5;

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
const installationMethodSelect = document.getElementById('installation-method');
const cableCountInput = document.getElementById('cable-count');
const cableLengthInput = document.getElementById('cable-length');
const errorMessage = document.getElementById('error-message');
const resultsSection = document.getElementById('results');

const resP = document.getElementById('res-p');
const resS = document.getElementById('res-s');
const resQ = document.getElementById('res-q');
const resI = document.getElementById('res-i');
const resBreaker = document.getElementById('res-breaker');
const resCable = document.getElementById('res-cable');
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
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportDxfBtn = document.getElementById('export-dxf-btn');
const resetNetworkBtn = document.getElementById('reset-network-btn');
const networkErrorMessage = document.getElementById('network-error-message');
const networkPanel = document.getElementById('network-panel');
const netPanelTitle = document.getElementById('net-panel-title');

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
const nodeCableLegend = document.getElementById('node-cable-legend');
const nodeInstallationSelect = document.getElementById('node-installation');
const nodeCableCountInput = document.getElementById('node-cable-count');
const nodeCableLengthInput = document.getElementById('node-cable-length');
const nodeKcField = document.getElementById('node-kc-field');
const nodeKcInput = document.getElementById('node-kc');
const nodeErrorMessage = document.getElementById('node-error-message');

const nodeResultEl = document.getElementById('node-result');
const nodeResP = document.getElementById('node-res-p');
const nodeResS = document.getElementById('node-res-s');
const nodeResQ = document.getElementById('node-res-q');
const nodeResI = document.getElementById('node-res-i');
const nodeResBreaker = document.getElementById('node-res-breaker');
const nodeResCable = document.getElementById('node-res-cable');
const nodeResVoltageDrop = document.getElementById('node-res-voltage-drop');
const nodeResSelectivity = document.getElementById('node-res-selectivity');

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

networkTypeSelect.addEventListener('change', updateNetworkTypeUI);
updateNetworkTypeUI();

function updateKnownFieldUI() {
  const known = form.querySelector('input[name="known"]:checked').value;
  powerField.hidden = known !== 'power';
  currentField.hidden = known !== 'current';
}

knownRadios.forEach((radio) => radio.addEventListener('change', updateKnownFieldUI));
updateKnownFieldUI();

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
    simultaneityFactor: 1,
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
let lastCalcMap = null;

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

function persistNetworkScheme() {
  if (networkTree) saveNetworkScheme({ tree: networkTree });
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
    return `${node.children.length} ${pluralize(node.children.length, 'дочерний узел', 'дочерних узла', 'дочерних узлов')}`;
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

function addChildToNode(parentId) {
  const parent = findNode(networkTree, parentId);
  if (!parent) return;
  const child = createNode();
  parent.children.push(child);
  selectedNodeId = child.id;
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

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
  parent.children = parent.children.filter((child) => child.id !== node.id);
  if (isDescendantOrSelf(node, selectedNodeId)) {
    selectedNodeId = parent.id;
  }
  persistNetworkScheme();
  renderTree();
  renderPanel();
}

function renderNodeEl(node) {
  const li = document.createElement('li');

  const wrap = document.createElement('div');
  wrap.className = 'net-node-wrap';
  wrap.dataset.id = node.id;
  if (node.children.length) wrap.classList.add('has-children');
  wrap.addEventListener('mouseenter', () => highlightHoverPath(node.id));
  wrap.addEventListener('mouseleave', clearHoverPath);

  const isRoot = node.id === networkTree.id;

  const card = document.createElement('div');
  card.className = 'net-node';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  if (node.id === selectedNodeId) card.classList.add('selected');

  const calc = lastCalcMap?.get(node.id);
  if (calc?.error) card.classList.add('has-error');

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

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'net-node-icon-btn net-node-add-btn';
  addBtn.title = 'Добавить дочерний узел';
  addBtn.setAttribute('aria-label', 'Добавить дочерний узел');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    addChildToNode(node.id);
  });
  toolbar.appendChild(addBtn);

  if (!isRoot) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'net-node-icon-btn net-node-delete-btn';
    deleteBtn.title = 'Удалить узел';
    deleteBtn.setAttribute('aria-label', 'Удалить узел');
    deleteBtn.textContent = '−';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteNode(node.id);
    });
    toolbar.appendChild(deleteBtn);
  }

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

  card.addEventListener('click', () => selectNode(node.id));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectNode(node.id);
    }
  });
  wrap.appendChild(card);
  li.appendChild(wrap);

  if (node.children.length) {
    const ul = document.createElement('ul');
    node.children.forEach((child) => ul.appendChild(renderNodeEl(child)));
    li.appendChild(ul);
  }

  return li;
}

function renderTree() {
  networkTreeEl.innerHTML = '';
  if (!networkTree) return;
  networkTreeEl.appendChild(renderNodeEl(networkTree));
  drawConnectors();
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
        svg.appendChild(buildConnectorCurrentMark(childId, midX, midY, calc.result.I));
      }
    });
  });
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

/**
 * При наведении на узел подсвечивает цепочку «узел → ... → корень»: сами
 * блоки и соединяющие их линии остаются полностью видимыми, а всё
 * остальное дерево затухает (см. .is-hovering / .on-hover-path в CSS).
 * На линиях этой цепочки также появляются кружки с расчётным током.
 * При наведении на корневой узел (ВРУ) подсвечивается всё дерево целиком —
 * у корня нет предков, поэтому вместо цепочки к корню берётся поддерево.
 */
function highlightHoverPath(id) {
  const chain = id === networkTree.id ? collectDescendantIds(networkTree) : getAncestorChainIds(id);
  networkTreeEl.classList.add('is-hovering');
  networkTreeEl.querySelectorAll('.net-node-wrap').forEach((wrap) => {
    wrap.classList.toggle('on-hover-path', chain.has(wrap.dataset.id));
  });
  networkTreeEl.querySelectorAll('.net-connector').forEach((path) => {
    path.classList.toggle('on-hover-path', chain.has(path.dataset.child));
  });
  networkTreeEl.querySelectorAll('.net-connector-current').forEach((group) => {
    group.classList.toggle('on-hover-path', chain.has(group.dataset.child));
  });
}

function clearHoverPath() {
  networkTreeEl.classList.remove('is-hovering');
  networkTreeEl.querySelectorAll('.on-hover-path').forEach((el) => el.classList.remove('on-hover-path'));
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
  const { result, protection, voltageDrop, sumOfChildBreakers } = calc;
  nodeResP.textContent = formatPower(result.P);
  nodeResS.textContent = formatApparentPower(result.S);
  nodeResQ.textContent = formatReactivePower(result.Q);
  nodeResI.textContent = formatCurrent(result.I);

  nodeResBreaker.textContent = protection.breaker
    ? `Рекомендуемый автоматический выключатель: ${protection.breaker} А (расчётный ток ${result.I.toFixed(2)} А)`
    : `Расчётный ток (${result.I.toFixed(2)} А) превышает диапазон таблицы — требуется индивидуальный подбор оборудования.`;

  const cableParts = [];
  if (protection.copperCable) {
    cableParts.push(`медь — ${protection.copperCable.section} мм² (доп. ток ${protection.copperCable.ratedCurrent} А)`);
  }
  if (protection.aluminumCable) {
    cableParts.push(`алюминий — ${protection.aluminumCable.section} мм² (доп. ток ${protection.aluminumCable.ratedCurrent} А)`);
  }
  nodeResCable.textContent = cableParts.length
    ? `Рекомендуемое сечение кабеля: ${cableParts.join('; ')}`
    : 'Расчётный ток превышает диапазон табличных сечений — требуется индивидуальный подбор кабеля.';

  nodeResVoltageDrop.textContent = '';
  nodeResVoltageDrop.classList.remove('warn');
  if (voltageDrop) {
    const withinLimit = voltageDrop.dropPercent <= VOLTAGE_DROP_LIMIT_PERCENT;
    const materialLabel = voltageDrop.material === 'copper' ? 'медь' : 'алюминий';
    nodeResVoltageDrop.textContent =
      `Потеря напряжения на линии ${node.cableLength} м (сечение ${voltageDrop.section} мм², ${materialLabel}): ` +
      `${voltageDrop.drop.toFixed(2)} В (${voltageDrop.dropPercent.toFixed(2)}%) — ` +
      `${withinLimit ? 'в пределах общепринятой нормы (≤5%)' : 'превышает общепринятую норму (≤5%), увеличьте сечение'}.`;
    nodeResVoltageDrop.classList.toggle('warn', !withinLimit);
  }

  nodeResSelectivity.textContent = node.children.length
    ? `Сумма номиналов автоматов дочерних линий — ${sumOfChildBreakers} А; автомат этого узла подобран по суммарной ` +
      `нагрузке с учётом Кс = ${node.simultaneityFactor}. Если его номинал меньше этой суммы — это нормально при ` +
      'условии, что не все дочерние линии работают одновременно на полную мощность; проверку селективности ' +
      'срабатывания защит выполняйте по таблицам производителя аппаратов или с привлечением специалиста.'
    : '';
}

function renderPanel() {
  const node = findNode(networkTree, selectedNodeId);
  if (!node) {
    networkPanel.hidden = true;
    return;
  }
  networkPanel.hidden = false;
  netPanelTitle.textContent = node.name;
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
  nodeCableLengthInput.value = node.cableLength || '';
  nodeKcInput.value = node.simultaneityFactor;

  const isRoot = node.id === networkTree.id;
  nodeCableLegend.textContent = isRoot ? 'Вводной кабель' : 'Кабель от родительского узла';
  nodeKcField.hidden = node.children.length === 0;

  updateNodeLoadFieldsUI();
  updateNodeKnownFieldsUI();
  renderNodeResult(node);
}

function selectNode(id) {
  selectedNodeId = id;
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
  node.cableLength = Number(nodeCableLengthInput.value) || 0;
  node.simultaneityFactor = Number(nodeKcInput.value) || 1;

  netPanelTitle.textContent = node.name;
  updateNodeLoadFieldsUI();
  updateNodeKnownFieldsUI();
  persistNetworkScheme();
  renderTree();
}

[
  nodeNameInput, nodeHasOwnLoadInput, nodeNetworkTypeSelect, nodeVoltageInput, nodePfInput,
  nodePowerValueInput, nodePowerUnitSelect, nodeCurrentValueInput, nodeInstallationSelect,
  nodeCableCountInput, nodeCableLengthInput, nodeKcInput,
  ...document.querySelectorAll('input[name="node-known"]'),
].forEach((el) => {
  el.addEventListener('input', onPanelChange);
  el.addEventListener('change', onPanelChange);
});

calcNetworkBtn.addEventListener('click', () => {
  if (!networkTree) return;
  const resultTree = calculateTree(networkTree);
  lastCalcMap = flattenCalc(resultTree);
  const errors = collectErrors(resultTree);
  networkErrorMessage.textContent = errors.length ? `Не удалось рассчитать: ${errors.join('; ')}.` : '';
  renderTree();
  renderPanel();
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

resetNetworkBtn.addEventListener('click', () => {
  if (!confirm('Удалить все узлы и параметры сети и начать сначала?')) return;
  networkTree = buildDefaultTree();
  selectedNodeId = networkTree.id;
  lastCalcMap = null;
  networkErrorMessage.textContent = '';
  persistNetworkScheme();
  renderTree();
  renderPanel();
});

const savedNetworkScheme = loadNetworkScheme();
networkTree = savedNetworkScheme ? savedNetworkScheme.tree : buildDefaultTree();
selectedNodeId = networkTree.id;
if (!savedNetworkScheme) persistNetworkScheme();
renderTree();
renderPanel();

function showError(message) {
  errorMessage.textContent = message;
  resultsSection.hidden = true;
}

function renderResults(result, protection, line) {
  resP.textContent = formatPower(result.P);
  resS.textContent = formatApparentPower(result.S);
  resQ.textContent = formatReactivePower(result.Q);
  resI.textContent = formatCurrent(result.I);

  resBreaker.textContent = protection.breaker
    ? `Рекомендуемый автоматический выключатель: ${protection.breaker} А (расчётный ток ${result.I.toFixed(2)} А)`
    : `Расчётный ток (${result.I.toFixed(2)} А) превышает диапазон таблицы — требуется индивидуальный подбор оборудования.`;

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
  { networkType, voltage, powerFactor, known, knownValue, installationMethod, cableCount, cableLength },
  { persist },
) {
  errorMessage.textContent = '';
  try {
    const result = calculate({ networkType, voltage, powerFactor, known, knownValue });
    const protection = recommendProtection(result.I, { installationMethod, cableCount });
    renderResults(result, protection, { installationMethod, cableCount, cableLength });

    if (persist) {
      saveHistoryEntry({
        input: { networkType, voltage, powerFactor, known, knownValue, installationMethod, cableCount, cableLength },
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
  installationMethodSelect.value = installationMethod;
  cableCountInput.value = cableCount;
  cableLengthInput.value = cableLength || '';
  switchTab('calc');
  runCalculation({ ...input, installationMethod, cableCount, cableLength }, { persist: false });
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

  runCalculation(
    { networkType, voltage, powerFactor, known, knownValue, installationMethod, cableCount, cableLength },
    { persist: true },
  );
});

renderHistory();
