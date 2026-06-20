// Вспомогательная логика множественного выбора узлов дерева. Из набора
// выбранных id оставляет только «верхние» — те, ни один предок которых не
// выбран. Нужно для групповых операций (удаление, дублирование, перенос):
// если выбраны и узел, и его предок, обрабатывать надо только предка (вместе с
// поддеревом), иначе узел будет затронут дважды. Модуль не зависит от DOM и
// проверяется модульными тестами.

/**
 * @param {object} tree         корневой узел дерева
 * @param {Set<string>} selectedIds  множество выбранных id
 * @returns {string[]}          id верхних выбранных узлов в порядке обхода дерева
 */
export function topMostSelectedIds(tree, selectedIds) {
  const result = [];
  const walk = (node, hasSelectedAncestor) => {
    const selected = selectedIds.has(node.id);
    if (selected && !hasSelectedAncestor) result.push(node.id);
    node.children.forEach((child) => walk(child, hasSelectedAncestor || selected));
  };
  walk(tree, false);
  return result;
}
