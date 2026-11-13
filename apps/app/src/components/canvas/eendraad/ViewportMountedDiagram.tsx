import {
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import Konva from 'konva'
import { Group, Rect, KonvaRenderer } from 'react-konva'
import { ViewportCulledGroup } from '../shared/ViewportCulledGroup'
import {
  acquireCanvasGroupMaterialization,
  registerCanvasGroupMaterialization,
} from '@/lib/canvas/groupMaterialization'
import { awaitPendingSymbolImages } from '@/lib/symbolImage'
import { withActivationTime } from '@/utils/repeatActivation'
import { commitForwardedCanvasInput } from '@/hooks/useCanvasUiStore'
import { logger } from '@/lib/logger'
import { OverviewInteractionContext, OverviewPrecisionContext, type ForwardOverviewInteraction } from './OverviewInteractionContext'
import { useDiagramOverviewPrecision } from './useDiagramOverviewPrecision'
import { DiagramDetailContext } from './DiagramDetailContext'
import {
  cancelLiveGroupDetail,
  liveGroupDetailPriority,
  scheduleLiveGroupDetail,
} from '@/lib/canvas/liveGroupDetailScheduling'
import {
  cancelLiveGroupMountCheck,
  scheduleLiveGroupMountCheck,
} from '@/lib/canvas/liveGroupMountScheduling'

type DiagramBounds = { x: number; y: number; width: number; height: number }
let nextDiagramSubscription = 0
// A 32-unit symbol is only six pixels wide at the old 0.18 threshold. Keep the
// cheap topology until its artwork is large enough to distinguish (~12 pixels).
const OVERVIEW_ENTER_ZOOM = 0.3
const OVERVIEW_EXIT_ZOOM = 0.36

/** Keep large projects' offscreen diagrams as logical geometry, without symbol components. */
export function ViewportMountedDiagram({
  name,
  logicalBounds,
  boundsRevision,
  virtualized,
  initialZoom = 1,
  forceMounted = false,
  materializeForcedDetail = true,
  overview,
  children,
}: {
  name: string
  logicalBounds: DiagramBounds
  boundsRevision: unknown
  virtualized: boolean
  initialZoom?: number
  forceMounted?: boolean
  /** Selection keeps a live board mounted without expanding all its offscreen regions. */
  materializeForcedDetail?: boolean
  overview?: ReactNode
  children: ReactNode
}) {
  const hasOverview = Boolean(overview)
  const { groupRef, precise: preciseOverview } = useDiagramOverviewPrecision(
    initialZoom, logicalBounds, hasOverview, OVERVIEW_EXIT_ZOOM,
  )
  const parentDetail = useContext(DiagramDetailContext)
  const [viewportVisible, setViewportVisible] = useState(!virtualized)
  const [exportMounts, setExportMounts] = useState(0)
  const [overviewScale, setOverviewScale] = useState(() => initialZoom <= OVERVIEW_ENTER_ZOOM)
  const overviewScaleRef = useRef(overviewScale)
  useLayoutEffect(() => { overviewScaleRef.current = overviewScale }, [overviewScale])
  const detailScope = useMemo(
    () => ({
      localized: virtualized || parentDetail.localized,
      materialized: (forceMounted && materializeForcedDetail) || exportMounts > 0 || parentDetail.materialized,
    }),
    [virtualized, forceMounted, materializeForcedDetail, exportMounts, parentDetail]
  )
  const mounted = !virtualized || forceMounted || detailScope.materialized || viewportVisible
  const mountedRef = useRef(mounted)
  useLayoutEffect(() => { mountedRef.current = mounted }, [mounted])
  const interactionQueue = useRef(Promise.resolve())
  const forwardInteraction = useCallback<ForwardOverviewInteraction>((targetName, event) => {
    const group = groupRef.current
    if (!group) return
    event.cancelBubble = true
    const evt = event.evt
    const type = event.type
    if (type === 'contextmenu') evt.preventDefault?.()
    const activatedAt = performance.now()
    interactionQueue.current = interactionQueue.current
      .then(async () => {
        if (!group.getStage()) return
        const release = await acquireCanvasGroupMaterialization(group)
        try {
          const target = group.findOne(`.${targetName}`)
          if (!target) return
          // Keep the real symbol/wire handlers authoritative for selection,
          // modifiers, repeated activation and context-menu event targeting.
          flushSync(() =>
            commitForwardedCanvasInput(() =>
              withActivationTime(activatedAt, () => target.fire(type, { evt, target }, true))
            )
          )
          KonvaRenderer.flushSyncFromReconciler(() => {})
        } finally {
          release()
        }
      })
      .catch((error) => logger.error('[onewire] Overview interaction failed', error))
  }, [groupRef])

  useLayoutEffect(() => {
    const group = groupRef.current
    const stage = group?.getStage()
    const layer = group?.getLayer()
    if (!group || !stage || !layer || !virtualized) return
    const window = stage.container().ownerDocument.defaultView!
    let active = true
    let wantDetail = false
    const promote = () => {
      if (active && wantDetail) setOverviewScale(false)
    }
    const namespace = `.diagramMount${++nextDiagramSubscription}`
    const refresh = () => {
      if (!active) return
      // The active drag can own children temporarily moved to the isolated layer.
      if (Konva.isDragging() && mountedRef.current) return
      const transform = group.getAbsoluteTransform()
      const leftTop = transform.point({ x: logicalBounds.x, y: logicalBounds.y })
      const rightBottom = transform.point({
        x: logicalBounds.x + logicalBounds.width,
        y: logicalBounds.y + logicalBounds.height,
      })
      // Pre-mount the neighbouring diagrams before a fast mouse/touch pan reaches
      // them. The live layer transform also covers gestures not yet stored in React.
      const intersects = (overscan: number) =>
        stage.width() > 0 &&
        stage.height() > 0 &&
        Math.max(leftTop.x, rightBottom.x) >= -overscan &&
        Math.min(leftTop.x, rightBottom.x) <= stage.width() + overscan &&
        Math.max(leftTop.y, rightBottom.y) >= -overscan &&
        Math.min(leftTop.y, rightBottom.y) <= stage.height() + overscan
      const visible = intersects(600)
      setViewportVisible((previous) => (previous === visible ? previous : visible))
      const scale = Math.max(
        Math.abs(group.getAbsoluteScale().x),
        Math.abs(group.getAbsoluteScale().y)
      )
      if (hasOverview) {
        // Hysteresis prevents detail repeatedly mounting near the threshold.
        wantDetail =
          intersects(160) &&
          !(overviewScaleRef.current ? scale < OVERVIEW_EXIT_ZOOM : scale <= OVERVIEW_ENTER_ZOOM)
        if (wantDetail && overviewScaleRef.current) {
          scheduleLiveGroupDetail(
            window,
            promote,
            liveGroupDetailPriority(stage, leftTop, rightBottom)
          )
        } else if (!wantDetail) {
          cancelLiveGroupDetail(window, promote)
          setOverviewScale(true)
        }
      }
    }
    const schedule = () => scheduleLiveGroupMountCheck(refresh)
    layer.on(
      `xChange${namespace} yChange${namespace} scaleXChange${namespace} scaleYChange${namespace}`,
      schedule
    )
    stage.on(`widthChange${namespace} heightChange${namespace} dragend${namespace}`, schedule)
    refresh()
    return () => {
      active = false
      cancelLiveGroupDetail(window, promote)
      cancelLiveGroupMountCheck(refresh)
      layer.off(namespace)
      stage.off(namespace)
    }
  }, [virtualized, logicalBounds, hasOverview, groupRef])

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    let active = true
    let requests = 0
    const unregister = registerCanvasGroupMaterialization(group, async () => {
      let released = false
      const release = () => {
        if (released) return
        released = true
        requests--
        if (active) KonvaRenderer.flushSyncFromReconciler(() => setExportMounts(requests))
      }
      requests++
      KonvaRenderer.flushSyncFromReconciler(() => setExportMounts(requests))
      try {
        // Newly mounted endpoints may initially render nothing while their SVG
        // image loads. Clone only after those loaders and their React state settle.
        let followupEffects: boolean
        do {
          KonvaRenderer.flushPassiveEffects()
          await awaitPendingSymbolImages()
          if (!active) throw new Error('Diagram unmounted while preparing its export')
          KonvaRenderer.flushSyncFromReconciler(() => {})
          followupEffects = KonvaRenderer.flushPassiveEffects()
        } while (followupEffects)
        return release
      } catch (error) {
        release()
        throw error
      }
    })
    return () => {
      active = false
      unregister()
    }
  }, [groupRef])

  return (
    <Group ref={groupRef} name={name}>
      {mounted ? (
        <ViewportCulledGroup boundsRevision={boundsRevision} conservativeBounds={logicalBounds}>
          {overview && overviewScale && (!forceMounted || (!materializeForcedDetail && !preciseOverview)) && !detailScope.materialized ? (
            <OverviewInteractionContext.Provider value={forwardInteraction}>
              <OverviewPrecisionContext.Provider value={preciseOverview}>
                {overview}
              </OverviewPrecisionContext.Provider>
            </OverviewInteractionContext.Provider>
          ) : (
            <DiagramDetailContext.Provider value={detailScope}>
              {children}
            </DiagramDetailContext.Provider>
          )}
        </ViewportCulledGroup>
      ) : (
        <Rect
          name="onewire-virtual-diagram-bounds"
          {...logicalBounds}
          listening={false}
          opacity={0}
        />
      )}
    </Group>
  )
}
