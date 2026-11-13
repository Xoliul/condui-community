import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import { useCallback } from 'react'

import { useProjectStore } from '@/stores/projectStore'

import type { Selection } from '@/types/ui'

import type { useEendraadWireSegments, useLayoutTree } from '@/hooks/eendraad'
import { computeEendraadCircuitFocusBounds } from '@/lib/eendraad/focusCircuit'

import { endpointIdsForPlacementSelection } from '@/lib/ui/crossCanvasSelection'

import { resolveSupplyWireSegmentByMetadata } from '@/lib/eendraad/wireSelectionIdentity'
import type { Endpoint } from '@/types/schema'
import { getEndpointOutlineGeometry } from './canvasSymbols'

type ViewportUIState = ReturnType<ReturnType<typeof useViewportUIApi>['getState']>
interface EendraadSelectionBoundsOptions {
  layoutTree: ReturnType<typeof useLayoutTree>
  requestFitToView: ViewportUIState['requestFitToView']
  viewportUI: ReturnType<typeof useViewportUIApi>
  wireSegments: ReturnType<typeof useEendraadWireSegments>
}


export function useEendraadSelectionBounds({
  layoutTree,
  requestFitToView,
  viewportUI,
  wireSegments,
}: EendraadSelectionBoundsOptions) {
  // Selection bounds in 1‑wire view (used by BaseCanvas fit-to-selection)
  const handleGetSelectionBounds = useCallback(
    (selectionOverride?: Selection, forPeer = false) => {
      const selection = selectionOverride ?? viewportUI.getState().selection
      if (!selection.type || !selection.ids || selection.ids.length === 0) {
        return null
      }

      if (selection.type === 'circuit' && selection.ids.length > 0) {
        const rootId = selection.ids[0]
        if (!rootId) return null
        const st = useProjectStore.getState()
        if (!st.currentProject) return null
        return computeEendraadCircuitFocusBounds({
          rootCircuitId: rootId,
          wireSegments,
          layoutTree,
          getCircuitById: st.getCircuitById,
          getProtectionForCircuit: st.getProtectionForCircuit,
          findPanelForCircuit: st.findPanelForCircuit,
        })
      }

      // Wires: use generated wireSegments (more precise than generic node bounds)
      if (selection.type === 'wire' || (selection.type === 'structuralConnection' && selection.wireAnchor)) {
        const selectedIds = new Set(selection.ids)
        const selectedAnchors = new Set(selection.wireMetadata?.flatMap(meta => meta.wireAnchors ?? (meta.wireAnchor ? [meta.wireAnchor] : [])) ?? [])
        if (selection.wireAnchor) selectedAnchors.add(selection.wireAnchor)
        let selectedSegments = wireSegments.filter((ws) => selectedIds.has(ws.id) || ws.wireAnchors?.some(anchor => selectedAnchors.has(anchor)))
        if (selectedSegments.length === 0 && selectedAnchors.size === 0 && selection.wireMetadata?.length) {
          const resolved = new Map<string, (typeof wireSegments)[number]>()
          for (const metadata of selection.wireMetadata) {
            let matched = null as (typeof wireSegments)[number] | null
            if (
              metadata.domoticaOutputGroup &&
              typeof metadata.domoticaOutputIndex === 'number' &&
              metadata.circuitId
            ) {
              matched =
                wireSegments.find(
                  (ws) =>
                    ws.type === 'branch' &&
                    ws.circuitId === metadata.circuitId &&
                    ws.panelId === metadata.panelId &&
                    ws.domoticaOutputGroup === metadata.domoticaOutputGroup &&
                    ws.domoticaOutputIndex === metadata.domoticaOutputIndex
                ) ?? null
            } else if (metadata.isGround) {
              matched =
                wireSegments.find(
                  (ws) =>
                    ws.type === 'vertical' &&
                    ws.fromElementType === 'ground' &&
                    ws.panelId === metadata.panelId
                ) ?? null
            } else if (
              metadata.supplySectionKey ||
              (metadata.supplyAssemblyId && metadata.supplyConnectionId) ||
              metadata.isSupply
            ) {
              matched = resolveSupplyWireSegmentByMetadata(wireSegments, metadata)
            } else if (metadata.circuitId) {
              if (metadata.fromElementId !== undefined || metadata.toElementId !== undefined) {
                matched =
                  wireSegments.find(
                    (ws) =>
                      ws.type === 'vertical' &&
                      ws.circuitId === metadata.circuitId &&
                      ws.panelId === metadata.panelId &&
                      (metadata.fromElementId === undefined ||
                        ws.fromElementId === metadata.fromElementId) &&
                      (metadata.toElementId === undefined ||
                        ws.toElementId === metadata.toElementId)
                  ) ?? null
              }
              if (!matched) {
                matched =
                  wireSegments.find(
                    (ws) =>
                      ws.type === 'vertical' &&
                      ws.circuitId === metadata.circuitId &&
                      ws.panelId === metadata.panelId
                  ) ?? null
              }
            }
            if (matched) resolved.set(matched.id, matched)
          }
          selectedSegments = Array.from(resolved.values())
        }
        if (selectedSegments.length === 0) return null

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let found = false

        for (const ws of selectedSegments) {
          const pts = [ws.startPoint, ws.endPoint]
          for (const p of pts) {
            if (!p) continue
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
            minX = Math.min(minX, p.x)
            minY = Math.min(minY, p.y)
            maxX = Math.max(maxX, p.x)
            maxY = Math.max(maxY, p.y)
            found = true
          }
        }

        if (
          !found ||
          !Number.isFinite(minX) ||
          !Number.isFinite(minY) ||
          !Number.isFinite(maxX) ||
          !Number.isFinite(maxY)
        ) {
          return null
        }

        const padding = 10
        return {
          x: minX - padding,
          y: minY - padding,
          width: maxX - minX + padding * 2,
          height: maxY - minY + padding * 2,
        }
      }

      // Other 1‑wire selections (endpoint, protection, trunkDevice, supply, panel)
      // Use layoutTree as the single source of truth for element bounds.
      if (!layoutTree) return null

      type LayoutNode = import('@/lib/layout/layoutTree').LayoutNode

      let selectedIds = new Set(selection.ids)
      const acceptableTypes: Array<import('@/lib/layout/layoutTree').LayoutNodeType> = []

      if (selection.type === 'endpoint') {
        acceptableTypes.push('endpoint')
      } else if (selection.type === 'placement') {
        acceptableTypes.push('endpoint')
        selectedIds = endpointIdsForPlacementSelection(
          () => useProjectStore.getState().getAllEndpoints(),
          selection.ids
        )
        if (selectedIds.size === 0) return null
      } else if (selection.type === 'protection') {
        acceptableTypes.push('mcb', 'rcd')
      } else if (selection.type === 'trunkDevice') {
        acceptableTypes.push('trunkDevice')
      } else if (selection.type === 'supply') {
        acceptableTypes.push('supply')
      } else if (selection.type === 'panel') {
        acceptableTypes.push('panel')
      } else if (selection.type === 'busSection' && selection.busSectionMetadata) {
        // A busbar is framed by its board.
        acceptableTypes.push('panel')
        selectedIds = new Set([selection.busSectionMetadata.panelId])
      }

      if (acceptableTypes.length === 0) return null

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let found = false

      const visitNode = (node: LayoutNode) => {
        if (
          node.domainId &&
          selectedIds.has(node.domainId) &&
          acceptableTypes.includes(node.type)
        ) {
          let { x, y, width, height } = node.bounds
          let padding = 10
          if (forPeer && node.type === 'endpoint' && node.domainRef && node.visual?.type === 'symbol' &&
            node.visual.symbolId !== 'domotica' && node.visual.symbolId !== 'panel_distribution') {
            // Layout bounds start at the electrical anchor and reserve space for the branch.
            // The peer highlight should frame the same centered artwork as a local selection.
            const outline = getEndpointOutlineGeometry(node.domainRef as Endpoint, node.visual.mirrorHorizontally)
            x += outline.centerX - outline.width / 2
            y -= outline.height / 2
            width = outline.width
            height = outline.height
            padding = 0
          }
          if (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            width > 0 &&
            height > 0
          ) {
            minX = Math.min(minX, x - padding)
            minY = Math.min(minY, y - padding)
            maxX = Math.max(maxX, x + width + padding)
            maxY = Math.max(maxY, y + height + padding)
            found = true
          }
        }
        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            visitNode(child)
          }
        }
      }

      for (const panelNode of layoutTree.panels) {
        visitNode(panelNode)
      }

      if (
        !found ||
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(maxY)
      ) {
        return null
      }

      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    },
    [wireSegments, layoutTree, viewportUI]
  )

  const handleFitToView = useCallback(() => {
    const viewportLayout = viewportUI.getState().viewportLayout
    const canvasesToFit =
      viewportLayout.panels.length === 1
        ? ['eendraad' as const]
        : Array.from(new Set(viewportLayout.panels.map((panel) => panel.canvas)))
    requestFitToView(canvasesToFit)
  }, [requestFitToView, viewportUI])

  const getPeerSelectionBounds = useCallback(
    (selection: Selection) => handleGetSelectionBounds(selection, true),
    [handleGetSelectionBounds]
  )

  return { handleGetSelectionBounds, getPeerSelectionBounds, handleFitToView }
}
