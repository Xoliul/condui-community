/**
 * Find drop target by walking the LayoutNode tree
 *
 * Two-pass hit testing with center-aware bounds:
 *
 * 1. Symbol nodes (MCB, RCD, endpoint, supply, ground) use CENTER-based positioning
 *    (the Konva Image uses offsetX/offsetY to center at position). Their effective
 *    bounds are [x - w/2, y - h/2] to [x + w/2, y + h/2].
 *
 * 2. Non-symbol nodes (busBar, branch, trunk, label) use TOP-LEFT positioning.
 *    Their effective bounds are [x, y] to [x + w, y + h].
 *
 * Two-pass priority:
 *   Pass 1 (core): Find deepest node whose CORE bounds contain the cursor.
 *   Pass 2 (padded): If pass 1 found nothing, find deepest node whose PADDED bounds contain cursor.
 *
 * This ensures that hovering ON the bus returns mainBus (core match), even though
 * an MCB's padded zone extends near the bus area.
 */

import type { LayoutNode, LayoutTree } from './layoutTree'
import type { Endpoint, ProtectionDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import {
  DOMOTICA_CHILD_ON_DROP_ZONE_SIZE,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
} from '@/lib/domoticaLayout'
import { isVerticalSupplyDevice } from './supplyDeviceOrientation'

/** Options for findDropTarget / findDropTargetWithDebug (all optional). */
export interface FindDropTargetOptions {
  /**
   * Accept any direct-converter AC wire as the single canonical modular-changeover slot.
   * This is deliberately opt-in so other symbols retain their normal wire semantics.
   */
  normalizeDirectConverterChangeoverDrop?: boolean
  /**
   * While placing a protection, treat the body of a protection already attached
   * to a secondary bus as the deterministic slot immediately after that item.
   * The dedicated circuit-nest zone above it remains available for deeper nesting.
   */
  preferSecondaryBusForNestedProtection?: boolean
  /**
   * When true, circuit trunk *symbols* (trunkDevice nodes) never produce a hit.
   * Use while dragging an existing trunk device so only vertical trunk *wire* segments
   * (with circuitTrunkSegmentIndex) resolve the drop slot.
   */
  ignoreCircuitTrunkDeviceSymbolHits?: boolean
  /**
   * When a ground-wire hit zone overlaps the main bus, prefer the main bus.
   * Ground-wire targeting remains available where no main-bus zone is under the pointer.
   */
  preferMainBusOverGroundWire?: boolean
  /**
   * When an incoming supply-wire hit zone overlaps the main bus, prefer the main bus.
   * Existing-protection moves use this so dropping at the first bus slot reorders the row
   * instead of accidentally promoting it to the secondary panel's incoming protection.
   */
  preferMainBusOverSupplyWire?: boolean
  /**
   * When placing a DC rail, prefer an overlapping circuit-trunk wire over the
   * generic circuit-nest continuation so one-port converter outputs retain
   * their DC segment/domain metadata.
   */
  preferCircuitTrunkWire?: boolean
}

export interface DropTarget {
  type:
    | 'circuit'
    | 'protection'
    | 'endpoint'
    | 'mainBus'
    | 'rcd'
    | 'supplyWire'
    | 'supplyBackupWire'
    | 'supplyBackupOutputWire'
    | 'supplyChangeoverGridWire'
    | 'supplyConverterGridWire'
    | 'supplyConverterBackupWire'
    | 'supplyConverterDcWire'
    | 'groundWire'
    | null
  circuitId?: string
  protectionId?: string
  endpointId?: string
  /** Which endpoint to insert after.
   *  - string: insert after this endpoint
   *  - null: insert at the very start of the branch (before all endpoints)
   *  - undefined: no position info — append to end */
  insertAfterEndpointId?: string | null
  panelId?: string
  /** Unique one-wire frame containing the hit target. */
  diagramId?: string
  branchEndpoints?: string[] // Endpoints on the branch that was dropped on
  /** Layout branch id (`branch-{circuitId}-{index}`) when the drop is on a branch wire */
  branchId?: string
  /** Explicit branch slot on a circuit trunk: moved branches are inserted before this branch index. */
  branchInsertIndex?: number
  /** Insertion point for a branch-local DC device, measured from the bus. */
  branchDeviceInsertIndex?: number
  /** Insert index for supply trunk devices (used when type === 'supplyWire') */
  supplyDeviceInsertIndex?: number
  /** Which feed path a supply-wire drop should target on a main panel. */
  supplyFeedScope?: 'shared' | 'root'
  supplyPanelInput?: boolean
  /** Which physical DC branch of a hybrid supply converter is targeted. */
  supplyConverterDcBranch?: 'right' | 'top'
  supplyConverterDcConnectionIndex?: number
  /** Supply DC bus under the pointer. */
  supplyDcBusId?: string
  /** Existing branch on the supply DC bus under the pointer. */
  supplyDcBusBranchId?: string
  /** Geometry selected on the converter grid-input path. */
  converterGridPlacement?: 'inline' | 'input-leg'
  /** Geometry selected on the modular changeover grid-input path. */
  changeoverGridPlacement?: 'inline' | 'input-leg'
  /** True only on the direct converter's load-side junction slot. */
  supplyConverterChangeoverSlot?: boolean
  /** Insert index for ground trunk devices (used when type === 'groundWire') */
  groundDeviceInsertIndex?: number
  /** Segment index on a circuit trunk hit zone (used for per-segment trunk insertion/domain checks) */
  circuitTrunkSegmentIndex?: number
  /** Insert index for main bus items (MCBs/RCDs/direct circuits) when dropping on the main bus */
  mainBusInsertIndex?: number
  /** Number of main bus items before the drop (used to derive final position after insertion) */
  mainBusItemCount?: number
  /** Explicit destination rail when the split main bus has no items to infer it from. */
  busSectionId?: string
  /** True when a generic panel-frame hit was normalized into a main-bus drop target for protections. */
  normalizedFromPanelFrame?: boolean
  /** Insert index for nested circuits on a secondary bus when dropping on that bus */
  secondaryBusInsertIndex?: number
  /** Number of nested circuits on a secondary bus before the drop */
  secondaryBusItemCount?: number
  /** Existing sole child that should be reparented below a new protection inserted on its feeder. */
  insertBeforeNestedCircuitId?: string
  /** Place a new nested protection after the circuit's existing branches/devices instead of wrapping them. */
  insertAfterCircuitContent?: boolean
  /** Direct wire domain at this drop target when known (e.g. from wire segment under cursor). */
  wireDomain?: string
  /** Domotica output details when dropping on a domotica output wire hit zone */
  domoticaOutput?: { group: 'control' | 'endpoint'; index: number; expands?: boolean }
  /** Intent when dropping on/after an existing domotica child endpoint. */
  domoticaChildDropIntent?: 'replace' | 'insertBefore' | 'insertAfter'
  /** Widened ordinary circuit-trunk converter DC connection under the pointer. */
  converterDcConnection?: { converterId: string; connectionIndex: number }
  /** Selectable DC bus under the pointer. */
  dcBusId?: string
}

export interface DebugStep {
  /** Layout node ID (for mapping back to tree when debugging/visualizing hit zones) */
  nodeId?: string
  nodeType: string
  domainId?: string
  hitZoneType?: string
  inBounds: boolean
  matched: boolean
}

export interface DebugInfo {
  panelId?: string
  path: DebugStep[]
}

/**
 * Context accumulated while walking the tree.
 * Passes parent information (like circuitId, branchEndpoints) down to children.
 */
interface WalkContext {
  panelId: string
  diagramId?: string
  circuitId?: string
  branchEndpoints?: string[] // Ordered endpoint IDs on the branch (when inside a branch node)
  branchId?: string // Layout branch id when inside a branch node
  branchEndpointPositions?: { id: string; x: number }[] // Endpoint positions sorted by X for insertion detection
  supplyDevicePositions?: { index: number; x: number; y: number }[] // Supply trunk device positions for insertion detection
  groundDevicePositions?: { index: number; y: number }[] // Ground trunk device positions sorted by Y for insertion detection
  /** Main bus node for this panel (used when hit-testing per-segment main bus hit zones) */
  mainBusNode?: LayoutNode
  /** Current secondary bus node when traversing nested-circuit secondary buses */
  secondaryBusNode?: LayoutNode
  /** Immediate circuit node whose children are currently being traversed. */
  currentCircuitNode?: LayoutNode
}

// ─── Node types that use center-based positioning ────────────────────────────
const CENTER_BASED_TYPES = new Set(['mcb', 'rcd', 'endpoint', 'supply', 'ground', 'trunkDevice'])

export interface HitBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Get the effective bounding rectangle for a node, accounting for center-based
 * vs top-left-based positioning.
 */
function getEffectiveBounds(node: LayoutNode): HitBounds {
  const b = node.bounds
  if (CENTER_BASED_TYPES.has(node.type)) {
    // Symbol nodes: position is CENTER
    return {
      left: b.x - b.width / 2,
      top: b.y - b.height / 2,
      right: b.x + b.width / 2,
      bottom: b.y + b.height / 2,
    }
  }
  // Non-symbol nodes: position is TOP-LEFT
  return {
    left: b.x,
    top: b.y,
    right: b.x + b.width,
    bottom: b.y + b.height,
  }
}

/**
 * Public helper to get the hit zone bounds for a layout node.
 * Used by both hit testing and debug overlay rendering so they stay in sync.
 *
 * - 'core': exact visual bounds of the node
 * - 'padded': bounds expanded by hitZone.padding (if any)
 */
export function getHitZoneBounds(node: LayoutNode, mode: 'core' | 'padded' = 'core'): HitBounds {
  const eff = getEffectiveBounds(node)
  if (node.type === 'endpoint' && (node.domainRef as Endpoint | undefined)?.domoticaChildProps) {
    const halfSize = DOMOTICA_CHILD_ON_DROP_ZONE_SIZE / 2
    return {
      left: node.bounds.x - halfSize,
      top: node.bounds.y - halfSize,
      right: node.bounds.x + halfSize,
      bottom: node.bounds.y + halfSize,
    }
  }
  if (mode === 'core' || !node.hitZone) return eff

  const padding = node.hitZone.padding || 0
  const paddingX = node.hitZone.paddingX ?? padding
  const paddingY = node.hitZone.paddingY ?? padding
  return {
    left: eff.left - paddingX,
    top: eff.top - paddingY,
    right: eff.right + paddingX,
    bottom: eff.bottom + paddingY,
  }
}

/**
 * Check if point is within node's CORE bounds (no padding)
 */
function isPointInCore(node: LayoutNode, point: Point): boolean {
  const eff = getHitZoneBounds(node, 'core')
  return point.x >= eff.left && point.x <= eff.right && point.y >= eff.top && point.y <= eff.bottom
}

/**
 * Check if point is within node's PADDED bounds
 */
function isPointInPadded(node: LayoutNode, point: Point): boolean {
  const eff = getHitZoneBounds(node, 'padded')
  return point.x >= eff.left && point.x <= eff.right && point.y >= eff.top && point.y <= eff.bottom
}

/** Horizontal reach of the dashed invitation for creating a secondary bus. */
export const SECONDARY_BUS_PREVIEW_STUB_LENGTH = 32
const SECONDARY_BUS_PREVIEW_HIT_PADDING = 12
const SECONDARY_BUS_PREVIEW_DOT_RADIUS = 8

const subtreeHitBoundsCache = new WeakMap<LayoutNode, HitBounds | null>()
const EXPLICIT_DROP_HINT_RADIUS = 10
const PENDING_SECONDARY_BUS_EXTRA_RIGHT =
  SECONDARY_BUS_PREVIEW_STUB_LENGTH + SECONDARY_BUS_PREVIEW_HIT_PADDING

function unionHitBounds(left: HitBounds | null, right: HitBounds): HitBounds {
  if (!left) return right
  return {
    left: Math.min(left.left, right.left),
    top: Math.min(left.top, right.top),
    right: Math.max(left.right, right.right),
    bottom: Math.max(left.bottom, right.bottom),
  }
}

/**
 * Aggregate every real hit zone in a subtree. Children are allowed to sit well
 * outside their parent's visual bounds, so parent bounds alone are not a safe
 * pruning condition; this cached union is.
 */
function getSubtreeHitBounds(node: LayoutNode): HitBounds | null {
  const cached = subtreeHitBoundsCache.get(node)
  if (cached !== undefined) return cached

  let aggregate: HitBounds | null = node.hitZone?.type ? getHitZoneBounds(node, 'padded') : null
  const dropHintAnchor = node.hitZone?.dropHintAnchor
  if (dropHintAnchor) {
    aggregate = unionHitBounds(aggregate, {
      left: dropHintAnchor.x - EXPLICIT_DROP_HINT_RADIUS,
      top: dropHintAnchor.y - EXPLICIT_DROP_HINT_RADIUS,
      right: dropHintAnchor.x + EXPLICIT_DROP_HINT_RADIUS,
      bottom: dropHintAnchor.y + EXPLICIT_DROP_HINT_RADIUS,
    })
  }
  if (node.id?.startsWith('circuit-nest-')) {
    const bounds = getHitZoneBounds(node, 'core')
    const anchorX = (bounds.left + bounds.right) / 2
    const anchorY = (bounds.top + bounds.bottom) / 2
    aggregate = unionHitBounds(aggregate, {
      left: anchorX - SECONDARY_BUS_PREVIEW_DOT_RADIUS,
      top: anchorY - SECONDARY_BUS_PREVIEW_HIT_PADDING,
      right: anchorX + PENDING_SECONDARY_BUS_EXTRA_RIGHT,
      bottom: anchorY + SECONDARY_BUS_PREVIEW_HIT_PADDING,
    })
  }
  if (node.id?.startsWith('secondary-bus-segment-')) {
    const bounds = getHitZoneBounds(node, 'padded')
    aggregate = unionHitBounds(aggregate, {
      ...bounds,
      top: bounds.top - 4,
      bottom: bounds.bottom + 4,
    })
  }
  for (const child of node.children) {
    const childBounds = getSubtreeHitBounds(child)
    if (!childBounds) continue
    aggregate = unionHitBounds(aggregate, childBounds)
  }
  subtreeHitBoundsCache.set(node, aggregate)
  return aggregate
}

function pointCanHitSubtree(node: LayoutNode, position: Point): boolean {
  const bounds = getSubtreeHitBounds(node)
  return (
    !!bounds &&
    position.x >= bounds.left &&
    position.x <= bounds.right &&
    position.y >= bounds.top &&
    position.y <= bounds.bottom
  )
}

/**
 * Circuit nesting dots are explicit targets and can overlap the secondary bus
 * that feeds their protection. Resolve them before the general tree walk so a
 * visible B/C nesting target cannot be flattened into parent A's bus slot.
 */
function findCircuitNestDropInPanel(
  panelNode: LayoutNode,
  position: Point,
  mode: 'core' | 'padded' = 'core'
): { target: DropTarget; node: LayoutNode } | null {
  const bestMatch: {
    current: { node: LayoutNode; circuitId: string; score: number } | null
  } = { current: null }

  const visit = (node: LayoutNode) => {
    if (!pointCanHitSubtree(node, position)) return
    const inBounds =
      mode === 'core' ? isPointInCore(node, position) : isPointInPadded(node, position)
    if (node.id?.startsWith('circuit-nest-') && inBounds) {
      const circuitId = node.id.slice('circuit-nest-'.length)
      if (circuitId) {
        const bounds = getHitZoneBounds(node, 'core')
        const midX = (bounds.left + bounds.right) / 2
        const midY = (bounds.top + bounds.bottom) / 2
        const score = Math.abs(position.y - midY) * 1000 + Math.abs(position.x - midX)
        if (!bestMatch.current || score < bestMatch.current.score) {
          bestMatch.current = { node, circuitId, score }
        }
      }
    }
    node.children.forEach(visit)
  }
  visit(panelNode)

  const best = bestMatch.current
  if (!best || !panelNode.domainId) return null
  return {
    node: best.node,
    target: {
      type: 'circuit',
      panelId: panelNode.domainId,
      circuitId: best.circuitId,
    },
  }
}

function findDirectConverterChangeoverSlotInPanel(
  panelNode: LayoutNode,
  position: Point,
  ctx: WalkContext,
  expandAcrossConverterAcPaths = false
): DropTarget | null {
  const canonicalTarget = getDirectConverterChangeoverTarget(panelNode, ctx)
  if (!canonicalTarget) return null

  const isCanonicalHit = (node: LayoutNode) =>
    node.hitZone?.supplyConverterChangeoverSlot && isPointInCore(node, position)
  const matchesExpandedAcPath = (node: LayoutNode) =>
    expandAcrossConverterAcPaths &&
    (node.hitZone?.type === 'supplyConverterGridWire' ||
      node.hitZone?.type === 'supplyConverterBackupWire') &&
    isPointInCore(node, position)
  const matches = (node: LayoutNode): boolean => {
    if (!pointCanHitSubtree(node, position)) return false
    return isCanonicalHit(node) || matchesExpandedAcPath(node) || node.children.some(matches)
  }

  return matches(panelNode) ? canonicalTarget : null
}

const directConverterChangeoverTargetCache = new WeakMap<LayoutNode, DropTarget | null>()

function getDirectConverterChangeoverTarget(
  panelNode: LayoutNode,
  ctx: WalkContext
): DropTarget | null {
  const cached = directConverterChangeoverTargetCache.get(panelNode)
  if (cached !== undefined) return cached
  let canonicalTarget: DropTarget | null = null
  const visit = (node: LayoutNode): void => {
    if (node.hitZone?.supplyConverterChangeoverSlot) {
      const candidate: DropTarget = {
        type: 'supplyWire',
        panelId: node.hitZone.supplyPanelId ?? ctx.panelId,
        diagramId: ctx.diagramId,
        supplyFeedScope: node.hitZone.supplyFeedScope ?? 'root',
        supplyDeviceInsertIndex: node.hitZone.supplyInsertIndex,
        supplyConverterChangeoverSlot: true,
      }
      if (
        canonicalTarget === null ||
        (candidate.supplyDeviceInsertIndex ?? -1) > (canonicalTarget.supplyDeviceInsertIndex ?? -1)
      ) {
        canonicalTarget = candidate
      }
    }
    node.children.forEach(visit)
  }
  visit(panelNode)
  directConverterChangeoverTargetCache.set(panelNode, canonicalTarget)
  return canonicalTarget
}

/**
 * Last-resort hit test for segmented secondary bus wires (nested circuits under a parent MCB).
 */
function findSecondaryBusDropInPanel(
  panelNode: LayoutNode,
  position: Point,
  ctx: WalkContext
): { target: DropTarget; node: LayoutNode } | null {
  const bestMatch: {
    current: { target: DropTarget; node: LayoutNode; distance: number } | null
  } = { current: null }
  // Keep the fallback narrow. A large band makes ordinary endpoint drops near a
  // secondary bus resolve to the exceptional parent-feeder target too easily.
  const extraY = 4

  const visit = (node: LayoutNode, walkCtx: WalkContext) => {
    if (!pointCanHitSubtree(node, position)) return
    const childCtx = accumulateContext(node, walkCtx)
    if (
      node.type === 'wire' &&
      node.id?.startsWith('secondary-bus-segment-') &&
      node.hitZone?.type === 'circuit'
    ) {
      const bounds = getHitZoneBounds(node, 'padded')
      const inX = position.x >= bounds.left && position.x <= bounds.right
      const inY = position.y >= bounds.top - extraY && position.y <= bounds.bottom + extraY
      if (inX && inY) {
        const midY = (bounds.top + bounds.bottom) / 2
        const verticalDistance = Math.abs(position.y - midY)
        const candidate = buildDropTarget(node, childCtx, position)
        if (!bestMatch.current || verticalDistance < bestMatch.current.distance) {
          bestMatch.current = { target: candidate, node, distance: verticalDistance }
        }
      }
    }
    for (const child of node.children) {
      visit(child, childCtx)
    }
  }

  visit(panelNode, ctx)
  return bestMatch.current
}

function findNestedProtectionSecondaryBusDropInPanel(
  panelNode: LayoutNode,
  circuitId: string,
  ctx: WalkContext
): DropTarget | null {
  return findNestedCircuitSecondaryBusDropInPanel(
    panelNode,
    (node) => node.circuitIdForWires === circuitId,
    ctx
  )
}

function findNestedCircuitSecondaryBusDropInPanel(
  panelNode: LayoutNode,
  matchesCircuit: (node: LayoutNode) => boolean,
  ctx: WalkContext
): DropTarget | null {
  const visit = (node: LayoutNode, walkCtx: WalkContext): DropTarget | null => {
    if (
      node.type === 'mcb' &&
      matchesCircuit(node) &&
      walkCtx.currentCircuitNode &&
      walkCtx.circuitId
    ) {
      const { insertIndex, itemCount } = computeSecondaryBusInsertIndex(
        walkCtx.currentCircuitNode,
        node.bounds.x
      )
      return {
        type: 'circuit',
        panelId: walkCtx.panelId,
        circuitId: walkCtx.circuitId,
        secondaryBusInsertIndex: insertIndex,
        secondaryBusItemCount: itemCount,
      }
    }

    const childCtx = accumulateContext(node, walkCtx)
    for (const child of node.children) {
      const match = visit(child, childCtx)
      if (match) return match
    }
    return null
  }

  return visit(panelNode, ctx)
}

/**
 * Resolve the dashed pending-bus invitation before ordinary nest-wire targeting.
 * A parent with one nested protection has no real bus segment yet, so this gives
 * the preview stub a forgiving hit area and inserts a sibling instead of placing
 * the new protection above the existing child.
 */
function findPendingSecondaryBusDropInPanel(
  panelNode: LayoutNode,
  position: Point,
  ctx: WalkContext
): { target: DropTarget; node: LayoutNode } | null {
  const visit = (node: LayoutNode): { target: DropTarget; node: LayoutNode } | null => {
    if (!pointCanHitSubtree(node, position)) return null
    if (node.type === 'mcb') {
      const nestedProtections = node.children.filter(
        (child) => child.type === 'mcb' && !!child.circuitIdForWires
      )
      const nestNode = node.children.find((child) => child.id?.startsWith('circuit-nest-'))
      if (nestedProtections.length === 1 && nestNode) {
        const bounds = getHitZoneBounds(nestNode, 'core')
        const anchorX = (bounds.left + bounds.right) / 2
        const busY = (bounds.top + bounds.bottom) / 2
        const inX =
          position.x >= anchorX - SECONDARY_BUS_PREVIEW_DOT_RADIUS &&
          position.x <=
            anchorX + SECONDARY_BUS_PREVIEW_STUB_LENGTH + SECONDARY_BUS_PREVIEW_HIT_PADDING
        const inY = Math.abs(position.y - busY) <= SECONDARY_BUS_PREVIEW_HIT_PADDING
        if (inX && inY) {
          const nestedCircuitId = nestedProtections[0]!.circuitIdForWires!
          const target = findNestedCircuitSecondaryBusDropInPanel(
            panelNode,
            (candidate) => candidate.circuitIdForWires === nestedCircuitId,
            ctx
          )
          if (target) return { target, node: nestNode }
        }
      }
    }
    for (const child of node.children) {
      const result = visit(child)
      if (result) return result
    }
    return null
  }

  return visit(panelNode)
}

/**
 * Preview balls are explicit placement controls. Resolve their own anchors
 * before overlapping structural wires so a compact converter stub cannot be
 * stolen by a nearby supply or ground hit zone.
 */
function findExplicitDropHintTargetInPanel(
  panelNode: LayoutNode,
  position: Point,
  ctx: WalkContext
): DropTarget | null {
  const radius = EXPLICIT_DROP_HINT_RADIUS
  const best: {
    current: { target: DropTarget; distanceSquared: number } | null
  } = { current: null }

  const visit = (node: LayoutNode, nodeCtx: WalkContext) => {
    if (!pointCanHitSubtree(node, position)) return
    const anchor = node.hitZone?.dropHintAnchor
    if (anchor && node.hitZone?.type) {
      const dx = position.x - anchor.x
      const dy = position.y - anchor.y
      const distanceSquared = dx * dx + dy * dy
      if (
        distanceSquared <= radius * radius &&
        (!best.current || distanceSquared < best.current.distanceSquared)
      ) {
        best.current = {
          target: buildDropTarget(node, nodeCtx, position),
          distanceSquared,
        }
      }
    }
    const childCtx = accumulateContext(node, nodeCtx)
    node.children.forEach((child) => visit(child, childCtx))
  }

  visit(panelNode, ctx)
  return best.current?.target ?? null
}

function findPanelFeedStubSlotInPanel(
  panelNode: LayoutNode,
  position: Point,
  ctx: WalkContext
): { node: LayoutNode; target: DropTarget } | null {
  const bus = panelNode.children.find((node) => node.type === 'busBar')
  const slot = bus?.children.find((node) =>
    node.id.startsWith('supply-wire-feed-stub-') &&
    node.hitZone?.type === 'supplyWire' &&
    isPointInCore(node, position)
  )
  return slot ? { node: slot, target: buildDropTarget(slot, ctx, position) } : null
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Find drop target at the given position by walking the tree
 */
export function findDropTarget(
  tree: LayoutTree,
  position: Point,
  options?: FindDropTargetOptions
): DropTarget {
  // First, find which panel contains this position
  const panelNode = findPanelAtPosition(tree, position)
  if (!panelNode || !panelNode.domainId) {
    return { type: null }
  }

  const ctx: WalkContext = { panelId: panelNode.domainId, diagramId: panelNode.diagramId }
  const explicitDropHint = findExplicitDropHintTargetInPanel(panelNode, position, ctx)
  if (explicitDropHint) return explicitDropHint
  const feedStubSlot = findPanelFeedStubSlotInPanel(panelNode, position, ctx)
  if (feedStubSlot) return feedStubSlot.target
  const directChangeoverSlot = findDirectConverterChangeoverSlotInPanel(
    panelNode,
    position,
    ctx,
    options?.normalizeDirectConverterChangeoverDrop
  )
  if (directChangeoverSlot) return directChangeoverSlot

  if (options?.preferSecondaryBusForNestedProtection) {
    const pendingSecondaryBus = findPendingSecondaryBusDropInPanel(panelNode, position, ctx)
    if (pendingSecondaryBus) return pendingSecondaryBus.target
  }

  // Pass 1: core bounds only (highest priority — cursor is directly ON the element)
  const coreResult = findTarget(panelNode, position, ctx, 'core', options)
  if (coreResult) {
    const preferMainBusOverGround =
      coreResult.type === 'groundWire' && options?.preferMainBusOverGroundWire
    const preferMainBusOverSupply =
      coreResult.type === 'supplyWire' && options?.preferMainBusOverSupplyWire
    if (preferMainBusOverGround || preferMainBusOverSupply) {
      let mainBusResult = findTarget(
        panelNode,
        position,
        ctx,
        'core',
        options,
        preferMainBusOverGround,
        preferMainBusOverSupply
      )
      // At a secondary panel's incoming corner the vertical supply wire can be a core hit
      // while the horizontal bus is represented by its padded hit zone.
      if (!mainBusResult && preferMainBusOverSupply) {
        mainBusResult = findTarget(panelNode, position, ctx, 'padded', options, false, true)
      }
      if (mainBusResult?.type === 'mainBus') return mainBusResult
    }
    if (
      options?.preferSecondaryBusForNestedProtection &&
      coreResult.type === 'protection' &&
      coreResult.protectionId
    ) {
      const secondaryBusTarget = findNestedProtectionSecondaryBusDropInPanel(
        panelNode,
        coreResult.circuitId!,
        ctx
      )
      if (secondaryBusTarget) return secondaryBusTarget
    }
    if (
      !options?.preferSecondaryBusForNestedProtection &&
      typeof coreResult.secondaryBusInsertIndex === 'number'
    ) {
      const circuitNestResult = findCircuitNestDropInPanel(panelNode, position)
      if (circuitNestResult) return circuitNestResult.target
    }
    return coreResult
  }

  // Pass 2: padded bounds (cursor is NEAR an element)
  const paddedResult = findTarget(panelNode, position, ctx, 'padded', options)
  if (paddedResult) {
    const preferMainBusOverGround =
      paddedResult.type === 'groundWire' && options?.preferMainBusOverGroundWire
    const preferMainBusOverSupply =
      paddedResult.type === 'supplyWire' && options?.preferMainBusOverSupplyWire
    if (preferMainBusOverGround || preferMainBusOverSupply) {
      const mainBusResult = findTarget(
        panelNode,
        position,
        ctx,
        'padded',
        options,
        preferMainBusOverGround,
        preferMainBusOverSupply
      )
      if (mainBusResult?.type === 'mainBus') return mainBusResult
    }
    if (
      options?.preferSecondaryBusForNestedProtection &&
      paddedResult.type === 'protection' &&
      paddedResult.protectionId
    ) {
      const secondaryBusTarget = findNestedProtectionSecondaryBusDropInPanel(
        panelNode,
        paddedResult.circuitId!,
        ctx
      )
      if (secondaryBusTarget) return secondaryBusTarget
    }
    return paddedResult
  }

  // Pass 3: secondary bus segments are very thin — accept a wider vertical band so
  // protection move-drags release on the wire below/above the bar still resolve.
  const secondaryBusResult = findSecondaryBusDropInPanel(panelNode, position, ctx)
  if (secondaryBusResult) return secondaryBusResult.target

  // Nothing matched
  return { type: null, panelId: panelNode.domainId }
}

/**
 * Find drop target with debug information about the tree walk
 */
export function findDropTargetWithDebug(
  tree: LayoutTree,
  position: Point,
  options?: FindDropTargetOptions
): { target: DropTarget; debug: DebugInfo } {
  const debugPath: DebugStep[] = []

  // First, find which panel contains this position
  const panelNode = findPanelAtPosition(tree, position)
  if (!panelNode || !panelNode.domainId) {
    return {
      target: { type: null },
      debug: { path: debugPath },
    }
  }

  const ctx: WalkContext = { panelId: panelNode.domainId, diagramId: panelNode.diagramId }
  const feedStubSlot = findPanelFeedStubSlotInPanel(panelNode, position, ctx)
  if (feedStubSlot) {
    debugPath.push({
      nodeId: feedStubSlot.node.id,
      nodeType: feedStubSlot.node.type,
      hitZoneType: 'supplyWire',
      inBounds: true,
      matched: true,
    })
    return { target: feedStubSlot.target, debug: { panelId: panelNode.domainId, path: debugPath } }
  }
  if (options?.preferSecondaryBusForNestedProtection) {
    const pendingSecondaryBus = findPendingSecondaryBusDropInPanel(panelNode, position, ctx)
    if (pendingSecondaryBus) {
      debugPath.push({
        nodeId: pendingSecondaryBus.node.id,
        nodeType: pendingSecondaryBus.node.type,
        domainId: pendingSecondaryBus.node.domainId,
        hitZoneType: pendingSecondaryBus.node.hitZone?.type ?? undefined,
        inBounds: true,
        matched: true,
      })
      return {
        target: pendingSecondaryBus.target,
        debug: { panelId: panelNode.domainId, path: debugPath },
      }
    }
  }
  const directChangeoverSlot = findDirectConverterChangeoverSlotInPanel(
    panelNode,
    position,
    ctx,
    options?.normalizeDirectConverterChangeoverDrop
  )
  if (directChangeoverSlot) {
    return { target: directChangeoverSlot, debug: { panelId: panelNode.domainId, path: debugPath } }
  }

  // Pass 1: core bounds only (highest priority — cursor is directly ON the element)
  const coreResult = findTargetWithDebug(panelNode, position, ctx, 'core', debugPath, options)
  if (coreResult) {
    const preferMainBusOverGround =
      coreResult.target.type === 'groundWire' && options?.preferMainBusOverGroundWire
    const preferMainBusOverSupply =
      coreResult.target.type === 'supplyWire' && options?.preferMainBusOverSupplyWire
    if (preferMainBusOverGround || preferMainBusOverSupply) {
      const mainBusDebugPath: DebugStep[] = []
      let mainBusResult = findTargetWithDebug(
        panelNode,
        position,
        ctx,
        'core',
        mainBusDebugPath,
        options,
        preferMainBusOverGround,
        preferMainBusOverSupply
      )
      if (!mainBusResult && preferMainBusOverSupply) {
        mainBusDebugPath.length = 0
        mainBusResult = findTargetWithDebug(
          panelNode,
          position,
          ctx,
          'padded',
          mainBusDebugPath,
          options,
          false,
          true
        )
      }
      if (mainBusResult?.target.type === 'mainBus') {
        return {
          target: mainBusResult.target,
          debug: { panelId: panelNode.domainId, path: mainBusDebugPath },
        }
      }
    }
    if (
      options?.preferSecondaryBusForNestedProtection &&
      coreResult.target.type === 'protection' &&
      coreResult.target.protectionId
    ) {
      const secondaryBusTarget = findNestedProtectionSecondaryBusDropInPanel(
        panelNode,
        coreResult.target.circuitId!,
        ctx
      )
      if (secondaryBusTarget) {
        return {
          target: secondaryBusTarget,
          debug: { panelId: panelNode.domainId, path: debugPath },
        }
      }
    }
    if (
      !options?.preferSecondaryBusForNestedProtection &&
      typeof coreResult.target.secondaryBusInsertIndex === 'number'
    ) {
      const circuitNestResult = findCircuitNestDropInPanel(panelNode, position)
      if (circuitNestResult) {
        const matchedNode = circuitNestResult.node
        debugPath.forEach((step) => {
          step.matched = false
        })
        debugPath.push({
          nodeId: matchedNode.id,
          nodeType: matchedNode.type,
          domainId: matchedNode.domainId,
          hitZoneType: matchedNode.hitZone?.type ?? undefined,
          inBounds: true,
          matched: true,
        })
        return {
          target: circuitNestResult.target,
          debug: { panelId: panelNode.domainId, path: debugPath },
        }
      }
    }
    return {
      target: coreResult.target,
      debug: {
        panelId: panelNode.domainId,
        path: debugPath,
      },
    }
  }

  // Pass 2: padded bounds (cursor is NEAR an element)
  // Clear the path and start fresh for padded pass
  debugPath.length = 0
  const paddedResult = findTargetWithDebug(panelNode, position, ctx, 'padded', debugPath, options)
  if (paddedResult) {
    const preferMainBusOverGround =
      paddedResult.target.type === 'groundWire' && options?.preferMainBusOverGroundWire
    const preferMainBusOverSupply =
      paddedResult.target.type === 'supplyWire' && options?.preferMainBusOverSupplyWire
    if (preferMainBusOverGround || preferMainBusOverSupply) {
      const mainBusDebugPath: DebugStep[] = []
      const mainBusResult = findTargetWithDebug(
        panelNode,
        position,
        ctx,
        'padded',
        mainBusDebugPath,
        options,
        preferMainBusOverGround,
        preferMainBusOverSupply
      )
      if (mainBusResult?.target.type === 'mainBus') {
        return {
          target: mainBusResult.target,
          debug: { panelId: panelNode.domainId, path: mainBusDebugPath },
        }
      }
    }
    if (
      options?.preferSecondaryBusForNestedProtection &&
      paddedResult.target.type === 'protection' &&
      paddedResult.target.protectionId
    ) {
      const secondaryBusTarget = findNestedProtectionSecondaryBusDropInPanel(
        panelNode,
        paddedResult.target.circuitId!,
        ctx
      )
      if (secondaryBusTarget) {
        return {
          target: secondaryBusTarget,
          debug: { panelId: panelNode.domainId, path: debugPath },
        }
      }
    }
    return {
      target: paddedResult.target,
      debug: {
        panelId: panelNode.domainId,
        path: debugPath,
      },
    }
  }

  const secondaryBusResult = findSecondaryBusDropInPanel(panelNode, position, ctx)
  if (secondaryBusResult) {
    const matchedNode = secondaryBusResult.node
    debugPath.push({
      nodeId: matchedNode.id,
      nodeType: matchedNode.type,
      domainId: matchedNode.domainId,
      hitZoneType: matchedNode.hitZone?.type ?? undefined,
      inBounds: false,
      matched: true,
    })
    return {
      target: secondaryBusResult.target,
      debug: { panelId: panelNode.domainId, path: debugPath },
    }
  }

  // Nothing matched
  return {
    target: { type: null, panelId: panelNode.domainId },
    debug: {
      panelId: panelNode.domainId,
      path: debugPath,
    },
  }
}

const TRUNK_WIRE_SEGMENT_PAD = 14

/**
 * Which vertical trunk wire segment (layout index) is under the point for this circuit.
 * Uses slightly padded bounds so thin trunk hit zones still register next to symbols.
 */
export function findCircuitTrunkSegmentIndexUnderPoint(
  tree: LayoutTree,
  position: Point,
  circuitId: string
): number | undefined {
  const prefix = `circuit-trunk-${circuitId}-segment-`
  // Holder so nested `visit` assignments are visible to control flow (plain `let best` + closure can infer `never` at return).
  const acc: { best: { index: number; score: number } | null } = { best: null }

  const visit = (node: LayoutNode) => {
    if (
      node.type === 'wire' &&
      typeof node.id === 'string' &&
      node.id.startsWith(prefix) &&
      node.hitZone?.type === 'circuit'
    ) {
      const tail = node.id.slice(prefix.length)
      const segIdx = Number.parseInt(tail, 10)
      if (!Number.isFinite(segIdx)) {
        for (const c of node.children) visit(c)
        return
      }
      const b = getHitZoneBounds(node, 'core')
      const p = TRUNK_WIRE_SEGMENT_PAD
      const hit =
        position.x >= b.left - p &&
        position.x <= b.right + p &&
        position.y >= b.top - p &&
        position.y <= b.bottom + p
      if (hit) {
        // Padded zones overlap between adjacent segments; "closest midpoint" wrongly
        // favours a long top wire segment over a short gap between converters.
        // Prefer: cursor inside core Y, then smallest segment height; else distance to core Y-range.
        const inCoreY = position.y >= b.top && position.y <= b.bottom
        const h = Math.max(1e-6, b.bottom - b.top)
        const distY = inCoreY
          ? 0
          : Math.min(Math.abs(position.y - b.top), Math.abs(position.y - b.bottom))
        const score = (inCoreY ? 0 : 1_000_000 + distY * 1_000) + h
        if (!acc.best || score < acc.best.score) acc.best = { index: segIdx, score }
      }
    }
    for (const c of node.children) visit(c)
  }

  for (const panelNode of tree.panels) visit(panelNode)
  return acc.best?.index
}

/**
 * If the target is a plain circuit (vertical trunk) hit without a segment index,
 * attach circuitTrunkSegmentIndex when the cursor lies on a trunk wire segment.
 */
export function ensureCircuitTrunkWireSegmentOnDropTarget(
  tree: LayoutTree,
  position: Point,
  target: DropTarget
): DropTarget {
  if (
    target.type !== 'circuit' ||
    !target.circuitId ||
    target.branchEndpoints?.length ||
    typeof target.circuitTrunkSegmentIndex === 'number'
  ) {
    return target
  }
  const seg = findCircuitTrunkSegmentIndexUnderPoint(tree, position, target.circuitId)
  if (seg == null) return target
  return { ...target, circuitTrunkSegmentIndex: seg }
}

/**
 * Resolve domotica output slots directly from their wire hit zones.
 *
 * Existing domotica child symbols can overlap the output wire zones. The normal
 * deepest-node hit test may then return the child endpoint instead of the
 * output slot, which makes drag-move fall back to generic endpoint movement.
 */
export function findDomoticaOutputDropTarget(tree: LayoutTree, position: Point): DropTarget | null {
  const bestMatch: { current: { target: DropTarget; score: number } | null } = { current: null }

  const visit = (node: LayoutNode, ctx: WalkContext) => {
    const childCtx = accumulateContext(node, ctx)

    if (
      node.type === 'wire' &&
      node.domainId &&
      node.hitZone?.type === 'endpoint' &&
      node.hitZone.outputGroup &&
      typeof node.hitZone.outputIndex === 'number'
    ) {
      const bounds = getHitZoneBounds(node, 'padded')
      const hit =
        position.x >= bounds.left &&
        position.x <= bounds.right &&
        position.y >= bounds.top &&
        position.y <= bounds.bottom
      if (hit) {
        const midY = (bounds.top + bounds.bottom) / 2
        const midX = (bounds.left + bounds.right) / 2
        const score = Math.abs(position.y - midY) * 1000 + Math.abs(position.x - midX)
        if (!bestMatch.current || score < bestMatch.current.score) {
          bestMatch.current = {
            score,
            target: {
              type: 'endpoint',
              panelId: childCtx.panelId,
              circuitId: childCtx.circuitId,
              endpointId: node.domainId,
              branchEndpoints: childCtx.branchEndpoints,
              insertAfterEndpointId: node.domainId,
              domoticaOutput: {
                group: node.hitZone.outputGroup,
                index: node.hitZone.outputIndex,
                expands: node.hitZone.outputExpands,
              },
            },
          }
        }
      }
    }

    for (const child of node.children) {
      visit(child, childCtx)
    }
  }

  for (const panelNode of tree.panels) {
    if (!panelNode.domainId) continue
    visit(panelNode, { panelId: panelNode.domainId, diagramId: panelNode.diagramId })
  }

  return bestMatch.current?.target ?? null
}

/**
 * Find which panel contains the position
 */
function findPanelAtPosition(tree: LayoutTree, position: Point): LayoutNode | null {
  for (const panelNode of tree.panels) {
    const bounds = panelNode.bounds
    if (
      position.x >= bounds.x &&
      position.x <= bounds.x + bounds.width &&
      position.y >= bounds.y &&
      position.y <= bounds.y + bounds.height
    ) {
      return panelNode
    }
  }
  return null
}

// ─── Tree walk ───────────────────────────────────────────────────────────────

/**
 * Depth-first search for deepest matching target.
 *
 * Always recurses into all children (no parent-bounds gating) because child
 * nodes can be spatially outside their parent's visual bounds (MCBs above bus,
 * endpoints above MCBs, etc.).
 *
 * @param mode - 'core' checks only core bounds, 'padded' checks padded bounds
 */
function findTarget(
  node: LayoutNode,
  position: Point,
  ctx: WalkContext,
  mode: 'core' | 'padded',
  options?: FindDropTargetOptions,
  ignoreGroundWireHits = false,
  ignoreSupplyWireHits = false
): DropTarget | null {
  if (!pointCanHitSubtree(node, position)) return null

  // Accumulate context from this node (e.g., circuitId from MCB)
  const childCtx = accumulateContext(node, ctx)

  // While placing a protection, the visible MCB body owns its entire hitbox.
  // Its trunk wire is a child node and geometrically runs underneath the body;
  // letting child-first traversal win there made the middle of the same symbol
  // behave like a feeder while its padded edge behaved like a sibling slot.
  if (
    options?.preferSecondaryBusForNestedProtection &&
    node.type === 'mcb' &&
    node.hitZone?.type === 'protection' &&
    (mode === 'core' ? isPointInCore(node, position) : isPointInPadded(node, position))
  ) {
    return buildDropTarget(node, ctx, position)
  }

  // ALWAYS check children first (depth-first: deeper = higher priority).
  // For core hits, endpoint symbols should outrank wire hit zones. Domotica
  // output wires can sit underneath child symbols; if the wire wins first,
  // dropping on a child becomes slot insertion instead of branch chaining.
  const children = getHitTestChildren(node, mode, position, options)
  for (const child of children) {
    if (!pointCanHitSubtree(child, position)) continue
    const match = findTarget(
      child,
      position,
      childCtx,
      mode,
      options,
      ignoreGroundWireHits,
      ignoreSupplyWireHits
    )
    if (match) return match
  }

  // Check if THIS node is a valid target
  if (node.hitZone?.type) {
    if (ignoreGroundWireHits && node.hitZone.type === 'groundWire') {
      return null
    }
    if (ignoreSupplyWireHits && node.hitZone.type === 'supplyWire') {
      return null
    }
    if (options?.ignoreCircuitTrunkDeviceSymbolHits && node.type === 'trunkDevice') {
      return null
    }
    const hit = mode === 'core' ? isPointInCore(node, position) : isPointInPadded(node, position)

    if (hit) {
      return buildDropTarget(node, ctx, position)
    }
  }

  return null
}

/**
 * Depth-first search with debug tracking
 */
function findTargetWithDebug(
  node: LayoutNode,
  position: Point,
  ctx: WalkContext,
  mode: 'core' | 'padded',
  debugPath: DebugStep[],
  options?: FindDropTargetOptions,
  ignoreGroundWireHits = false,
  ignoreSupplyWireHits = false
): { target: DropTarget } | null {
  // Accumulate context from this node (e.g., circuitId from MCB)
  const childCtx = accumulateContext(node, ctx)

  // Track this node in debug path
  const inBounds = mode === 'core' ? isPointInCore(node, position) : isPointInPadded(node, position)

  const step: DebugStep = {
    nodeId: node.id,
    nodeType: node.type,
    domainId: node.domainId,
    hitZoneType: node.hitZone?.type ?? undefined,
    inBounds,
    matched: false,
  }
  debugPath.push(step)

  if (!pointCanHitSubtree(node, position)) return null

  if (
    options?.preferSecondaryBusForNestedProtection &&
    node.type === 'mcb' &&
    node.hitZone?.type === 'protection' &&
    inBounds
  ) {
    step.matched = true
    return { target: buildDropTarget(node, ctx, position) }
  }

  // ALWAYS check children first (depth-first: deeper = higher priority)
  const children = getHitTestChildren(node, mode, position, options)
  for (const child of children) {
    if (!pointCanHitSubtree(child, position)) continue
    const match = findTargetWithDebug(
      child,
      position,
      childCtx,
      mode,
      debugPath,
      options,
      ignoreGroundWireHits,
      ignoreSupplyWireHits
    )
    if (match) {
      // A match was found deeper in the tree, return it
      return match
    }
  }

  // Check if THIS node is a valid target
  if (node.hitZone?.type && inBounds) {
    if (ignoreGroundWireHits && node.hitZone.type === 'groundWire') {
      return null
    }
    if (ignoreSupplyWireHits && node.hitZone.type === 'supplyWire') {
      return null
    }
    if (options?.ignoreCircuitTrunkDeviceSymbolHits && node.type === 'trunkDevice') {
      return null
    }
    step.matched = true
    return { target: buildDropTarget(node, ctx, position) }
  }

  return null
}

function getHitTestChildren(
  node: LayoutNode,
  mode: 'core' | 'padded',
  position: Point,
  options?: FindDropTargetOptions
): LayoutNode[] {
  if (node.children.length <= 1) return node.children

  // A parent circuit's nest zone overlaps the lower part of protections already
  // sitting on its secondary bus. Descend into those nested protections first,
  // otherwise a drop visibly on B/C is incorrectly resolved back to parent A.
  if (
    mode === 'padded' &&
    node.children.some((child) => child.id?.startsWith('circuit-nest-')) &&
    node.children.some((child) => child.type === 'mcb')
  ) {
    return [...node.children].sort((a, b) => {
      const priority = (child: LayoutNode) => {
        if (
          options?.preferCircuitTrunkWire &&
          child.type === 'wire' &&
          child.id?.startsWith('circuit-trunk-')
        ) {
          return -2
        }
        return child.type === 'mcb' ? -1 : 0
      }
      return priority(a) - priority(b)
    })
  }

  if (mode !== 'core') return node.children
  return [...node.children].sort((a, b) => {
    const priority = (child: LayoutNode): number => {
      if (
        options?.preferCircuitTrunkWire &&
        child.type === 'wire' &&
        child.id?.startsWith('circuit-trunk-')
      ) {
        return -6
      }
      if (child.type === 'mcb') return -5
      // The explicit input slot of a root domotica can overlap the circuit's
      // nest zone. Let that slot own its visible marker without changing hits
      // elsewhere on the branch or trunk.
      if (child.type === 'branch' && child.children.some((endpoint) =>
        endpoint.type === 'endpoint' &&
        !(endpoint.domainRef as Endpoint | undefined)?.domoticaChildProps &&
        endpoint.children.some((zone) =>
          zone.hitZone?.domoticaChildDropIntent === 'insertBefore' && isPointInCore(zone, position)))) return -4.5
      if (child.id?.startsWith('circuit-nest-')) return -4
      if (child.id?.startsWith('secondary-bus-segment-')) return -3
      // Existing output-chain symbols and their before/after zones own the
      // connection even when a parent's expand-output invitation overlaps it.
      if (child.type === 'endpoint' && (child.domainRef as Endpoint | undefined)?.domoticaChildProps) return -2
      if (child.type === 'wire' && child.hitZone?.outputExpands) return -1
      if (child.type === 'endpoint') return 0
      if (child.type === 'wire') return 2
      return 1
    }
    return priority(a) - priority(b)
  })
}

/**
 * Accumulate context as we descend the tree.
 * When entering an MCB's subtree, extract the circuitId from the protection's circuits.
 * When entering a branch, collect ordered endpoint IDs for that branch.
 */
function accumulateContext(node: LayoutNode, ctx: WalkContext): WalkContext {
  if (node.type === 'mcb' && node.domainRef) {
    const protection = node.domainRef as ProtectionDevice
    const circuitId = protection.circuits?.[0]?.id
    const secondaryBusNode = node.children.find((c) => c.type === 'secondaryBus')
    if (circuitId) {
      return {
        ...ctx,
        circuitId,
        currentCircuitNode: node,
        secondaryBusNode,
      }
    }
  }
  if (node.type === 'branch') {
    const branchEndpoints = collectBranchEndpoints(node)
    const branchEndpointPositions = collectBranchEndpointPositions(node)
    return {
      ...ctx,
      branchEndpoints,
      branchEndpointPositions,
      branchId: node.domainId,
    }
  }
  // When entering a panel node, collect:
  // - main bus node (for per-segment main bus hit zones)
  // - supply and ground trunk device positions for insertion detection
  if (node.type === 'panel') {
    const supplyDevicePositions = collectSupplyDevicePositions(node)
    const groundDevicePositions = collectGroundDevicePositions(node)
    const mainBusNode = node.children.find((c) => c.type === 'busBar')

    if (mainBusNode || supplyDevicePositions.length > 0 || groundDevicePositions.length > 0) {
      return {
        ...ctx,
        ...(mainBusNode ? { mainBusNode } : {}),
        ...(supplyDevicePositions.length > 0 ? { supplyDevicePositions } : {}),
        ...(groundDevicePositions.length > 0 ? { groundDevicePositions } : {}),
      }
    }
  }

  // When entering a secondary bus node, remember it so that child wire
  // segments can compute insertion index based on the full bus context.
  if (node.type === 'secondaryBus') {
    return { ...ctx, secondaryBusNode: node }
  }
  if (
    node.type === 'trunkDevice' &&
    node.hitZone?.dcBusId &&
    !node.id?.startsWith('dc-bus-branch-device-')
  ) {
    return { ...ctx, secondaryBusNode: node }
  }

  return ctx
}

// ─── Drop target construction ────────────────────────────────────────────────

/**
 * Convert a matched LayoutNode to a DropTarget using accumulated context.
 *
 * Position-aware insertion: when inside a branch, uses cursor X position
 * relative to endpoint positions to determine the precise insertion point.
 * This enables dropping a symbol on the wire between endpoint A and B to
 * correctly insert it between A and B (not after B).
 */
function buildDropTarget(node: LayoutNode, ctx: WalkContext, position?: Point): DropTarget {
  const target: DropTarget = {
    type: node.hitZone!.type,
    panelId: ctx.panelId,
    diagramId: ctx.diagramId,
  }

  if ('branchInsertAfterEndpointId' in (node.hitZone ?? {})) {
    target.insertAfterEndpointId = node.hitZone?.branchInsertAfterEndpointId
    if (ctx.branchId) target.branchId = ctx.branchId
    if (ctx.branchEndpoints !== undefined) target.branchEndpoints = ctx.branchEndpoints
  }

  switch (node.type) {
    case 'endpoint': {
      target.endpointId = node.domainId
      target.circuitId = ctx.circuitId // Inherited from parent MCB
      const endpointRef = node.domainRef as Endpoint | undefined
      if (endpointRef?.converterDcConnection) {
        target.converterDcConnection = endpointRef.converterDcConnection
      }
      const isDomoticaParent = endpointRef?.symbol === 'domotica'
      // Dropping on the domotica module body: treat as drop on first output branch
      // so we don't create a bogus "insert after domotica on main branch" slot.
      if (isDomoticaParent) {
        const endpointCount = Math.max(
          DOMOTICA_MIN_ENDPOINT_OUTPUTS,
          Math.min(
            DOMOTICA_MAX_ENDPOINT_OUTPUTS,
            Math.trunc(endpointRef.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
          )
        )
        const endpointSlots = endpointRef.domoticaProps?.endpointChildEndpointIds ?? []
        const currentSlotsAreFull = Array.from({ length: endpointCount }).every((_, index) => {
          const childId = endpointSlots[index]
          return typeof childId === 'string' && childId.trim().length > 0
        })
        target.domoticaOutput =
          currentSlotsAreFull && endpointCount < DOMOTICA_MAX_ENDPOINT_OUTPUTS
            ? { group: 'endpoint', index: endpointCount, expands: true }
            : { group: 'endpoint', index: 0 }
        target.insertAfterEndpointId = node.domainId
        target.branchEndpoints = ctx.branchEndpoints?.length
          ? ctx.branchEndpoints
          : node.domainId
            ? [node.domainId]
            : []
      } else if (!('branchInsertAfterEndpointId' in (node.hitZone ?? {}))) {
        // Use full branch list from context when inside a branch; fallback to single id
        target.branchEndpoints = ctx.branchEndpoints?.length
          ? ctx.branchEndpoints
          : node.domainId
            ? [node.domainId]
            : []
        if (position && endpointRef?.domoticaChildProps) {
          const visualBounds = getEffectiveBounds(node)
          if (position.x < visualBounds.left) {
            target.domoticaChildDropIntent = 'insertBefore'
            const childIndex = ctx.branchEndpointPositions?.findIndex(
              (candidate) => candidate.id === node.domainId
            )
            target.insertAfterEndpointId =
              childIndex != null && childIndex > 0
                ? ctx.branchEndpointPositions?.[childIndex - 1]?.id ?? null
                : null
          } else if (position.x > visualBounds.right) {
            target.domoticaChildDropIntent = 'insertAfter'
            target.insertAfterEndpointId = node.domainId
          } else {
            target.domoticaChildDropIntent = 'replace'
            target.insertAfterEndpointId = node.domainId
          }
        } else if (position && ctx.branchEndpointPositions?.length) {
          // Position-aware insertion: use cursor X to find which wire segment we're on
          const posResult = findInsertAfterByPosition(position.x, ctx.branchEndpointPositions)
          // null = "before all endpoints" (cursor on trunk-to-first-endpoint wire)
          target.insertAfterEndpointId = posResult === undefined ? null : posResult
        } else {
          target.insertAfterEndpointId = node.domainId
        }
      }
      break
    }

    case 'mcb': {
      target.protectionId = node.domainId
      // MCB's domainRef is ProtectionDevice, which has circuits[]
      const protection = node.domainRef as ProtectionDevice | undefined
      target.circuitId = protection?.circuits?.[0]?.id
      break
    }

    case 'rcd':
      target.protectionId = node.domainId
      break

    case 'busBar':
      // Main bus — type is already 'mainBus'
      if (position) {
        const { insertIndex, itemCount } = computeMainBusInsertIndex(node, position.x)
        target.mainBusInsertIndex = insertIndex
        target.mainBusItemCount = itemCount
      }
      break

    case 'secondaryBus':
      // Secondary buses:
      // - RCD trunk secondary bus (under an RCD): hitZone.type = 'rcd'
      // - Nested-circuit secondary bus (above a parent MCB): hitZone.type = 'circuit'
      target.circuitId = ctx.circuitId
      if (node.hitZone?.type === 'rcd') {
        target.protectionId = node.domainId
      }
      if (position && (node.hitZone?.type === 'circuit' || node.hitZone?.type === 'rcd')) {
        const { insertIndex, itemCount } = computeSecondaryBusInsertIndex(node, position.x)
        target.secondaryBusInsertIndex = insertIndex
        target.secondaryBusItemCount = itemCount
      }
      break

    case 'branch':
      target.circuitId = ctx.circuitId // Inherited from parent MCB
      target.branchEndpoints = collectBranchEndpoints(node)
      target.branchId = node.domainId
      // Position-aware insertion: use cursor X to find which wire segment we're on
      if ('branchInsertAfterEndpointId' in (node.hitZone ?? {})) {
        target.insertAfterEndpointId = node.hitZone?.branchInsertAfterEndpointId
      } else if (position) {
        const positions = collectBranchEndpointPositions(node)
        const posResult = findInsertAfterByPosition(position.x, positions)
        target.insertAfterEndpointId = posResult === undefined ? null : posResult
      } else if (target.branchEndpoints.length > 0) {
        target.insertAfterEndpointId = target.branchEndpoints[0]
      }
      break

    case 'wire':
      // Wire nodes (circuit trunk, supply-to-main-bus, domotica outputs)
      // - target type comes from hitZone (circuit/supplyWire/groundWire/endpoint/mainBus)
      // - circuitId always flows from context when inside a circuit
      target.circuitId = ctx.circuitId

      // A circuit with one nested child is rendered as a vertical feeder rather
      // than a bus. Dropping a protection on that feeder inserts it between the
      // parent and child; the child's own tip/trunk remains a target above it.
      if (
        target.type === 'circuit' &&
        ctx.currentCircuitNode &&
        (node.id?.startsWith('circuit-trunk-') || node.id?.startsWith('circuit-nest-'))
      ) {
        const directNestedCircuitIds = ctx.currentCircuitNode.children
          .filter((child) => child.type === 'mcb' && !!child.circuitIdForWires)
          .map((child) => child.circuitIdForWires!)
        if (directNestedCircuitIds.length === 1) {
          target.insertBeforeNestedCircuitId = directNestedCircuitIds[0]
        } else if (directNestedCircuitIds.length === 0 && node.id?.startsWith('circuit-nest-')) {
          // The nest zone is the continuation above the circuit's existing endpoint
          // branches/trunk devices. A protection dropped here belongs after that
          // content; drops on the lower trunk wire keep the wrapping behaviour.
          target.insertAfterCircuitContent = true
        }
      }

      // When inside a branch, propagate branch endpoint context (including [] on empty branches).
      if (ctx.branchEndpoints !== undefined) {
        target.branchEndpoints = ctx.branchEndpoints
      }
      if (ctx.branchId) {
        target.branchId = ctx.branchId
      }
      if (node.hitZone?.domoticaChildDropIntent && node.domainId) {
        target.endpointId = node.domainId
        target.domoticaChildDropIntent = node.hitZone.domoticaChildDropIntent
      }
      if ('branchInsertAfterEndpointId' in (node.hitZone ?? {})) {
        target.insertAfterEndpointId = node.hitZone?.branchInsertAfterEndpointId
      }

      // Domotica output hit zones are modeled as wire nodes whose domainId is the
      // parent domotica endpoint. Expose that as endpointId so downstream logic
      // (drop behavior, previews) can easily find the parent.
      if (node.hitZone?.outputGroup && node.domainId) {
        target.endpointId = node.domainId
      }
      // Circuit trunk wire segments carry insertion/domain context in their node id:
      // `circuit-trunk-<circuitId>-segment-<index>`
      if (target.type === 'circuit' && node.id?.includes('-segment-')) {
        const match = node.id.match(/-segment-(\d+)$/)
        if (match) {
          target.circuitTrunkSegmentIndex = Number.parseInt(match[1]!, 10)
        }
      }

      // For per-segment main bus hit zones modeled as wire nodes with hitZone.type === 'mainBus',
      // use the segment index from the node id so the insert position matches the segment the user
      // actually dropped on (e.g. last segment = insert at end). Fall back to position-based if no id.
      if (target.type === 'mainBus' && ctx.mainBusNode && typeof ctx.panelId === 'string') {
        target.busSectionId = node.hitZone?.busSectionId
        if (typeof node.hitZone?.mainBusInsertIndex === 'number') {
          target.mainBusInsertIndex = node.hitZone.mainBusInsertIndex
          const { itemCount } = computeMainBusInsertIndex(ctx.mainBusNode, 0)
          target.mainBusItemCount = itemCount
          break
        }
        const segPrefix = `main-bus-segment-${ctx.panelId}-`
        const segRest = node.id?.startsWith(segPrefix) ? node.id.slice(segPrefix.length) : undefined
        const segIndex =
          typeof segRest === 'string' && segRest !== '' ? Number.parseInt(segRest, 10) : NaN
        if (Number.isFinite(segIndex)) {
          target.mainBusInsertIndex = segIndex
          const { itemCount } = computeMainBusInsertIndex(ctx.mainBusNode, 0)
          target.mainBusItemCount = itemCount
        } else if (position) {
          const { insertIndex, itemCount } = computeMainBusInsertIndex(ctx.mainBusNode, position.x)
          target.mainBusInsertIndex = insertIndex
          target.mainBusItemCount = itemCount
        }
      }

      // For secondary bus hit zones modeled as wire nodes under a secondaryBus parent,
      // compute insertion index using that secondary bus node. We rely on the
      // walk context (secondaryBusNode) rather than the parent hitZone type so
      // the parent can remain a pure container.
      if (
        target.type === 'circuit' &&
        position &&
        ctx.secondaryBusNode &&
        !node.id?.startsWith('circuit-nest-') &&
        !node.id?.startsWith('dc-bus-branch-')
      ) {
        const dcBusSegmentMatch = node.id?.match(/^secondary-bus-segment-.+-(\d+)$/)
        if (node.hitZone?.dcBusId && dcBusSegmentMatch) {
          // The layout emits one horizontal segment per DC-rail insertion
          // slot. Its suffix is the stable slot index, so use it directly
          // instead of deriving a position from the padded hitbox.
          const { itemCount } = computeSecondaryBusInsertIndex(
            ctx.secondaryBusNode,
            position.x
          )
          target.secondaryBusInsertIndex = Number.parseInt(dcBusSegmentMatch[1]!, 10)
          target.secondaryBusItemCount = itemCount
        } else {
          const { insertIndex, itemCount } = computeSecondaryBusInsertIndex(
            ctx.secondaryBusNode,
            position.x
          )
          target.secondaryBusInsertIndex = insertIndex
          target.secondaryBusItemCount = itemCount
        }
      }

      break

    case 'trunkDevice':
      // Trunk device nodes — check if this is a supply trunk device, ground trunk device, or circuit trunk device
      if (node.id?.startsWith('supplyTrunkDevice-')) {
        // Supply trunk devices on converter branches retain their dedicated lane target.
        target.type =
          node.hitZone?.type === 'supplyBackupOutputWire' ||
          node.hitZone?.type === 'supplyChangeoverGridWire' ||
          node.hitZone?.type === 'supplyConverterGridWire' ||
          node.hitZone?.type === 'supplyConverterBackupWire' ||
          node.hitZone?.type === 'supplyConverterDcWire'
            ? node.hitZone.type
            : 'supplyWire'
      } else if (node.id?.startsWith('groundTrunkDevice-')) {
        // Ground trunk device → groundWire target
        target.type = 'groundWire'
      } else {
        // Circuit trunk device → circuit target
        target.circuitId = ctx.circuitId
      }
      break
  }

  // For supply wire targets, compute insertion index based on cursor X
  if (
    (target.type === 'supplyWire' ||
      target.type === 'supplyBackupOutputWire' ||
      target.type === 'supplyChangeoverGridWire' ||
      target.type === 'supplyConverterGridWire' ||
      target.type === 'supplyConverterBackupWire' ||
      target.type === 'supplyConverterDcWire') &&
    position
  ) {
    target.supplyFeedScope = node.hitZone?.supplyFeedScope
    target.supplyPanelInput = node.hitZone?.supplyPanelInput
    target.busSectionId = node.hitZone?.busSectionId
    target.supplyConverterDcBranch = node.hitZone?.supplyConverterDcBranch
    target.supplyConverterDcConnectionIndex = node.hitZone?.supplyConverterDcConnectionIndex
    target.supplyDcBusId = node.hitZone?.supplyDcBusId
    target.supplyDcBusBranchId = node.hitZone?.supplyDcBusBranchId
    target.converterGridPlacement = node.hitZone?.converterGridPlacement
    target.changeoverGridPlacement = node.hitZone?.changeoverGridPlacement
    target.supplyConverterChangeoverSlot = node.hitZone?.supplyConverterChangeoverSlot
    if (node.type === 'trunkDevice' && typeof node.hitZone?.supplyInsertIndex === 'number') {
      const isVerticalStub = node.id.includes('--feed-stub-') || isVerticalSupplyDevice(
        node.domainRef as import('@/types/schema').TrunkDevice
      )
      target.supplyDeviceInsertIndex = isVerticalStub
        ? position.y < node.bounds.y
          ? node.hitZone.supplyInsertIndex + 1
          : node.hitZone.supplyInsertIndex
        : position.x < node.bounds.x
          ? node.hitZone.supplyInsertIndex + 1
          : node.hitZone.supplyInsertIndex
    } else if (typeof node.hitZone?.supplyInsertIndex === 'number') {
      target.supplyDeviceInsertIndex = node.hitZone.supplyInsertIndex
    } else {
      target.supplyDeviceInsertIndex = computeSupplyInsertIndex(position, ctx)
    }
  }

  // For ground wire targets, compute insertion index based on cursor Y
  if (target.type === 'groundWire' && position) {
    target.groundDeviceInsertIndex = computeGroundInsertIndex(position.y, ctx)
  }

  if (node.hitZone?.outputGroup && typeof node.hitZone.outputIndex === 'number') {
    target.insertAfterEndpointId = node.domainId
    target.domoticaOutput = {
      group: node.hitZone.outputGroup,
      index: node.hitZone.outputIndex,
      expands: node.hitZone.outputExpands,
    }
  }
  if (node.hitZone?.converterDcConnection) {
    target.converterDcConnection = node.hitZone.converterDcConnection
    target.wireDomain = 'DC'
  }
  if (node.hitZone?.wireDomain) {
    target.wireDomain = node.hitZone.wireDomain
  }
  if (node.hitZone?.dcBusId) {
    target.dcBusId = node.hitZone.dcBusId
    target.wireDomain = 'DC'
  }
  if (typeof node.hitZone?.branchDeviceInsertIndex === 'number') {
    target.branchDeviceInsertIndex = node.hitZone.branchDeviceInsertIndex
  }

  return target
}

/**
 * Collect supply trunk device positions from a panel node's children.
 * Returns positions sorted by X (left to right) with their array index.
 */
function collectSupplyDevicePositions(
  panelNode: LayoutNode
): { index: number; x: number; y: number }[] {
  const positions: { index: number; x: number; y: number }[] = []
  let index = 0
  for (const child of panelNode.children) {
    if (
      child.type === 'trunkDevice' &&
      (child.id?.startsWith('supplyTrunkDevice-') ||
        child.id?.startsWith('subpanelSupplyTrunkDevice-'))
    ) {
      positions.push({ index, x: child.bounds.x, y: child.bounds.y })
      index++
    }
  }
  return positions
}

/**
 * Collect ground trunk device positions from a panel node's children.
 * Returns positions sorted by Y (top to bottom) with their array index.
 */
function collectGroundDevicePositions(panelNode: LayoutNode): { index: number; y: number }[] {
  const positions: { index: number; y: number }[] = []
  let index = 0
  for (const child of panelNode.children) {
    if (child.type === 'trunkDevice' && child.id?.startsWith('groundTrunkDevice-')) {
      positions.push({ index, y: child.bounds.y })
      index++
    }
  }
  return positions.sort((a, b) => a.y - b.y) // Sort by Y (top to bottom)
}

/**
 * Compute supply trunk device insert index based on cursor X position.
 * Uses the same midpoint approach as branch endpoint insertion:
 * - Cursor before all devices → index 0 (insert at start)
 * - Cursor between device A (index i) and device B (index i+1) → index i+1
 * - Cursor after all devices → index = device count (append at end)
 */
function computeSupplyInsertIndex(cursor: Point, ctx: WalkContext): number {
  const positions = ctx.supplyDevicePositions
  if (!positions || positions.length === 0) return 0

  const xs = positions.map((p) => p.x)
  const ys = positions.map((p) => p.y)
  const spreadX = Math.max(...xs) - Math.min(...xs)
  const spreadY = Math.max(...ys) - Math.min(...ys)

  // Vertical incoming sub-panel feeder devices share X and vary by Y.
  if (spreadY > spreadX) {
    let insertIndex = 0
    const byOrder = [...positions].sort((a, b) => a.index - b.index)
    for (const pos of byOrder) {
      if (cursor.y <= pos.y) {
        insertIndex = pos.index + 1
      }
    }
    return insertIndex
  }

  // Horizontal main supply devices: walk left to right.
  let insertIndex = 0
  const byX = [...positions].sort((a, b) => a.x - b.x)
  for (const pos of byX) {
    if (cursor.x >= pos.x) {
      insertIndex = pos.index + 1
    } else {
      break
    }
  }
  return insertIndex
}

/**
 * Compute ground trunk device insert index based on cursor Y position.
 * Uses the same approach as supply insertion but on the vertical axis:
 * - Cursor above all devices (lower Y) → index 0 (insert at start, closest to main bus)
 * - Cursor between device A (index i) and device B (index i+1) → index i+1
 * - Cursor below all devices (higher Y) → index = device count (append at end, closest to ground symbol)
 */
function computeGroundInsertIndex(cursorY: number, ctx: WalkContext): number {
  const positions = ctx.groundDevicePositions
  if (!positions || positions.length === 0) return 0

  // Walk top to bottom; find the last device whose Y is <= cursorY
  let insertIndex = 0
  for (const pos of positions) {
    if (cursorY >= pos.y) {
      insertIndex = pos.index + 1 // insert AFTER this device
    } else {
      break
    }
  }
  return insertIndex
}

/**
 * Collect all endpoint IDs from a branch node or an endpoint's sibling context
 */
function collectBranchEndpoints(node: LayoutNode): string[] {
  const endpointIds: string[] = []

  if (node.type === 'branch') {
    for (const child of node.children) {
      if (child.type === 'endpoint' && child.domainId) {
        endpointIds.push(child.domainId)
      }
    }
  } else if (node.type === 'endpoint') {
    if (node.domainId) {
      endpointIds.push(node.domainId)
    }
  }

  return endpointIds
}

/**
 * Collect endpoint IDs with their X positions from a branch node.
 * Sorted by X position (left-to-right = trunk-to-tip).
 *
 * Endpoint nodes use CENTER-based positioning, so bounds.x is the center X.
 */
function collectBranchEndpointPositions(node: LayoutNode): { id: string; x: number }[] {
  const positions: { id: string; x: number }[] = []

  if (node.type === 'branch') {
    for (const child of node.children) {
      if (child.type === 'endpoint' && child.domainId) {
        positions.push({ id: child.domainId, x: child.bounds.x })
      }
    }
  }

  return positions.sort((a, b) => a.x - b.x)
}

/**
 * Determine insertAfterEndpointId based on cursor X position relative to
 * endpoint positions on the branch.
 *
 * Returns the ID of the last endpoint whose center is to the LEFT of the
 * cursor (cursorX >= endpoint.x), or undefined if the cursor is before
 * all endpoints (insert at the beginning of the chain).
 *
 * This ensures:
 * - Dropping on wire between A and B → insertAfter = A (between A and B)
 * - Dropping on wire before first endpoint → insertAfter = undefined (at start)
 * - Dropping past last endpoint → insertAfter = last endpoint
 */
function findInsertAfterByPosition(
  cursorX: number,
  branchEndpointPositions: { id: string; x: number }[]
): string | undefined {
  if (!branchEndpointPositions.length) return undefined

  // Ensure sorted order by X.
  const sorted = [...branchEndpointPositions].sort((a, b) => a.x - b.x)

  let insertAfterId: string | undefined = undefined
  for (const ep of sorted) {
    if (cursorX >= ep.x) {
      insertAfterId = ep.id
    } else {
      break
    }
  }

  return insertAfterId
}

/**
 * Compute insertion index for a drop on the main bus based on cursor X position.
 * Uses the X positions of RCD/MCB children under the busBar node:
 * - Cursor before first item → index 0
 * - Cursor between item i and i+1 → index i+1
 * - Cursor after last item → index = itemCount
 */
function computeMainBusInsertIndex(
  busNode: LayoutNode,
  cursorX: number
): { insertIndex: number; itemCount: number } {
  const itemXs = busNode.children
    .filter((child) => child.type === 'rcd' || child.type === 'mcb')
    .map((child) => child.bounds.x)
    .sort((a, b) => a - b)

  const itemCount = itemXs.length
  if (itemCount === 0) {
    return { insertIndex: 0, itemCount: 0 }
  }

  let insertIndex = 0
  for (let i = 0; i < itemXs.length; i++) {
    const x = itemXs[i]!
    if (cursorX >= x) {
      insertIndex = i + 1
    } else {
      break
    }
  }

  return { insertIndex, itemCount }
}

/**
 * Compute insertion index for a drop on a secondary bus (nested circuits)
 * based on cursor X position. Uses the X positions of child MCB nodes:
 * - Cursor before first child → index 0
 * - Cursor between child i and i+1 → index i+1
 * - Cursor after last child → index = itemCount
 */
function computeSecondaryBusInsertIndex(
  busNode: LayoutNode,
  cursorX: number
): { insertIndex: number; itemCount: number } {
  // Prefer real child MCB nodes (RCD trunk secondary bus).
  let childXs = busNode.children
    .filter(
      (child) =>
        child.type === 'mcb' ||
        (child.type === 'endpoint' &&
          child.visual?.type === 'symbol' &&
          child.visual.symbolId === 'panel_distribution')
    )
    .map((child) => child.bounds.x)
    .sort((a, b) => a - b)

  // For nested-circuit secondary buses above a parent MCB, the bus node doesn't
  // own the MCB children directly. In that case we store the X positions as
  // metadata on the bus node (nestedChildXs).
  if (childXs.length === 0) {
    const metaXs = busNode.nestedChildXs
    if (metaXs && metaXs.length > 0) {
      childXs = [...metaXs].sort((a, b) => a - b)
    }
  }

  // Ordinary DC rails render their branch trunks as `branch` children of the
  // bus device rather than as MCB/endpoint children. Include those anchors in
  // the same insertion calculation so a drop between two rail branches keeps
  // its intended slot instead of falling back to the end of the rail.
  if (childXs.length === 0) {
    childXs = busNode.children
      .filter((child) => child.type === 'branch' && child.id?.startsWith('dc-bus-branch-'))
      .map((child) => child.bounds.x + child.bounds.width / 2)
      .sort((a, b) => a - b)
  }

  const itemCount = childXs.length
  if (itemCount === 0) {
    return { insertIndex: 0, itemCount: 0 }
  }

  let insertIndex = 0
  for (let i = 0; i < childXs.length; i++) {
    const x = childXs[i]!
    if (cursorX >= x) {
      insertIndex = i + 1
    } else {
      break
    }
  }

  return { insertIndex, itemCount }
}
