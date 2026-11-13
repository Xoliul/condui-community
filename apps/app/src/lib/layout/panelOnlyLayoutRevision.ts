import type { ProjectV2 } from '@/types/projectV2'
import type { Panel, PanelGridConfig, PanelGridSlot } from '@/types/schema'
import { isImmutablePanelReadInput } from '@/lib/panel/panelReadContext'

const revisions = new WeakMap<ProjectV2, ProjectV2>()
let latest: { project: ProjectV2; source: ProjectV2 } | undefined

function sameFieldsExcept(left: object, right: object, excluded: readonly string[]): boolean {
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (key) => excluded.includes(key) || Object.is(a[key], b[key])
  )
}

function sameStrings(left: readonly string[] = [], right: readonly string[] = []): boolean {
  return left === right || (left.length === right.length && left.every((value, i) => value === right[i]))
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  if (!Array.isArray(left) && Object.getPrototypeOf(left) !== Object.prototype) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key =>
    Object.hasOwn(b, key) && sameValue(a[key], b[key])
  )
}

function supplyMembership(slots: readonly PanelGridSlot[] = []): string[] {
  // deriveWires and resolveSupplyDeviceMounting read supply membership, never
  // row/column/width or the presence of ordinary protection/circuit modules.
  return slots.flatMap(({ module }) =>
    module.kind === 'trunkDevice' && module.scope === 'supply' ? [module.id] : []
  ).sort()
}

function sameGrid(left?: PanelGridConfig, right?: PanelGridConfig): boolean {
  if (left === right) return true
  if (!sameFieldsExcept(left ?? {}, right ?? {}, [
    'rows', 'columns', 'fields', 'feedFromTop', 'terminalStripTopRail', 'terminalStripBottomRail',
    'supplyPanelRows', 'supplyPanelColumns', 'slots', 'supplyPanelSlots',
    'hiddenModuleKeys', 'shownModuleKeys',
  ])) return false
  return sameStrings(left?.hiddenModuleKeys, right?.hiddenModuleKeys) &&
    sameStrings(left?.shownModuleKeys, right?.shownModuleKeys) &&
    sameStrings(supplyMembership(left?.slots), supplyMembership(right?.slots)) &&
    sameStrings(supplyMembership(left?.supplyPanelSlots), supplyMembership(right?.supplyPanelSlots))
}

function samePanels(left: readonly Panel[], right: readonly Panel[]): boolean {
  return left === right || (left.length === right.length && left.every((panel, index) => {
    const other = right[index]!
    return panel === other || (
      sameFieldsExcept(panel, other, ['gridView', 'subPanels']) &&
      sameGrid(panel.gridView, other.gridView) &&
      samePanels(panel.subPanels, other.subPanels)
    )
  }))
}

function sameOneWireInputs(left: ProjectV2, right: ProjectV2): boolean {
  const a = left.disciplines.electrical
  const b = right.disciplines.electrical
  if (!a || !b) return false
  if (!sameFieldsExcept(left, right, ['project', 'disciplines']) ||
      !sameFieldsExcept(left.project, right.project, ['updatedAt']) ||
      !sameFieldsExcept(left.disciplines, right.disciplines, ['electrical']) ||
      !sameFieldsExcept(a, b, ['installation', 'panels', 'auxiliaryEnclosures']) ||
      // Existing grid persistence may recreate an equal feed-topology record.
      !sameValue(a.installation, b.installation) ||
      !samePanels(a.panels, b.panels)) return false
  const enclosures = a.auxiliaryEnclosures ?? []
  const otherEnclosures = b.auxiliaryEnclosures ?? []
  return enclosures === otherEnclosures || (
    enclosures.length === otherEnclosures.length && enclosures.every((enclosure, index) => {
      const other = otherEnclosures[index]!
      return enclosure === other || (
        sameFieldsExcept(enclosure, other, ['gridView', 'panelViewPosition']) &&
        sameGrid(enclosure.gridView, other.gridView)
      )
    })
  )
}

/**
 * Cabinet coordinates do not change one-wire geometry or wire routing. Preserve
 * their immutable source revision only after comparing the completed domain edit:
 * automatic naming, visibility, supply membership, mounting, topology and all
 * unrecognized fields still invalidate. Unknown/mutable input is never retained.
 * Weak keys support undo/redo without inheriting across a different electrical
 * revision; only the latest comparison candidate is strongly retained.
 */
export function getPanelOnlyLayoutRevision(project: ProjectV2): ProjectV2 {
  if (!isImmutablePanelReadInput(project)) return project
  const known = revisions.get(project)
  const source = known ?? (
    latest && sameOneWireInputs(latest.project, project) ? latest.source : project
  )
  revisions.set(project, source)
  latest = { project, source }
  return source
}
