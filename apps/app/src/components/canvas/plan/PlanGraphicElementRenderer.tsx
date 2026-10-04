import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Ellipse, Group, Line, Path, Rect, RegularPolygon, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { PlanGraphicElement, Point2 } from '@/types/schema'
import {
  getPlanGraphicElementAsset,
  PLAN_GRAPHIC_ELEMENT_KONVA_NAME,
  PLAN_GRAPHIC_EXPORT_ATTR_ASSET_ID,
  PLAN_GRAPHIC_EXPORT_ATTR_HEIGHT,
  PLAN_GRAPHIC_EXPORT_ATTR_WIDTH,
} from '@/lib/plan/graphicElements'
import {
  PLAN_GRAPHIC_LABEL_FILL_DARK,
  PLAN_GRAPHIC_LABEL_FILL_LIGHT,
  PLAN_GRAPHIC_STROKE_DARK,
  PLAN_GRAPHIC_STROKE_LIGHT,
} from '@/lib/plan/planGraphicColors'
import { getThemeColor } from '@/lib/theme/colors'
import { isPrimaryPlanActivationEvent } from '@/lib/canvas/planPointerEvent'
import {
  DRAW_TOOL_STROKE_PX,
  DRAW_TOOL_STROKE_PX_MAX,
  DRAW_TOOL_STROKE_PX_MIN,
  HOVER_OUTLINE_DASH_PX,
  HOVER_OUTLINE_DASH_PX_MAX,
  HOVER_OUTLINE_DASH_PX_MIN,
  HOVER_OUTLINE_STROKE_PX,
  HOVER_OUTLINE_STROKE_PX_MAX,
  HOVER_OUTLINE_STROKE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import {
  clearFloorPlanDrawDimensionEditor,
  setFloorPlanDrawDimensionEditor,
} from './floorPlanDrawDimensionEditorStore'
import { normalizeDimensionRotationDeg } from '@/lib/plan/dimensionDragGesture'
import { scalePlanGraphicPath, scalePlanGraphicPathUniformly } from '@/lib/plan/planGraphicPath'
import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'

const PLAN_GRAPHIC_HOVER_COLOR = '#eab308'

export type GraphicElementSnapGuide = { from: Point2; to: Point2 }

export type GraphicElementSnapFloorPointResult = {
  point: Point2
  guides: GraphicElementSnapGuide[]
}

interface PlanGraphicElementRendererProps {
  elements: PlanGraphicElement[]
  selectedIds: string[]
  active: boolean
  zoom: number
  canvasPxPerMeter: number
  themeMode: 'light' | 'dark'
  fontFamily: string
  snapFloorPoint?: (point: Point2) => GraphicElementSnapFloorPointResult
  onSnapGuidesChange?: (guides: GraphicElementSnapGuide[]) => void
  onSelect: (
    elementId: string,
    event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  ) => void
  onMove: (elementId: string, pos: Point2) => void
  onResize: (elementId: string, size: { width: number; height: number }) => void
  onRotate: (elementId: string, rotationDeg: number) => void
}

type DimensionField = 'width' | 'height'
type PlanGraphicPointerEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent>

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function fitX(value: number, viewBoxWidth: number, width: number): number {
  return -width / 2 + (value / viewBoxWidth) * width
}

function fitY(value: number, viewBoxHeight: number, height: number): number {
  return -height / 2 + (value / viewBoxHeight) * height
}

function fitLinePoints(
  points: number[],
  viewBoxWidth: number,
  viewBoxHeight: number,
  width: number,
  height: number
): number[] {
  const fitted: number[] = []
  for (let index = 0; index < points.length; index += 2) {
    fitted.push(
      fitX(points[index] ?? 0, viewBoxWidth, width),
      fitY(points[index + 1] ?? 0, viewBoxHeight, height)
    )
  }
  return fitted
}

function fitPathData(
  data: string,
  viewBoxWidth: number,
  viewBoxHeight: number,
  width: number,
  height: number
): string {
  return scalePlanGraphicPath(data, viewBoxWidth, viewBoxHeight, width, height)
}

function fitPathDataUniformly(
  data: string,
  viewBoxWidth: number,
  viewBoxHeight: number,
  width: number,
  height: number
): string {
  return scalePlanGraphicPathUniformly(data, viewBoxWidth, viewBoxHeight, width, height)
}

export function PlanGraphicElementShape({
  element,
  themeMode,
  listening = false,
  strokeColor,
}: {
  element: Pick<PlanGraphicElement, 'kind' | 'width' | 'height'>
  themeMode: 'light' | 'dark'
  listening?: boolean
  strokeColor?: string
}) {
  const w = element.width
  const h = element.height
  const x = -w / 2
  const y = -h / 2
  const graphicStrokeColor =
    strokeColor ?? (themeMode === 'dark' ? PLAN_GRAPHIC_STROKE_DARK : PLAN_GRAPHIC_STROKE_LIGHT)
  const common = {
    stroke: graphicStrokeColor,
    strokeWidth: 1,
    listening,
  }
  const lineCommon = {
    ...common,
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
  }
  const pathCommon = {
    ...lineCommon,
    fill: undefined,
  }

  switch (element.kind) {
    case 'kitchen_cabinet':
      return (
        <>
          <Rect x={x} y={y} width={w} height={h} {...common} />
          <Line points={[x, y, x + w, y + h]} {...lineCommon} />
          <Line points={[x + w, y, x, y + h]} {...lineCommon} />
        </>
      )
    case 'shower': {
      const showerHeadSize = Math.min(w, h)
      return (
        <>
          <Rect
            x={x}
            y={y}
            width={w}
            height={h}
            cornerRadius={Math.min(w, h) * 0.0514}
            {...common}
          />
          <Circle
            x={fitX(16.39, 100, w)}
            y={fitY(85.01, 100, h)}
            radius={Math.min(w, h) * 0.0789}
            {...common}
          />
          <Path
            data={fitPathDataUniformly(
              'M57.89,32.49c0,4.35-3.53,7.89-7.89,7.89s-7.89-3.54-7.89-7.89c0-3.34,2.07-6.19,5-7.34V4.98c0-.98.8-1.78,1.78-1.78h2.44c.99,0,1.78.8,1.78,1.78v20.26c2.81,1.2,4.78,4,4.78,7.25Z',
              100,
              100,
              w,
              h
            )}
            x={-showerHeadSize / 2}
            y={y}
            {...pathCommon}
          />
        </>
      )
    }
    case 'bathtub':
      return (
        <>
          <Rect
            x={fitX(2.72, 170, w)}
            y={fitY(2.89, 75, h)}
            width={(164.56 / 170) * w}
            height={(69.22 / 75) * h}
            cornerRadius={Math.min((10 / 170) * w, (10 / 75) * h)}
            {...common}
          />
          <Rect
            x={fitX(11.28, 170, w)}
            y={fitY(10.89, 75, h)}
            width={(133.11 / 170) * w}
            height={(53.22 / 75) * h}
            cornerRadius={Math.min((20 / 170) * w, (20 / 75) * h)}
            {...common}
          />
          <Line
            points={fitLinePoints(
              [147.54, 17.99, 161.94, 17.99, 161.94, 57.01, 147.54, 57.01],
              170,
              75,
              w,
              h
            )}
            {...lineCommon}
          />
          <Ellipse
            x={fitX(154.74, 170, w)}
            y={fitY(36.82, 75, h)}
            radiusX={(3.09 / 170) * w}
            radiusY={(3.12 / 75) * h}
            {...common}
          />
        </>
      )
    case 'washbasin':
      return (
        <>
          <Rect
            x={fitX(0.5, 60, w)}
            y={fitY(0.56, 45, h)}
            width={(59 / 60) * w}
            height={(43.89 / 45) * h}
            cornerRadius={Math.min((6 / 60) * w, (6 / 45) * h)}
            {...common}
          />
          <Ellipse
            x={fitX(30, 60, w)}
            y={fitY(24.49, 45, h)}
            radiusX={(26.1 / 60) * w}
            radiusY={(16.17 / 45) * h}
            {...common}
          />
          <Ellipse
            x={fitX(30, 60, w)}
            y={fitY(24.49, 45, h)}
            radiusX={(3.62 / 60) * w}
            radiusY={(3.49 / 45) * h}
            {...common}
          />
          <Ellipse
            x={fitX(30, 60, w)}
            y={fitY(4.44, 45, h)}
            radiusX={(2.11 / 60) * w}
            radiusY={(2.03 / 45) * h}
            {...common}
          />
        </>
      )
    case 'toilet':
      return (
        <Path
          data={fitPathData(
            'M20,55c11.35,0,16.84-8.81,16.84-24.12C36.84,15.57,33.91,0,33.91,0c0,0-13.91,0-13.91,0H6.09s-2.93,15.57-2.93,30.88c0,15.31,5.49,24.12,16.84,24.12Z',
            40,
            55,
            w,
            h
          )}
          x={x}
          y={y}
          {...pathCommon}
        />
      )
    case 'car':
      return (
        <Group listening={false}>
          {[
            'M5.71,40c0-13.36,1.39-17.81,3.08-22.11s4.93-6.23,6.62-6.83,1.57-2.14.94-3.52',
            'M44.97,11.21l75.59-1.19s-17.4,5.94-27.1,7.42-21,1.36-28.17.59c-11.09-1.19-20.32-6.83-20.32-6.83Z',
            'M113.17,10.14c-.46-5.76-3.54-8.72-1.69-9.91s8.01,2.37,8.31,9.8',
            'M118.58,74.87h27.85c13.55,0,16.63-1.04,21.39-3.55,4.77-2.54,12.17-10.55,12.17-31.31v-.02c0-20.76-7.39-28.77-12.16-31.31-4.77-2.51-7.84-3.55-21.39-3.55h-27.85',
            'M112.07,74.87H39.27c-22.48,0-29.26-4.59-32.34-6.68-3.08-2.08-6.93-9.06-6.93-28.18v-.02C0,20.86,3.86,13.89,6.93,11.8c3.08-2.08,9.87-6.68,32.34-6.68h72.8',
            'M5.71,40c0,13.36,1.39,17.81,3.08,22.11s4.93,6.23,6.62,6.83,1.57,2.14.94,3.52',
            'M44.97,68.79l75.59,1.19s-17.4-5.94-27.1-7.42c-9.7-1.48-21-1.36-28.17-.59-11.09,1.19-20.32,6.83-20.32,6.83Z',
            'M47.74,40c0,11.87,2.93,18.55,2.93,18.55l-21.55,5.79s-5.85-10.09-5.85-24.34h0c0-14.25,5.85-24.34,5.85-24.34l21.55,5.79s-2.93,6.68-2.93,18.55',
            'M134.57,40c0,16.62-6.31,27.31-6.31,27.31l-24.94-7.72s2.77-4.16,2.77-19.59h0c0-15.44-2.77-19.59-2.77-19.59l24.94-7.72s6.31,10.69,6.31,27.31',
            'M162.91,73.43s-.48-1.82-.63-2.86,2.77-2.04,5.7-4.88,6.31-7.74,6.31-25.69h0c0-17.96-3.39-22.86-6.31-25.69s-5.85-3.84-5.7-4.88.63-2.86.63-2.86',
            'M113.16,69.86c-.46,5.76-3.54,8.72-1.69,9.91s8.01-2.37,8.31-9.8',
          ].map((data, index) => (
            <Path
              key={index}
              data={fitPathData(data, 180, 80, w, h)}
              x={x}
              y={y}
              stroke={graphicStrokeColor}
              strokeWidth={1}
              fill={undefined}
              listening={false}
              lineCap="round"
              lineJoin="round"
            />
          ))}
          {(
            [
              [9.56, 16.26, 29.11, 15.66],
              [173.07, 24.71, 128.26, 12.69],
              [80.34, 10.65, 78.5, 18.59],
              [9.56, 63.74, 29.11, 64.34],
              [173.06, 55.29, 128.26, 67.31],
              [80.34, 69.35, 78.49, 61.41],
            ] as Array<[number, number, number, number]>
          ).map(([x1, y1, x2, y2], index) => (
            <Line
              key={`line-${index}`}
              points={fitLinePoints([x1, y1, x2, y2], 180, 80, w, h)}
              stroke={graphicStrokeColor}
              strokeWidth={1}
              listening={false}
              lineCap="round"
              lineJoin="round"
            />
          ))}
        </Group>
      )
    case 'rectangle':
    default:
      return <Rect x={x} y={y} width={w} height={h} {...common} />
  }
}

interface GraphicElementNodeProps extends Omit<PlanGraphicElementRendererProps, 'elements'> {
  element: PlanGraphicElement
  selected: boolean
}

function rotatePoint2(point: Point2, angleDeg: number): Point2 {
  const angle = (angleDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

function worldToElementLocal(point: Point2, center: Point2, rotationDeg: number): Point2 {
  return rotatePoint2({ x: point.x - center.x, y: point.y - center.y }, -rotationDeg)
}

function constrainFloorDeltaToElementAxis(
  floorDelta: Point2,
  rotationDeg: number,
  axisMode: 'horizontal' | 'vertical'
): Point2 {
  const local = rotatePoint2(floorDelta, -rotationDeg)
  const constrainedLocal = axisMode === 'horizontal' ? { x: local.x, y: 0 } : { x: 0, y: local.y }
  return rotatePoint2(constrainedLocal, rotationDeg)
}

/** Keep a floor point on the element axis through axisOrigin (after 2D snap). */
function projectFloorPointOntoElementAxis(
  point: Point2,
  axisOrigin: Point2,
  rotationDeg: number,
  axisMode: 'horizontal' | 'vertical'
): Point2 {
  const axisDir = rotatePoint2(
    axisMode === 'horizontal' ? { x: 1, y: 0 } : { x: 0, y: 1 },
    rotationDeg
  )
  const t = (point.x - axisOrigin.x) * axisDir.x + (point.y - axisOrigin.y) * axisDir.y
  return {
    x: axisOrigin.x + t * axisDir.x,
    y: axisOrigin.y + t * axisDir.y,
  }
}

function GraphicElementNode({
  element,
  selected,
  selectedIds,
  active,
  zoom,
  canvasPxPerMeter,
  themeMode,
  fontFamily,
  snapFloorPoint,
  onSnapGuidesChange,
  onSelect,
  onMove,
  onResize,
  onRotate,
}: GraphicElementNodeProps) {
  const asset = getPlanGraphicElementAsset(element.assetId)
  const selectionColor = getThemeColor(themeMode, 'selectionColor')
  const locked = element.sizeLocked || asset?.sizeLocked
  const [editingField, setEditingField] = useState<DimensionField | null>(null)
  const [draftText, setDraftText] = useState('')
  const [interactionDraft, setInteractionDraft] = useState<PlanGraphicElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const interactionDraftRef = useRef<PlanGraphicElement | null>(null)
  const resizeBaseRef = useRef<PlanGraphicElement | null>(null)
  const rotationBaseRef = useRef<PlanGraphicElement | null>(null)
  const moveBaseRef = useRef<PlanGraphicElement | null>(null)
  const movePointerStartRef = useRef<Point2 | null>(null)
  const moveAxisModeRef = useRef<'horizontal' | 'vertical'>('horizontal')
  const renderElement = interactionDraft ?? element

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  useEffect(() => {
    if (!selected || !active) {
      setEditingField(null)
      setDraftText('')
      setInteractionDraft(null)
      interactionDraftRef.current = null
      if (!selected || !active) {
        onSnapGuidesChange?.([])
      }
    }
    if (!active) {
      setIsHovered(false)
    }
  }, [active, onSnapGuidesChange, selected])

  const setFastDraft = (nextElement: PlanGraphicElement | null) => {
    interactionDraftRef.current = nextElement
    setInteractionDraft(nextElement)
  }

  useEffect(() => {
    if (!editingField || locked) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        setDraftText((current) => `${current}${event.key}`)
        return
      }
      if ((event.key === '.' || event.key === ',') && !draftText.includes('.')) {
        event.preventDefault()
        setDraftText((current) => `${current}.`)
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        setDraftText((current) => current.slice(0, -1))
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setEditingField(null)
        setDraftText('')
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const valueCm = Number.parseFloat(draftText.replace(',', '.'))
        if (Number.isFinite(valueCm) && valueCm > 0 && canvasPxPerMeter > 0) {
          const nextPx = (valueCm / 100) * canvasPxPerMeter
          onResize(
            element.id,
            editingField === 'width'
              ? { width: nextPx, height: element.height }
              : { width: element.width, height: nextPx }
          )
        }
        setEditingField(null)
        setDraftText('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canvasPxPerMeter, draftText, editingField, element, locked, onResize])

  const strokeWidth = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_STROKE_PX,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX
  )
  const hoverStrokeWidth = screenPxToCanvasUnits(
    zoom,
    HOVER_OUTLINE_STROKE_PX,
    HOVER_OUTLINE_STROKE_PX_MIN,
    HOVER_OUTLINE_STROKE_PX_MAX
  )
  const hoverDash = screenPxToCanvasUnits(
    zoom,
    HOVER_OUTLINE_DASH_PX,
    HOVER_OUTLINE_DASH_PX_MIN,
    HOVER_OUTLINE_DASH_PX_MAX
  )
  const handleOffset = 16 / zoom
  const fontSize = 12 / zoom
  const paddingX = 7 / zoom
  const paddingY = 4 / zoom
  const handleSize = Math.max(11 / zoom, 8)
  const handleStrokeWidth = Math.max(2 / zoom, 1.5)
  const rotationHandleRadius = renderElement.height / 2 + handleOffset + handleSize * 4.6
  const handleFillColor = '#ffffff'
  const handleStrokeColor = '#0284c7'
  const moveHandleRadius = handleSize * 0.82

  const applyFloorSnap = (point: Point2): Point2 => {
    if (!snapFloorPoint) return point
    const result = snapFloorPoint(point)
    onSnapGuidesChange?.(result.guides)
    return result.point
  }

  const clearSnapGuides = () => {
    onSnapGuidesChange?.([])
  }

  const getElementFromMoveHandle = (event: PlanGraphicPointerEvent): PlanGraphicElement | null => {
    const base = moveBaseRef.current ?? renderElement
    const startPointer = movePointerStartRef.current
    const pointer = getPointerInElementParent(event)
    if (!startPointer || !pointer) return null
    const rotationDeg = base.rotationDeg ?? 0
    const axisMode = moveAxisModeRef.current
    const floorDelta = constrainFloorDeltaToElementAxis(
      { x: pointer.x - startPointer.x, y: pointer.y - startPointer.y },
      rotationDeg,
      axisMode
    )
    const axisOrigin = base.pos
    const snapped = applyFloorSnap({
      x: axisOrigin.x + floorDelta.x,
      y: axisOrigin.y + floorDelta.y,
    })
    const nextPos = projectFloorPointOntoElementAxis(snapped, axisOrigin, rotationDeg, axisMode)
    return {
      ...base,
      pos: nextPos,
    }
  }

  const getElementFromResizeEvent = (
    event: PlanGraphicPointerEvent,
    signX: -1 | 1,
    signY: -1 | 1
  ): PlanGraphicElement | null => {
    const pointer = getPointerInElementParent(event)
    if (!pointer) return null
    const base = resizeBaseRef.current ?? renderElement
    const snappedPointer = applyFloorSnap(pointer)
    const localHandle = worldToElementLocal(snappedPointer, base.pos, base.rotationDeg ?? 0)
    return getElementFromCornerHandle(localHandle.x, localHandle.y, signX, signY)
  }

  const getElementFromCornerHandle = (
    handleX: number,
    handleY: number,
    signX: -1 | 1,
    signY: -1 | 1
  ): PlanGraphicElement => {
    const base = resizeBaseRef.current ?? renderElement
    const opposite = {
      x: (-signX * base.width) / 2,
      y: (-signY * base.height) / 2,
    }
    const minSize = Math.max(8, canvasPxPerMeter * 0.1)
    const nextWidth = Math.max(minSize, Math.abs(handleX - opposite.x))
    const nextHeight = Math.max(minSize, Math.abs(handleY - opposite.y))
    const nextCenterLocal = {
      x: (handleX + opposite.x) / 2,
      y: (handleY + opposite.y) / 2,
    }
    const centerDelta = rotatePoint2(nextCenterLocal, base.rotationDeg ?? 0)
    return {
      ...base,
      width: nextWidth,
      height: nextHeight,
      pos: {
        x: base.pos.x + centerDelta.x,
        y: base.pos.y + centerDelta.y,
      },
    }
  }

  const snapAngle = (angleDeg: number, event: MouseEvent | TouchEvent | PointerEvent) => {
    const step = event.ctrlKey || event.metaKey ? 90 : event.shiftKey ? 45 : 0
    if (!step) return angleDeg
    return Math.round(angleDeg / step) * step
  }

  const getPointerInElementParent = (event: PlanGraphicPointerEvent): Point2 | null => {
    const stage = event.target?.getStage?.()
    const pointer = stage?.getPointerPosition?.()
    const overlayGroup = event.target?.getParent?.()
    const elementNode = overlayGroup?.getParent?.()
    const elementParent = elementNode?.getParent?.()
    if (!pointer || !elementParent?.getAbsoluteTransform) return null
    // Convert to the element's parent (plan) space. Using the element node's
    // transform here would already apply its rotation, which move and resize
    // handlers account for separately below.
    const transform = elementParent.getAbsoluteTransform().copy().invert()
    return transform.point(pointer)
  }

  const updateRotationFromPointer = (event: PlanGraphicPointerEvent): PlanGraphicElement | null => {
    const pointer = getPointerInElementParent(event)
    if (!pointer) return null
    const base = rotationBaseRef.current ?? renderElement
    const angle = (Math.atan2(pointer.y - base.pos.y, pointer.x - base.pos.x) * 180) / Math.PI + 90
    const rotationDeg = snapAngle(angle, event.evt as MouseEvent | PointerEvent)
    const nextElement = { ...base, rotationDeg }
    setFastDraft(nextElement)
    event.target.position({ x: 0, y: -rotationHandleRadius })
    return nextElement
  }

  const estimateDimensionLabelBoxWidth = (valuePx: number, field: DimensionField) => {
    const valueCm = canvasPxPerMeter > 0 ? (valuePx / canvasPxPerMeter) * 100 : 0
    const activeField = editingField === field
    const value = activeField && draftText ? draftText : `${Math.round(valueCm)}`
    const text = `${value} cm`
    return Math.max(44 / zoom, text.length * fontSize * 0.62 + paddingX * 2)
  }

  const heightLabelCenterX = renderElement.width / 2 + handleOffset
  const heightLabelBoxWidth = estimateDimensionLabelBoxWidth(renderElement.height, 'height')
  const dimensionLabelGap = moveHandleRadius * 1.35
  const rightHandleX =
    heightLabelCenterX + heightLabelBoxWidth / 2 + dimensionLabelGap + moveHandleRadius

  const dimensionEditorOwnerId = `graphic:${element.id}`
  useEffect(() => {
    if (!editingField || locked || !selected || !active) {
      clearFloorPlanDrawDimensionEditor(dimensionEditorOwnerId)
      return
    }

    const widthField = editingField === 'width'
    const localAnchor = widthField
      ? {
          x: 0,
          y: -renderElement.height / 2 - handleOffset - moveHandleRadius * 2.7,
        }
      : { x: heightLabelCenterX, y: 0 }
    const rotatedAnchor = rotatePoint2(localAnchor, renderElement.rotationDeg ?? 0)
    const valuePx = widthField ? renderElement.width : renderElement.height
    const valueCm = canvasPxPerMeter > 0 ? (valuePx / canvasPxPerMeter) * 100 : 0

    setFloorPlanDrawDimensionEditor({
      ownerId: dimensionEditorOwnerId,
      fields: [
        {
          id: editingField,
          anchor: {
            x: renderElement.pos.x + rotatedAnchor.x,
            y: renderElement.pos.y + rotatedAnchor.y,
          },
          placement: 'center',
          value: draftText || `${Math.round(valueCm)}`,
          active: true,
          rotationDeg: normalizeDimensionRotationDeg(
            (renderElement.rotationDeg ?? 0) + (widthField ? 0 : 90)
          ),
        },
      ],
      onActivate: () => undefined,
      onChange: (_id, value) => setDraftText(value),
      onEnter: () => {
        const nextValueCm = Number.parseFloat(draftText.replace(',', '.'))
        if (Number.isFinite(nextValueCm) && nextValueCm > 0 && canvasPxPerMeter > 0) {
          const nextPx = (nextValueCm / 100) * canvasPxPerMeter
          onResize(
            element.id,
            editingField === 'width'
              ? { width: nextPx, height: element.height }
              : { width: element.width, height: nextPx }
          )
        }
        setEditingField(null)
        setDraftText('')
      },
      onTab: () => {
        setEditingField((field) => (field === 'width' ? 'height' : 'width'))
        setDraftText('')
      },
      onEscape: () => {
        setEditingField(null)
        setDraftText('')
      },
    })
  }, [
    active,
    canvasPxPerMeter,
    dimensionEditorOwnerId,
    draftText,
    editingField,
    element.height,
    element.id,
    element.width,
    handleOffset,
    heightLabelCenterX,
    locked,
    moveHandleRadius,
    onResize,
    renderElement.height,
    renderElement.pos.x,
    renderElement.pos.y,
    renderElement.rotationDeg,
    renderElement.width,
    selected,
  ])

  useEffect(
    () => () => clearFloorPlanDrawDimensionEditor(dimensionEditorOwnerId),
    [dimensionEditorOwnerId]
  )

  const renderDimensionBox = (
    field: DimensionField,
    x: number,
    y: number,
    valuePx: number,
    rotationDeg: number
  ) => {
    const valueCm = canvasPxPerMeter > 0 ? (valuePx / canvasPxPerMeter) * 100 : 0
    const activeField = editingField === field
    const value = activeField && draftText ? draftText : `${Math.round(valueCm)}`
    const text = `${value} cm`
    const boxWidth = estimateDimensionLabelBoxWidth(valuePx, field)
    const boxHeight = fontSize + paddingY * 2
    if (activeField) return null
    return (
      <Group
        x={x}
        y={y}
        rotation={rotationDeg}
        listening={active && selected && !locked}
        onPointerDown={(event) => {
          if (!isPrimaryPlanActivationEvent(event.evt)) return
          event.cancelBubble = true
          if (locked) return
          setEditingField(field)
          setDraftText('')
        }}
        onClick={(event) => {
          if (!isPrimaryPlanActivationEvent(event.evt)) return
          event.cancelBubble = true
          if (locked) return
          setEditingField(field)
          setDraftText('')
        }}
        onTap={(event) => {
          event.cancelBubble = true
          if (locked) return
          setEditingField(field)
          setDraftText('')
        }}
      >
        <Rect
          x={-boxWidth / 2}
          y={-boxHeight / 2}
          width={boxWidth}
          height={boxHeight}
          fill={themeMode === 'dark' ? PLAN_GRAPHIC_LABEL_FILL_DARK : PLAN_GRAPHIC_LABEL_FILL_LIGHT}
          stroke={locked ? '#9ca3af' : '#0284c7'}
          strokeWidth={strokeWidth}
          cornerRadius={4 / zoom}
        />
        <Text
          x={-boxWidth / 2}
          y={-boxHeight / 2}
          width={boxWidth}
          height={boxHeight}
          align="center"
          verticalAlign="middle"
          text={text}
          fontSize={fontSize}
          fontFamily={fontFamily}
          fontStyle="bold"
          fill={
            activeField
              ? '#0284c7'
              : themeMode === 'dark'
                ? PLAN_GRAPHIC_STROKE_DARK
                : PLAN_GRAPHIC_STROKE_LIGHT
          }
        />
      </Group>
    )
  }

  const renderMoveHandle = (
    key: string,
    x: number,
    y: number,
    rotation: number,
    axisMode: 'horizontal' | 'vertical'
  ) => {
    const baseHandle = { x, y }
    return (
      <RegularPolygon
        key={key}
        x={x}
        y={y}
        sides={3}
        radius={moveHandleRadius}
        rotation={rotation}
        fill={handleFillColor}
        stroke={handleStrokeColor}
        strokeWidth={handleStrokeWidth}
        listening={active}
        draggable={active}
        onDragStart={(event) => {
          moveAxisModeRef.current = axisMode
          moveBaseRef.current = renderElement
          movePointerStartRef.current = getPointerInElementParent(event)
        }}
        onPointerDown={(event) => {
          if (!isPrimaryPlanActivationEvent(event.evt)) return
          event.cancelBubble = true
          onSelect(element.id)
          moveAxisModeRef.current = axisMode
          moveBaseRef.current = renderElement
          movePointerStartRef.current = getPointerInElementParent(event)
        }}
        onDragMove={(event) => {
          event.cancelBubble = true
          const nextElement = getElementFromMoveHandle(event)
          if (nextElement) setFastDraft(nextElement)
          event.target.position(baseHandle)
        }}
        onDragEnd={(event) => {
          event.cancelBubble = true
          const nextElement = interactionDraftRef.current ?? getElementFromMoveHandle(event)
          if (nextElement) onMove(element.id, nextElement.pos)
          moveBaseRef.current = null
          movePointerStartRef.current = null
          setFastDraft(null)
          clearSnapGuides()
          event.target.position(baseHandle)
        }}
      />
    )
  }

  return (
    <Group
      name={PLAN_GRAPHIC_ELEMENT_KONVA_NAME}
      {...{
        [PLAN_GRAPHIC_EXPORT_ATTR_ASSET_ID]: element.assetId,
        [PLAN_GRAPHIC_EXPORT_ATTR_WIDTH]: renderElement.width,
        [PLAN_GRAPHIC_EXPORT_ATTR_HEIGHT]: renderElement.height,
      }}
      x={renderElement.pos.x}
      y={renderElement.pos.y}
      rotation={renderElement.rotationDeg ?? 0}
      listening={active}
      draggable={active && selected}
      onPointerDown={(event) => {
        if (!isPrimaryPlanActivationEvent(event.evt)) return
        event.cancelBubble = true
        onSelect(
          element.id,
          event.evt as { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
        )
      }}
      onClick={(event) => {
        if (!isPrimaryPlanActivationEvent(event.evt)) return
        event.cancelBubble = true
        onSelect(
          element.id,
          event.evt as { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
        )
      }}
      onTap={(event) => {
        event.cancelBubble = true
        onSelect(
          element.id,
          event.evt as { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
        )
      }}
      onDragStart={() => {
        onSelect(element.id)
        moveBaseRef.current = renderElement
      }}
      onDragMove={(event) => {
        const pos = applyFloorSnap({ x: event.target.x(), y: event.target.y() })
        event.target.position(pos)
      }}
      onDragEnd={(event) => {
        moveBaseRef.current = null
        movePointerStartRef.current = null
        clearSnapGuides()
        const pos = applyFloorSnap({ x: event.target.x(), y: event.target.y() })
        event.target.position(pos)
        onMove(element.id, pos)
      }}
    >
      <Rect
        x={-renderElement.width / 2}
        y={-renderElement.height / 2}
        width={renderElement.width}
        height={renderElement.height}
        fill="rgba(0,0,0,0.001)"
        listening={active}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
      <PlanGraphicElementShape element={renderElement} themeMode={themeMode} />
      {active && !selected && isHovered && (
        <Rect
          name={INTERACTIVE_OVERLAY_EXPORT_NAME}
          x={-renderElement.width / 2}
          y={-renderElement.height / 2}
          width={renderElement.width}
          height={renderElement.height}
          stroke={PLAN_GRAPHIC_HOVER_COLOR}
          strokeWidth={hoverStrokeWidth}
          dash={[hoverDash, hoverDash]}
          listening={false}
        />
      )}
      {selected && (
        <Group name={INTERACTIVE_OVERLAY_EXPORT_NAME}>
          <Rect
            x={-renderElement.width / 2}
            y={-renderElement.height / 2}
            width={renderElement.width}
            height={renderElement.height}
            stroke={selectionColor}
            strokeWidth={strokeWidth * 1.5}
            dash={selectedSet.size > 1 ? [8 / zoom, 5 / zoom] : undefined}
            listening={false}
          />
          {renderDimensionBox(
            'width',
            0,
            -renderElement.height / 2 - handleOffset - moveHandleRadius * 2.7,
            renderElement.width,
            0
          )}
          {renderDimensionBox('height', heightLabelCenterX, 0, renderElement.height, 90)}
          {renderMoveHandle('move-top', 0, -renderElement.height / 2 - handleOffset, 0, 'vertical')}
          {renderMoveHandle(
            'move-left',
            -renderElement.width / 2 - handleOffset,
            0,
            -90,
            'horizontal'
          )}
          {renderMoveHandle('move-right', rightHandleX, 0, 90, 'horizontal')}
          {renderMoveHandle(
            'move-bottom',
            0,
            renderElement.height / 2 + handleOffset,
            180,
            'vertical'
          )}
          {(
            [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ] as Array<[-1 | 1, -1 | 1]>
          ).map(([signX, signY]) => (
            <Rect
              key={`resize-${signX}-${signY}`}
              x={(signX * renderElement.width) / 2}
              y={(signY * renderElement.height) / 2}
              width={handleSize}
              height={handleSize}
              offsetX={handleSize / 2}
              offsetY={handleSize / 2}
              fill={handleFillColor}
              stroke={handleStrokeColor}
              strokeWidth={handleStrokeWidth}
              listening={active}
              draggable={active}
              onDragStart={() => {
                resizeBaseRef.current = renderElement
              }}
              onPointerDown={(event) => {
                if (!isPrimaryPlanActivationEvent(event.evt)) return
                event.cancelBubble = true
                onSelect(element.id)
                resizeBaseRef.current = renderElement
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                const nextElement = getElementFromResizeEvent(event, signX, signY)
                if (!nextElement) return
                setFastDraft(nextElement)
                event.target.position({
                  x: (signX * nextElement.width) / 2,
                  y: (signY * nextElement.height) / 2,
                })
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                const nextElement = getElementFromResizeEvent(event, signX, signY)
                if (!nextElement) return
                onResize(element.id, { width: nextElement.width, height: nextElement.height })
                onMove(element.id, nextElement.pos)
                resizeBaseRef.current = null
                setFastDraft(null)
                clearSnapGuides()
              }}
            />
          ))}
          <Circle
            x={0}
            y={-rotationHandleRadius}
            radius={handleSize * 0.7}
            fill={handleFillColor}
            stroke={handleStrokeColor}
            strokeWidth={handleStrokeWidth}
            listening={active}
            draggable={active}
            onDragStart={() => {
              rotationBaseRef.current = renderElement
            }}
            onPointerDown={(event) => {
              if (!isPrimaryPlanActivationEvent(event.evt)) return
              event.cancelBubble = true
              onSelect(element.id)
              rotationBaseRef.current = renderElement
            }}
            onDragMove={(event) => {
              event.cancelBubble = true
              updateRotationFromPointer(event)
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true
              const nextElement =
                updateRotationFromPointer(event) ?? interactionDraftRef.current ?? renderElement
              const nextRotation = nextElement.rotationDeg ?? 0
              onRotate(element.id, nextRotation)
              rotationBaseRef.current = null
              setFastDraft(null)
            }}
          />
        </Group>
      )}
    </Group>
  )
}

export function PlanGraphicElementRenderer(props: PlanGraphicElementRendererProps) {
  return (
    <Group listening={props.active}>
      {props.elements.map((element) => (
        <GraphicElementNode
          key={element.id}
          {...props}
          element={element}
          selected={props.selectedIds.includes(element.id)}
        />
      ))}
    </Group>
  )
}
