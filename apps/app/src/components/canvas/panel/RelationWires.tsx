import { logger } from '@/lib/logger'
/* eslint-disable react-refresh/only-export-components */
import { useMemo, useRef, useEffect, useCallback } from 'react'
import { Circle, Line, Text } from 'react-konva'
import Konva from 'konva'
import { panelGridModuleRefKey, ROW_GAP, ROW_STRIDE, CELL_W, CELL_H } from './panelGridLayout'
import {
  findPanelContainingModuleRef,
  getPanelMainBusSupplyDevice,
  getRelationEdges,
} from './panelRelationEdges'
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import type { ModulePlacement } from './panelGridLayout'
import { ensureInstallationFeedTopology, getPanelFeedProjection } from '@/lib/feedTopology'
import { getPanelIncomingMainBusFeedDevice } from '@/lib/panel/subPanelFeed'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  collectTerminalStripOccurrences,
  getEffectiveTerminalStripOutgoingPin,
  getTerminalStripId,
  getTerminalStripPin,
} from '@/lib/terminalStrip/labels'
import { findTrunkDeviceInProject } from '@/utils/project'
import { useIsMarqueeSelecting } from '@/contexts/SelectionPreviewContext'
import { useUIStore } from '@/stores/uiStore'
import { DEFAULT_PANEL_GRID_COLUMNS } from '@/lib/panel/panelGridDefaults'
import {
  routePanelWire,
  type PanelWirePathRegion,
  type WirePathDebug,
  type WirePathSegment,
} from './panelWireRouter'

export type PanelHierarchyRoute = {
  side: 'left' | 'right'
  corridorY: number
  panelLeftX: number
  panelRightX: number
  panelTopY?: number
  panelBottomY?: number
  feedFromTop: boolean
  panelInset: number
}

interface RelationWiresProps {
  placements: ModulePlacement[]
  selectedRef: PanelGridModuleRef | null
  /** Side of the selected one-wire span on the focused panel device. */
  selectedConnectionSide?: 'incoming' | 'outgoing'
  /** Other placed endpoint of the selected one-wire span, when present. */
  selectedConnectionPeerRef?: PanelGridModuleRef
  hoveredRef?: PanelGridModuleRef | null
  panel: Panel | null
  project: ProjectWithOptionalV2Electrical | null
  dragOverride?: { ref: PanelGridModuleRef; x: number; y: number } | null
  /** When set, placements with ref keys in this set keep their row during drag (for supply panel synthetic row). */
  preserveRowForRefKeys?: Set<string>
  /** When set, ref keys of modules in the supply panel (for routing last supply device → supply panel along side). */
  supplyPanelRefKeys?: Set<string>
  /**
   * `false` (default) — sharp, full-opacity wires rendered behind modules.
   * `true` — subtle frosted-glass wires rendered on top of modules.
   */
  ghost?: boolean
  /** Enables animated dash offset. Disable on touch devices for performance. */
  animateDash?: boolean
  hierarchyRoute?: PanelHierarchyRoute | null
  mainBusRouteSide?: 'left' | 'right' | null
  /** Single-panel mode explicit corridor Y (between main and supply panel frames). */
  singlePanelCorridorY?: number | null
  /** Dev-only panel relation routing debug colors. */
  debugMode?: boolean
  /** Sparse board-level ladders used by the shared pathfinder. */
  pathwayRegions?: PanelWirePathRegion[]
  /** Scene-derived pathways connecting separate board ladders. */
  pathwayLinks?: WirePathSegment[]
  /**
   * When set (merged hierarchy with multiple boards), resolve frame/corridor per target panel
   * so WSUD/WSPM/WUMP use the correct main’s bounds (not only the first / active main).
   */
  getHierarchyRoute?: (panel: Panel) => PanelHierarchyRoute | null
}

type WireRouteKind =
  | 'internal'
  | 'sharedSupplyToMainProtection'
  | 'sharedSupplyToUniqueSupplyDevice'
  | 'uniqueSupplyToMainProtection'
  | 'panelBusFeedToProtection'
  | 'mainProtectionToSecondaryPanelFeed'

interface RoutedWire {
  points: number[]
  kind: WireRouteKind
  pathDebug?: WirePathDebug
  selectedEndpoint?: 'source' | 'target'
  remotePlacement?: ModulePlacement
  /** Cross-panel wires in the same bundle should share their trunk, not repel it. */
  overlapGroup?: string
}

interface RenderedWireSegment {
  points: number[]
  kind: WireRouteKind
}

export function shouldSuppressPanelRelationWires(
  isMarqueeSelecting: boolean,
  selectedItemCount: number
): boolean {
  return isMarqueeSelecting || selectedItemCount > 1
}

interface RoutedWireLabel {
  text: string
  anchorX: number
  anchorY: number
  placeAbove: boolean
}

interface ComputeWiresResult {
  wires: RoutedWire[]
  labels: RoutedWireLabel[]
}

/** Console diagnostics when Settings → panel relation debug is on (UI-only). */
export type RelationWireDiagnostics = {
  source: 'selection' | 'hover'
  refKey: string
  ref: PanelGridModuleRef
  owningPanel: { id: string; name: string; isMain: boolean } | null
  usedPanelFallback: boolean
  targetPlacement: 'ok' | 'missing'
  graph: {
    parentRefKeys: string[]
    childRefKeys: string[]
    childPanelIds: string[]
    parentsWithPlacement: string[]
    parentsMissingPlacement: string[]
    childrenWithPlacement: string[]
    childrenMissingPlacement: string[]
  }
  wires: Array<{
    kind: WireRouteKind
    vertices: number
    points: number[]
    pathCost: number | null
    pathBends: number | null
    visitedNodes: number | null
    usedFallback: boolean | null
  }>
  /** Supply trunks only: how the ref maps to `installation.feedTopology.sharedFeed`. */
  supplyFeedPosition:
    | {
        inSharedFeed: true
        indexInSharedFeed: number
        sharedFeedLength: number
        isLastShared: boolean
      }
    | { inSharedFeed: false }
    | null
}

/**
 * Snapshot of graph + placement resolution + routed wire kinds for one module ref.
 * Use with `panelRelationDebug` in settings to trace WSUD/WSPM/WUMP issues.
 */
export function buildRelationWireDiagnostics(
  source: 'selection' | 'hover',
  ref: PanelGridModuleRef,
  placements: ModulePlacement[],
  panelFallback: Panel | null,
  project: ProjectWithOptionalV2Electrical | null,
  dragOverride?: { ref: PanelGridModuleRef; x: number; y: number } | null,
  preserveRowForRefKeys?: Set<string>,
  supplyPanelRefKeys?: Set<string>,
  hierarchyRoute?: RelationWiresProps['hierarchyRoute'],
  getHierarchyRoute?: RelationWiresProps['getHierarchyRoute'],
  mainBusRouteSide?: RelationWiresProps['mainBusRouteSide'],
  singlePanelCorridorY?: number | null,
  pathwayRegions?: PanelWirePathRegion[],
  pathwayLinks?: WirePathSegment[]
): RelationWireDiagnostics | null {
  if (!project) return null
  const refKey = panelGridModuleRefKey(ref)
  const fromResolve = findPanelContainingModuleRef(ref, project)
  const panelForContext = fromResolve ?? panelFallback
  const usedPanelFallback = fromResolve == null && panelFallback != null

  const effective = dragOverride
    ? placements.map((p) => applyDragOverride(p, dragOverride, preserveRowForRefKeys))
    : placements
  const placementByKey = new Map(effective.map((p) => [panelGridModuleRefKey(p.ref), p]))
  const targetPlacement = placementByKey.has(refKey) ? ('ok' as const) : ('missing' as const)

  const { parentRefs, childRefs, childPanelIds } = panelForContext
    ? getRelationEdges(ref, panelForContext, project)
    : {
        parentRefs: [] as PanelGridModuleRef[],
        childRefs: [] as PanelGridModuleRef[],
        childPanelIds: [] as string[],
      }

  const parentRefKeys = parentRefs.map((r) => panelGridModuleRefKey(r))
  const childRefKeys = childRefs.map((r) => panelGridModuleRefKey(r))
  const parentsWithPlacement: string[] = []
  const parentsMissingPlacement: string[] = []
  for (const r of parentRefs) {
    const k = panelGridModuleRefKey(r)
    ;(placementByKey.has(k) ? parentsWithPlacement : parentsMissingPlacement).push(k)
  }
  const childrenWithPlacement: string[] = []
  const childrenMissingPlacement: string[] = []
  for (const r of childRefs) {
    const k = panelGridModuleRefKey(r)
    ;(placementByKey.has(k) ? childrenWithPlacement : childrenMissingPlacement).push(k)
  }

  const wires =
    targetPlacement === 'ok' && panelForContext
      ? computeWires(
          ref,
          placements,
          panelFallback,
          project,
          dragOverride,
          preserveRowForRefKeys,
          supplyPanelRefKeys,
          hierarchyRoute,
          getHierarchyRoute,
          mainBusRouteSide,
          singlePanelCorridorY,
          pathwayRegions,
          pathwayLinks
        ).wires
      : []

  let supplyFeedPosition: RelationWireDiagnostics['supplyFeedPosition'] = null
  if (ref.kind === 'trunkDevice' && ref.scope === 'supply') {
    const installation = getProjectElectricalInstallation(project)
    if (installation) {
      const topology = ensureInstallationFeedTopology(
        installation,
        getProjectElectricalPanels(project)
      )
      const sharedDevices = topology.sharedFeed.trunkDevices ?? []
      const idxInShared = sharedDevices.findIndex((d) => d.id === ref.id)
      if (idxInShared >= 0) {
        supplyFeedPosition = {
          inSharedFeed: true,
          indexInSharedFeed: idxInShared,
          sharedFeedLength: sharedDevices.length,
          isLastShared: idxInShared === sharedDevices.length - 1,
        }
      } else {
        supplyFeedPosition = { inSharedFeed: false }
      }
    }
  }

  return {
    source,
    refKey,
    ref,
    owningPanel: panelForContext
      ? {
          id: panelForContext.id,
          name: panelForContext.name,
          isMain: panelForContext.isMain === true,
        }
      : null,
    usedPanelFallback,
    targetPlacement,
    graph: {
      parentRefKeys,
      childRefKeys,
      childPanelIds,
      parentsWithPlacement,
      parentsMissingPlacement,
      childrenWithPlacement,
      childrenMissingPlacement,
    },
    wires: wires.map((w) => ({
      kind: w.kind,
      vertices: w.points.length / 2,
      points: w.points,
      pathCost: w.pathDebug?.cost ?? null,
      pathBends: w.pathDebug?.bends ?? null,
      visitedNodes: w.pathDebug?.visitedNodes ?? null,
      usedFallback: w.pathDebug?.usedFallback ?? null,
    })),
    supplyFeedPosition,
  }
}

/* ── Routing constants ────────────────────────────────────────── */

const WIRE_SPACING = 2.5
const DODGE_MARGIN = 5
const SAME_ROW_SPREAD = 6
/** Margin when routing last-supply → supply panel along left/right side of main panel. */
const SIDE_ROUTE_MARGIN = 4
/** Extra side push used in single-panel mode so corridor lanes sit outside the frame gutter. */
const SINGLE_PANEL_SIDE_EXTRA = 10
/** Small offset before final entry so a short vertical segment remains visible. */
const FINAL_ENTRY_OFFSET = 6
/** Stubs this short are drawn solid over dashed wires so they never disappear in a dash gap. */
const VISIBLE_STUB_MAX_LENGTH = 18
/** Keep supply-chain input/output ports visually separate on compact modules. */
const SUPPLY_PORT_SPREAD = 8
/** Bottom-fed WUMP corridor offset so it doesn't overlap WSUD. */
const WUMP_SIDE_OFFSET = 5
/** Offset WINT side-corridor from feed corridors to reduce overlap. */
const INTERNAL_FEED_AVOID_OFFSET = 6
/** Split opposite vertical WINT flows in same side corridor. */
const INTERNAL_BIDIR_CORRIDOR_SPLIT = 4
/** Prefer a clear alternative, but never justify a board-scale detour for one conflict. */
const WIRE_CONFLICT_PENALTY = ROW_STRIDE * 4

/* ── Wire routing helpers ─────────────────────────────────────── */

function routeViaGap(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  gapY: number
): number[] {
  if (fromX === toX) return [fromX, fromY, toX, toY]
  return [fromX, fromY, fromX, gapY, toX, gapY, toX, toY]
}

type ModulePortCandidate = { wires: RoutedWire[]; preferencePenalty: number }

export function countWirePathConflicts(
  wires: Array<{ points: number[]; overlapGroup?: string }>
): number {
  const segmentsFor = (wire: { points: number[] }): WirePathSegment[] => {
    const segments: WirePathSegment[] = []
    for (let index = 0; index <= wire.points.length - 4; index += 2) {
      segments.push({
        from: { x: wire.points[index]!, y: wire.points[index + 1]! },
        to: { x: wire.points[index + 2]!, y: wire.points[index + 3]! },
      })
    }
    return segments
  }
  const allSegments = wires.map(segmentsFor)
  let conflicts = 0
  for (let wireIndex = 1; wireIndex < allSegments.length; wireIndex += 1) {
    for (const candidate of allSegments[wireIndex]!) {
      const candidateVertical = candidate.from.x === candidate.to.x
      for (let previousIndex = 0; previousIndex < wireIndex; previousIndex += 1) {
        if (
          wires[wireIndex]!.overlapGroup &&
          wires[wireIndex]!.overlapGroup === wires[previousIndex]!.overlapGroup
        ) {
          continue
        }
        for (const reserved of allSegments[previousIndex]!) {
          const reservedVertical = reserved.from.x === reserved.to.x
          if (candidateVertical !== reservedVertical) {
            const vertical = candidateVertical ? candidate : reserved
            const horizontal = candidateVertical ? reserved : candidate
            const verticalLow = Math.min(vertical.from.y, vertical.to.y)
            const verticalHigh = Math.max(vertical.from.y, vertical.to.y)
            const horizontalLow = Math.min(horizontal.from.x, horizontal.to.x)
            const horizontalHigh = Math.max(horizontal.from.x, horizontal.to.x)
            const crosses =
              vertical.from.x >= horizontalLow &&
              vertical.from.x <= horizontalHigh &&
              horizontal.from.y >= verticalLow &&
              horizontal.from.y <= verticalHigh
            const isHorizontalEndpoint =
              vertical.from.x === horizontalLow || vertical.from.x === horizontalHigh
            const isVerticalEndpoint =
              horizontal.from.y === verticalLow || horizontal.from.y === verticalHigh
            if (
              crosses &&
              // A shared endpoint is a legitimate connection. A T-junction,
              // such as a side ladder continuing through another wire, is not.
              !(isHorizontalEndpoint && isVerticalEndpoint)
            ) {
              conflicts += 1
            }
            continue
          }
          if (candidateVertical && candidate.from.x === reserved.from.x) {
            const overlap =
              Math.min(
                Math.max(candidate.from.y, candidate.to.y),
                Math.max(reserved.from.y, reserved.to.y)
              ) -
              Math.max(
                Math.min(candidate.from.y, candidate.to.y),
                Math.min(reserved.from.y, reserved.to.y)
              )
            if (overlap > 0) conflicts += 1
          } else if (!candidateVertical && candidate.from.y === reserved.from.y) {
            const overlap =
              Math.min(
                Math.max(candidate.from.x, candidate.to.x),
                Math.max(reserved.from.x, reserved.to.x)
              ) -
              Math.max(
                Math.min(candidate.from.x, candidate.to.x),
                Math.min(reserved.from.x, reserved.to.x)
              )
            if (overlap > 0) conflicts += 1
          }
        }
      }
    }
  }
  return conflicts
}

function resolveSameRowLockedRegion(
  placement: ModulePlacement,
  remote: ModulePlacement,
  side: 'top' | 'bottom',
  pathwayRegions: PanelWirePathRegion[] | undefined
): PanelWirePathRegion[] | undefined {
  if (placement.row !== remote.row) return undefined
  const placementCenterX = placement.x + placement.width / 2
  const remoteCenterX = remote.x + remote.width / 2
  const placementCenterY = placement.y + placement.height / 2
  const remoteCenterY = remote.y + remote.height / 2
  const region = pathwayRegions?.find((candidate) => {
    const minY = Math.min(...candidate.horizontalYs)
    const maxY = Math.max(...candidate.horizontalYs)
    return (
      placementCenterX >= candidate.left &&
      placementCenterX <= candidate.right &&
      remoteCenterX >= candidate.left &&
      remoteCenterX <= candidate.right &&
      placementCenterY >= minY &&
      placementCenterY <= maxY &&
      remoteCenterY >= minY &&
      remoteCenterY <= maxY
    )
  })
  if (pathwayRegions && !region) return undefined

  const edgeY =
    side === 'top'
      ? Math.min(placement.y, remote.y)
      : Math.max(placement.y + placement.height, remote.y + remote.height)
  const eligibleLanes = region?.horizontalYs.filter((y) =>
    side === 'top' ? y <= edgeY : y >= edgeY
  )
  const laneY = eligibleLanes?.reduce<number | null>((nearest, y) => {
    if (nearest == null) return y
    return Math.abs(y - edgeY) < Math.abs(nearest - edgeY) ? y : nearest
  }, null)
  const lockedLaneY = laneY ?? (side === 'top' ? edgeY - ROW_GAP / 2 : edgeY + ROW_GAP / 2)
  return [
    region
      ? { ...region, horizontalYs: [lockedLaneY] }
      : {
          id: 'same-row-lock',
          left: Math.min(placementCenterX, remoteCenterX),
          right: Math.max(placementCenterX, remoteCenterX),
          horizontalYs: [lockedLaneY],
        },
  ]
}

function candidateKeepsOverlapGroupsTogether(candidate: ModulePortCandidate): boolean {
  const terminalYByGroup = new Map<string, number>()
  for (const wire of candidate.wires) {
    if (!wire.overlapGroup || !wire.selectedEndpoint) continue
    const terminalIndex = wire.selectedEndpoint === 'source' ? 1 : wire.points.length - 1
    const terminalY = wire.points[terminalIndex]!
    const existing = terminalYByGroup.get(wire.overlapGroup)
    if (existing != null && existing !== terminalY) return false
    terminalYByGroup.set(wire.overlapGroup, terminalY)
  }
  return true
}

function applyWireTerminal(
  wire: RoutedWire,
  endpoint: 'source' | 'target',
  placement: ModulePlacement,
  side: 'top' | 'bottom',
  terminalX: number
): void {
  const points = [...wire.points]
  const terminalY = side === 'top' ? placement.y : placement.y + placement.height
  const approachY =
    side === 'top'
      ? placement.y - FINAL_ENTRY_OFFSET
      : placement.y + placement.height + FINAL_ENTRY_OFFSET
  if (endpoint === 'source') {
    const oldApproachY = points[3]
    points[0] = terminalX
    points[1] = terminalY
    points[2] = terminalX
    points[3] = approachY
    if (oldApproachY != null && points[5] != null && Math.abs(points[5] - oldApproachY) <= 0.5) {
      points[5] = approachY
    }
  } else {
    const endpointIndex = points.length - 2
    const adjacentIndex = points.length - 4
    const precedingIndex = points.length - 6
    const oldApproachY = points[adjacentIndex + 1]
    points[endpointIndex] = terminalX
    points[endpointIndex + 1] = terminalY
    points[adjacentIndex] = terminalX
    points[adjacentIndex + 1] = approachY
    const precedingY = points[precedingIndex + 1]
    if (oldApproachY != null && precedingY != null && Math.abs(precedingY - oldApproachY) <= 0.5) {
      points[precedingIndex + 1] = approachY
    }
  }
  wire.points = points
}

function buildModulePortCandidates(
  wires: RoutedWire[],
  placement: ModulePlacement,
  lockDirectionalSides = false,
  incomingSideOverride?: 'top' | 'bottom',
  outgoingSideOverride?: 'top' | 'bottom',
  incomingXOverride?: number,
  outgoingXOverride?: number
): ModulePortCandidate[] {
  const centerX = placement.x + placement.width / 2
  const cloneWires = () => wires.map((wire) => ({ ...wire, points: [...wire.points] }))
  const incomingWireIndexes = wires.flatMap((wire, index) =>
    wire.selectedEndpoint === 'target' ? [index] : []
  )
  const outgoingWireIndexes = wires.flatMap((wire, index) =>
    wire.selectedEndpoint === 'source' ? [index] : []
  )
  const configurableGroups = [incomingWireIndexes, outgoingWireIndexes].filter(
    (indexes) => indexes.length > 0
  )
  if (configurableGroups.length === 0) {
    return [{ wires: cloneWires(), preferencePenalty: 0 }]
  }

  if (lockDirectionalSides) {
    return (['top', 'bottom'] as const).map((incomingSide) => {
      const outgoingSide = incomingSide === 'top' ? 'bottom' : 'top'
      const candidateWires = cloneWires()
      for (const wireIndex of [...incomingWireIndexes, ...outgoingWireIndexes]) {
        const wire = candidateWires[wireIndex]!
        const side =
          wire.selectedEndpoint === 'target'
            ? (incomingSideOverride ?? incomingSide)
            : (outgoingSideOverride ?? outgoingSide)
        const incomingIndex = incomingWireIndexes.indexOf(wireIndex)
        const terminalX =
          incomingIndex >= 0 && incomingWireIndexes.length > 1
            ? centerX +
              (incomingIndex - (incomingWireIndexes.length - 1) / 2) * SUPPLY_PORT_SPREAD * 2
            : wire.selectedEndpoint === 'target'
              ? (incomingXOverride ?? centerX)
              : (outgoingXOverride ?? centerX)
        applyWireTerminal(wire, wire.selectedEndpoint!, placement, side, terminalX)
      }
      return { wires: candidateWires, preferencePenalty: 0 }
    })
  }

  // A module port represents a bus connection, not a separate decision for every
  // relation. Keep the complete incoming bundle and complete outgoing fan-out on
  // coherent sides, then let pathfinding compare the (at most four) group-level
  // assignments. Besides producing a readable bus, this avoids the old five-wire
  // bitmask cap leaving large fan-outs partly on their legacy guide side.
  const assignmentCount = 1 << configurableGroups.length
  const candidates: ModulePortCandidate[] = []
  for (let assignment = 0; assignment < assignmentCount; assignment += 1) {
    const candidateWires = cloneWires()
    for (let groupIndex = 0; groupIndex < configurableGroups.length; groupIndex += 1) {
      const side = (assignment & (1 << groupIndex)) === 0 ? 'top' : 'bottom'
      for (const wireIndex of configurableGroups[groupIndex]!) {
        const wire = candidateWires[wireIndex]!
        const resolvedSide =
          wire.selectedEndpoint === 'target'
            ? (incomingSideOverride ?? side)
            : (outgoingSideOverride ?? side)
        applyWireTerminal(
          wire,
          wire.selectedEndpoint!,
          placement,
          resolvedSide,
          wire.selectedEndpoint === 'target'
            ? (incomingXOverride ?? centerX)
            : (outgoingXOverride ?? centerX)
        )
      }
    }
    candidates.push({ wires: candidateWires, preferencePenalty: 0 })
  }
  return candidates
}

function routeWithDodge(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  yOff: number
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2

  const exitY = parentPl.y
  const topGapY = parentPl.y - ROW_GAP / 2 + yOff
  const childGapY = childPl.y - ROW_GAP / 2 + yOff
  const entryY = childPl.y

  const needsDodge = childCx >= parentPl.x && childCx <= parentPl.x + parentPl.width

  if (!needsDodge) {
    return [parentCx, exitY, parentCx, topGapY, childCx, topGapY, childCx, entryY]
  }

  const dodgeRight = childCx > parentCx
  const dodgeX = dodgeRight ? parentPl.x + parentPl.width + DODGE_MARGIN : parentPl.x - DODGE_MARGIN

  return [
    parentCx,
    exitY,
    parentCx,
    topGapY,
    dodgeX,
    topGapY,
    dodgeX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
}

/** Wire points from parent to child (for relation wires and drop preview). Exported for auto-parent preview. */
export function getDownstreamWirePoints(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  yOff = 0
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2

  if (childPl.row < parentPl.row) {
    const gapY = parentPl.y - ROW_GAP / 2 + yOff
    return routeViaGap(parentCx, parentPl.y, childCx, childPl.y + childPl.height, gapY)
  }

  if (childPl.row === parentPl.row) {
    const dir = childCx >= parentCx ? 1 : -1
    const gapY = parentPl.y + parentPl.height + ROW_GAP / 2 + yOff
    return routeViaGap(
      parentCx + dir * SAME_ROW_SPREAD,
      parentPl.y + parentPl.height,
      childCx - dir * SAME_ROW_SPREAD,
      childPl.y + childPl.height,
      gapY
    )
  }

  if (childPl.row === parentPl.row + 1) {
    const gapY = parentPl.y + parentPl.height + ROW_GAP / 2 + yOff
    return routeViaGap(parentCx, parentPl.y + parentPl.height, childCx, childPl.y, gapY)
  }

  return routeWithDodge(parentPl, childPl, yOff)
}

/**
 * Internal wiring when source is incoming MCIR feeder:
 * - same row: bottom lane from source to target
 * - different row: snake via nearest side corridor (left half -> left, right half -> right)
 */
function routeInternalFromPanelBusFeeder(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  feedFromTop: boolean
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const sameRowUseBottomLane = feedFromTop
  const parentExitY = sameRowUseBottomLane ? parentPl.y + parentPl.height : parentPl.y
  const childEntryY = sameRowUseBottomLane ? childPl.y + childPl.height : childPl.y

  if (childPl.row === parentPl.row) {
    const laneY = sameRowUseBottomLane
      ? Math.max(parentExitY, childEntryY) + FINAL_ENTRY_OFFSET
      : Math.min(parentExitY, childEntryY) - FINAL_ENTRY_OFFSET
    return [parentCx, parentExitY, parentCx, laneY, childCx, laneY, childCx, childEntryY]
  }

  const exitsFromBottom = feedFromTop
  const directionalParentExitY = exitsFromBottom ? parentPl.y + parentPl.height : parentPl.y
  const directionalChildEntryY = exitsFromBottom ? childPl.y + childPl.height : childPl.y
  const panelMidX = (mainPanelLeftX + mainPanelRightX) / 2
  const side: 'left' | 'right' = parentCx <= panelMidX ? 'left' : 'right'
  const baseSideX =
    side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const childBelowParent = childPl.row > parentPl.row
  const directionalSplit = childBelowParent
    ? INTERNAL_BIDIR_CORRIDOR_SPLIT
    : -INTERNAL_BIDIR_CORRIDOR_SPLIT
  const sideX =
    side === 'left'
      ? baseSideX + INTERNAL_FEED_AVOID_OFFSET + directionalSplit
      : baseSideX - INTERNAL_FEED_AVOID_OFFSET + directionalSplit
  let exitLaneY = feedFromTop
    ? directionalParentExitY + FINAL_ENTRY_OFFSET
    : directionalParentExitY - FINAL_ENTRY_OFFSET
  if (exitsFromBottom) {
    exitLaneY = Math.max(exitLaneY, parentPl.y + parentPl.height + ROW_GAP / 2)
  } else {
    exitLaneY = Math.min(exitLaneY, parentPl.y - ROW_GAP / 2)
  }
  const childGapY = exitsFromBottom
    ? childPl.y + childPl.height + ROW_GAP / 2
    : childPl.y - ROW_GAP / 2

  return [
    parentCx,
    directionalParentExitY,
    parentCx,
    exitLaneY,
    sideX,
    exitLaneY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    directionalChildEntryY,
  ]
}

function routeInternalByFeedDirection(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  feedFromTop: boolean,
  yOff = 0
): number[] {
  // Same-row is the only intentional deviation from global feed direction so wires
  // don't fold over themselves.
  if (childPl.row === parentPl.row) {
    const parentCx = parentPl.x + parentPl.width / 2
    const childCx = childPl.x + childPl.width / 2
    const sameRowUseBottomLane = feedFromTop
    const parentExitY = sameRowUseBottomLane ? parentPl.y + parentPl.height : parentPl.y
    const childEntryY = sameRowUseBottomLane ? childPl.y + childPl.height : childPl.y
    const laneY = sameRowUseBottomLane
      ? Math.max(parentExitY, childEntryY) + FINAL_ENTRY_OFFSET + yOff
      : Math.min(parentExitY, childEntryY) - FINAL_ENTRY_OFFSET + yOff
    return [parentCx, parentExitY, parentCx, laneY, childCx, laneY, childCx, childEntryY]
  }
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const panelMidX = (mainPanelLeftX + mainPanelRightX) / 2
  const side: 'left' | 'right' = parentCx <= panelMidX ? 'left' : 'right'
  const baseSideX =
    side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const childBelowParent = childPl.row > parentPl.row
  const directionalSplit = childBelowParent
    ? INTERNAL_BIDIR_CORRIDOR_SPLIT
    : -INTERNAL_BIDIR_CORRIDOR_SPLIT
  const sideX =
    side === 'left'
      ? baseSideX + INTERNAL_FEED_AVOID_OFFSET + directionalSplit
      : baseSideX - INTERNAL_FEED_AVOID_OFFSET + directionalSplit

  const exitsFromBottom = feedFromTop
  const parentExitY = exitsFromBottom ? parentPl.y + parentPl.height : parentPl.y
  const childEntryY = exitsFromBottom ? childPl.y + childPl.height : childPl.y
  let exitLaneY = feedFromTop
    ? parentExitY - FINAL_ENTRY_OFFSET + yOff
    : parentExitY + FINAL_ENTRY_OFFSET + yOff
  if (exitsFromBottom) {
    exitLaneY = Math.max(exitLaneY, parentPl.y + parentPl.height + ROW_GAP / 2 + yOff)
  } else {
    exitLaneY = Math.min(exitLaneY, parentPl.y - ROW_GAP / 2 + yOff)
  }
  const childGapY = exitsFromBottom
    ? childPl.y + childPl.height + ROW_GAP / 2 + yOff
    : childPl.y - ROW_GAP / 2 + yOff

  return [
    parentCx,
    parentExitY,
    parentCx,
    exitLaneY,
    sideX,
    exitLaneY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    childEntryY,
  ]
}

/**
 * Route from last device on supply wire (main panel) to a child in the supply panel:
 * horizontal to left or right side of main panel block, then vertical to child row, then horizontal to child.
 * Only used when parent is last supply trunk device and child is in supply panel.
 */
function routeLastSupplyToSupplyPanel(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const parentCy = parentPl.y + parentPl.height / 2
  const childCy = childPl.y + childPl.height / 2
  // Adapt to feed orientation/relative vertical direction:
  // if child is below parent, leave from bottom and enter child top; else inverse.
  const childBelowParent = childCy >= parentCy
  const exitY = childBelowParent ? parentPl.y + parentPl.height : parentPl.y
  const entryY = childBelowParent ? childPl.y : childPl.y + childPl.height
  // Short vertical out of parent before turning horizontal (same offset as final entry).
  const exitApproachY = childBelowParent ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  // Horizontal in the gap; tiny last vertical into module.
  const approachY = childBelowParent ? entryY - FINAL_ENTRY_OFFSET : entryY + FINAL_ENTRY_OFFSET
  // Use the side that is closer to the parent module (avoids long detour when parent is narrow).
  const distToLeft = parentCx - (mainPanelLeftX - SIDE_ROUTE_MARGIN)
  const distToRight = mainPanelRightX + SIDE_ROUTE_MARGIN - parentCx
  const useLeft = distToLeft <= distToRight
  const sideX = useLeft ? mainPanelLeftX - SIDE_ROUTE_MARGIN : mainPanelRightX + SIDE_ROUTE_MARGIN
  return [
    parentCx,
    exitY,
    parentCx,
    exitApproachY,
    sideX,
    exitApproachY,
    sideX,
    approachY,
    childCx,
    approachY,
    childCx,
    entryY,
  ]
}

function routeSupplyPanelTrunkToMainBus(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredSide?: 'left' | 'right' | null,
  corridorY?: number | null,
  feedFromTop = true
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const parentExitX =
    parentCx + (preferredSide === 'left' ? -SUPPLY_PORT_SPREAD : SUPPLY_PORT_SPREAD)
  const childCx = childPl.x + childPl.width / 2
  const exitY = feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const childGapY = feedFromTop ? childPl.y - ROW_GAP / 2 : childPl.y + childPl.height + ROW_GAP / 2
  const entryY = feedFromTop ? childPl.y : childPl.y + childPl.height
  const side =
    preferredSide ??
    (parentCx - (mainPanelLeftX - SIDE_ROUTE_MARGIN) <=
    mainPanelRightX + SIDE_ROUTE_MARGIN - parentCx
      ? 'left'
      : 'right')
  const sideX =
    side === 'left' ? mainPanelLeftX - SIDE_ROUTE_MARGIN : mainPanelRightX + SIDE_ROUTE_MARGIN
  const exitApproachY = feedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const trunkY = corridorY ?? exitApproachY
  return [
    parentExitX,
    exitY,
    parentExitX,
    exitApproachY,
    sideX,
    exitApproachY,
    sideX,
    trunkY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
}

/**
 * WUMP: Unique supply device -> main protections.
 * Keep this route inside the panel frame and avoid "exit then reverse" movement.
 */
function routeUniqueSupplyToMainBusInside(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredSide?: 'left' | 'right' | null,
  hierarchyRoute?: RelationWiresProps['hierarchyRoute'],
  feedFromTop = true
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const side =
    preferredSide ?? (parentCx - mainPanelLeftX <= mainPanelRightX - parentCx ? 'left' : 'right')
  const sideX = hierarchyRoute
    ? side === 'left'
      ? hierarchyRoute.panelLeftX + hierarchyRoute.panelInset / 2
      : hierarchyRoute.panelRightX - hierarchyRoute.panelInset / 2
    : side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const wumpSideX = side === 'left' ? sideX + WUMP_SIDE_OFFSET : sideX - WUMP_SIDE_OFFSET

  // WUMP should keep paths simple:
  // - top-feed panels: always leave MUNQ from bottom
  // - bottom-feed panels: always leave MUNQ from top
  // - avoid side-corridor detours for local fanout; use corridor for deeper targets.
  const exitY = feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const exitApproachY = feedFromTop ? exitY + ROW_GAP / 2 : exitY - ROW_GAP / 2
  const childRowIsSameOrFurtherInFeedDirection = feedFromTop
    ? childPl.row >= parentPl.row
    : childPl.row <= parentPl.row
  const childGapY = feedFromTop ? childPl.y - ROW_GAP / 2 : childPl.y + childPl.height + ROW_GAP / 2
  const entryY = feedFromTop ? childPl.y : childPl.y + childPl.height

  // If the source approach is already the target row opening, branch into the
  // module immediately. Going out to a side passage and returning on this same
  // horizontal lane only creates a U-turn and cannot avoid any row content.
  if (Math.abs(exitApproachY - childGapY) < 0.5) {
    return [parentCx, exitY, parentCx, exitApproachY, childCx, childGapY, childCx, entryY]
  }

  // Bottom-fed special case:
  // when target is on a lower row than source, keep trunk in side corridor,
  // then branch at the target row gap and feed from the bottom.
  if (!feedFromTop && childPl.row > parentPl.row) {
    return [
      parentCx,
      exitY,
      parentCx,
      exitApproachY,
      wumpSideX,
      exitApproachY,
      wumpSideX,
      childGapY,
      childCx,
      childGapY,
      childCx,
      entryY,
    ]
  }

  if (childRowIsSameOrFurtherInFeedDirection) {
    if (feedFromTop) {
      // For deeper targets, route via side corridor to avoid crossing through intermediate rows/modules.
      if (childPl.row > parentPl.row + 1) {
        const trunkY = Math.max(exitApproachY, childGapY)
        return [
          parentCx,
          exitY,
          parentCx,
          exitApproachY,
          sideX,
          exitApproachY,
          sideX,
          trunkY,
          childCx,
          trunkY,
          childCx,
          entryY,
        ]
      }
      if (childPl.row === parentPl.row) {
        // Same-row fanout: stay in bottom lane and feed neighbour from below.
        const laneY = exitApproachY
        const entryY = childPl.y + childPl.height
        return [parentCx, exitY, parentCx, laneY, childCx, laneY, childCx, entryY]
      }
      // Downstream row fanout: drop from source, then run across child row gap.
      const laneY = Math.max(exitApproachY, childGapY)
      return [parentCx, exitY, parentCx, laneY, childCx, laneY, childCx, entryY]
    }

    if (childPl.row !== parentPl.row) {
      return [
        parentCx,
        exitY,
        parentCx,
        exitApproachY,
        wumpSideX,
        exitApproachY,
        wumpSideX,
        childGapY,
        childCx,
        childGapY,
        childCx,
        entryY,
      ]
    }
    if (childPl.row === parentPl.row) {
      // Bottom-feed mirror: same-row fanout from top lane.
      const laneY = exitApproachY
      const entryY = childPl.y
      return [parentCx, exitY, parentCx, laneY, childCx, laneY, childCx, entryY]
    }
  }

  // Only use side lane when target is opposite feed direction (rare, drag/edit states).
  const trunkY = feedFromTop
    ? Math.max(exitApproachY, childGapY)
    : Math.min(exitApproachY, childGapY)
  const corridorX = feedFromTop ? sideX : wumpSideX
  return [
    parentCx,
    exitY,
    parentCx,
    exitApproachY,
    corridorX,
    exitApproachY,
    corridorX,
    trunkY,
    childCx,
    trunkY,
    childCx,
    entryY,
  ]
}

/**
 * Shared strip → frame corridor → target row gap → module top (hierarchy / merged boards).
 * Used for WSPM and WSUD so both land on the DIN preview the same way.
 */
function routeSharedSupplyThroughHierarchyCorridor(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  hierarchyRoute: PanelHierarchyRoute
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const sideX =
    hierarchyRoute.side === 'left'
      ? hierarchyRoute.panelLeftX + hierarchyRoute.panelInset / 2
      : hierarchyRoute.panelRightX - hierarchyRoute.panelInset / 2
  const childGapY = hierarchyRoute.feedFromTop
    ? childPl.y - ROW_GAP / 2
    : childPl.y + childPl.height + ROW_GAP / 2
  const exitY = hierarchyRoute.feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const exitLaneY = hierarchyRoute.feedFromTop
    ? exitY + FINAL_ENTRY_OFFSET
    : exitY - FINAL_ENTRY_OFFSET
  const entryY = hierarchyRoute.feedFromTop ? childPl.y : childPl.y + childPl.height
  const gateX = (hierarchyRoute.panelLeftX + hierarchyRoute.panelRightX) / 2
  const borderY = hierarchyRoute.feedFromTop
    ? (hierarchyRoute.panelTopY ?? hierarchyRoute.corridorY)
    : (hierarchyRoute.panelBottomY ?? hierarchyRoute.corridorY)
  const TOP_INNER_LANE_OFFSET = 26
  const BOTTOM_INNER_LANE_OFFSET = 10
  const innerLaneY = hierarchyRoute.feedFromTop
    ? (hierarchyRoute.panelTopY ?? borderY) + TOP_INNER_LANE_OFFSET
    : (hierarchyRoute.panelBottomY ?? borderY) - BOTTOM_INNER_LANE_OFFSET

  return [
    parentCx,
    exitY,
    parentCx,
    exitLaneY,
    gateX,
    exitLaneY,
    gateX,
    hierarchyRoute.corridorY,
    gateX,
    borderY,
    gateX,
    innerLaneY,
    sideX,
    innerLaneY,
    sideX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
}

function routeSharedSupplyToMainPanel(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  hierarchyRoute: PanelHierarchyRoute
): number[] {
  return routeSharedSupplyThroughHierarchyCorridor(parentPl, childPl, hierarchyRoute)
}

function routeSharedSupplyDirectToPanelBottom(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  hierarchyRoute: PanelHierarchyRoute
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const exitY = parentPl.y
  const entryY = childPl.y + childPl.height
  return [
    parentCx,
    exitY,
    parentCx,
    hierarchyRoute.corridorY,
    childCx,
    hierarchyRoute.corridorY,
    childCx,
    entryY,
  ]
}

function routeSharedSupplyToSupplyDevice(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredSide?: 'left' | 'right' | null,
  hierarchyRoute?: RelationWiresProps['hierarchyRoute'],
  corridorY?: number | null,
  feedFromTop = true
): number[] {
  if (hierarchyRoute) {
    if (!hierarchyRoute.feedFromTop && parentPl.y > childPl.y) {
      return routeSharedSupplyDirectToPanelBottom(parentPl, childPl, hierarchyRoute)
    }
    return routeSharedSupplyThroughHierarchyCorridor(parentPl, childPl, hierarchyRoute)
  }

  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const side =
    preferredSide ?? (parentCx - mainPanelLeftX <= mainPanelRightX - parentCx ? 'left' : 'right')
  const sideX =
    side === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA

  const exitY = feedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const entryY = feedFromTop ? childPl.y : childPl.y + childPl.height
  const exitApproachY = feedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const entryApproachY = feedFromTop ? entryY - FINAL_ENTRY_OFFSET : entryY + FINAL_ENTRY_OFFSET
  const resolvedCorridorY =
    corridorY ?? (parentPl.y + parentPl.height / 2 + childPl.y + childPl.height / 2) / 2

  return [
    parentCx,
    exitY,
    parentCx,
    exitApproachY,
    sideX,
    exitApproachY,
    sideX,
    resolvedCorridorY,
    sideX,
    entryApproachY,
    childCx,
    entryApproachY,
    childCx,
    entryY,
  ]
}

/**
 * WSPF: feeder protection (source board) -> fed panel main-bus protection.
 * This intentionally does NOT reuse WSUD routing:
 * - leave source row lane first (top/bottom by feed direction)
 * - use opposite side corridor from feed side
 * - run via shared hierarchy corridor Y
 * - then enter target with side-corridor -> row-gap -> module entry
 */
function routeMainProtectionToSecondaryPanelFeed(
  parentPl: ModulePlacement,
  childPl: ModulePlacement,
  mainPanelLeftX: number,
  mainPanelRightX: number,
  preferredFeedSide?: 'left' | 'right' | null,
  sourceHierarchyRoute?: RelationWiresProps['hierarchyRoute'],
  targetHierarchyRoute?: RelationWiresProps['hierarchyRoute'],
  corridorY?: number | null,
  sourceFeedFromTop = true,
  targetFeedFromTop = true
): number[] {
  const parentCx = parentPl.x + parentPl.width / 2
  const childCx = childPl.x + childPl.width / 2
  const sourceFeedSide =
    sourceHierarchyRoute?.side ??
    preferredFeedSide ??
    (parentCx - mainPanelLeftX <= mainPanelRightX - parentCx ? 'left' : 'right')
  const sourceExitSide: 'left' | 'right' = sourceFeedSide === 'left' ? 'right' : 'left'
  const targetEntrySide =
    targetHierarchyRoute?.side ??
    preferredFeedSide ??
    (childCx - mainPanelLeftX <= mainPanelRightX - childPl.x ? 'left' : 'right')
  const sourceSideX = sourceHierarchyRoute
    ? sourceExitSide === 'left'
      ? sourceHierarchyRoute.panelLeftX + sourceHierarchyRoute.panelInset / 2
      : sourceHierarchyRoute.panelRightX - sourceHierarchyRoute.panelInset / 2
    : sourceExitSide === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const targetSideX = targetHierarchyRoute
    ? targetEntrySide === 'left'
      ? targetHierarchyRoute.panelLeftX + targetHierarchyRoute.panelInset / 2
      : targetHierarchyRoute.panelRightX - targetHierarchyRoute.panelInset / 2
    : targetEntrySide === 'left'
      ? mainPanelLeftX - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : mainPanelRightX + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const exitY = sourceFeedFromTop ? parentPl.y + parentPl.height : parentPl.y
  const exitLaneY = sourceFeedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const derivedGapMidY = resolvePanelGapMidY(sourceHierarchyRoute, targetHierarchyRoute, null)
  const trunkY =
    derivedGapMidY ??
    corridorY ??
    targetHierarchyRoute?.corridorY ??
    sourceHierarchyRoute?.corridorY ??
    (parentPl.y + parentPl.height / 2 + childPl.y + childPl.height / 2) / 2
  const childGapY = targetFeedFromTop
    ? childPl.y - ROW_GAP / 2
    : childPl.y + childPl.height + ROW_GAP / 2
  const entryY = targetFeedFromTop ? childPl.y : childPl.y + childPl.height
  const sourceGateX =
    sourceHierarchyRoute != null
      ? (sourceHierarchyRoute.panelLeftX + sourceHierarchyRoute.panelRightX) / 2
      : parentCx
  const targetGateX =
    targetHierarchyRoute != null
      ? (targetHierarchyRoute.panelLeftX + targetHierarchyRoute.panelRightX) / 2
      : childCx
  const sourceBorderY = sourceFeedFromTop
    ? sourceHierarchyRoute?.panelBottomY
    : sourceHierarchyRoute?.panelTopY
  const targetBorderY = targetFeedFromTop
    ? targetHierarchyRoute?.panelTopY
    : targetHierarchyRoute?.panelBottomY
  // Dedicated border lanes inside panel padding (avoid title overlap on top lane).
  const TOP_INNER_LANE_OFFSET = 26
  const BOTTOM_INNER_LANE_OFFSET = 10
  const sourceInnerLaneY = sourceHierarchyRoute
    ? sourceFeedFromTop
      ? (sourceHierarchyRoute.panelBottomY ?? 0) - BOTTOM_INNER_LANE_OFFSET
      : (sourceHierarchyRoute.panelTopY ?? 0) + TOP_INNER_LANE_OFFSET
    : exitLaneY
  const targetInnerLaneY = targetHierarchyRoute
    ? targetFeedFromTop
      ? (targetHierarchyRoute.panelTopY ?? 0) + TOP_INNER_LANE_OFFSET
      : (targetHierarchyRoute.panelBottomY ?? 0) - BOTTOM_INNER_LANE_OFFSET
    : childGapY

  // Edge-row exception: if source exits toward the closest border row, skip
  // side-corridor detour and head straight to the center gate.
  const sourceBypassSideCorridor = Math.abs(exitY - sourceInnerLaneY) <= CELL_H + ROW_GAP

  const points: number[] = [parentCx, exitY, parentCx, exitLaneY]
  if (sourceBypassSideCorridor) {
    points.push(sourceGateX, exitLaneY, sourceGateX, sourceBorderY ?? sourceInnerLaneY)
  } else {
    points.push(
      sourceSideX,
      exitLaneY,
      sourceSideX,
      sourceInnerLaneY,
      sourceGateX,
      sourceInnerLaneY,
      sourceGateX,
      sourceBorderY ?? sourceInnerLaneY
    )
  }
  points.push(
    sourceGateX,
    trunkY,
    targetGateX,
    trunkY,
    targetGateX,
    targetBorderY ?? targetInnerLaneY
  )
  const directTargetRoute = [
    targetGateX,
    targetBorderY ?? targetInnerLaneY,
    targetGateX,
    childGapY,
    childCx,
    childGapY,
    childCx,
    entryY,
  ]
  const targetBypassSideCorridor = childPl.width === 0 && childPl.height === 0
  if (targetBypassSideCorridor) {
    points.push(...directTargetRoute.slice(2))
  } else {
    points.push(
      targetGateX,
      targetInnerLaneY,
      targetSideX,
      targetInnerLaneY,
      targetSideX,
      childGapY,
      childCx,
      childGapY,
      childCx,
      entryY
    )
  }
  return points
}

function resolvePanelGapMidY(
  sourceRoute: PanelHierarchyRoute | null | undefined,
  targetRoute: PanelHierarchyRoute | null | undefined,
  fallback: number | null
): number | null {
  const sourceTop = sourceRoute?.panelTopY
  const sourceBottom = sourceRoute?.panelBottomY
  const targetTop = targetRoute?.panelTopY
  const targetBottom = targetRoute?.panelBottomY
  if (sourceTop == null || sourceBottom == null || targetTop == null || targetBottom == null) {
    return fallback
  }
  if (targetTop >= sourceBottom) return (sourceBottom + targetTop) / 2
  if (sourceTop >= targetBottom) return (targetBottom + sourceTop) / 2
  return ((sourceTop + sourceBottom) / 2 + (targetTop + targetBottom) / 2) / 2
}

function resolveSinglePanelStubY(
  route: PanelHierarchyRoute | null | undefined,
  feedFromTop: boolean,
  mode: 'incoming' | 'outgoing',
  fallback: number | null
): number | null {
  const top = route?.panelTopY
  const bottom = route?.panelBottomY
  if (top == null || bottom == null) return fallback
  const STUB_MARGIN = 8
  const shouldUseTop = mode === 'incoming' ? feedFromTop : !feedFromTop
  return shouldUseTop ? top - STUB_MARGIN : bottom + STUB_MARGIN
}

function routeWspfOutgoingStub(
  sourcePl: ModulePlacement,
  sourceRoute: PanelHierarchyRoute | null,
  preferredFeedSide?: 'left' | 'right' | null,
  sourceFeedFromTop = true,
  corridorY?: number | null
): number[] {
  const parentCx = sourcePl.x + sourcePl.width / 2
  const sourceFeedSide = sourceRoute?.side ?? preferredFeedSide ?? 'left'
  const sourceExitSide: 'left' | 'right' = sourceFeedSide === 'left' ? 'right' : 'left'
  const sourceExitX = sourceRoute
    ? sourceExitSide === 'left'
      ? sourceRoute.panelLeftX + sourceRoute.panelInset / 2
      : sourceRoute.panelRightX - sourceRoute.panelInset / 2
    : sourceExitSide === 'left'
      ? sourcePl.x - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : sourcePl.x + sourcePl.width + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const exitY = sourceFeedFromTop ? sourcePl.y + sourcePl.height : sourcePl.y
  const exitLaneY = sourceFeedFromTop ? exitY + FINAL_ENTRY_OFFSET : exitY - FINAL_ENTRY_OFFSET
  const trunkY = corridorY ?? sourceRoute?.corridorY ?? exitLaneY
  return [parentCx, exitY, parentCx, exitLaneY, sourceExitX, exitLaneY, sourceExitX, trunkY]
}

function routeWspfIncomingStub(
  targetPl: ModulePlacement,
  targetRoute: PanelHierarchyRoute | null,
  preferredFeedSide?: 'left' | 'right' | null,
  targetFeedFromTop = true,
  corridorY?: number | null
): number[] {
  const childCx = targetPl.x + targetPl.width / 2
  const targetEntrySide = targetRoute?.side ?? preferredFeedSide ?? 'left'
  const targetEntryX = targetRoute
    ? targetEntrySide === 'left'
      ? targetRoute.panelLeftX + targetRoute.panelInset / 2
      : targetRoute.panelRightX - targetRoute.panelInset / 2
    : targetEntrySide === 'left'
      ? targetPl.x - (SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA)
      : targetPl.x + targetPl.width + SIDE_ROUTE_MARGIN + SINGLE_PANEL_SIDE_EXTRA
  const childGapY = targetFeedFromTop
    ? targetPl.y - ROW_GAP / 2
    : targetPl.y + targetPl.height + ROW_GAP / 2
  const entryY = targetFeedFromTop ? targetPl.y : targetPl.y + targetPl.height
  const trunkY = corridorY ?? targetRoute?.corridorY ?? childGapY
  return [targetEntryX, trunkY, targetEntryX, childGapY, childCx, childGapY, childCx, entryY]
}

/* ── Drag helpers ─────────────────────────────────────────────── */

function applyDragOverride(
  pl: ModulePlacement,
  dragOverride: { ref: PanelGridModuleRef; x: number; y: number },
  preserveRowForRefKeys?: Set<string>
): ModulePlacement {
  if (panelGridModuleRefKey(pl.ref) !== panelGridModuleRefKey(dragOverride.ref)) return pl
  const key = panelGridModuleRefKey(pl.ref)
  const keepRow = preserveRowForRefKeys?.has(key)
  const approxRow = keepRow
    ? pl.row
    : Math.max(0, Math.floor((dragOverride.y + ROW_GAP / 2) / ROW_STRIDE))
  return { ...pl, x: dragOverride.x, y: dragOverride.y, row: approxRow }
}

function isSupplyPanelPlacement(
  placement: ModulePlacement,
  supplyPanelRefKeys?: Set<string>
): boolean {
  return supplyPanelRefKeys?.has(panelGridModuleRefKey(placement.ref)) === true
}

/* ── Animation constants ──────────────────────────────────────── */

const DASH = [8, 4] as const
const DASH_TOTAL = DASH[0] + DASH[1]
const SPEED = 30
const DASH_ANIMATION_FPS = 15
const DASH_FRAME_MS = 1000 / DASH_ANIMATION_FPS

/**
 * Wires fade along each run: full opacity at the selected module, dropping to
 * FADE_MIN_OPACITY at the far (peer) end. Feeding runs brighten toward the
 * selected module; outgoing runs dim away from it — both anchor bright at the
 * selection. Tweak this single constant to taste.
 */
const FADE_MIN_OPACITY = 0.25
const WIRE_STROKE_RGB = '245, 158, 11' // #f59e0b
const HOVER_WIRE_OPACITY = 0.5
const HOVER_WIRE_FADE_MIN_OPACITY = 0.2
const HOVER_WIRE_STROKE_RGB = '122, 92, 10' // #7a5c0a

function wireRgba(opacity: number, strokeRgb = WIRE_STROKE_RGB): string {
  return `rgba(${strokeRgb}, ${opacity})`
}

function fadeFieldKey(x: number, y: number): string {
  return `${Math.round(x)}:${Math.round(y)}`
}

/**
 * Precompute a per-vertex opacity field for a focused module's wires, keyed by
 * rounded coordinate. Opacity is a linear function of distance *along the run*
 * from the focused module's terminal, so the fade spans the whole run rather
 * than resetting per segment. Built from un-merged wires (which still know
 * their endpoint + ordering) so values survive collinear merging; where runs
 * share a vertex the brightest value wins.
 */
function buildWireFadeField(
  wires: RoutedWire[],
  startOpacity = 1,
  minOpacity = FADE_MIN_OPACITY
): Map<string, number> {
  const field = new Map<string, number>()
  for (const wire of wires) {
    const pts = wire.points
    const n = Math.floor(pts.length / 2)
    if (n < 2) continue
    const cum = new Array<number>(n)
    cum[0] = 0
    let total = 0
    for (let v = 1; v < n; v++) {
      const dx = pts[v * 2]! - pts[(v - 1) * 2]!
      const dy = pts[v * 2 + 1]! - pts[(v - 1) * 2 + 1]!
      total += Math.hypot(dx, dy)
      cum[v] = total
    }
    if (total <= 0.001) continue
    // 'source' → selected module sits at the polyline start; 'target' → at the end.
    const selectedAtStart = wire.selectedEndpoint !== 'target'
    for (let v = 0; v < n; v++) {
      const distFromSelected = selectedAtStart ? cum[v]! : total - cum[v]!
      const fraction = distFromSelected / total // 0 at the selected module, 1 at the far end
      const opacity = startOpacity - (startOpacity - minOpacity) * fraction
      const key = fadeFieldKey(pts[v * 2]!, pts[v * 2 + 1]!)
      const prev = field.get(key)
      if (prev == null || opacity > prev) field.set(key, opacity)
    }
  }
  return field
}

/**
 * Konva stroke-gradient props for one straight rendered segment, fading between
 * its two endpoints' field opacities. A single stroke color would clip to one
 * opacity; the 2-stop gradient reproduces the run-long fade exactly (opacity is
 * linear in distance, the segment is straight). Returns null when there is
 * nothing to fade.
 */
function wireFadeGradient(
  points: number[],
  field: Map<string, number>,
  strokeRgb = WIRE_STROKE_RGB
): {
  strokeLinearGradientStartPoint: { x: number; y: number }
  strokeLinearGradientEndPoint: { x: number; y: number }
  strokeLinearGradientColorStops: (number | string)[]
} | null {
  if (points.length < 4) return null
  const x1 = points[0]!
  const y1 = points[1]!
  const x2 = points[points.length - 2]!
  const y2 = points[points.length - 1]!
  const o1 = field.get(fadeFieldKey(x1, y1)) ?? 1
  const o2 = field.get(fadeFieldKey(x2, y2)) ?? 1
  return {
    strokeLinearGradientStartPoint: { x: x1, y: y1 },
    strokeLinearGradientEndPoint: { x: x2, y: y2 },
    strokeLinearGradientColorStops: [0, wireRgba(o1, strokeRgb), 1, wireRgba(o2, strokeRgb)],
  }
}

const DEBUG_ROUTE_STROKES: Record<WireRouteKind, string> = {
  internal: '#22c55e', // WINT
  sharedSupplyToMainProtection: '#a855f7', // WSPM
  sharedSupplyToUniqueSupplyDevice: '#0ea5e9', // WSUD
  uniqueSupplyToMainProtection: '#f97316', // WUMP
  panelBusFeedToProtection: '#f43f5e', // WPBP
  mainProtectionToSecondaryPanelFeed: '#2563eb', // WSPF
}

function getShortVerticalStubPoints(points: number[]): number[][] {
  const stubs: number[][] = []
  for (let i = 0; i <= points.length - 4; i += 2) {
    const x1 = points[i]
    const y1 = points[i + 1]
    const x2 = points[i + 2]
    const y2 = points[i + 3]
    if (x1 == null || y1 == null || x2 == null || y2 == null || Math.abs(x1 - x2) > 0.5) {
      continue
    }
    const len = Math.abs(y2 - y1)
    if (len > 0.5 && len <= VISIBLE_STUB_MAX_LENGTH) {
      stubs.push([x1, y1, x2, y2])
    }
  }
  return stubs
}

function laneKey(value: number): string {
  return String(Math.round(value))
}

function mergeAxisAlignedWireSegments(wires: RoutedWire[]): RenderedWireSegment[] {
  type Interval = { from: number; to: number; direction: 1 | -1; kind: WireRouteKind }
  const horizontal = new Map<string, Interval[]>()
  const vertical = new Map<string, Interval[]>()
  const other: RenderedWireSegment[] = []

  for (const wire of wires) {
    for (let i = 0; i <= wire.points.length - 4; i += 2) {
      const x1 = wire.points[i]
      const y1 = wire.points[i + 1]
      const x2 = wire.points[i + 2]
      const y2 = wire.points[i + 3]
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue
      if (Math.abs(x1 - x2) <= 0.5 && Math.abs(y1 - y2) <= 0.5) continue

      if (Math.abs(y1 - y2) <= 0.5) {
        const direction = x2 >= x1 ? 1 : -1
        const key = `${laneKey(y1)}:${direction}`
        const intervals = horizontal.get(key) ?? []
        intervals.push({ from: Math.min(x1, x2), to: Math.max(x1, x2), direction, kind: wire.kind })
        horizontal.set(key, intervals)
      } else if (Math.abs(x1 - x2) <= 0.5) {
        const direction = y2 >= y1 ? 1 : -1
        const key = `${laneKey(x1)}:${direction}`
        const intervals = vertical.get(key) ?? []
        intervals.push({ from: Math.min(y1, y2), to: Math.max(y1, y2), direction, kind: wire.kind })
        vertical.set(key, intervals)
      } else {
        other.push({ points: [x1, y1, x2, y2], kind: wire.kind })
      }
    }
  }

  const merged: RenderedWireSegment[] = []
  const pushMergedIntervals = (
    groups: Map<string, Interval[]>,
    orientation: 'horizontal' | 'vertical'
  ) => {
    for (const [groupKey, intervals] of groups) {
      const [coordKey] = groupKey.split(':')
      const coord = Number(coordKey)
      const sorted = intervals
        .filter((interval) => interval.to - interval.from > 0.5)
        .sort((a, b) => a.from - b.from)
      let active: Interval | null = null
      for (const interval of sorted) {
        if (!active) {
          active = { ...interval }
          continue
        }
        if (interval.from <= active.to + 0.5) {
          active.to = Math.max(active.to, interval.to)
          continue
        }
        merged.push({
          points:
            orientation === 'horizontal'
              ? active.direction > 0
                ? [active.from, coord, active.to, coord]
                : [active.to, coord, active.from, coord]
              : active.direction > 0
                ? [coord, active.from, coord, active.to]
                : [coord, active.to, coord, active.from],
          kind: active.kind,
        })
        active = { ...interval }
      }
      if (active) {
        merged.push({
          points:
            orientation === 'horizontal'
              ? active.direction > 0
                ? [active.from, coord, active.to, coord]
                : [active.to, coord, active.from, coord]
              : active.direction > 0
                ? [coord, active.from, coord, active.to]
                : [coord, active.to, coord, active.from],
          kind: active.kind,
        })
      }
    }
  }

  pushMergedIntervals(horizontal, 'horizontal')
  pushMergedIntervals(vertical, 'vertical')
  return [...merged, ...other]
}

/* ── Component ────────────────────────────────────────────────── */

function findProtectionInProject(
  project: ProjectWithOptionalV2Electrical,
  protectionId: string
): { panel: Panel; fedPanelIds: string[] } | null {
  const walk = (p: Panel): { panel: Panel; fedPanelIds: string[] } | null => {
    const pr = p.protections.find((x) => x.id === protectionId)
    if (pr) {
      const fed = new Set<string>()
      if (pr.subPanelId) fed.add(pr.subPanelId)
      for (const c of pr.circuits ?? []) {
        for (const ep of c.endpoints ?? []) {
          if (ep.symbol === 'panel_distribution' && ep.panelId) fed.add(ep.panelId)
        }
      }
      return { panel: p, fedPanelIds: [...fed] }
    }
    for (const s of p.subPanels ?? []) {
      const hit = walk(s)
      if (hit) return hit
    }
    return null
  }
  for (const root of getProjectElectricalPanels(project)) {
    const hit = walk(root)
    if (hit) return hit
  }
  return null
}

function computeWires(
  ref: PanelGridModuleRef,
  placements: ModulePlacement[],
  panelFallback: Panel | null,
  project: ProjectWithOptionalV2Electrical,
  dragOverride?: { ref: PanelGridModuleRef; x: number; y: number } | null,
  preserveRowForRefKeys?: Set<string>,
  supplyPanelRefKeys?: Set<string>,
  hierarchyRoute?: RelationWiresProps['hierarchyRoute'],
  getHierarchyRoute?: RelationWiresProps['getHierarchyRoute'],
  mainBusRouteSide?: RelationWiresProps['mainBusRouteSide'],
  singlePanelCorridorY?: number | null,
  pathwayRegions?: PanelWirePathRegion[],
  pathwayLinks?: WirePathSegment[],
  expandPhysicalTerminal = true
): ComputeWiresResult {
  const physicalPlacement = placements.find(
    (placement) => panelGridModuleRefKey(placement.ref) === panelGridModuleRefKey(ref)
  )
  if (expandPhysicalTerminal && (physicalPlacement?.terminalStripMemberRefs?.length ?? 0) > 1) {
    const combined = physicalPlacement!.terminalStripMemberRefs!.map((memberRef) =>
      computeWires(
        memberRef,
        placements,
        panelFallback,
        project,
        dragOverride,
        preserveRowForRefKeys,
        supplyPanelRefKeys,
        hierarchyRoute,
        getHierarchyRoute,
        mainBusRouteSide,
        singlePanelCorridorY,
        pathwayRegions,
        pathwayLinks,
        false
      )
    )
    return {
      wires: combined.flatMap((result) => result.wires),
      labels: combined.flatMap((result) => result.labels),
    }
  }
  const panelForContext = findPanelContainingModuleRef(ref, project) ?? panelFallback
  if (!panelForContext) return { wires: [], labels: [] }

  const effective = dragOverride
    ? placements.map((p) => applyDragOverride(p, dragOverride, preserveRowForRefKeys))
    : placements
  const terminalOccurrences = collectTerminalStripOccurrences(project)
  const getTerminalPinLead = (
    placement: ModulePlacement,
    connectionSide: 'incoming' | 'outgoing'
  ): {
    x: number
    pinY: number
    side: 'top' | 'bottom'
    boundaryY: number
    horizontal: boolean
  } | null => {
    if (placement.junctionPanelTerminal) {
      const entersFromTop = placement.junctionPanelTerminal.feedFromTop
      const useTop = connectionSide === 'incoming' ? entersFromTop : !entersFromTop
      return {
        x: placement.x + placement.width / 2,
        pinY: placement.y + placement.height / 2,
        side: useTop ? 'top' : 'bottom',
        boundaryY: useTop ? placement.y : placement.y + placement.height,
        horizontal: false,
      }
    }
    if (placement.ref.kind !== 'trunkDevice') return null
    const device = findTrunkDeviceInProject(project, placement.ref.id)
    if (!device || (device.symbol !== 'terminal_strip' && device.type !== 'terminal_strip')) {
      return null
    }
    const stripId = getTerminalStripId(device)
    const pin =
      connectionSide === 'outgoing'
        ? getEffectiveTerminalStripOutgoingPin(project, device)
        : (getTerminalStripPin(device) ?? 1)
    const maxPin = Math.max(
      2,
      ...terminalOccurrences
        .filter((occurrence) => occurrence.stripId.toUpperCase() === stripId.toUpperCase())
        .map((occurrence) => occurrence.pin)
    )
    const reservedTop = placement.width < CELL_W * 0.55 ? 13 : 4
    const horizontal = placement.terminalStripRail != null && placement.width > CELL_W * 2
    const pinIndex = Math.min(maxPin, Math.max(1, pin))
    const pinY = horizontal
      ? placement.y + placement.height / 2
      : placement.y + reservedTop + ((placement.height - reservedTop - 4) * pinIndex) / (maxPin + 1)
    const side = pin <= maxPin / 2 ? 'top' : 'bottom'
    return {
      x: horizontal
        ? placement.x + (placement.width * pinIndex) / (maxPin + 1)
        : placement.x + placement.width / 2,
      pinY,
      side,
      boundaryY: side === 'top' ? placement.y : placement.y + placement.height,
      horizontal,
    }
  }
  const attachTerminalPinLead = (
    points: number[],
    endpoint: 'source' | 'target',
    lead: ReturnType<typeof getTerminalPinLead>
  ): number[] => {
    if (!lead) return points
    if (endpoint === 'source') {
      if (lead.horizontal && points.length >= 4) {
        return [
          lead.x,
          lead.pinY,
          lead.x,
          lead.boundaryY,
          lead.x,
          points[3]!,
          points[2]!,
          points[3]!,
          ...points.slice(4),
        ]
      }
      return [lead.x, lead.pinY, lead.x, lead.boundaryY, ...points.slice(2)]
    }
    if (lead.horizontal && points.length >= 4) {
      const previousX = points.at(-4)!
      const previousY = points.at(-3)!
      return [
        ...points.slice(0, -4),
        previousX,
        previousY,
        lead.x,
        previousY,
        lead.x,
        lead.boundaryY,
        lead.x,
        lead.pinY,
      ]
    }
    return [...points.slice(0, -2), lead.x, lead.boundaryY, lead.x, lead.pinY]
  }
  const simplifyAttachedLead = (points: number[]): number[] => {
    const pairs: Array<{ x: number; y: number }> = []
    for (let index = 0; index < points.length; index += 2) {
      const point = { x: points[index]!, y: points[index + 1]! }
      const previous = pairs.at(-1)
      if (!previous || previous.x !== point.x || previous.y !== point.y) pairs.push(point)
    }
    if (pairs.length <= 2) return pairs.flatMap((point) => [point.x, point.y])
    const simplified = [pairs[0]!]
    for (let index = 1; index < pairs.length - 1; index += 1) {
      const previous = simplified.at(-1)!
      const current = pairs[index]!
      const next = pairs[index + 1]!
      if (
        (previous.x === current.x && current.x === next.x) ||
        (previous.y === current.y && current.y === next.y)
      ) {
        continue
      }
      simplified.push(current)
    }
    simplified.push(pairs.at(-1)!)
    return simplified.flatMap((point) => [point.x, point.y])
  }
  const placementByKey = new Map<string, ModulePlacement>()
  for (const placement of effective) {
    placementByKey.set(panelGridModuleRefKey(placement.ref), placement)
    for (const memberRef of placement.terminalStripMemberRefs ?? []) {
      placementByKey.set(panelGridModuleRefKey(memberRef), { ...placement, ref: memberRef })
    }
  }
  const rawTargetPlacement = placementByKey.get(panelGridModuleRefKey(ref))
  const targetPlacement = rawTargetPlacement
  if (!targetPlacement) return { wires: [], labels: [] }

  const { parentRefs, childRefs, childPanelIds } = getRelationEdges(ref, panelForContext, project)
  const parentPls = parentRefs
    .map((r) => placementByKey.get(panelGridModuleRefKey(r)))
    .filter((p): p is ModulePlacement => p != null)
  const childPls = childRefs
    .map((r) => placementByKey.get(panelGridModuleRefKey(r)))
    .filter((p): p is ModulePlacement => p != null)

  const result: RoutedWire[] = []
  const labels: RoutedWireLabel[] = []
  const hasBoth = parentPls.length > 0 && childPls.length > 0
  const inOff = hasBoth ? -WIRE_SPACING / 2 : 0
  const outOff = hasBoth ? WIRE_SPACING / 2 : 0
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)

  const supplyDevices =
    panelForContext.isMain && installation
      ? (getPanelFeedProjection(installation, panels, panelForContext)?.devices ?? [])
      : []
  const lastSupplyDeviceId = getPanelMainBusSupplyDevice(supplyDevices)?.id ?? null

  const lastSupplyRef: PanelGridModuleRef | null = lastSupplyDeviceId
    ? { kind: 'trunkDevice', id: lastSupplyDeviceId, scope: 'supply' }
    : null
  const lastSupplyKey = lastSupplyRef ? panelGridModuleRefKey(lastSupplyRef) : null
  const lastSupplyInSupplyPanel =
    lastSupplyKey != null && supplyPanelRefKeys != null && supplyPanelRefKeys.has(lastSupplyKey)
  const panelFeed = getPanelIncomingMainBusFeedDevice(panelForContext)

  const sharedSupplyTrunkDevices =
    panelForContext.isMain === true && installation
      ? (getPanelFeedProjection(installation, panels, panelForContext)?.sharedFeed.trunkDevices ??
        [])
      : []
  const sharedSupplyTrunkIds = new Set(
    sharedSupplyTrunkDevices
      .filter(
        (device) =>
          device.type !== 'junction_box' &&
          device.type !== 'junction_panel' &&
          device.type !== 'terminal_strip'
      )
      .map((device) => device.id)
  )

  const isSharedSupplyTrunkRef = (r: PanelGridModuleRef | undefined | null): boolean =>
    r?.kind === 'trunkDevice' && r.scope === 'supply' && sharedSupplyTrunkIds.has(r.id)
  const isMspfProtectionEdge = (
    sourceRef: PanelGridModuleRef,
    targetRef: PanelGridModuleRef,
    targetPanel: Panel
  ): boolean => {
    if (sourceRef.kind !== 'protection' || targetRef.kind !== 'protection') return false
    const source = findProtectionInProject(project, sourceRef.id)
    const target = findProtectionInProject(project, targetRef.id)
    if (!source || !target) return false
    return source.fedPanelIds.includes(targetPanel.id) && target.panel.id === targetPanel.id
  }

  // Use panel content bounds so the side corridor stays truly at row edges.
  const cols = panelForContext.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
  let mainPanelLeftX = hierarchyRoute ? hierarchyRoute.panelLeftX + hierarchyRoute.panelInset : 0
  let mainPanelRightX = hierarchyRoute
    ? hierarchyRoute.panelRightX - hierarchyRoute.panelInset
    : cols * CELL_W
  if (!hierarchyRoute && effective.length > 0) {
    const mainPlacements = supplyPanelRefKeys
      ? effective.filter((p) => !supplyPanelRefKeys.has(panelGridModuleRefKey(p.ref)))
      : effective
    if (mainPlacements.length > 0) {
      mainPanelLeftX = Math.min(...mainPlacements.map((p) => p.x))
      mainPanelRightX = Math.max(...mainPlacements.map((p) => p.x + p.width))
    }
  }
  // Fallback to placement extents if needed.
  if (
    (!Number.isFinite(mainPanelRightX) || mainPanelRightX <= mainPanelLeftX) &&
    effective.length > 0
  ) {
    const mainPlacements = supplyPanelRefKeys
      ? effective.filter((p) => !supplyPanelRefKeys.has(panelGridModuleRefKey(p.ref)))
      : effective
    if (mainPlacements.length > 0) {
      mainPanelLeftX = Math.min(...mainPlacements.map((p) => p.x))
      mainPanelRightX = Math.max(...mainPlacements.map((p) => p.x + p.width))
    }
  }
  const supplyPlacements = supplyPanelRefKeys
    ? effective.filter((p) => supplyPanelRefKeys.has(panelGridModuleRefKey(p.ref)))
    : []
  const supplyToMainCorridorY = (() => {
    if (singlePanelCorridorY != null) return singlePanelCorridorY
    if (hierarchyRoute) return hierarchyRoute.corridorY
    if (supplyPlacements.length === 0) return null
    const mainPlacements = supplyPanelRefKeys
      ? effective.filter((p) => !supplyPanelRefKeys.has(panelGridModuleRefKey(p.ref)))
      : effective
    if (mainPlacements.length === 0) return null
    const supplyTop = Math.min(...supplyPlacements.map((p) => p.y))
    const supplyBottom = Math.max(...supplyPlacements.map((p) => p.y + p.height))
    const mainTop = Math.min(...mainPlacements.map((p) => p.y))
    const mainBottom = Math.max(...mainPlacements.map((p) => p.y + p.height))
    if (supplyBottom <= mainTop) return (supplyBottom + mainTop) / 2
    if (mainBottom <= supplyTop) return (mainBottom + supplyTop) / 2
    return null
  })()

  const incomingStartIndex = result.length
  for (const pl of parentPls) {
    const wireStartIndex = result.length
    const sourcePanel = findPanelContainingModuleRef(pl.ref, project) ?? panelForContext
    const sourceHr = getHierarchyRoute?.(sourcePanel) ?? hierarchyRoute ?? null
    const downstreamPanel =
      findPanelContainingModuleRef(targetPlacement.ref, project) ?? panelForContext
    const edgeHr = getHierarchyRoute?.(downstreamPanel) ?? hierarchyRoute ?? null
    const mLeft = edgeHr ? edgeHr.panelLeftX + edgeHr.panelInset : mainPanelLeftX
    const mRight = edgeHr ? edgeHr.panelRightX - edgeHr.panelInset : mainPanelRightX
    const edgeCorridorY = edgeHr != null ? edgeHr.corridorY : supplyToMainCorridorY
    const edgeFeedTop =
      edgeHr != null ? edgeHr.feedFromTop : (panelForContext.gridView?.feedFromTop ?? false)
    const edgeSide = edgeHr?.side ?? mainBusRouteSide

    const parentIsSharedSupplyTrunk = isSharedSupplyTrunkRef(pl.ref)
    const parentIsSupplyTrunk = pl.ref.kind === 'trunkDevice' && pl.ref.scope === 'supply'
    const parentIsSupplyInSupplyPanel =
      parentIsSupplyTrunk && isSupplyPanelPlacement(pl, supplyPanelRefKeys)
    const targetIsMainProtection =
      targetPlacement.ref.kind === 'protection' &&
      !isSupplyPanelPlacement(targetPlacement, supplyPanelRefKeys)
    const targetIsSupplyTrunk =
      targetPlacement.ref.kind === 'trunkDevice' && targetPlacement.ref.scope === 'supply'
    const targetIsSharedSupplyTrunk = isSharedSupplyTrunkRef(targetPlacement.ref)
    const parentIsLastSupply =
      panelForContext.isMain &&
      pl.ref.kind === 'trunkDevice' &&
      pl.ref.scope === 'supply' &&
      pl.ref.id === lastSupplyDeviceId
    const supplyToMainCorridorRoute = parentIsSupplyTrunk && targetIsMainProtection
    const parentIsPanelBusFeeder =
      pl.ref.kind === 'trunkDevice' &&
      pl.ref.scope === 'circuit' &&
      pl.ref.circuitId === panelFeed?.circuit.id &&
      pl.ref.id === panelFeed?.device.id &&
      targetPlacement.ref.kind === 'protection'
    // Upstream MCB (parent board) → local PANEL/MCIR incoming trunk (same corridor style)
    const parentIsUpstreamFeederToIncomingTrunk =
      pl.ref.kind === 'protection' &&
      targetPlacement.ref.kind === 'trunkDevice' &&
      targetPlacement.ref.scope === 'circuit' &&
      panelFeed != null &&
      targetPlacement.ref.circuitId === panelFeed.circuit.id &&
      targetPlacement.ref.id === panelFeed.incomingDevice.id
    const parentIsInternalProtectionToProtection =
      pl.ref.kind === 'protection' &&
      targetPlacement.ref.kind === 'protection' &&
      pl.row !== targetPlacement.row
    const parentIsMspf = isMspfProtectionEdge(pl.ref, targetPlacement.ref, downstreamPanel)

    if (
      edgeHr &&
      parentIsSharedSupplyTrunk &&
      targetIsMainProtection &&
      !parentIsSupplyInSupplyPanel
    ) {
      result.push({
        points: routeSharedSupplyToMainPanel(pl, targetPlacement, edgeHr),
        kind: 'sharedSupplyToMainProtection', // WSPM
      })
    } else if (parentIsSharedSupplyTrunk && targetIsSupplyTrunk && !targetIsSharedSupplyTrunk) {
      // Shared corridor trunk device -> unique supply trunk device inside the supply panel.
      result.push({
        points: routeSharedSupplyToSupplyDevice(
          pl,
          targetPlacement,
          mLeft,
          mRight,
          edgeSide,
          edgeHr,
          edgeCorridorY,
          edgeFeedTop
        ),
        kind: 'sharedSupplyToUniqueSupplyDevice', // WSUD
      })
    } else if (parentIsMspf) {
      const wspfFeedFromTop =
        sourceHr != null ? sourceHr.feedFromTop : (sourcePanel.gridView?.feedFromTop ?? edgeFeedTop)
      result.push({
        points: routeMainProtectionToSecondaryPanelFeed(
          pl,
          targetPlacement,
          mLeft,
          mRight,
          edgeSide,
          sourceHr,
          edgeHr,
          edgeCorridorY,
          wspfFeedFromTop,
          wspfFeedFromTop
        ),
        kind: 'mainProtectionToSecondaryPanelFeed', // WSPF
        overlapGroup: `panel-link:${sourcePanel.id}->${downstreamPanel.id}`,
      })
    } else if (supplyToMainCorridorRoute) {
      const useSharedSupplyRoute = parentIsSharedSupplyTrunk
      result.push({
        points: useSharedSupplyRoute
          ? routeSupplyPanelTrunkToMainBus(
              pl,
              targetPlacement,
              mLeft,
              mRight,
              edgeSide,
              edgeCorridorY,
              edgeFeedTop
            )
          : routeUniqueSupplyToMainBusInside(
              pl,
              targetPlacement,
              mLeft,
              mRight,
              edgeSide,
              edgeHr,
              edgeFeedTop
            ),
        kind: parentIsSharedSupplyTrunk
          ? 'sharedSupplyToMainProtection' // WSPM
          : 'uniqueSupplyToMainProtection', // WUMP
      })
    } else if (parentIsUpstreamFeederToIncomingTrunk) {
      const wpbpFeedFromTop =
        sourceHr != null ? sourceHr.feedFromTop : (sourcePanel.gridView?.feedFromTop ?? edgeFeedTop)
      result.push({
        points: routeMainProtectionToSecondaryPanelFeed(
          pl,
          targetPlacement,
          mLeft,
          mRight,
          edgeSide,
          sourceHr,
          edgeHr,
          edgeCorridorY,
          wpbpFeedFromTop,
          wpbpFeedFromTop
        ),
        kind: 'panelBusFeedToProtection', // WPBP
      })
    } else if (parentIsPanelBusFeeder) {
      // Local PANEL-feed trunk -> local bus MPRO fanout is internal panel wiring.
      result.push({
        points: routeInternalFromPanelBusFeeder(pl, targetPlacement, mLeft, mRight, edgeFeedTop),
        kind: 'internal', // WINT
      })
    } else if (parentIsInternalProtectionToProtection) {
      result.push({
        points: routeInternalByFeedDirection(
          pl,
          targetPlacement,
          mLeft,
          mRight,
          edgeFeedTop,
          inOff
        ),
        kind: 'internal', // WINT
      })
    } else if (parentIsLastSupply && lastSupplyInSupplyPanel) {
      result.push({
        points: routeLastSupplyToSupplyPanel(pl, targetPlacement, mLeft, mRight),
        kind:
          targetPlacement.ref.kind === 'protection'
            ? 'uniqueSupplyToMainProtection' // WUMP
            : 'sharedSupplyToUniqueSupplyDevice', // WSUD
      })
    } else {
      result.push({
        points: routeInternalByFeedDirection(
          pl,
          targetPlacement,
          mLeft,
          mRight,
          edgeFeedTop,
          inOff
        ),
        kind: 'internal',
      }) // WINT
    }
    for (let index = wireStartIndex; index < result.length; index += 1) {
      result[index]!.remotePlacement = pl
    }
  }
  for (let index = incomingStartIndex; index < result.length; index += 1) {
    result[index]!.selectedEndpoint = 'target'
  }

  const isLastSupplyDevice =
    panelForContext.isMain &&
    ref.kind === 'trunkDevice' &&
    ref.scope === 'supply' &&
    lastSupplyDeviceId != null &&
    ref.id === lastSupplyDeviceId
  const isPanelBusFeeder =
    ref.kind === 'trunkDevice' &&
    ref.scope === 'circuit' &&
    ref.circuitId === panelFeed?.circuit.id &&
    ref.id === panelFeed?.device.id

  const outgoingStartIndex = result.length
  for (const pl of childPls) {
    const wireStartIndex = result.length
    const sourcePanel =
      findPanelContainingModuleRef(targetPlacement.ref, project) ?? panelForContext
    const sourceHr = getHierarchyRoute?.(sourcePanel) ?? hierarchyRoute ?? null
    const downstreamPanel = findPanelContainingModuleRef(pl.ref, project) ?? panelForContext
    const edgeHr = getHierarchyRoute?.(downstreamPanel) ?? hierarchyRoute ?? null
    const mLeft = edgeHr ? edgeHr.panelLeftX + edgeHr.panelInset : mainPanelLeftX
    const mRight = edgeHr ? edgeHr.panelRightX - edgeHr.panelInset : mainPanelRightX
    const edgeCorridorY = edgeHr != null ? edgeHr.corridorY : supplyToMainCorridorY
    const edgeFeedTop =
      edgeHr != null ? edgeHr.feedFromTop : (panelForContext.gridView?.feedFromTop ?? false)
    const edgeSide = edgeHr?.side ?? mainBusRouteSide

    const sourceIsSharedSupplyTrunk = isSharedSupplyTrunkRef(targetPlacement.ref)
    const sourceIsSupplyTrunk =
      targetPlacement.ref.kind === 'trunkDevice' && targetPlacement.ref.scope === 'supply'
    const childIsMainProtection =
      pl.ref.kind === 'protection' && !isSupplyPanelPlacement(pl, supplyPanelRefKeys)
    const childPanelFeed = getPanelIncomingMainBusFeedDevice(downstreamPanel)
    const childIsDownstreamIncomingTrunk =
      targetPlacement.ref.kind === 'protection' &&
      pl.ref.kind === 'trunkDevice' &&
      pl.ref.scope === 'circuit' &&
      childPanelFeed != null &&
      pl.ref.circuitId === childPanelFeed.circuit.id &&
      pl.ref.id === childPanelFeed.incomingDevice.id
    const supplyToMainCorridorRoute = sourceIsSupplyTrunk && childIsMainProtection
    const childIsMspf = isMspfProtectionEdge(targetPlacement.ref, pl.ref, downstreamPanel)
    const childIsInternalProtectionToProtection =
      targetPlacement.ref.kind === 'protection' &&
      pl.ref.kind === 'protection' &&
      targetPlacement.row !== pl.row

    if (
      edgeHr &&
      sourceIsSharedSupplyTrunk &&
      childIsMainProtection &&
      !isSupplyPanelPlacement(targetPlacement, supplyPanelRefKeys)
    ) {
      result.push({
        points: routeSharedSupplyToMainPanel(targetPlacement, pl, edgeHr),
        kind: 'sharedSupplyToMainProtection', // WSPM
      })
    } else if (
      sourceIsSharedSupplyTrunk &&
      pl.ref.kind === 'trunkDevice' &&
      pl.ref.scope === 'supply' &&
      !isSharedSupplyTrunkRef(pl.ref)
    ) {
      result.push({
        points: routeSharedSupplyToSupplyDevice(
          targetPlacement,
          pl,
          mLeft,
          mRight,
          edgeSide,
          edgeHr,
          edgeCorridorY,
          edgeFeedTop
        ),
        kind: 'sharedSupplyToUniqueSupplyDevice', // WSUD
      })
    } else if (childIsMspf) {
      const wspfFeedFromTop =
        sourceHr != null ? sourceHr.feedFromTop : (sourcePanel.gridView?.feedFromTop ?? edgeFeedTop)
      result.push({
        points: routeMainProtectionToSecondaryPanelFeed(
          targetPlacement,
          pl,
          mLeft,
          mRight,
          edgeSide,
          sourceHr,
          edgeHr,
          edgeCorridorY,
          wspfFeedFromTop,
          wspfFeedFromTop
        ),
        kind: 'mainProtectionToSecondaryPanelFeed', // WSPF
        overlapGroup: `panel-link:${sourcePanel.id}->${downstreamPanel.id}`,
      })
    } else if (childIsDownstreamIncomingTrunk) {
      const wpbpFeedFromTop =
        sourceHr != null ? sourceHr.feedFromTop : (sourcePanel.gridView?.feedFromTop ?? edgeFeedTop)
      result.push({
        points: routeMainProtectionToSecondaryPanelFeed(
          targetPlacement,
          pl,
          mLeft,
          mRight,
          edgeSide,
          sourceHr,
          edgeHr,
          edgeCorridorY,
          wpbpFeedFromTop,
          wpbpFeedFromTop
        ),
        kind: 'panelBusFeedToProtection', // WPBP
      })
    } else if (supplyToMainCorridorRoute) {
      const useSharedSupplyRoute = sourceIsSharedSupplyTrunk
      result.push({
        points: useSharedSupplyRoute
          ? routeSupplyPanelTrunkToMainBus(
              targetPlacement,
              pl,
              mLeft,
              mRight,
              edgeSide,
              edgeCorridorY,
              edgeFeedTop
            )
          : routeUniqueSupplyToMainBusInside(
              targetPlacement,
              pl,
              mLeft,
              mRight,
              edgeSide,
              edgeHr,
              edgeFeedTop
            ),
        kind: sourceIsSharedSupplyTrunk
          ? 'sharedSupplyToMainProtection' // WSPM
          : 'uniqueSupplyToMainProtection', // WUMP
      })
    } else if (isPanelBusFeeder && pl.ref.kind === 'protection') {
      result.push({
        points: routeInternalFromPanelBusFeeder(targetPlacement, pl, mLeft, mRight, edgeFeedTop),
        kind: 'internal', // WINT
      })
    } else if (childIsInternalProtectionToProtection) {
      result.push({
        points: routeInternalByFeedDirection(
          targetPlacement,
          pl,
          mLeft,
          mRight,
          edgeFeedTop,
          outOff
        ),
        kind: 'internal', // WINT
      })
    } else if (isLastSupplyDevice && lastSupplyInSupplyPanel) {
      result.push({
        points: routeLastSupplyToSupplyPanel(targetPlacement, pl, mLeft, mRight),
        kind:
          pl.ref.kind === 'protection'
            ? 'uniqueSupplyToMainProtection' // WUMP
            : 'sharedSupplyToUniqueSupplyDevice', // WSUD
      })
    } else {
      result.push({
        points: routeInternalByFeedDirection(
          targetPlacement,
          pl,
          mLeft,
          mRight,
          edgeFeedTop,
          outOff
        ),
        kind: 'internal',
      }) // WINT
    }
    for (let index = wireStartIndex; index < result.length; index += 1) {
      result[index]!.remotePlacement = pl
    }
  }
  for (let index = outgoingStartIndex; index < result.length; index += 1) {
    result[index]!.selectedEndpoint = 'source'
  }
  if (targetPlacement.ref.kind === 'protection') {
    const sourceRoute = getHierarchyRoute?.(panelForContext) ?? hierarchyRoute ?? null
    const sourceFeedFromTop =
      sourceRoute?.feedFromTop ?? panelForContext.gridView?.feedFromTop ?? false
    for (const childPanelId of childPanelIds) {
      const childPanel = findPanelById(panels, childPanelId)
      if (!childPanel) continue
      const targetRoute = getHierarchyRoute?.(childPanel) ?? null
      const gapMidY = resolvePanelGapMidY(
        sourceRoute,
        targetRoute,
        singlePanelCorridorY ?? hierarchyRoute?.corridorY ?? null
      )
      if (!targetRoute) {
        result.push({
          points: routeWspfOutgoingStub(
            targetPlacement,
            sourceRoute,
            mainBusRouteSide,
            sourceFeedFromTop,
            resolveSinglePanelStubY(sourceRoute, sourceFeedFromTop, 'outgoing', gapMidY)
          ),
          kind: 'mainProtectionToSecondaryPanelFeed',
          selectedEndpoint: 'source',
        })
        continue
      }

      const targetFeedFromTop = targetRoute.feedFromTop
      const targetEntryY = targetFeedFromTop
        ? (targetRoute.panelTopY ?? targetRoute.corridorY) + targetRoute.panelInset
        : (targetRoute.panelBottomY ?? targetRoute.corridorY) - targetRoute.panelInset
      const targetAnchor: ModulePlacement = {
        ref: targetPlacement.ref,
        x: (targetRoute.panelLeftX + targetRoute.panelRightX) / 2,
        y: targetEntryY,
        width: 0,
        height: 0,
        row: 0,
        col: 0,
      }
      result.push({
        points: routeMainProtectionToSecondaryPanelFeed(
          targetPlacement,
          targetAnchor,
          mainPanelLeftX,
          mainPanelRightX,
          mainBusRouteSide,
          sourceRoute,
          targetRoute,
          gapMidY,
          sourceFeedFromTop,
          targetFeedFromTop
        ),
        kind: 'mainProtectionToSecondaryPanelFeed',
        selectedEndpoint: 'source',
      })
    }
  }
  const missingParentRefs = parentRefs.filter((r) => !placementByKey.has(panelGridModuleRefKey(r)))
  const missingChildRefs = childRefs.filter((r) => !placementByKey.has(panelGridModuleRefKey(r)))
  if (targetPlacement.ref.kind === 'protection') {
    const targetPanel =
      findPanelContainingModuleRef(targetPlacement.ref, project) ?? panelForContext
    const targetRoute = getHierarchyRoute?.(targetPanel) ?? hierarchyRoute ?? null
    for (const r of missingChildRefs) {
      const remotePanel = findPanelContainingModuleRef(r, project)
      if (!remotePanel || !isMspfProtectionEdge(targetPlacement.ref, r, remotePanel)) continue
      const remoteRoute = getHierarchyRoute?.(remotePanel) ?? null
      const sourceFeedTop = targetRoute?.feedFromTop ?? targetPanel.gridView?.feedFromTop ?? false
      const gapMidY = resolvePanelGapMidY(
        targetRoute,
        remoteRoute,
        singlePanelCorridorY ?? hierarchyRoute?.corridorY ?? null
      )
      const stubCorridorY = resolveSinglePanelStubY(targetRoute, sourceFeedTop, 'outgoing', gapMidY)
      const points = routeWspfOutgoingStub(
        targetPlacement,
        targetRoute,
        mainBusRouteSide,
        sourceFeedTop,
        stubCorridorY
      )
      result.push({
        points,
        kind: 'mainProtectionToSecondaryPanelFeed',
        selectedEndpoint: 'source',
      })
      const anchorY = points[points.length - 1] ?? 0
      const placeAbove = targetRoute?.panelTopY != null && anchorY < targetRoute.panelTopY
      labels.push({
        text: remotePanel.name,
        anchorX: (points[points.length - 2] ?? 0) + 6,
        anchorY,
        placeAbove,
      })
    }
    for (const r of missingParentRefs) {
      const remotePanel = findPanelContainingModuleRef(r, project)
      if (!remotePanel || !isMspfProtectionEdge(r, targetPlacement.ref, targetPanel)) continue
      const remoteRoute = getHierarchyRoute?.(remotePanel) ?? null
      const targetFeedTop = targetRoute?.feedFromTop ?? targetPanel.gridView?.feedFromTop ?? false
      const gapMidY = resolvePanelGapMidY(
        remoteRoute,
        targetRoute,
        singlePanelCorridorY ?? hierarchyRoute?.corridorY ?? null
      )
      const stubCorridorY = resolveSinglePanelStubY(targetRoute, targetFeedTop, 'incoming', gapMidY)
      const points = routeWspfIncomingStub(
        targetPlacement,
        targetRoute,
        mainBusRouteSide,
        targetFeedTop,
        stubCorridorY
      )
      result.push({
        points,
        kind: 'mainProtectionToSecondaryPanelFeed',
        selectedEndpoint: 'target',
      })
      const anchorY = points[1] ?? 0
      const placeAbove = targetRoute?.panelTopY != null && anchorY < targetRoute.panelTopY
      labels.push({
        text: remotePanel.name,
        anchorX: (points[0] ?? 0) + 6,
        anchorY,
        placeAbove,
      })
    }
  }
  const routeCandidate = (candidate: ModulePortCandidate) => {
    const reservedRoutes: Array<{ segment: WirePathSegment; overlapGroup?: string }> = []
    let score = candidate.preferencePenalty
    const wires = candidate.wires.map((wire) => {
      const wireOptions = (() => {
        if (!wire.remotePlacement || !wire.selectedEndpoint) {
          return [wire]
        }
        const remoteEndpoint = wire.selectedEndpoint === 'source' ? 'target' : 'source'
        const remoteCenterX = wire.remotePlacement.x + wire.remotePlacement.width / 2
        const selectedPointIndex = wire.selectedEndpoint === 'source' ? 1 : wire.points.length - 1
        const selectedTerminalY = wire.points[selectedPointIndex]
        const selectedConnectionSide = wire.selectedEndpoint === 'source' ? 'outgoing' : 'incoming'
        const selectedTerminalLead = getTerminalPinLead(targetPlacement, selectedConnectionSide)
        const selectedSide =
          selectedTerminalY === targetPlacement.y
            ? 'top'
            : selectedTerminalY === targetPlacement.y + targetPlacement.height
              ? 'bottom'
              : null
        // A same-row relation belongs to one horizontal corridor end-to-end.
        // Letting its remote terminal choose the opposite side creates a large
        // loop around the panel even though both modules touch the same lane.
        const lockedSameRowRegion =
          selectedSide && !selectedTerminalLead
            ? resolveSameRowLockedRegion(
                targetPlacement,
                wire.remotePlacement,
                selectedSide,
                pathwayRegions
              )
            : undefined
        const remoteConnectionSide = remoteEndpoint === 'source' ? 'outgoing' : 'incoming'
        const remoteTerminalLead = getTerminalPinLead(wire.remotePlacement, remoteConnectionSide)
        const remoteSides: Array<'top' | 'bottom'> =
          remoteTerminalLead != null
            ? [remoteTerminalLead.side]
            : lockedSameRowRegion && selectedSide
              ? [selectedSide]
              : ['top', 'bottom']
        return remoteSides.map((side) => {
          const option = { ...wire, points: [...wire.points] }
          applyWireTerminal(option, remoteEndpoint, wire.remotePlacement!, side, remoteCenterX)
          return option
        })
      })()
      const routedOptions = wireOptions.map((option) => {
        const lockedSameRowRegion = (() => {
          const selectedConnectionSide =
            option.selectedEndpoint === 'source' ? 'outgoing' : 'incoming'
          if (getTerminalPinLead(targetPlacement, selectedConnectionSide)) return undefined
          const remoteEndpoint = option.selectedEndpoint === 'source' ? 'target' : 'source'
          const remoteConnectionSide = remoteEndpoint === 'source' ? 'outgoing' : 'incoming'
          if (
            option.remotePlacement &&
            getTerminalPinLead(option.remotePlacement, remoteConnectionSide)
          ) {
            return undefined
          }
          if (
            !option.remotePlacement ||
            !option.selectedEndpoint ||
            option.remotePlacement.row !== targetPlacement.row
          ) {
            return undefined
          }
          const selectedTerminalIndex =
            option.selectedEndpoint === 'source' ? 1 : option.points.length - 1
          const selectedTerminalY = option.points[selectedTerminalIndex]
          const selectedSide =
            selectedTerminalY === targetPlacement.y
              ? 'top'
              : selectedTerminalY === targetPlacement.y + targetPlacement.height
                ? 'bottom'
                : null
          return selectedSide
            ? resolveSameRowLockedRegion(
                targetPlacement,
                option.remotePlacement,
                selectedSide,
                pathwayRegions
              )
            : undefined
        })()
        const reservedSegments = reservedRoutes
          .filter(
            (reserved) => !option.overlapGroup || reserved.overlapGroup !== option.overlapGroup
          )
          .map((reserved) => reserved.segment)
        const routed = routePanelWire(option.points, effective, {
          preserveGuideTurns: pathwayRegions == null || pathwayRegions.length === 0,
          reservedSegments,
          pathwayRegions: lockedSameRowRegion ?? pathwayRegions,
          pathwayLinks: lockedSameRowRegion ? undefined : pathwayLinks,
        })
        return {
          wire: option,
          routed,
          score: routed.debug.usedFallback ? 1_000_000 : routed.debug.cost,
        }
      })
      const chosen = routedOptions.reduce((best, option) =>
        option.score < best.score ? option : best
      )
      score += chosen.score
      for (let index = 0; index <= chosen.routed.points.length - 4; index += 2) {
        reservedRoutes.push({
          overlapGroup: chosen.wire.overlapGroup,
          segment: {
            from: {
              x: chosen.routed.points[index]!,
              y: chosen.routed.points[index + 1]!,
            },
            to: {
              x: chosen.routed.points[index + 2]!,
              y: chosen.routed.points[index + 3]!,
            },
          },
        })
      }
      return {
        ...chosen.wire,
        points: (() => {
          if (!chosen.wire.selectedEndpoint) return chosen.routed.points
          const selectedConnectionSide =
            chosen.wire.selectedEndpoint === 'source' ? 'outgoing' : 'incoming'
          const selectedLead = getTerminalPinLead(targetPlacement, selectedConnectionSide)
          let points = attachTerminalPinLead(
            chosen.routed.points,
            chosen.wire.selectedEndpoint,
            selectedLead
          )
          let hasHorizontalLead = selectedLead?.horizontal === true
          if (chosen.wire.remotePlacement) {
            const remoteEndpoint = chosen.wire.selectedEndpoint === 'source' ? 'target' : 'source'
            const remoteConnectionSide = remoteEndpoint === 'source' ? 'outgoing' : 'incoming'
            const remoteLead = getTerminalPinLead(chosen.wire.remotePlacement, remoteConnectionSide)
            points = attachTerminalPinLead(points, remoteEndpoint, remoteLead)
            hasHorizontalLead ||= remoteLead?.horizontal === true
          }
          return hasHorizontalLead ? simplifyAttachedLead(points) : points
        })(),
        pathDebug: chosen.routed.debug,
      }
    })
    // Complete feed/supply paths must not win merely because a crossing or
    // shared run is a little shorter. Prefer a conflict-free corridor split.
    score += countWirePathConflicts(wires) * WIRE_CONFLICT_PENALTY
    return { wires, score }
  }
  const selectedSupplyDevice =
    ref.kind === 'trunkDevice' && ref.scope === 'supply'
      ? supplyDevices.find((device) => device.id === ref.id)
      : undefined
  const selectedIncomingLead = getTerminalPinLead(targetPlacement, 'incoming')
  const selectedOutgoingLead = getTerminalPinLead(targetPlacement, 'outgoing')
  const modulePortCandidates = buildModulePortCandidates(
    result,
    targetPlacement,
    selectedSupplyDevice?.symbol === 'source_changeover' ||
      (result.some((wire) => wire.selectedEndpoint === 'target') &&
        result.some((wire) => wire.selectedEndpoint === 'source')),
    selectedIncomingLead?.side,
    selectedOutgoingLead?.side,
    selectedIncomingLead?.horizontal &&
      result.filter((wire) => wire.selectedEndpoint === 'target').length === 1
      ? selectedIncomingLead.x
      : undefined,
    selectedOutgoingLead?.horizontal &&
      result.filter((wire) => wire.selectedEndpoint === 'source').length === 1
      ? selectedOutgoingLead.x
      : undefined
  )
  const bundledCandidates = modulePortCandidates.filter(candidateKeepsOverlapGroupsTogether)
  const routedCandidates = (
    bundledCandidates.length > 0 ? bundledCandidates : modulePortCandidates
  ).map(routeCandidate)
  const routedResult = routedCandidates.reduce((best, candidate) =>
    candidate.score < best.score ? candidate : best
  )
  return { wires: routedResult.wires, labels }
}

export default function RelationWires({
  placements,
  selectedRef,
  selectedConnectionSide,
  selectedConnectionPeerRef,
  hoveredRef,
  panel,
  project,
  dragOverride,
  preserveRowForRefKeys,
  supplyPanelRefKeys,
  ghost = false,
  animateDash = true,
  hierarchyRoute = null,
  getHierarchyRoute,
  mainBusRouteSide = null,
  singlePanelCorridorY = null,
  debugMode = false,
  pathwayRegions,
  pathwayLinks,
}: RelationWiresProps) {
  const isMarqueeSelecting = useIsMarqueeSelecting()
  const selectedItemCount = useUIStore((state) => state.selection.ids.length)
  const suppressRelationWires = shouldSuppressPanelRelationWires(
    isMarqueeSelecting,
    selectedItemCount
  )
  const strokeColor = '#f59e0b'
  const strokeWidth = 2
  const lineRefs = useRef<(Konva.Line | null)[]>([])
  const dashFrameRef = useRef<number | null>(null)
  const dashOffsetRef = useRef(0)
  const lastDashTickRef = useRef(0)
  const pageVisibleRef = useRef(typeof document === 'undefined' ? true : !document.hidden)
  const canvasVisibleRef = useRef(true)
  const visibilityObserverRef = useRef<IntersectionObserver | null>(null)

  const wireState = useMemo(() => {
    if (suppressRelationWires) return { wires: [], labels: [] as RoutedWireLabel[] }
    if (!selectedRef || !project) return { wires: [], labels: [] as RoutedWireLabel[] }
    const result = computeWires(
      selectedRef,
      placements,
      panel,
      project,
      dragOverride,
      preserveRowForRefKeys,
      supplyPanelRefKeys,
      hierarchyRoute,
      getHierarchyRoute,
      mainBusRouteSide,
      singlePanelCorridorY,
      pathwayRegions,
      pathwayLinks,
      selectedConnectionSide == null
    )
    if (!selectedConnectionSide) return result
    const selectedEndpoint = selectedConnectionSide === 'incoming' ? 'target' : 'source'
    const peerKey = selectedConnectionPeerRef
      ? panelGridModuleRefKey(selectedConnectionPeerRef)
      : null
    return {
      wires: result.wires.filter(
        (wire) =>
          wire.selectedEndpoint === selectedEndpoint &&
          (peerKey == null ||
            (wire.remotePlacement != null &&
              panelGridModuleRefKey(wire.remotePlacement.ref) === peerKey))
      ),
      labels: [],
    }
  }, [
    suppressRelationWires,
    placements,
    selectedRef,
    selectedConnectionSide,
    selectedConnectionPeerRef,
    panel,
    project,
    dragOverride,
    preserveRowForRefKeys,
    supplyPanelRefKeys,
    hierarchyRoute,
    getHierarchyRoute,
    mainBusRouteSide,
    singlePanelCorridorY,
    pathwayRegions,
    pathwayLinks,
  ])

  const selectedKey = selectedRef ? panelGridModuleRefKey(selectedRef) : null
  const hoveredKey = hoveredRef ? panelGridModuleRefKey(hoveredRef) : null
  const hoverWireState = useMemo(() => {
    if (suppressRelationWires) return { wires: [], labels: [] as RoutedWireLabel[] }
    if (selectedConnectionSide) return { wires: [], labels: [] as RoutedWireLabel[] }
    if (!hoveredRef || !project) return { wires: [], labels: [] as RoutedWireLabel[] }
    if (hoveredKey === selectedKey) return { wires: [], labels: [] as RoutedWireLabel[] }
    return computeWires(
      hoveredRef,
      placements,
      panel,
      project,
      dragOverride,
      preserveRowForRefKeys,
      supplyPanelRefKeys,
      hierarchyRoute,
      getHierarchyRoute,
      mainBusRouteSide,
      singlePanelCorridorY,
      pathwayRegions,
      pathwayLinks
    )
  }, [
    suppressRelationWires,
    selectedConnectionSide,
    hoveredRef,
    hoveredKey,
    selectedKey,
    placements,
    panel,
    project,
    dragOverride,
    preserveRowForRefKeys,
    supplyPanelRefKeys,
    hierarchyRoute,
    getHierarchyRoute,
    mainBusRouteSide,
    singlePanelCorridorY,
    pathwayRegions,
    pathwayLinks,
  ])

  const hasWires = wireState.wires.length > 0
  const renderedWireSegments = useMemo(
    () => mergeAxisAlignedWireSegments(wireState.wires),
    [wireState.wires]
  )
  const wireFadeField = useMemo(() => buildWireFadeField(wireState.wires), [wireState.wires])
  const hoverWireFadeField = useMemo(
    () =>
      buildWireFadeField(
        hoverWireState.wires,
        HOVER_WIRE_OPACITY,
        HOVER_WIRE_FADE_MIN_OPACITY
      ),
    [hoverWireState.wires]
  )
  const renderedHoverWireSegments = useMemo(
    () => mergeAxisAlignedWireSegments(hoverWireState.wires),
    [hoverWireState.wires]
  )
  const debugPathwaySegments = useMemo(() => {
    if (!debugMode) return []
    const seen = new Set<string>()
    return [...wireState.wires, ...hoverWireState.wires]
      .flatMap((wire) => wire.pathDebug?.pathwayEdges ?? [])
      .filter((segment) => {
        const forward = `${segment.from.x}:${segment.from.y}:${segment.to.x}:${segment.to.y}`
        const reverse = `${segment.to.x}:${segment.to.y}:${segment.from.x}:${segment.from.y}`
        if (seen.has(forward) || seen.has(reverse)) return false
        seen.add(forward)
        return true
      })
  }, [debugMode, hoverWireState.wires, wireState.wires])
  const debugPathwayNodes = useMemo(() => {
    const seen = new Set<string>()
    return debugPathwaySegments
      .flatMap((segment) => [segment.from, segment.to])
      .filter((point) => {
        const key = `${point.x}:${point.y}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [debugPathwaySegments])
  const shouldAnimateDash = animateDash && hasWires && !ghost

  const stopDashLoop = useCallback(() => {
    if (dashFrameRef.current != null) {
      cancelAnimationFrame(dashFrameRef.current)
      dashFrameRef.current = null
    }
  }, [])

  const updateDashOffset = useCallback((offset: number) => {
    dashOffsetRef.current = offset
    let layer: Konva.Layer | null = null
    for (const line of lineRefs.current) {
      if (!line) continue
      line.dashOffset(DASH_TOTAL - offset)
      if (!layer) layer = line.getLayer()
    }
    layer?.batchDraw()
  }, [])

  const canRunDashAnimation = useCallback(() => {
    if (!shouldAnimateDash) return false
    if (!pageVisibleRef.current) return false
    if (!canvasVisibleRef.current) return false
    return lineRefs.current.some((line) => line != null)
  }, [shouldAnimateDash])

  const scheduleDashLoop = useCallback(() => {
    if (dashFrameRef.current != null) return
    if (!canRunDashAnimation()) return

    const tick = (now: number) => {
      if (!canRunDashAnimation()) {
        dashFrameRef.current = null
        return
      }

      if (lastDashTickRef.current === 0 || now - lastDashTickRef.current >= DASH_FRAME_MS) {
        lastDashTickRef.current = now
        const offset = ((now * SPEED) / 1000) % DASH_TOTAL
        updateDashOffset(offset)
      }

      dashFrameRef.current = requestAnimationFrame(tick)
    }

    dashFrameRef.current = requestAnimationFrame(tick)
  }, [canRunDashAnimation, updateDashOffset])

  useEffect(() => {
    if (!debugMode || !project) return
    if (hoveredRef && panelGridModuleRefKey(hoveredRef) !== selectedKey) {
      const d = buildRelationWireDiagnostics(
        'hover',
        hoveredRef,
        placements,
        panel,
        project,
        dragOverride,
        preserveRowForRefKeys,
        supplyPanelRefKeys,
        hierarchyRoute,
        getHierarchyRoute,
        mainBusRouteSide,
        singlePanelCorridorY,
        pathwayRegions,
        pathwayLinks
      )
      logger.info('[RelationWires:hover]', d)
    }
  }, [
    debugMode,
    project,
    selectedRef,
    hoveredRef,
    selectedKey,
    placements,
    panel,
    dragOverride,
    preserveRowForRefKeys,
    supplyPanelRefKeys,
    hierarchyRoute,
    getHierarchyRoute,
    mainBusRouteSide,
    singlePanelCorridorY,
    pathwayRegions,
    pathwayLinks,
  ])

  useEffect(() => {
    if (!shouldAnimateDash) {
      stopDashLoop()
      lastDashTickRef.current = 0
      updateDashOffset(0)
      return
    }

    scheduleDashLoop()
  }, [shouldAnimateDash, scheduleDashLoop, stopDashLoop, updateDashOffset])

  useEffect(() => {
    if (!shouldAnimateDash) return

    const handleVisibilityChange = () => {
      pageVisibleRef.current = !document.hidden
      if (pageVisibleRef.current) {
        scheduleDashLoop()
      } else {
        stopDashLoop()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [shouldAnimateDash, scheduleDashLoop, stopDashLoop])

  useEffect(() => {
    if (!shouldAnimateDash) {
      canvasVisibleRef.current = true
      visibilityObserverRef.current?.disconnect()
      visibilityObserverRef.current = null
      return
    }

    const firstLine = lineRefs.current.find((line) => line != null)
    const container = firstLine?.getStage()?.container()
    if (!container || typeof IntersectionObserver === 'undefined') {
      canvasVisibleRef.current = true
      scheduleDashLoop()
      return
    }

    visibilityObserverRef.current?.disconnect()
    const observer = new IntersectionObserver(
      ([entry]) => {
        canvasVisibleRef.current = entry?.isIntersecting !== false
        if (canvasVisibleRef.current) {
          scheduleDashLoop()
        } else {
          stopDashLoop()
        }
      },
      { threshold: 0.01 }
    )
    observer.observe(container)
    visibilityObserverRef.current = observer

    return () => {
      observer.disconnect()
      if (visibilityObserverRef.current === observer) visibilityObserverRef.current = null
    }
  }, [shouldAnimateDash, scheduleDashLoop, stopDashLoop])

  useEffect(() => {
    return () => {
      stopDashLoop()
      visibilityObserverRef.current?.disconnect()
      visibilityObserverRef.current = null
    }
  }, [stopDashLoop])

  lineRefs.current.length = renderedWireSegments.length

  if (!hasWires && hoverWireState.wires.length === 0) return null

  return (
    <>
      {debugPathwaySegments.map((segment, index) => (
        <Line
          key={`pathway-${index}`}
          points={[segment.from.x, segment.from.y, segment.to.x, segment.to.y]}
          stroke="#06b6d4"
          strokeWidth={1.15}
          opacity={0.72}
          dash={[3, 3]}
          listening={false}
        />
      ))}
      {debugPathwayNodes.map((point, index) => (
        <Circle
          key={`pathway-node-${index}`}
          x={point.x}
          y={point.y}
          radius={1.8}
          fill="#0891b2"
          stroke="#ecfeff"
          strokeWidth={0.65}
          opacity={0.9}
          listening={false}
        />
      ))}
      {debugMode &&
        wireState.wires.map((wire, index) => {
          const debug = wire.pathDebug
          const anchorX = wire.points[wire.points.length - 2]
          const anchorY = wire.points[wire.points.length - 1]
          if (!debug || anchorX == null || anchorY == null) return null
          const fallback = debug.usedFallback ? ' · fallback' : ''
          return (
            <Text
              key={`path-cost-${index}`}
              text={`cost ${Math.round(debug.cost)} · bends ${debug.bends} · nodes ${debug.visitedNodes}${fallback}`}
              x={anchorX + 5}
              y={anchorY - 14}
              fontSize={9}
              fill={debug.usedFallback ? '#dc2626' : '#475569'}
              listening={false}
            />
          )
        })}
      {renderedHoverWireSegments.map((wire, i) => {
        const fade = !debugMode
          ? wireFadeGradient(wire.points, hoverWireFadeField, HOVER_WIRE_STROKE_RGB)
          : null
        return (
          <Line
            key={`hover-${i}`}
            points={wire.points}
            stroke={debugMode ? DEBUG_ROUTE_STROKES[wire.kind] : '#7a5c0a'}
            {...fade}
            strokeWidth={ghost ? 1.5 : 1}
            opacity={fade ? 1 : HOVER_WIRE_OPACITY}
            dash={animateDash ? [6, 4] : undefined}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        )
      })}
      {renderedHoverWireSegments.flatMap((wire, wireIndex) =>
        getShortVerticalStubPoints(wire.points).map((points, stubIndex) => {
          const fade = !debugMode
            ? wireFadeGradient(points, hoverWireFadeField, HOVER_WIRE_STROKE_RGB)
            : null
          return (
            <Line
              key={`hover-stub-${wireIndex}-${stubIndex}`}
              points={points}
              stroke={debugMode ? DEBUG_ROUTE_STROKES[wire.kind] : '#7a5c0a'}
              {...fade}
              strokeWidth={ghost ? 2 : 1.5}
              opacity={fade ? 1 : HOVER_WIRE_OPACITY}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )
        })
      )}
      {hoverWireState.labels.map((label, i) =>
        (() => {
          const fontSize = 12
          const estWidth = Math.max(24, label.text.length * fontSize * 0.58)
          const estHeight = fontSize * 1.2
          const gap = 6
          const x = label.anchorX - estWidth / 2
          const y = label.placeAbove ? label.anchorY - estHeight - gap : label.anchorY + gap
          return (
            <Text
              key={`hover-label-${i}`}
              text={label.text}
              x={x}
              y={y}
              width={estWidth}
              align="center"
              fontSize={fontSize}
              fill={debugMode ? '#06b6d4' : '#7a5c0a'}
              listening={false}
            />
          )
        })()
      )}
      {renderedWireSegments.map((wire, i) => {
        const fade = !ghost && !debugMode ? wireFadeGradient(wire.points, wireFadeField) : null
        return (
          <Line
            key={i}
            ref={(node) => {
              lineRefs.current[i] = node
            }}
            points={wire.points}
            stroke={debugMode ? DEBUG_ROUTE_STROKES[wire.kind] : strokeColor}
            {...fade}
            strokeWidth={ghost ? strokeWidth + 1 : strokeWidth}
            opacity={ghost ? 0.28 : 1}
            dash={animateDash ? [DASH[0], DASH[1]] : undefined}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        )
      })}
      {renderedWireSegments.flatMap((wire, wireIndex) =>
        getShortVerticalStubPoints(wire.points).map((points, stubIndex) => {
          const fade = !ghost && !debugMode ? wireFadeGradient(points, wireFadeField) : null
          return (
            <Line
              key={`stub-${wireIndex}-${stubIndex}`}
              points={points}
              stroke={debugMode ? DEBUG_ROUTE_STROKES[wire.kind] : strokeColor}
              {...fade}
              strokeWidth={ghost ? strokeWidth + 1 : strokeWidth}
              opacity={ghost ? 0.5 : 1}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          )
        })
      )}
      {wireState.labels.map((label, i) =>
        (() => {
          const fontSize = 12
          const estWidth = Math.max(24, label.text.length * fontSize * 0.58)
          const estHeight = fontSize * 1.2
          const gap = 6
          const x = label.anchorX - estWidth / 2
          const y = label.placeAbove ? label.anchorY - estHeight - gap : label.anchorY + gap
          return (
            <Text
              key={`label-${i}`}
              text={label.text}
              x={x}
              y={y}
              width={estWidth}
              align="center"
              fontSize={fontSize}
              fill={debugMode ? '#2563eb' : strokeColor}
              listening={false}
            />
          )
        })()
      )}
    </>
  )
}
