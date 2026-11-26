/** Per-segment main-bus hit zones, positioned to match the segmented bus drawn by deriveWires. */
import type { LayoutNode } from './layoutTree'
import { drawsHostedFeederStubs } from '@/lib/layout/supplyFrameRole'
import type { BottomUpLayoutElement, BottomUpPanelLayout } from './bottomUpLayout'
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import { getPanelDiagramId } from './bottomUpLayout'
import { PANEL_BUS_FEED_GAP } from '@/lib/panel/panelBusFeedPreview'
import {
  getPrimaryPanelBusSectionId,
  getProtectionBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { applyHostedFeederSectionCut } from './feedStubFeeders'
import { getSecondaryBusSectionBoundaryX } from './mainBusSectionBoundary'
import { isSupplyTapNode } from './layoutTreeSupplyTaps'
import type { ProtectionDevice, Panel } from '@/types/schema'

function getProtectionBusSectionIdForLayoutNode(panel: Panel, node: LayoutNode): string {
  const protection = node.domainRef as ProtectionDevice | undefined
  return protection
    ? getProtectionBusSectionId(panel, protection)
    : getPrimaryPanelBusSectionId(panel)
}

/**
 * Build the bus segment nodes for a main bus. `children` are the already built circuit nodes
 * that cut the bus; the returned nodes are appended after them by the caller.
 */
export function buildMainBusSegmentNodes(
  panelLayout: BottomUpPanelLayout,
  mainBusElement: BottomUpLayoutElement,
  children: readonly LayoutNode[]
): LayoutNode[] {
  const segments: LayoutNode[] = []
  // Add per-segment hit zones along the main bus so that hitboxes visually
  // match the segmented bus rendering in deriveWires. Segments span the gaps
  // between protections (RCD/MCB) on the main bus.
  if (mainBusElement.position) {
    const busYTop = mainBusElement.position.y
    const busThickness = mainBusElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS
    const busStartX = mainBusElement.position.x
    const busEndX = busStartX + (mainBusElement.width || 0)

    const connectionEntries = children
      .filter((child) => {
        if (child.type !== 'rcd' && child.type !== 'mcb') return false
        if (isSupplyTapNode(child)) return false
        const circuit = panelLayout.circuits.find(
          (candidate) => candidate.circuit.id === child.circuitIdForWires
        )?.circuit
        return circuit?.supplySource?.kind !== 'converter-backup'
      })
      .map((child) => ({
        x: child.bounds.x,
        busSectionId: getProtectionBusSectionIdForLayoutNode(panelLayout.panel, child),
      }))
      .sort((a, b) => a.x - b.x)
    const connectionXs = connectionEntries.map((entry) => entry.x)
    const secondaryBusSectionRanges = children.flatMap((node) => {
      if (node.type !== 'rcd' && node.type !== 'mcb') return []
      const sectionId = getProtectionBusSectionIdForLayoutNode(panelLayout.panel, node)
      if (!sectionId) return []
      return node.children
        .filter((child) => child.type === 'secondaryBus' && child.bounds.width > 0)
        .map((secondaryBus) => ({
          sectionId,
          startX: secondaryBus.bounds.x,
          endX: secondaryBus.bounds.x + secondaryBus.bounds.width,
        }))
    })

    const explicitEmptySections =
      connectionXs.length === 0 && hasExplicitPanelBusSections(panelLayout.panel)
        ? [...(panelLayout.panel.busSections ?? [])].sort((left, right) =>
            left.role === right.role ? 0 : left.role === 'backup' ? 1 : -1
          )
        : []
    if (explicitEmptySections.length > 0) {
      const sectionWidth =
        (busEndX - busStartX - PANEL_BUS_FEED_GAP * Math.max(0, explicitEmptySections.length - 1)) /
        explicitEmptySections.length
      explicitEmptySections.forEach((section, index) => {
        const startX = busStartX + index * (sectionWidth + PANEL_BUS_FEED_GAP)
        segments.push({
          id: `main-bus-segment-${getPanelDiagramId(panelLayout)}-${section.id}-empty`,
          type: 'wire',
          bounds: { x: startX, y: busYTop, width: sectionWidth, height: busThickness },
          visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
          hitZone: {
            // Detached supply frames keep the two short grid/backup rail stubs as
            // first-class insertion points. The surrounding bus container remains
            // non-droppable, so only the explicit rail itself can create a circuit.
            type: 'mainBus',
            padding: panelLayout.frameRole === 'supply' ? 10 : 0,
            mainBusInsertIndex: 0,
            busSectionId: section.id,
          },
          children: [],
        })
      })
    } else if (hasExplicitPanelBusSections(panelLayout.panel) && connectionEntries.length > 0) {
      const splitGap = PANEL_BUS_FEED_GAP
      const drawsHostedFeeders = drawsHostedFeederStubs(panelLayout, panelLayout.panel)
      const hostedFeederCounts = new Map(
        drawsHostedFeeders
          ? (panelLayout.panelLocalFeedStubStacks ?? []).map(
              (stack) => [stack.busSectionId, stack.feeders?.length ?? 0] as const
            )
          : []
      )
      const sectionCut = (left: number, right: number) => {
        const previous = connectionEntries[left]!
        const entry = connectionEntries[right]!
        const boundaryX = getSecondaryBusSectionBoundaryX(
          secondaryBusSectionRanges,
          previous.busSectionId,
          entry.busSectionId,
          (previous.x + entry.x) / 2
        )
        const firstOfSection =
          connectionEntries.findIndex(
            (candidate) => candidate.busSectionId === entry.busSectionId
          ) === right
        return applyHostedFeederSectionCut(
          { leftEndX: boundaryX - splitGap / 2, rightStartX: boundaryX + splitGap / 2 },
          previous.x,
          Math.min(
            entry.x,
            ...secondaryBusSectionRanges
              .filter(
                (range) => range.sectionId === entry.busSectionId && range.startX > previous.x
              )
              .map((range) => range.startX)
          ),
          firstOfSection ? (hostedFeederCounts.get(entry.busSectionId) ?? 0) : 0
        )
      }
      connectionEntries.forEach((entry, index) => {
        const previous = connectionEntries[index - 1]
        const next = connectionEntries[index + 1]
        let startX = previous ? (previous.x + entry.x) / 2 : busStartX
        let endX = next ? (entry.x + next.x) / 2 : busEndX
        if (previous && previous.busSectionId !== entry.busSectionId) {
          startX = sectionCut(index - 1, index).rightStartX
        }
        if (next && next.busSectionId !== entry.busSectionId) {
          endX = sectionCut(index, index + 1).leftEndX
        }
        const pushSegment = (
          suffix: 'before' | 'after',
          x: number,
          width: number,
          insertIndex: number
        ) => {
          if (width <= 0) return
          segments.push({
            id: `main-bus-segment-${panelLayout.panel.id}-${index}-${suffix}`,
            type: 'wire',
            bounds: { x, y: busYTop, width, height: busThickness },
            visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
            hitZone: {
              type: panelLayout.frameRole === 'supply' ? null : 'mainBus',
              // Keep the forgiving vertical target, but never expand it
              // horizontally into the neighboring insertion slot.
              padding: 0,
              paddingY: 12,
              mainBusInsertIndex: insertIndex,
              busSectionId: entry.busSectionId,
            },
            children: [],
          })
        }

        // Split-feed bus segments are centered around their protection in the
        // rendered wire layout. Split the hit surface at the protection stem
        // as well, so the two sides retain distinct before/after semantics.
        pushSegment('before', startX, entry.x - startX, index)
        pushSegment('after', entry.x, endX - entry.x, index + 1)
      })
    } else {
      const waypoints: number[] = [busStartX, ...connectionXs, busEndX]
      for (let i = 0; i < waypoints.length - 1; i++) {
        const startX = waypoints[i]!
        const endX = waypoints[i + 1]!
        if (endX <= startX) continue

        segments.push({
          id: `main-bus-segment-${panelLayout.panel.id}-${i}`,
          type: 'wire',
          bounds: { x: startX, y: busYTop, width: endX - startX, height: busThickness },
          visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
          hitZone: {
            type: panelLayout.frameRole === 'supply' ? null : 'mainBus',
            padding: 0,
            paddingY: 12,
            mainBusInsertIndex: i,
          },
          children: [],
        })
      }
    }
  }
  return segments
}
