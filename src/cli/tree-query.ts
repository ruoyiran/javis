import {
  joinComputerTreeText,
  parseComputerTreeText,
  type ComputerTreeElement
} from '../contract/computer-use-tree-text.js'

export function queryComputerTreeText(
  treeText: string,
  options: { query?: string; maxElements?: number }
): string {
  const { header, elements, footer } = parseComputerTreeText(treeText)
  const needle = options.query?.toLowerCase()
  const candidates = needle
    ? elements.filter((element) => element.lines[0].trimStart().toLowerCase().includes(needle))
    : elements
  const shown = options.maxElements === undefined
    ? candidates
    : candidates.slice(0, options.maxElements)
  const shownSet = new Set(shown)
  const keep = new Set<ComputerTreeElement>()
  const path: (ComputerTreeElement | undefined)[] = []
  for (const element of elements) {
    path.length = Math.min(path.length, element.depth)
    if (shownSet.has(element)) {
      for (const ancestor of path) if (ancestor) keep.add(ancestor)
      keep.add(element)
    }
    path[element.depth] = element
  }
  const body = elements.flatMap((element) =>
    !keep.has(element) ? [] : shownSet.has(element) ? element.lines : element.lines.slice(0, 1)
  )
  const note = needle
    ? candidates.length === 0
      ? `No elements match "${options.query}".`
      : `${candidates.length} of ${elements.length} elements match "${options.query}"; showing ${shown.length === candidates.length ? 'them' : `the first ${shown.length}`} with their ancestors.`
    : shown.length < elements.length
      ? `Showing the first ${shown.length} of ${elements.length} elements.`
      : null
  return joinComputerTreeText(header, note ? [note, ...body] : body, footer)
}
