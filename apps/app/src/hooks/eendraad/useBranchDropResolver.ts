import { useCallback, useEffect, useRef, type RefObject } from 'react'
import {
  collectBranchDropTargets,
  resolveBranchDropFallback,
  resolveBranchDropIntent,
  resolveBranchStemFallback,
  type BranchDropTargets,
} from '@/lib/layout/branchDropInteraction'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { findDropTarget } from '@/lib/layout/findDropTarget'
import { resolveSupplyTapLane } from '@/lib/layout/supplyTapDropTargets'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import type { SymbolMetadata } from '@/lib/symbols'
import { getSupplyTapDropLanes, stepSupplyTapDropLanes } from '@/lib/supplyTaps/tapDropLanes'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectV2 } from '@/types/projectV2'
import type { Point } from '@/types/ui'

interface BranchDropResolverInput {
  layout: BottomUpLayoutResult | null | undefined
  layoutTree: LayoutTree | null | undefined
  project: ProjectV2 | null | undefined
  getZoom: () => number
  internalDragElementIdRef: RefObject<string | null>
  elementDragModeRef: RefObject<'move' | 'duplicate'>
  endpointDragStartSelectionIdsRef: RefObject<string[] | null>
}

const emptyTargets = (): BranchDropTargets => ({
  intents: [], regions: [], endpointNodeIds: new Set(), circuitIds: new Set(),
})

/**
 * Lays out supply tap drop spots while the browser is idle, so a drag does not start with a stall.
 * One spot per callback: a single long task would freeze a zoom or pan that is under way.
 */
function usePrefetchSupplyTapLanes(project: ProjectV2 | null | undefined, layout: BottomUpLayoutResult | null | undefined) {
  useEffect(() => {
    if (!project || !layout?.panels.some((panel) => panel.frameRole === 'supply')) return
    const idle = typeof requestIdleCallback === 'function'
    let handle = 0
    const schedule = (delayMs: number) => {
      handle = idle ? requestIdleCallback(run, { timeout: 2000 }) : window.setTimeout(run, delayMs)
    }
    const run = () => { if (!stepSupplyTapDropLanes(project, layout)) schedule(30) }
    schedule(200)
    return () => { if (idle) cancelIdleCallback(handle); else clearTimeout(handle) }
  }, [project, layout])
}

/** Branch, endpoint-slot and supply-tap drop resolution for one-wire drags. */
export function useBranchDropResolver(input: BranchDropResolverInput) {
  const { layout, layoutTree, project, getZoom } = input
  const { internalDragElementIdRef, elementDragModeRef, endpointDragStartSelectionIdsRef } = input
  usePrefetchSupplyTapLanes(project, layout)
  const branchTargetCache = useRef<{
    layout: typeof layout; key: string; targets: BranchDropTargets; previousId: string | null
  } | null>(null)
  const branchMovingIds = useCallback(() => {
    const id = internalDragElementIdRef.current
    if (!id || elementDragModeRef.current === 'duplicate') return []
    if (!useProjectStore.getState().getEndpointById(id)) return []
    return endpointDragStartSelectionIdsRef.current ?? [id]
  }, [internalDragElementIdRef, elementDragModeRef, endpointDragStartSelectionIdsRef])
  const getBranchTargets = useCallback((symbol: SymbolMetadata, movingIds = branchMovingIds()) => {
    const zoom = getZoom()
    const key = JSON.stringify([symbol.id, symbol.searchPreset, zoom, movingIds])
    const cached = branchTargetCache.current
    if (!cached || cached.layout !== layout || cached.key !== key) {
      branchTargetCache.current = {
        layout, key, previousId: null,
        targets: layout && layoutTree
          ? collectBranchDropTargets(layout, layoutTree, symbol, zoom, movingIds, true,
            () => project ? getSupplyTapDropLanes(project, layout) : [])
          : emptyTargets(),
      }
    }
    return { ...branchTargetCache.current!, zoom }
  }, [layout, layoutTree, branchMovingIds, project, getZoom])
  const resolveBranchDrop = useCallback((position: Point, symbol: SymbolMetadata, movingIds?: string[]) => {
    const internalId = internalDragElementIdRef.current
    // A dragged supply tap protection only slides along the tap zones; a drop there moves it.
    if (internalId && elementDragModeRef.current !== 'duplicate' &&
      useProjectStore.getState().getProtectionById(internalId)?.supplyTap) {
      const { targets } = getBranchTargets(symbol, [])
      const tap = targets.supplyTapLanes?.length ? resolveSupplyTapLane(targets.supplyTapLanes, position) : null
      const intent = tap && !(layoutTree && findDropTarget(layoutTree, position).type) ? tap : null
      return { handled: !!intent, intent }
    }
    if (internalId && (elementDragModeRef.current === 'duplicate' ||
      !useProjectStore.getState().getEndpointById(internalId))) return { handled: false, intent: null }
    const ids = movingIds ?? branchMovingIds()
    if (ids.some((id) => !useProjectStore.getState().getEndpointById(id))) return { handled: false, intent: null }
    const { targets, zoom, previousId } = getBranchTargets(symbol, ids)
    let resolved = resolveBranchDropIntent(targets, position, zoom, previousId)
    // A supply tap never takes a spot that already drops onto a wire or device in series.
    if (resolved.intent?.lockPoint && layoutTree && findDropTarget(layoutTree, position).type)
      resolved = { handled: false, intent: null }
    if (!resolved.handled && targets.intents.length && layoutTree) {
      const target = findDropTarget(layoutTree, position, { preferMainBusOverGroundWire: true })
      const circuit = target.circuitId ? useProjectStore.getState().getCircuitById(target.circuitId) : null
      const intent = resolveBranchStemFallback(targets, layoutTree, position)
        ?? (circuit ? resolveBranchDropFallback(targets, target, circuit, symbol) : null)
      if (intent) resolved = { handled: true, intent }
    }
    branchTargetCache.current!.previousId = resolved.intent?.id ?? null
    return resolved
  }, [getBranchTargets, branchMovingIds, layoutTree, internalDragElementIdRef, elementDragModeRef])
  const clearBranchDrop = useCallback(() => {
    if (branchTargetCache.current) branchTargetCache.current.previousId = null
  }, [])
  return { getBranchTargets, resolveBranchDrop, clearBranchDrop }
}
