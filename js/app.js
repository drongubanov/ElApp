import { calculate, calculateVoltageDrop, NETWORK_TYPES } from './calculations.js';
import { recommendProtection, INSTALLATION_LABELS, CABLE_TABLE, CABLE_TABLE_SOURCE } from './tables.js';
import { calculateBlock, aggregateIncoming } from './network.js';
import { loadNetworkScheme, saveNetworkScheme } from './networkStorage.js';
import { loadHistory, saveHistoryEntry, deleteHistoryEntry, clearHistory } from './history.js';
import { formatPower, formatApparentPower, formatReactivePower, formatCurrent, formatDateTime } from './format.js';

const VOLTAGE_DROP_LIMIT_PERCENT = 5;

const NETWORK_LABELS = {
  [NETWORK_TYPES.DC]: 'Постоянный ток',
  [NETWORK_TYPES.AC1]: 'Однофазная сеть',
  [NETWORK_TYPES.AC3]: 'Трёхфазная сеть',
};

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

const netMainNetworkType = document.getElementById('net-main-network-type');
const netMainVoltage = document.getElementById('net-main-voltage');
const netMainInstallation = document.getElementById('net-main-installation');
const netMainCableCount = document.getElementById('net-main-cable-count');
const netMainCableLength = document.getElementById('net-main-cable-length');
const netMainSimultaneity = document.getElementById('net-main-simultaneity');
const networkBlocksContainer = document.getElementById('network-blocks');
const addBlockBtn = document.getElementById('add-block-btn');
const calcNetworkBtn = document.getElementById('calc-network-btn');
const networkErrorMessage = document.getElementById('network-error-message');
const networkResults = document.getElementById('network-results');
const netResP = document.getElementById('net-res-p');
const netResS = document.getElementById('net-res-s');
const netResQ = document.getElementById('net-res-q');
const netResI = document.getElementById('net-res-i');
const netResBreaker = document.getElementById('net-res-breaker');
const netResCable = document.getElementById('net-res-cable');
const netResVoltageDrop = document.getElementById('net-res-voltage-drop');
const netResSelectivity = document.getElementById('net-res-selectivity');

function switchTab(tabName) {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

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

function blockTemplate(id) {
  return `
    <div class="network-block" data-id="${id}">
      <div class="network-block-header">
        <input type="text" class="block-name" value="Блок" aria-label="Название блока" />
        <button type="button" class="remove-block-btn" aria-label="Удалить блок">✕</button>
      </div>

      <div class="field">
        <label>Тип сети</label>
        <select class="block-network-type">
          <option value="dc">Постоянный ток (DC)</option>
          <option value="ac1" selected>Однофазная сеть (1 фаза)</option>
          <option value="ac3">Трёхфазная сеть (3 фазы)</option>
        </select>
      </div>

      <div class="field">
        <label>Напряжение, U (В)</label>
        <input type="number" class="block-voltage" inputmode="decimal" step="any" min="0" placeholder="220" />
      </div>

      <div class="field block-pf-field">
        <label>Коэффициент мощности, cos φ</label>
        <input type="number" class="block-pf" inputmode="decimal" step="0.01" min="0.01" max="1" value="1" />
      </div>

      <div class="field">
        <span class="field-label">Известная величина</span>
        <div class="radio-group">
          <label><input type="radio" name="block-known-${id}" class="block-known" value="power" checked /> Мощность</label>
          <label><input type="radio" name="block-known-${id}" class="block-known" value="current" /> Ток</label>
        </div>
      </div>

      <div class="field block-power-field">
        <label>Активная мощность, P</label>
        <div class="input-with-unit">
          <input type="number" class="block-power-value" inputmode="decimal" step="any" min="0" placeholder="1" />
          <select class="block-power-unit">
            <option value="1">Вт</option>
            <option value="1000" selected>кВт</option>
          </select>
        </div>
      </div>

      <div class="field block-current-field" hidden>
        <label>Ток, I (А)</label>
        <input type="number" class="block-current-value" inputmode="decimal" step="any" min="0" placeholder="10" />
      </div>

      <div class="field">
        <label>Способ прокладки</label>
        <select class="block-installation">
          <option value="air" selected>Открыто в воздухе</option>
          <option value="conduit">В трубе / кабель-канале / штукатурке</option>
          <option value="tray">На лотке / в пучке</option>
        </select>
      </div>

      <div class="field">
        <label>Кабелей рядом, шт.</label>
        <input type="number" class="block-cable-count" inputmode="numeric" step="1" min="1" value="1" />
      </div>

      <div class="field">
        <label>Длина линии, L (м)</label>
        <input type="number" class="block-cable-length" inputmode="decimal" step="any" min="0" placeholder="не учитывать" />
      </div>

      <p class="block-error error-message"></p>
      <div class="block-result note-line"></div>
    </div>
  `;
}

function applyBlockConfig(el, config) {
  const known = config.known ?? 'power';
  el.querySelector('.block-name').value = config.name ?? 'Блок';
  el.querySelector('.block-network-type').value = config.networkType ?? NETWORK_TYPES.AC1;
  el.querySelector('.block-voltage').value = config.voltage ?? '';
  el.querySelector('.block-pf').value = config.powerFactor ?? 1;
  el.querySelector(`.block-known[value="${known}"]`).checked = true;
  if (known === 'power') {
    el.querySelector('.block-power-unit').value = '1';
    el.querySelector('.block-power-value').value = config.knownValue ?? '';
  } else {
    el.querySelector('.block-current-value').value = config.knownValue ?? '';
  }
  el.querySelector('.block-installation').value = config.installationMethod ?? 'air';
  el.querySelector('.block-cable-count').value = config.cableCount ?? 1;
  el.querySelector('.block-cable-length').value = config.cableLength || '';
}

function readBlockConfig(el) {
  const known = el.querySelector('.block-known:checked').value;
  const knownValue = known === 'power'
    ? Number(el.querySelector('.block-power-value').value) * Number(el.querySelector('.block-power-unit').value)
    : Number(el.querySelector('.block-current-value').value);
  return {
    id: el.dataset.id,
    name: el.querySelector('.block-name').value || 'Блок',
    networkType: el.querySelector('.block-network-type').value,
    voltage: Number(el.querySelector('.block-voltage').value),
    powerFactor: Number(el.querySelector('.block-pf').value),
    known,
    knownValue,
    installationMethod: el.querySelector('.block-installation').value,
    cableCount: Number(el.querySelector('.block-cable-count').value) || 1,
    cableLength: Number(el.querySelector('.block-cable-length').value) || 0,
  };
}

let blockCounter = 0;

function addBlockElement(config = null) {
  blockCounter += 1;
  const id = config?.id ?? `b${Date.now()}-${blockCounter}`;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = blockTemplate(id).trim();
  const el = wrapper.firstElementChild;

  const blockNetworkTypeSelect = el.querySelector('.block-network-type');
  const blockPfField = el.querySelector('.block-pf-field');
  const blockKnownRadios = el.querySelectorAll('.block-known');
  const blockPowerField = el.querySelector('.block-power-field');
  const blockCurrentField = el.querySelector('.block-current-field');
  const blockVoltageInput = el.querySelector('.block-voltage');

  function updateBlockNetworkUI() {
    blockPfField.hidden = blockNetworkTypeSelect.value === NETWORK_TYPES.DC;
    blockVoltageInput.placeholder = VOLTAGE_PLACEHOLDERS[blockNetworkTypeSelect.value] ?? '';
  }
  function updateBlockKnownUI() {
    const known = el.querySelector('.block-known:checked').value;
    blockPowerField.hidden = known !== 'power';
    blockCurrentField.hidden = known !== 'current';
  }

  blockNetworkTypeSelect.addEventListener('change', updateBlockNetworkUI);
  blockKnownRadios.forEach((radio) => radio.addEventListener('change', updateBlockKnownUI));
  el.querySelector('.remove-block-btn').addEventListener('click', () => {
    el.remove();
    persistNetworkScheme();
  });

  if (config) {
    applyBlockConfig(el, config);
  }
  updateBlockNetworkUI();
  updateBlockKnownUI();

  networkBlocksContainer.appendChild(el);
  return el;
}

function readMainConfig() {
  return {
    networkType: netMainNetworkType.value,
    voltage: Number(netMainVoltage.value),
    installationMethod: netMainInstallation.value,
    cableCount: Number(netMainCableCount.value) || 1,
    cableLength: Number(netMainCableLength.value) || 0,
    simultaneityFactor: Number(netMainSimultaneity.value) || 1,
  };
}

function applyMainConfig(config) {
  netMainNetworkType.value = config.networkType ?? NETWORK_TYPES.AC3;
  netMainVoltage.value = config.voltage ?? 380;
  netMainInstallation.value = config.installationMethod ?? 'air';
  netMainCableCount.value = config.cableCount ?? 1;
  netMainCableLength.value = config.cableLength || '';
  netMainSimultaneity.value = config.simultaneityFactor ?? 1;
}

function persistNetworkScheme() {
  const blocks = Array.from(networkBlocksContainer.querySelectorAll('.network-block')).map(readBlockConfig);
  saveNetworkScheme({ main: readMainConfig(), blocks });
}

function renderBlockResult(resultEl, block) {
  const { result, protection, voltageDrop } = block;
  const parts = [`${formatPower(result.P)}, ${formatCurrent(result.I)}`];
  parts.push(protection.breaker ? `автомат ${protection.breaker} А` : 'ток вне диапазона таблицы автоматов');

  const cableParts = [];
  if (protection.copperCable) cableParts.push(`медь ${protection.copperCable.section} мм²`);
  if (protection.aluminumCable) cableParts.push(`алюминий ${protection.aluminumCable.section} мм²`);
  parts.push(cableParts.length ? `кабель: ${cableParts.join('; ')}` : 'сечение вне диапазона таблицы');

  let warn = false;
  if (voltageDrop) {
    warn = voltageDrop.dropPercent > VOLTAGE_DROP_LIMIT_PERCENT;
    parts.push(`ΔU ${voltageDrop.drop.toFixed(2)} В (${voltageDrop.dropPercent.toFixed(2)}%)${warn ? ' — превышает норму ≤5%' : ''}`);
  }

  resultEl.textContent = parts.join(' · ');
  resultEl.classList.toggle('warn', warn);
}

function renderIncomingResult(incoming, main) {
  const { result, protection, voltageDrop, sumOfBlockBreakers } = incoming;
  netResP.textContent = formatPower(result.P);
  netResS.textContent = formatApparentPower(result.S);
  netResQ.textContent = formatReactivePower(result.Q);
  netResI.textContent = formatCurrent(result.I);

  netResBreaker.textContent = protection.breaker
    ? `Рекомендуемый вводной автоматический выключатель: ${protection.breaker} А (расчётный ток ${result.I.toFixed(2)} А)`
    : `Расчётный ток ввода (${result.I.toFixed(2)} А) превышает диапазон таблицы — требуется индивидуальный подбор оборудования.`;

  const cableParts = [];
  if (protection.copperCable) {
    cableParts.push(`медь — ${protection.copperCable.section} мм² (доп. ток ${protection.copperCable.ratedCurrent} А)`);
  }
  if (protection.aluminumCable) {
    cableParts.push(`алюминий — ${protection.aluminumCable.section} мм² (доп. ток ${protection.aluminumCable.ratedCurrent} А)`);
  }
  netResCable.textContent = cableParts.length
    ? `Рекомендуемое сечение вводного кабеля: ${cableParts.join('; ')}`
    : 'Расчётный ток превышает диапазон табличных сечений — требуется индивидуальный подбор кабеля.';

  netResVoltageDrop.textContent = '';
  netResVoltageDrop.classList.remove('warn');
  if (voltageDrop) {
    const withinLimit = voltageDrop.dropPercent <= VOLTAGE_DROP_LIMIT_PERCENT;
    const materialLabel = voltageDrop.material === 'copper' ? 'медь' : 'алюминий';
    netResVoltageDrop.textContent =
      `Потеря напряжения на вводной линии ${main.cableLength} м (сечение ${voltageDrop.section} мм², ${materialLabel}): ` +
      `${voltageDrop.drop.toFixed(2)} В (${voltageDrop.dropPercent.toFixed(2)}%) — ` +
      `${withinLimit ? 'в пределах общепринятой нормы (≤5%)' : 'превышает общепринятую норму (≤5%), увеличьте сечение'}.`;
    netResVoltageDrop.classList.toggle('warn', !withinLimit);
  }

  netResSelectivity.textContent =
    `Сумма номиналов автоматов отходящих линий — ${sumOfBlockBreakers} А; вводной автомат подобран по суммарной ` +
    `нагрузке с учётом коэффициента одновременности (Кс = ${main.simultaneityFactor}). Если его номинал меньше ` +
    'этой суммы — это нормально при условии, что не все группы работают одновременно на полную мощность; ' +
    'проверку селективности срабатывания защит выполняйте по таблицам производителя аппаратов или с привлечением специалиста.';
}

addBlockBtn.addEventListener('click', () => {
  addBlockElement();
  persistNetworkScheme();
});

networkBlocksContainer.addEventListener('input', persistNetworkScheme);
networkBlocksContainer.addEventListener('change', persistNetworkScheme);
[netMainNetworkType, netMainVoltage, netMainInstallation, netMainCableCount, netMainCableLength, netMainSimultaneity].forEach((el) => {
  el.addEventListener('input', persistNetworkScheme);
  el.addEventListener('change', persistNetworkScheme);
});

calcNetworkBtn.addEventListener('click', () => {
  networkErrorMessage.textContent = '';
  persistNetworkScheme();

  const blockElements = Array.from(networkBlocksContainer.querySelectorAll('.network-block'));
  if (!blockElements.length) {
    networkErrorMessage.textContent = 'Добавьте хотя бы один блок потребителя.';
    networkResults.hidden = true;
    return;
  }

  const validBlocks = [];
  blockElements.forEach((el) => {
    const errorEl = el.querySelector('.block-error');
    const resultEl = el.querySelector('.block-result');
    errorEl.textContent = '';
    resultEl.textContent = '';
    resultEl.classList.remove('warn');
    try {
      const config = readBlockConfig(el);
      const block = calculateBlock(config);
      renderBlockResult(resultEl, block);
      validBlocks.push(block);
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  if (!validBlocks.length) {
    networkErrorMessage.textContent = 'Нет ни одного корректно заполненного блока — исправьте ошибки в блоках выше.';
    networkResults.hidden = true;
    return;
  }

  const main = readMainConfig();
  try {
    const incoming = aggregateIncoming({ blocks: validBlocks, ...main });
    renderIncomingResult(incoming, main);
    networkResults.hidden = false;
  } catch (err) {
    networkErrorMessage.textContent = err.message;
    networkResults.hidden = true;
  }
});

const savedNetworkScheme = loadNetworkScheme();
if (savedNetworkScheme) {
  applyMainConfig(savedNetworkScheme.main ?? {});
  savedNetworkScheme.blocks.forEach((block) => addBlockElement(block));
} else {
  addBlockElement({
    name: 'Освещение',
    networkType: NETWORK_TYPES.AC1,
    voltage: 220,
    powerFactor: 1,
    known: 'power',
    knownValue: 1000,
    installationMethod: 'air',
    cableCount: 1,
    cableLength: 0,
  });
}

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
