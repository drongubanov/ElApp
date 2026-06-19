import { calculate, NETWORK_TYPES } from './calculations.js';
import { recommendProtection } from './tables.js';
import { loadHistory, saveHistoryEntry, deleteHistoryEntry, clearHistory } from './history.js';
import { formatPower, formatApparentPower, formatReactivePower, formatCurrent, formatDateTime } from './format.js';

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
const errorMessage = document.getElementById('error-message');
const resultsSection = document.getElementById('results');

const resP = document.getElementById('res-p');
const resS = document.getElementById('res-s');
const resQ = document.getElementById('res-q');
const resI = document.getElementById('res-i');
const resBreaker = document.getElementById('res-breaker');
const resCable = document.getElementById('res-cable');

const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const clearHistoryBtn = document.getElementById('clear-history-btn');

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

function showError(message) {
  errorMessage.textContent = message;
  resultsSection.hidden = true;
}

function renderResults(result, protection) {
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

function runCalculation({ networkType, voltage, powerFactor, known, knownValue }, { persist }) {
  errorMessage.textContent = '';
  try {
    const result = calculate({ networkType, voltage, powerFactor, known, knownValue });
    const protection = recommendProtection(result.I);
    renderResults(result, protection);

    if (persist) {
      saveHistoryEntry({
        input: { networkType, voltage, powerFactor, known, knownValue },
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
  switchTab('calc');
  runCalculation(input, { persist: false });
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

  runCalculation({ networkType, voltage, powerFactor, known, knownValue }, { persist: true });
});

renderHistory();
