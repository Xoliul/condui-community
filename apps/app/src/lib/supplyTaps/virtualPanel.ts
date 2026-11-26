import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { generateId } from '@/utils/id'

/**
 * Virtual boards are drawing-only containers (see `Panel.virtual`). They are never a board of
 * their own, but their circuits are ordinary circuits of the project.
 */
export function isVirtualPanel(panel: Pick<Panel, 'virtual'> | null | undefined): boolean {
  return panel?.virtual != null
}

/** The virtual board that holds the supply taps of its owner main panel. */
export function isSupplyTapsPanel(panel: Pick<Panel, 'virtual'> | null | undefined): boolean {
  return panel?.virtual?.kind === 'supply-taps'
}

/** The owner's supply-taps virtual board, when it has one. */
export function getSupplyTapsPanel(owner: Pick<Panel, 'subPanels'>): Panel | undefined {
  return (owner.subPanels ?? []).find((panel) => isSupplyTapsPanel(panel))
}

/**
 * The protections and circuits whose modules hang in this board's cabinet. A supply tap's breaker
 * is a physical module of its owner board: the taps board only groups it for the one-wire drawing.
 */
export function getPanelModuleItems(
  panel: Pick<Panel, 'protections' | 'circuits' | 'subPanels'>
): { protections: ProtectionDevice[]; circuits: Circuit[] } {
  const taps = getSupplyTapsPanel(panel)
  if (!taps) return { protections: panel.protections, circuits: panel.circuits }
  return {
    protections: [...panel.protections, ...taps.protections],
    circuits: [...panel.circuits, ...taps.circuits],
  }
}

/**
 * The owner's supply-taps virtual board, created empty when missing. Mutates `owner`, so call it
 * on a draft; the board gets the localized default name and no feeder protection.
 */
export function getOrCreateSupplyTapsPanel(
  owner: Pick<Panel, 'subPanels'>,
  localizedName: string
): Panel {
  const existing = getSupplyTapsPanel(owner)
  if (existing) return existing
  const created: Panel = {
    id: generateId(),
    name: localizedName,
    symbol: 'panel_distribution',
    virtual: { kind: 'supply-taps' },
    protections: [],
    circuits: [],
    subPanels: [],
  }
  if (!owner.subPanels) owner.subPanels = []
  owner.subPanels.push(created)
  return created
}

/** Where a top-level item of a supply-taps board leaves the supply wire, when it has an anchor. */
export function getSupplyTapAnchor(
  item: Pick<ProtectionDevice | Circuit, 'supplyTap'>
): SupplyTapAnchor | undefined {
  return item.supplyTap
}

/** A top-level item of a supply-taps board with its anchor, in tap order. */
export type SupplyTapEntry =
  | { kind: 'protection'; item: ProtectionDevice; anchor: SupplyTapAnchor | undefined }
  | { kind: 'circuit'; item: Circuit; anchor: SupplyTapAnchor | undefined }

/**
 * Top-level taps of the owner's supply-taps board: protected taps first, then unprotected
 * circuits, each in stored order. Several taps at one anchor keep this order.
 */
export function listSupplyTaps(owner: Pick<Panel, 'subPanels'>): SupplyTapEntry[] {
  const board = getSupplyTapsPanel(owner)
  if (!board) return []
  return [
    ...(board.protections ?? []).filter((item) => !isNestedSupplyTapProtection(board, item)).map(
      (item): SupplyTapEntry => ({ kind: 'protection', item, anchor: item.supplyTap })
    ),
    ...(board.circuits ?? []).map(
      (item): SupplyTapEntry => ({ kind: 'circuit', item, anchor: item.supplyTap })
    ),
  ]
}

/**
 * A protection of the taps board that sits after another tap's content (a terminal strip on a
 * tap lead, then this breaker): its circuit is nested under a tap circuit, so it is no tap of
 * its own and carries no anchor.
 */
export function isNestedSupplyTapProtection(
  board: Pick<Panel, 'protections' | 'circuits'>,
  protection: Pick<ProtectionDevice, 'circuits'>
): boolean {
  const ids = new Set((protection.circuits ?? []).map((circuit) => circuit.id))
  if (ids.size === 0) return false
  const circuits = [...(board.circuits ?? []), ...(board.protections ?? []).flatMap((item) => item.circuits ?? [])]
  return circuits.some((circuit) => circuit.subCircuitIds?.some((id) => ids.has(id)))
}

/** True when the virtual board carries no protection and no circuit. */
export function isSupplyTapsPanelEmpty(panel: Panel): boolean {
  return (
    (panel.protections ?? []).length === 0 &&
    (panel.circuits ?? []).length === 0 &&
    (panel.subPanels ?? []).length === 0
  )
}

/** A physical board: not a virtual container. Use as an array filter for board-level lists. */
export function isBoardPanel(panel: Pick<Panel, 'virtual'> | null | undefined): boolean {
  return !isVirtualPanel(panel)
}

/** The panel whose `subPanels` hold the given virtual board, searched through the panel tree. */
export function findVirtualPanelOwner(
  panels: readonly Panel[] | undefined,
  virtualPanelId: string
): Panel | undefined {
  for (const panel of panels ?? []) {
    if ((panel.subPanels ?? []).some((child) => child.id === virtualPanelId && isVirtualPanel(child))) {
      return panel
    }
    const nested = findVirtualPanelOwner(panel.subPanels, virtualPanelId)
    if (nested) return nested
  }
  return undefined
}
