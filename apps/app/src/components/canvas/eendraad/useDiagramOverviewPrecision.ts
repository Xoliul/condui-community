import { useLayoutEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import {
  cancelLiveGroupMountCheck,
  scheduleLiveGroupMountCheck,
} from '@/lib/canvas/liveGroupMountScheduling'
import {
  cancelLiveGroupDetail,
  liveGroupDetailPriority,
  scheduleLiveGroupDetail,
} from '@/lib/canvas/liveGroupDetailScheduling'

let nextSubscription = 0
// A 32-unit symbol needs about seven screen pixels before individual picking
// is useful. Hysteresis avoids rebuilding proxies around that boundary.
const PRECISE_ENTER_ZOOM = 0.22
const PRECISE_EXIT_ZOOM = 0.18

export function useDiagramOverviewPrecision(
  initialZoom: number,
  bounds: { x: number; y: number; width: number; height: number },
  enabled: boolean,
  richDetailZoom: number,
) {
  const groupRef = useRef<Konva.Group>(null)
  const [precise, setPrecise] = useState(initialZoom >= PRECISE_ENTER_ZOOM && initialZoom < richDetailZoom)
  const preciseRef = useRef(precise)
  useLayoutEffect(() => { preciseRef.current = precise }, [precise])
  useLayoutEffect(() => {
    if (!enabled) return
    const group = groupRef.current,
      layer = group?.getLayer(),
      stage = group?.getStage()
    if (!group || !layer || !stage) return
    const window = stage.container().ownerDocument.defaultView!
    const namespace = `.overviewPrecision${++nextSubscription}`
    let active = true
    let wanted = false
    const promote = () => {
      if (active && wanted) setPrecise(true)
    }
    const refresh = () => {
      if (!active) return
      const transform = group.getAbsoluteTransform()
      const start = transform.point(bounds)
      const end = transform.point({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
      const scale = group.getAbsoluteScale()
      const zoom = Math.max(Math.abs(scale.x), Math.abs(scale.y))
      wanted = stage.width() > 0 && stage.height() > 0 &&
        Math.max(start.x, end.x) >= -160 && Math.min(start.x, end.x) <= stage.width() + 160 &&
        Math.max(start.y, end.y) >= -160 && Math.min(start.y, end.y) <= stage.height() + 160 &&
        zoom >= (preciseRef.current ? PRECISE_EXIT_ZOOM : PRECISE_ENTER_ZOOM) && zoom < richDetailZoom
      if (wanted && !preciseRef.current) {
        scheduleLiveGroupDetail(window, promote, liveGroupDetailPriority(stage, start, end))
      } else if (!wanted) {
        cancelLiveGroupDetail(window, promote)
        setPrecise(false)
      }
    }
    const schedule = () => scheduleLiveGroupMountCheck(refresh)
    layer.on(`xChange${namespace} yChange${namespace} scaleXChange${namespace} scaleYChange${namespace}`, schedule)
    stage.on(`widthChange${namespace} heightChange${namespace}`, schedule)
    refresh()
    return () => {
      active = false
      cancelLiveGroupDetail(window, promote)
      cancelLiveGroupMountCheck(refresh)
      layer.off(namespace)
      stage.off(namespace)
    }
  }, [bounds, enabled, richDetailZoom])
  return { groupRef, precise }
}
