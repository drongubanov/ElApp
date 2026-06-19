// Форматирование чисел и единиц измерения для вывода в интерфейсе.

function formatWithUnit(value, baseUnit, kiloUnit) {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ${kiloUnit}`;
  }
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${baseUnit}`;
}

export const formatPower = (watts) => formatWithUnit(watts, 'Вт', 'кВт');
export const formatApparentPower = (va) => formatWithUnit(va, 'ВА', 'кВА');
export const formatReactivePower = (reactive) => formatWithUnit(reactive, 'вар', 'квар');
export const formatCurrent = (amps) => `${amps.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} А`;
export const formatVoltage = (volts) => `${volts.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} В`;

export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
