import type { WireSegment } from '@/types/schema'

export type LocalWireRender = {
  origin: { x: number; y: number }
  wire: WireSegment
}

const localWireRenderCache = new Map<string, { signature: string; wire: WireSegment }>()
const MAX_LOCAL_WIRE_RENDERS = 5000

export function localizeWireSegment(wire: WireSegment): LocalWireRender {
  const origin = wire.startPoint
  const localized: WireSegment = {
    ...wire,
    startPoint: { x: 0, y: 0 },
    endPoint: {
      x: wire.endPoint.x - origin.x,
      y: wire.endPoint.y - origin.y,
    },
    ...(wire.phaseLabelAnchor
      ? {
          phaseLabelAnchor: {
            x: wire.phaseLabelAnchor.x - origin.x,
            y: wire.phaseLabelAnchor.y - origin.y,
          },
        }
      : {}),
    ...(wire.wireLabelBaseEndPoint
      ? {
          wireLabelBaseEndPoint: {
            x: wire.wireLabelBaseEndPoint.x - origin.x,
            y: wire.wireLabelBaseEndPoint.y - origin.y,
          },
        }
      : {}),
    ...(wire.wireLabelEndPoint
      ? {
          wireLabelEndPoint: {
            x: wire.wireLabelEndPoint.x - origin.x,
            y: wire.wireLabelEndPoint.y - origin.y,
          },
        }
      : {}),
    ...(wire.supplySeparatorX !== undefined
      ? { supplySeparatorX: wire.supplySeparatorX - origin.x }
      : {}),
  }
  const cacheKey = `${wire.panelId}:${wire.diagramId ?? wire.panelId}:${wire.id}`
  const signature = JSON.stringify(localized)
  const cached = localWireRenderCache.get(cacheKey)
  if (cached?.signature === signature) {
    localWireRenderCache.delete(cacheKey)
    localWireRenderCache.set(cacheKey, cached)
    return { origin, wire: cached.wire }
  }
  localWireRenderCache.set(cacheKey, { signature, wire: localized })
  if (localWireRenderCache.size > MAX_LOCAL_WIRE_RENDERS) {
    const oldestKey = localWireRenderCache.keys().next().value
    if (oldestKey) localWireRenderCache.delete(oldestKey)
  }
  return { origin, wire: localized }
}
