/**
 * Supply taps in the detached supply frame: the items of the owner's virtual supply-taps board
 * are laid out by the ordinary circuit pipeline (like a main board), then moved onto the grid
 * lane at their anchor. Canonical (pre-mirror) space is used throughout; the detached-frame
 * mirror flips the finished geometry.
 */
import type { Circuit, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { getEndpointLayoutOffsets } from './bottomUpBranchWidths'
import { LAYOUT_CONSTANTS, SUPPLY_INFO_DEVICE_HORIZONTAL_REACH } from './bottomUpLayoutConstants'
import { getProtectionAnchorOffset } from './bottomUpPanelTransforms'
import { getSupplyInlineLabelLines } from './supplyInlineDeviceLabels'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { getSupplyTapsPanel, isNestedSupplyTapProtection } from '@/lib/supplyTaps/virtualPanel'
import type { BottomUpCircuitLayout } from './bottomUpLayout'
import type { BranchLayout, TrunkLayout } from './wireSegments'

/** Gap between neighbouring tap columns, and between a column and a device's painted edge. */
const TAP_COLUMN_MARGIN = 8
/** Clearance from the converter / backup row's centre to the lowest paint of a tap above it. */
export const SUPPLY_TAP_ROW_CLEARANCE = 54
/** Label allowance above the topmost tap content. */
const TAP_TOP_LABEL_ALLOWANCE = 14

/** A top-level tap item (protection or unprotected circuit) of a supply-taps board. */
export interface SupplyTapGroup {
  /** Id of the top-level protection or circuit. */
  id: string
  kind: 'protection' | 'circuit'
  anchor: SupplyTapAnchor
  /** Every circuit under the item, nested ones included. */
  circuitIds: ReadonlySet<string>
  protectionId?: string
}

/** Measured canonical geometry of one tap group, relative to its anchor column. */
export interface SupplyTapMeasure extends SupplyTapGroup {
  /** Canonical x of the tap's vertical wire before relocation. */
  anchorX: number
  /**
   * Painted extent left of / right of the anchor x in canonical (pre-mirror) space. A tap is drawn
   * like an ordinary board column (branches to the right) in the final scene, so its canonical
   * footprint is the reflection of the measured one: the measured right side is `left` here.
   */
  left: number
  right: number
  /** Height of the tap above its lane (mcb riser, devices, branches, labels). */
  height: number
}

/** Final position of a placed tap, in canonical (pre-mirror) layout space. */
export interface SupplyTapPlacement {
  id: string
  circuitIds: string[]
  protectionId?: string
  anchor: SupplyTapAnchor
  /** Where the tap leaves the grid lane. */
  x: number
  laneY: number
  /** Topmost painted y of the tap (smaller = higher). */
  topY: number
}

const tapGroupCache = new WeakMap<Panel, SupplyTapGroup[]>()

function collectCircuitIds(
  circuit: Circuit,
  circuitById: ReadonlyMap<string, Circuit>,
  into: Set<string>
): void {
  if (into.has(circuit.id)) return
  into.add(circuit.id)
  for (const childId of circuit.subCircuitIds ?? []) {
    const child = circuitById.get(childId)
    if (child) collectCircuitIds(child, circuitById, into)
  }
}

/** Tap groups of a supply diagram panel: its top-level items that carry a `supplyTap` anchor. */
export function getSupplyTapGroups(panel: Panel): SupplyTapGroup[] {
  const cached = tapGroupCache.get(panel)
  if (cached) return cached
  const circuitById = new Map<string, Circuit>()
  for (const circuit of panel.circuits ?? []) circuitById.set(circuit.id, circuit)
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) circuitById.set(circuit.id, circuit)
  }
  const groups: SupplyTapGroup[] = []
  for (const protection of panel.protections ?? []) {
    if (!protection.supplyTap) continue
    const ids = new Set<string>()
    for (const circuit of protection.circuits ?? []) collectCircuitIds(circuit, circuitById, ids)
    groups.push({
      id: protection.id,
      kind: 'protection',
      anchor: protection.supplyTap,
      circuitIds: ids,
      protectionId: protection.id,
    })
  }
  for (const circuit of panel.circuits ?? []) {
    if (!circuit.supplyTap) continue
    const ids = new Set<string>()
    collectCircuitIds(circuit, circuitById, ids)
    groups.push({ id: circuit.id, kind: 'circuit', anchor: circuit.supplyTap, circuitIds: ids })
  }
  tapGroupCache.set(panel, groups)
  return groups
}

/** Ids of every circuit a supply diagram panel draws as a tap. */
export function getSupplyTapCircuitIds(panel: Panel): ReadonlySet<string> {
  const groups = getSupplyTapGroups(panel)
  if (groups.length === 0) return EMPTY_SET
  return new Set(groups.flatMap((group) => [...group.circuitIds]))
}
const EMPTY_SET: ReadonlySet<string> = new Set()

/**
 * The detached supply frame's own panel clone plus the owner's tap items, so the ordinary
 * circuit pipeline lays them out. Items without an anchor start the grid run.
 *
 * A tap without a breaker (a kWh meter or a load straight off the grid wire) is a bare circuit in
 * the taps board. The circuit pipeline only draws circuits that hang under a protection, so the
 * drawing wraps it in a hidden owner, as a meter wired directly to a busbar is stored
 * (`directTrunkFeeder`: no symbol, the wire runs through). The owner takes the circuit's id, so
 * the tap keeps its identity in placements and drop lanes; it never reaches the project.
 */
export function addSupplyTapsToDiagramPanel(diagramPanel: Panel, owner: Panel): Panel {
  const board = getSupplyTapsPanel(owner)
  if (!board) return diagramPanel
  const anchorOf = (item: ProtectionDevice | Circuit) => item.supplyTap ?? { leg: 'grid-run' as const }
  const hiddenOwner = (circuit: Circuit): ProtectionDevice => ({
    id: circuit.id,
    type: 'OTHER',
    label: '',
    directTrunkFeeder: true,
    supplyTap: anchorOf(circuit),
    circuits: [circuit],
  })
  return {
    ...diagramPanel,
    protections: [
      ...diagramPanel.protections,
      ...(board.protections ?? []).map((item) =>
        isNestedSupplyTapProtection(board, item) ? item : { ...item, supplyTap: anchorOf(item) }
      ),
      ...(board.circuits ?? []).map(hiddenOwner),
    ],
  }
}

function isTapCircuitLayout(
  layout: BottomUpCircuitLayout,
  group: SupplyTapGroup
): boolean {
  return group.circuitIds.has(layout.circuit.id)
}

/** Splits circuit-pipeline outputs into the ordinary board part and the tap part. */
export function splitSupplyTapLayouts<T extends { circuitId: string }>(
  tapCircuitIds: ReadonlySet<string>,
  branches: readonly T[]
): { main: T[]; tap: T[] } {
  const main: T[] = []
  const tap: T[] = []
  for (const branch of branches) (tapCircuitIds.has(branch.circuitId) ? tap : main).push(branch)
  return { main, tap }
}

export function splitSupplyTapCircuitLayouts(
  tapCircuitIds: ReadonlySet<string>,
  layouts: readonly BottomUpCircuitLayout[]
): { main: BottomUpCircuitLayout[]; tap: BottomUpCircuitLayout[] } {
  const main: BottomUpCircuitLayout[] = []
  const tap: BottomUpCircuitLayout[] = []
  for (const layout of layouts) (tapCircuitIds.has(layout.circuit.id) ? tap : main).push(layout)
  return { main, tap }
}

export function splitSupplyTapTrunks(
  tapCircuitIds: ReadonlySet<string>,
  trunks: readonly TrunkLayout[],
  tapProtectionIds: ReadonlySet<string>
): { main: TrunkLayout[]; tap: TrunkLayout[] } {
  const main: TrunkLayout[] = []
  const tap: TrunkLayout[] = []
  for (const trunk of trunks) {
    const isTap =
      tapProtectionIds.has(trunk.protectionId) ||
      trunk.circuits.some((circuit) => tapCircuitIds.has(circuit.id))
    ;(isTap ? tap : main).push(trunk)
  }
  return { main, tap }
}

function getBranchTopY(branch: BranchLayout): number {
  if (branch.endpoints.length === 0) {
    return branch.branchY - LAYOUT_CONSTANTS.SYMBOL_SIZE - 4
  }
  const offsets = getEndpointLayoutOffsets(
    branch.endpoints,
    LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
    LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
    LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
    LAYOUT_CONSTANTS.SYMBOL_SIZE
  )
  return Math.min(
    ...branch.endpoints.map(
      (_endpoint, index) =>
        branch.branchY + (offsets[index]?.y ?? 0) - LAYOUT_CONSTANTS.SYMBOL_SIZE - 4
    )
  )
}

/** Measures every tap group on the provisional layout (bus at `mainBusY`, before relocation). */
export function measureSupplyTapGroups(
  groups: readonly SupplyTapGroup[],
  circuitLayouts: readonly BottomUpCircuitLayout[],
  trunks: readonly TrunkLayout[],
  branches: readonly BranchLayout[],
  mainBusY: number
): SupplyTapMeasure[] {
  return groups.map((group) => {
    const layouts = circuitLayouts.filter((layout) => isTapCircuitLayout(layout, group))
    const groupTrunks = trunks.filter(
      (trunk) =>
        trunk.protectionId === group.protectionId ||
        trunk.circuits.some((circuit) => group.circuitIds.has(circuit.id))
    )
    const groupBranches = branches.filter((branch) => group.circuitIds.has(branch.circuitId))
    const topLayouts = layouts.filter((layout) => !layout.parentCircuit)
    const rcdTrunk = topLayouts.some((layout) => layout.parentRcd) || topLayouts.length === 0
      ? groupTrunks[0]
      : undefined
    let anchorX: number
    if (rcdTrunk) anchorX = rcdTrunk.x + rcdTrunk.width / 2
    else if (topLayouts[0]) {
      anchorX = topLayouts[0].x + getProtectionAnchorOffset(topLayouts[0].leftReserve)
    } else anchorX = LAYOUT_CONSTANTS.LEFT_MARGIN
    let minX = anchorX - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
    let maxX = anchorX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
    for (const layout of layouts) {
      minX = Math.min(minX, layout.x)
      maxX = Math.max(maxX, layout.x + layout.width)
    }
    for (const trunk of groupTrunks) {
      minX = Math.min(minX, trunk.x)
      maxX = Math.max(maxX, trunk.x + trunk.width)
    }
    for (const branch of groupBranches) {
      minX = Math.min(minX, branch.trunkX, branch.branchX)
      maxX = Math.max(maxX, branch.trunkX, branch.branchX + branch.branchWidth)
    }
    let topY =
      mainBusY -
      LAYOUT_CONSTANTS.MCB_Y_OFFSET -
      LAYOUT_CONSTANTS.BRANCH_START_OFFSET -
      LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
    if (groupTrunks.length > 0) {
      topY = Math.min(topY, mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET - LAYOUT_CONSTANTS.SYMBOL_SIZE)
    }
    for (const branch of groupBranches) topY = Math.min(topY, getBranchTopY(branch))
    return {
      ...group,
      anchorX,
      left: Math.max(0, maxX - anchorX),
      right: Math.max(0, anchorX - minX),
      height: mainBusY - topY + TAP_TOP_LABEL_ALLOWANCE,
    }
  })
}

/** Horizontal half extent of a lane device including its inline captions. */
export function getSupplyTapDeviceHalfExtent(device: TrunkDevice): number {
  const labelWidth = Math.max(
    0,
    ...getSupplyInlineLabelLines(device).map((line) =>
      measureSymbolLabelTextWidth(line.text, 'Figtree', 10)
    )
  )
  // Never narrower than the collision block the frame reserves for a supply device.
  return Math.max(SUPPLY_INFO_DEVICE_HORIZONTAL_REACH, labelWidth / 2 + 4)
}

export interface SupplyTapRunItem {
  id: string
  /** Position along the run, increasing away from the fixed lower boundary. */
  x: number
  half: number
}

export interface SupplyTapRunPlan {
  /** Extra x added to each run item (index-aligned) so the tap columns fit before it. */
  shifts: number[]
  /** Canonical x of every tap's vertical wire, in the shifted frame. */
  tapX: Map<string, number>
  /** Span needed past the last item for taps at the open end of the run. */
  trailingNeed: number
  /** Everything the run needs in total, for runs whose far end is another fixed element. */
  totalExtra: number
}

/**
 * Packs tap columns into the gaps of one lane run. `gapByTapId` names the gap (0 = between the
 * lower boundary and item 0, k = between item k-1 and item k, items.length = past the last
 * item). Items from a gap onward move outward by the space the gap's taps need; the lower
 * boundary stays. `fromUpper` places the first tap against the upper neighbour.
 */
export function planSupplyTapRun(input: {
  items: readonly SupplyTapRunItem[]
  lowerBoundX: number
  lowerBoundHalf: number
  taps: readonly SupplyTapMeasure[]
  gapByTapId: ReadonlyMap<string, number>
  fromUpper: boolean
}): SupplyTapRunPlan {
  const { items, lowerBoundX, lowerBoundHalf, taps, gapByTapId, fromUpper } = input
  const shifts = items.map(() => 0)
  const tapX = new Map<string, number>()
  let cumulative = 0
  let trailingNeed = 0
  for (let gap = 0; gap <= items.length; gap++) {
    const gapTaps = taps.filter((tap) => gapByTapId.get(tap.id) === gap)
    const lowerX = gap === 0 ? lowerBoundX : items[gap - 1]!.x + shifts[gap - 1]!
    const lowerHalf = gap === 0 ? lowerBoundHalf : items[gap - 1]!.half
    const upper = items[gap]
    if (gapTaps.length > 0) {
      const spans = gapTaps.reduce((sum, tap) => sum + tap.left + tap.right, 0)
      const inner = spans + (gapTaps.length - 1) * TAP_COLUMN_MARGIN
      const need = lowerHalf + TAP_COLUMN_MARGIN + inner + TAP_COLUMN_MARGIN + (upper?.half ?? 0)
      const available = upper ? upper.x + cumulative - lowerX : 0
      const extra = upper ? Math.max(0, need - available) : 0
      cumulative += extra
      if (upper) shifts[gap] = cumulative
      else trailingNeed = need
      // Lay the columns out between the (shifted) neighbours.
      const ordered = fromUpper ? [...gapTaps].reverse() : gapTaps
      let cursor = lowerX + lowerHalf + TAP_COLUMN_MARGIN
      if (upper && fromUpper) {
        cursor = upper.x + cumulative - (upper.half + TAP_COLUMN_MARGIN + inner)
      }
      for (const tap of ordered) {
        tapX.set(tap.id, cursor + tap.left)
        cursor += tap.left + tap.right + TAP_COLUMN_MARGIN
      }
    } else if (upper) {
      shifts[gap] = cumulative
    }
  }
  return { shifts, tapX, trailingNeed, totalExtra: cumulative + trailingNeed }
}

/** The gap a tap uses on a run whose flow runs toward the lower boundary (serial grid run). */
export function resolveTowardLowerGap(
  tap: SupplyTapGroup,
  itemDeviceIds: readonly string[]
): number {
  const afterId = tap.anchor.afterTrunkDeviceId
  if (afterId == null) return itemDeviceIds.length
  const index = itemDeviceIds.indexOf(afterId)
  return index >= 0 ? index : 0
}

/** The gap a tap uses on a run whose flow runs away from the lower boundary. */
export function resolveAwayFromLowerGap(
  tap: SupplyTapGroup,
  itemDeviceIds: readonly string[]
): number {
  const afterId = tap.anchor.afterTrunkDeviceId
  if (afterId == null) return 0
  const index = itemDeviceIds.indexOf(afterId)
  return index >= 0 ? index + 1 : itemDeviceIds.length
}

/** Moves a measured tap's circuit pipeline output rigidly so its bus point lands on the lane. */
export function translateSupplyTapGeometry(
  measure: SupplyTapMeasure,
  parts: {
    circuitLayouts: BottomUpCircuitLayout[]
    trunks: TrunkLayout[]
    branches: BranchLayout[]
  },
  dx: number,
  dy: number
): void {
  for (const layout of parts.circuitLayouts) {
    if (!measure.circuitIds.has(layout.circuit.id)) continue
    layout.x += dx
    layout.protectionY += dy
    if (layout.trunkY != null) layout.trunkY += dy
    if (layout.secondaryBusY != null) layout.secondaryBusY += dy
  }
  for (const trunk of parts.trunks) {
    if (
      trunk.protectionId !== measure.protectionId &&
      !trunk.circuits.some((circuit) => measure.circuitIds.has(circuit.id))
    ) {
      continue
    }
    trunk.x += dx
    trunk.y += dy
  }
  for (const branch of parts.branches) {
    if (!measure.circuitIds.has(branch.circuitId)) continue
    branch.trunkX += dx
    branch.trunkY += dy
    branch.branchX += dx
    branch.branchY += dy
    if (branch.column) branch.column.crossbarY += dy
    if (branch.labelX != null) branch.labelX += dx
  }
}

/** Ids of the circuits a laid-out supply frame actually draws as taps (placed ones only). */
export function getDrawnSupplyTapCircuitIds(panelLayout: {
  supplyTaps?: readonly Pick<SupplyTapPlacement, 'circuitIds'>[]
}): ReadonlySet<string> {
  if (!panelLayout.supplyTaps?.length) return EMPTY_SET
  return new Set(panelLayout.supplyTaps.flatMap((placement) => placement.circuitIds))
}

/** A tap's painted extent above its lane, kept out of by labels and metadata cards. */
export interface SupplyTapPaintBlock {
  id: string
  circuitIds: string[]
  x: number
  y: number
  width: number
  height: number
}

/** Space left between the painted tap and the lane wire it leaves, which it crosses by design. */
const TAP_LANE_CROSSING_CLEARANCE = 10

export function getSupplyTapPaintBlocks(
  placements: readonly SupplyTapPlacement[],
  measures: readonly SupplyTapMeasure[]
): SupplyTapPaintBlock[] {
  return placements.flatMap((placement) => {
    const measure = measures.find((candidate) => candidate.id === placement.id)
    if (!measure) return []
    return [{
      id: placement.id,
      circuitIds: placement.circuitIds,
      x: placement.x - measure.left,
      y: placement.topY,
      width: measure.left + measure.right,
      height: placement.laneY - TAP_LANE_CROSSING_CLEARANCE - placement.topY,
    }]
  })
}
