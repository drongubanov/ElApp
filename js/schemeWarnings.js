// Сводка проверок схемы сети — собирает в один плоский список все замечания,
// разбросанные по узлам дерева после расчёта (calculateTree + annotateShortCircuit +
// annotateVoltageDrop): ошибки расчёта, перегрузку по балансу нагрузки, превышение
// суммарной потери напряжения, негарантированное время отключения и недостаточную
// термическую стойкость кабеля при КЗ, а также проблемы селективности. Модуль
// независим от DOM — работает с готовым деревом результатов и проверяется
// обычными модульными тестами; визуальное представление и переход к узлу
// реализованы в app.js.

// Общепринятая норма потери напряжения в сети до потребителя (ГОСТ 32144, ПУЭ).
export const VOLTAGE_DROP_LIMIT_PERCENT = 5;

const SELECTIVITY_LABELS = {
  'not-selective': 'не обеспечена',
  uncertain: 'не гарантирована',
};

/**
 * Обходит дерево результатов в порядке сверху вниз и возвращает массив замечаний
 * вида { nodeId, nodeName, severity, category, message }. severity: 'error' —
 * узел не рассчитан; 'warn' — рассчитан, но есть к чему присмотреться.
 */
export function collectSchemeWarnings(calcTree) {
  if (!calcTree) return [];
  const warnings = [];

  const walk = (calc) => {
    // Ошибка расчёта: показываем узел-первопричину (без ошибок ниже по дереву),
    // иначе одна ошибка в листе порождала бы дубли у всех его предков.
    if (calc.error && !calc.children.some((child) => child.error)) {
      warnings.push({
        nodeId: calc.id,
        nodeName: calc.name,
        severity: 'error',
        category: 'error',
        message: calc.error,
      });
    } else if (calc.result) {
      if (calc.balance) {
        const limits = [];
        if (calc.balance.overBreaker) limits.push(`автомат ${calc.balance.breaker} А`);
        if (calc.balance.overCable) limits.push(`допустимый ток кабеля ${calc.balance.cableAmpacity} А`);
        warnings.push({
          nodeId: calc.id,
          nodeName: calc.name,
          severity: 'warn',
          category: 'balance',
          message:
            `Баланс нагрузки: без учёта Кс суммарный ток дочерних узлов (${calc.balance.rawCurrent.toFixed(1)} А) ` +
            `превысил бы ${limits.join(' и ')}.`,
        });
      }

      if (calc.cumulativeVoltageDropPercent != null && calc.cumulativeVoltageDropPercent > VOLTAGE_DROP_LIMIT_PERCENT) {
        warnings.push({
          nodeId: calc.id,
          nodeName: calc.name,
          severity: 'warn',
          category: 'voltage-drop',
          message:
            `Суммарная потеря напряжения от точки ввода ${calc.cumulativeVoltageDropPercent.toFixed(2)}% превышает ` +
            `норму ≤${VOLTAGE_DROP_LIMIT_PERCENT}% — увеличьте сечение кабеля на этом или предыдущих участках.`,
        });
      }

      if (calc.shortCircuit?.disconnection?.requiresRcd) {
        warnings.push({
          nodeId: calc.id,
          nodeName: calc.name,
          severity: 'warn',
          category: 'short-circuit',
          message:
            'Система TT: автоматическое отключение питания должно обеспечиваться УЗО (RCD) — ' +
            'максимально-токовая защита ток однофазного замыкания на землю за нормативное время не отключит.',
        });
      } else if (calc.shortCircuit?.disconnection && !calc.shortCircuit.disconnection.ok) {
        warnings.push({
          nodeId: calc.id,
          nodeName: calc.name,
          severity: 'warn',
          category: 'short-circuit',
          message:
            `Время отключения при КЗ не гарантировано (характеристика ${calc.shortCircuit.curve}) — ` +
            'уменьшите длину, увеличьте сечение или примените УЗО.',
        });
      }

      if (calc.shortCircuit?.thermalCheck && !calc.shortCircuit.thermalCheck.ok) {
        warnings.push({
          nodeId: calc.id,
          nodeName: calc.name,
          severity: 'warn',
          category: 'thermal',
          message:
            `Термическая стойкость кабеля при КЗ не обеспечена: по нагреву требуется сечение не менее ` +
            `${calc.shortCircuit.thermalCheck.minSection.toFixed(2)} мм² (сейчас ` +
            `${calc.shortCircuit.thermalCheck.actualSection} мм²) — увеличьте сечение или ускорьте отключение.`,
        });
      }

      if (calc.selectivity && calc.selectivity.level !== 'selective') {
        warnings.push({
          nodeId: calc.id,
          nodeName: calc.name,
          severity: 'warn',
          category: 'selectivity',
          message:
            `Селективность с дочерними автоматами ${SELECTIVITY_LABELS[calc.selectivity.level]} ` +
            `(отношение номиналов ×${calc.selectivity.ratio.toFixed(2)}).`,
        });
      }
    }

    calc.children.forEach(walk);
  };

  walk(calcTree);
  return warnings;
}
