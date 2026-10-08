import { useCallback } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import {
  selectProjectPlanWireRoutes,
  selectProjectPlanWiringVisibility,
  replacePlanWireRoutesForProject,
  replacePlanWiringVisibilityForProject,
} from '@/lib/projectV2/planWiring'
import {
  buildManualOtherPlanWireRoute,
  buildManualPlanWireRoutesForPlacementMove,
  hidePlanSocketWireRouteForPlacementDrop,
  removePlanWireRouteWaypoint,
} from '@/lib/plan/planWiring'
import {
  movePlanWireRouteRiser,
  movePlanWireRouteRisers,
  movePlanWireRouteWaypoint,
  replacePlanWireSpanRoutes,
  upsertPlanWireRouteWaypoint,
} from '@/lib/plan/planWiringRouteEdits'
import type { Point2, PlanWireRoute } from '@/types/schema'

type UsePlanWireEditingOptions = {
  activeFloorId: string | null
  currentProject: ProjectState['currentProject']
}

export function usePlanWireEditing({ activeFloorId, currentProject }: UsePlanWireEditingOptions) {
  const insertPlanWireWaypoint = useCallback(
    (route: PlanWireRoute, point: Point2, waypointIndex: number) => {
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        replacePlanWireRoutesForProject(
          project,
          upsertPlanWireRouteWaypoint(
            selectProjectPlanWireRoutes(project),
            route,
            point,
            waypointIndex
          )
        )
        state.isDirty = true
      })
    },
    []
  )

  const movePlanWireWaypoint = useCallback(
    (route: PlanWireRoute, waypointIndex: number, point: Point2) => {
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const nextRoutes = movePlanWireRouteWaypoint(
          selectProjectPlanWireRoutes(project),
          route,
          waypointIndex,
          point
        )
        if (!nextRoutes) return
        replacePlanWireRoutesForProject(project, nextRoutes)
        state.isDirty = true
      })
    },
    []
  )

  const movePlanWireRiser = useCallback((route: PlanWireRoute, point: Point2) => {
    useProjectStore.setState((state: ProjectState) => {
      const project = state.currentProject
      if (!project) return
      const nextRoutes = movePlanWireRouteRiser(selectProjectPlanWireRoutes(project), route, point)
      if (!nextRoutes) return
      replacePlanWireRoutesForProject(project, nextRoutes)
      state.isDirty = true
    })
  }, [])

  /** Several floor passages dragged together, as one edit. */
  const movePlanWireRisers = useCallback(
    (moves: ReadonlyArray<{ route: PlanWireRoute; point: Point2 }>) => {
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const nextRoutes = movePlanWireRouteRisers(selectProjectPlanWireRoutes(project), moves)
        if (!nextRoutes) return
        replacePlanWireRoutesForProject(project, nextRoutes)
        state.isDirty = true
      })
    },
    []
  )

  const removePlanWireWaypoint = useCallback((route: PlanWireRoute, waypointIndex: number) => {
    useProjectStore.setState((state: ProjectState) => {
      const project = state.currentProject
      if (!project) return
      if (removePlanWireRouteWaypoint(project, route, waypointIndex)) {
        state.isDirty = true
      }
    })
  }, [])

  const drawPlanWire = useCallback(
    (sourcePlacementId: string, targetPlacementId: string) => {
      if (!activeFloorId || !currentProject || sourcePlacementId === targetPlacementId) return
      const otherRoute = buildManualOtherPlanWireRoute(
        currentProject,
        activeFloorId,
        sourcePlacementId,
        targetPlacementId
      )
      const routes = buildManualPlanWireRoutesForPlacementMove(
        currentProject,
        activeFloorId,
        sourcePlacementId,
        targetPlacementId,
        { keepAutoSpans: isCableRoutesEnabled() }
      )
      if (!otherRoute && (!routes || routes.length === 0)) return
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const storedRoutes = selectProjectPlanWireRoutes(project)
        const visibility = selectProjectPlanWiringVisibility(project)
        if (otherRoute) {
          replacePlanWireRoutesForProject(project, [
            ...storedRoutes.filter((route) => route.id !== otherRoute.id),
            otherRoute,
          ])
          replacePlanWiringVisibilityForProject(project, {
            ...visibility,
            wiresVisible: true,
            otherVisible: true,
          })
        } else if (routes) {
          replacePlanWireRoutesForProject(project, replacePlanWireSpanRoutes(storedRoutes, routes))
          const kind = routes[0]?.kind
          replacePlanWiringVisibilityForProject(project, {
            ...visibility,
            wiresVisible: true,
            ...(kind === 'lighting-control' ? { lightingVisible: true } : { socketsVisible: true }),
          })
        }
        state.isDirty = true
      })
    },
    [activeFloorId, currentProject]
  )

  const removeManualOtherPlanWiresFromOrigin = useCallback(
    (sourcePlacementId: string) => {
      if (!activeFloorId) return false
      let removed = false
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        const storedRoutes = selectProjectPlanWireRoutes(project)
        const routes = storedRoutes.filter(
          (route) =>
            !(
              route.source === 'manual' &&
              route.kind === 'other' &&
              route.floorId === activeFloorId &&
              route.from.placementId === sourcePlacementId
            )
        )
        if (routes.length === storedRoutes.length) return
        replacePlanWireRoutesForProject(project, routes)
        state.isDirty = true
        removed = true
      })
      return removed
    },
    [activeFloorId]
  )

  const hideSocketWireRouteForPlacementDrop = useCallback(
    (sourcePlacementId: string) => {
      if (!activeFloorId) return
      useProjectStore.setState((state: ProjectState) => {
        const project = state.currentProject
        if (!project) return
        if (hidePlanSocketWireRouteForPlacementDrop(project, activeFloorId, sourcePlacementId)) {
          state.isDirty = true
        }
      })
    },
    [activeFloorId]
  )

  return {
    insertPlanWireWaypoint,
    movePlanWireWaypoint,
    movePlanWireRiser,
    movePlanWireRisers,
    removePlanWireWaypoint,
    drawPlanWire,
    removeManualOtherPlanWiresFromOrigin,
    hideSocketWireRouteForPlacementDrop,
  }
}
