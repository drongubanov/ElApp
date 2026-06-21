// Шаблоны типовых узлов сети — быстрые пресеты при добавлении дочернего узла,
// чтобы не настраивать каждое поле вручную. Каждый шаблон задаёт характерные
// параметры распространённого потребителя/группы (тип сети, напряжение, cos φ,
// нагрузку, способ прокладки, тип нагрузки). Значения — типовые ориентиры для
// эскизного проектирования, пользователь правит их под свой объект. Модуль
// независим от DOM и проверяется модульными тестами (каждый пресет должен
// рассчитываться без ошибок и подбирать автомат).

import { NETWORK_TYPES } from './calculations.js';
import { DEFAULT_START_CURRENT_RATIO } from './network.js';

export const NODE_TEMPLATES = [
  {
    id: 'socket',
    label: 'Розеточная группа',
    hint: '1 фаза, 220 В, ~3,5 кВт',
    node: {
      name: 'Розеточная группа',
      kind: 'socket',
      networkType: NETWORK_TYPES.AC1,
      voltage: 220,
      powerFactor: 0.95,
      hasOwnLoad: true,
      known: 'power',
      knownValue: 3500,
      installationMethod: 'conduit',
      cableCount: 1,
      loadType: 'general',
    },
  },
  {
    id: 'lighting',
    label: 'Освещение',
    hint: '1 фаза, 220 В, ~1 кВт',
    node: {
      name: 'Освещение',
      kind: 'lighting',
      networkType: NETWORK_TYPES.AC1,
      voltage: 220,
      powerFactor: 0.95,
      hasOwnLoad: true,
      known: 'power',
      knownValue: 1000,
      installationMethod: 'conduit',
      cableCount: 1,
      loadType: 'general',
    },
  },
  {
    id: 'motor',
    label: 'Электродвигатель',
    hint: '3 фазы, 380 В, ~5,5 кВт, пусковой ток',
    node: {
      name: 'Электродвигатель',
      kind: 'motor',
      networkType: NETWORK_TYPES.AC3,
      voltage: 380,
      powerFactor: 0.85,
      hasOwnLoad: true,
      known: 'power',
      knownValue: 5500,
      installationMethod: 'tray',
      cableCount: 1,
      loadType: 'motor',
      startCurrentRatio: DEFAULT_START_CURRENT_RATIO,
    },
  },
];
