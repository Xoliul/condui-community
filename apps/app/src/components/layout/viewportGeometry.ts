import type { CanvasType, ViewportLayout } from '@/types/ui'

export interface ViewportZoneRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ViewportPanelZone {
  type: CanvasType
  panelIndex: number
  rect: ViewportZoneRect
}

export interface ViewportDividerSpec {
  direction: 'horizontal' | 'vertical'
  ratio: number
  ratioKey: 'primary' | 'secondary'
  heightFraction?: number
  topFraction?: number
}

export interface ViewportContentRect {
  left: number
  top: number
  width: number
  height: number
}

const FULL_RECT: ViewportZoneRect = {
  left: 0,
  top: 0,
  width: 1,
  height: 1,
}

export function getViewportPanelZones(layout: ViewportLayout): ViewportPanelZone[] {
  const { preset, panels, primaryRatio, secondaryRatio } = layout
  const p0 = panels[0]
  const p1 = panels[1]
  const p2 = panels[2]
  const p3 = panels[3]

  if (preset === 'single' && p0) {
    return [{ type: p0.canvas, panelIndex: 0, rect: FULL_RECT }]
  }

  if (preset === 'sideBySide' && p0 && p1) {
    return [
      { type: p0.canvas, panelIndex: 0, rect: { left: 0, top: 0, width: primaryRatio, height: 1 } },
      {
        type: p1.canvas,
        panelIndex: 1,
        rect: { left: primaryRatio, top: 0, width: 1 - primaryRatio, height: 1 },
      },
    ]
  }

  if (preset === 'stacked' && p0 && p1) {
    return [
      { type: p0.canvas, panelIndex: 0, rect: { left: 0, top: 0, width: 1, height: primaryRatio } },
      {
        type: p1.canvas,
        panelIndex: 1,
        rect: { left: 0, top: primaryRatio, width: 1, height: 1 - primaryRatio },
      },
    ]
  }

  if (preset === 'topPairBottomWide' && p0 && p1 && p2) {
    return [
      {
        type: p0.canvas,
        panelIndex: 0,
        rect: { left: 0, top: 0, width: secondaryRatio, height: primaryRatio },
      },
      {
        type: p1.canvas,
        panelIndex: 1,
        rect: { left: secondaryRatio, top: 0, width: 1 - secondaryRatio, height: primaryRatio },
      },
      {
        type: p2.canvas,
        panelIndex: 2,
        rect: { left: 0, top: primaryRatio, width: 1, height: 1 - primaryRatio },
      },
    ]
  }

  if (preset === 'topWideBottomPair' && p0 && p1 && p2) {
    return [
      { type: p0.canvas, panelIndex: 0, rect: { left: 0, top: 0, width: 1, height: primaryRatio } },
      {
        type: p1.canvas,
        panelIndex: 1,
        rect: { left: 0, top: primaryRatio, width: secondaryRatio, height: 1 - primaryRatio },
      },
      {
        type: p2.canvas,
        panelIndex: 2,
        rect: {
          left: secondaryRatio,
          top: primaryRatio,
          width: 1 - secondaryRatio,
          height: 1 - primaryRatio,
        },
      },
    ]
  }

  if (preset === 'grid' && p0 && p1 && p2 && p3) {
    const top = { top: 0, height: primaryRatio }
    const bottom = { top: primaryRatio, height: 1 - primaryRatio }
    const left = { left: 0, width: secondaryRatio }
    const right = { left: secondaryRatio, width: 1 - secondaryRatio }
    return [
      { type: p0.canvas, panelIndex: 0, rect: { ...left, ...top } },
      { type: p1.canvas, panelIndex: 1, rect: { ...right, ...top } },
      { type: p2.canvas, panelIndex: 2, rect: { ...left, ...bottom } },
      { type: p3.canvas, panelIndex: 3, rect: { ...right, ...bottom } },
    ]
  }

  return p0 ? [{ type: p0.canvas, panelIndex: 0, rect: FULL_RECT }] : []
}

export function getViewportDividerSpecs(layout: ViewportLayout): ViewportDividerSpec[] {
  const { preset, primaryRatio, secondaryRatio, panels } = layout
  const out: ViewportDividerSpec[] = []

  if (preset === 'sideBySide' && panels.length >= 2) {
    out.push({ direction: 'vertical', ratio: primaryRatio, ratioKey: 'primary' })
  } else if (preset === 'stacked' && panels.length >= 2) {
    out.push({ direction: 'horizontal', ratio: primaryRatio, ratioKey: 'primary' })
  } else if (preset === 'topPairBottomWide' && panels.length >= 3) {
    out.push({ direction: 'horizontal', ratio: primaryRatio, ratioKey: 'primary' })
    out.push({
      direction: 'vertical',
      ratio: secondaryRatio,
      ratioKey: 'secondary',
      heightFraction: primaryRatio,
    })
  } else if (preset === 'grid' && panels.length >= 4) {
    out.push({ direction: 'horizontal', ratio: primaryRatio, ratioKey: 'primary' })
    out.push({ direction: 'vertical', ratio: secondaryRatio, ratioKey: 'secondary' })
  } else if (preset === 'topWideBottomPair' && panels.length >= 3) {
    out.push({ direction: 'horizontal', ratio: primaryRatio, ratioKey: 'primary' })
    out.push({
      direction: 'vertical',
      ratio: secondaryRatio,
      ratioKey: 'secondary',
      topFraction: primaryRatio,
      heightFraction: 1 - primaryRatio,
    })
  }

  return out
}

export function getViewportPanelAtClientPoint(
  layout: ViewportLayout,
  contentRect: ViewportContentRect,
  clientX: number,
  clientY: number
): ViewportPanelZone | null {
  if (contentRect.width <= 0 || contentRect.height <= 0) return null

  const relX = (clientX - contentRect.left) / contentRect.width
  const relY = (clientY - contentRect.top) / contentRect.height

  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null

  return (
    getViewportPanelZones(layout).find((zone) => {
      const { left, top, width, height } = zone.rect
      return relX >= left && relX <= left + width && relY >= top && relY <= top + height
    }) ?? null
  )
}
