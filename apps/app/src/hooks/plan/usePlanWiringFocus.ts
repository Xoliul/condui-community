import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  circuitIdForPlanEndpoint,
  freezePlanWireCircuit,
  type FrozenPlanWireCircuit,
  type PlanWireRedraw,
} from '@/lib/plan/planWiringFocus'
import { selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { useProjectStore } from '@/stores/projectStore'
import type { PlanWireRoute } from '@/types/schema'

/** A circuit, and the symbol in it the user worked on (null: the whole circuit). */
export interface PlanWiringTarget {
  circuitId: string
  placementId: string | null
}

/**
 * Wire mode's working branch. It is sticky: the last symbol or wire you worked on sets it, and
 * it stays after the drag ends. Entering wire mode starts without focus, with every wire visible.
 * Leaving wire mode or changing floor clears it. The canvas turns a target
 * into the wires to show with `planWireFocusScope`.
 */
export function usePlanWiringFocus({
  wiringMode,
  activeFloorId,
  currentProject,
  hoverPlacementId,
  dragSourcePlacementId,
}: {
  wiringMode: boolean
  activeFloorId: string | null | undefined
  currentProject: ProjectWithOptionalV2Electrical | null | undefined
  hoverPlacementId: string | null
  dragSourcePlacementId: string | null
}) {
  const [focus, applyFocus] = useState<PlanWiringTarget | null>(null)
  const [hoverRoute, applyHoverRoute] = useState<PlanWireRoute | null>(null)
  const [redraw, applyRedraw] = useState<PlanWireRedraw | null>(null)
  const [frozen, applyFrozen] = useState<FrozenPlanWireCircuit | null>(null)

  const panels = useMemo(
    () => (currentProject ? selectProjectElectricalPanels(currentProject) : []),
    [currentProject]
  )
  const circuitIdForPlacement = useCallback(
    (placementId: string | null | undefined): string | null => {
      if (!placementId) return null
      const placement = useProjectStore.getState().getPlacementById(placementId)
      return circuitIdForPlanEndpoint(panels, placement?.endpointId)
    },
    [panels]
  )

  const focusRef = useRef(focus)
  focusRef.current = focus
  const focusTarget = useCallback((target: PlanWiringTarget | null) => {
    if (target) useProjectStore.setState({ lastWorkedCircuitId: target.circuitId })
    const current = focusRef.current
    if (current?.circuitId === target?.circuitId && current?.placementId === target?.placementId) {
      return
    }
    // Leaving a circuit ends its redraw and lets its automatic wires settle.
    if (current?.circuitId !== target?.circuitId) {
      applyRedraw(null)
      applyFrozen(null)
    }
    focusRef.current = target
    applyFocus(target)
  }, [])
  const focusCircuit = useCallback(
    (circuitId: string) => focusTarget({ circuitId, placementId: null }),
    [focusTarget]
  )
  const focusPlacement = useCallback(
    (placementId: string | null | undefined, circuitId?: string | null) => {
      const resolved = circuitId ?? circuitIdForPlacement(placementId)
      if (resolved) focusTarget({ circuitId: resolved, placementId: placementId ?? null })
    },
    [circuitIdForPlacement, focusTarget]
  )

  // Mode and floor changes clear focus; a selection from regular plan mode is not inherited.
  useEffect(
    function () {
      applyHoverRoute(null)
      applyRedraw(null)
      applyFrozen(null)
      focusRef.current = null
      applyFocus(null)
    },
    // Only on entering or leaving wire mode, or switching floor; not on every project edit.
    [wiringMode, activeFloorId]
  )

  // Starting a wire from a symbol makes its branch the working one.
  useEffect(
    function () {
      if (wiringMode && dragSourcePlacementId) focusPlacement(dragSourcePlacementId)
    },
    [wiringMode, dragSourcePlacementId, focusPlacement]
  )

  // Hovering a symbol or wire previews its branch; not while dragging a wire.
  const preview = useMemo((): PlanWiringTarget | null => {
    if (!wiringMode || dragSourcePlacementId) return null
    const hoveredCircuitId = circuitIdForPlacement(hoverPlacementId)
    if (hoverPlacementId && hoveredCircuitId) {
      return { circuitId: hoveredCircuitId, placementId: hoverPlacementId }
    }
    if (hoverRoute) {
      return { circuitId: hoverRoute.circuitId, placementId: hoverRoute.to.placementId ?? null }
    }
    return null
  }, [wiringMode, dragSourcePlacementId, circuitIdForPlacement, hoverPlacementId, hoverRoute])

  /**
   * Called just before a wire is drawn in a circuit: outside a redraw, the circuit's automatic
   * wires are held as they are until the user moves on to another circuit.
   */
  const holdCircuitBeforeDraw = useCallback(
    (circuitId: string | null, routes: PlanWireRoute[]) => {
      if (!circuitId || !activeFloorId || circuitId === redraw?.circuitId) return
      applyFrozen((current) =>
        current?.circuitId === circuitId && current.floorId === activeFloorId
          ? current
          : freezePlanWireCircuit(routes, circuitId, activeFloorId)
      )
    },
    [activeFloorId, redraw]
  )

  /** Clears the automatic wires into these symbols (the focus branch) until the redraw ends. */
  const startRedraw = useCallback((circuitId: string, placementIds: Iterable<string>) => {
    applyFrozen(null)
    applyRedraw({ circuitId, placementIds: new Set(placementIds) })
  }, [])

  const finishRedraw = useCallback(() => {
    applyRedraw(null)
    applyFrozen(null)
  }, [])

  return {
    focus: wiringMode ? focus : null,
    preview,
    redraw: wiringMode ? redraw : null,
    frozen: wiringMode ? frozen : null,
    circuitIdForPlacement,
    focusCircuit,
    focusPlacement,
    onHoverRoute: applyHoverRoute,
    holdCircuitBeforeDraw,
    startRedraw,
    finishRedraw,
  }
}
