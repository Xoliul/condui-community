import { useState, useCallback, useEffect, useRef } from 'react'
import { Line, Circle, Text, Group, Rect } from 'react-konva'
import type Konva from 'konva'
import type { Point2 } from '@/types/schema'
import { scaleRulerPointerToCanvas } from '@/lib/plan/scaleRulerCoordinates'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { screenPxToCanvasUnits } from '@/constants/canvasConstants'
import { isScaleRulerPlacementButton } from '@/lib/plan/scaleRulerInput'
import { createPlanScaleReference } from '@/lib/plan/planScale'

export interface ScaleReference {
  p1: Point2
  p2: Point2
  meters: number
}

interface ScaleRulerCanvasProps {
  onComplete: (p1: Point2, p2: Point2, meters: number) => void
  onCancel: () => void
  /** When user has placed both points, parent shows overlay and can control meters for the label */
  onPointsReady?: (start: Point2, end: Point2, meters: number) => void
  onPointsChange?: (start: Point2 | null, end: Point2 | null) => void
  /** Controlled meters when parent is showing the distance input (for label on line) */
  meters?: number
  onMetersChange?: (meters: number) => void
  /** Existing scale reference (e.g. from wizard). When set, ruler starts with line in place and overlay can show. */
  initialReference?: ScaleReference | null
  /** Signal from parent to request commit with latest points + meters (increments on each OK click). */
  commitSignal?: number
  /** Current plan zoom to keep ruler UI screen-scaled. */
  zoom?: number
}

function pointerToCanvas(stage: Konva.Stage): Point2 | null {
  return scaleRulerPointerToCanvas(stage)
}

function isNodeInsideGroup(node: Konva.Node | null, group: Konva.Group | null): boolean {
  if (!node || !group) return false
  let current: Konva.Node | null = node
  while (current) {
    if (current === group) return true
    current = current.getParent()
  }
  return false
}

function ScaleRulerCanvas({
  onComplete,
  onCancel: _onCancel,
  onPointsReady,
  onPointsChange,
  meters: controlledMeters,
  onMetersChange: _onMetersChange,
  initialReference,
  commitSignal,
  zoom = 1,
}: ScaleRulerCanvasProps) {
  const [startPoint, setStartPoint] = useState<Point2 | null>(initialReference?.p1 ?? null)
  const [endPoint, setEndPoint] = useState<Point2 | null>(initialReference?.p2 ?? null)
  const [currentPoint, setCurrentPoint] = useState<Point2 | null>(null)
  const [internalMeters] = useState<number>(initialReference?.meters ?? 1)
  const groupRef = useRef<Konva.Group>(null)
  const rafRef = useRef<number | null>(null)
  const pendingDragRef = useRef<{ start?: Point2; end?: Point2 } | null>(null)
  const meters = controlledMeters ?? internalMeters
  const distanceLabel = Number.isFinite(meters) && meters > 0 ? `${meters.toFixed(2)} m` : '— m'
  const fontFamily = useCanvasFontFamily()
  const lastCommitSignalRef = useRef<number | undefined>(commitSignal)
  const rulerStrokeCanvas = screenPxToCanvasUnits(zoom, 3, 2, 6)
  const handleRadiusCanvas = screenPxToCanvasUnits(zoom, 8, 5, 14)
  const labelFontSizeCanvas = screenPxToCanvasUnits(zoom, 14, 10, 20)
  const labelPaddingXCanvas = screenPxToCanvasUnits(zoom, 8, 5, 12)
  const labelPaddingYCanvas = screenPxToCanvasUnits(zoom, 4, 3, 8)
  const labelWidthCanvas = Math.max(
    screenPxToCanvasUnits(zoom, 72, 52, 120),
    distanceLabel.length * labelFontSizeCanvas * 0.62 + labelPaddingXCanvas * 2,
  )
  const labelHeightCanvas = labelFontSizeCanvas + labelPaddingYCanvas * 2
  const labelCornerRadiusCanvas = screenPxToCanvasUnits(zoom, 4, 2, 8)

  // On mount, tell the parent to show the distance input for a saved reference.
  useEffect(() => {
    if (initialReference?.p1 && initialReference?.p2) {
      onPointsReady?.(initialReference.p1, initialReference.p2, initialReference.meters)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- only on mount when initialReference is used by parent

  // A saved reference can arrive after this layer mounts while the plan image
  // is loading. Hydrate it once available, without replacing user-placed points.
  useEffect(() => {
    if (!initialReference?.p1 || !initialReference?.p2 || startPoint || endPoint) return
    setStartPoint(initialReference.p1)
    setEndPoint(initialReference.p2)
    onPointsReady?.(initialReference.p1, initialReference.p2, initialReference.meters)
  }, [
    initialReference?.p1.x,
    initialReference?.p1.y,
    initialReference?.p2.x,
    initialReference?.p2.y,
    initialReference?.meters,
    startPoint,
    endPoint,
    onPointsReady,
  ]) // eslint-disable-line react-hooks/exhaustive-deps -- synchronize only when the saved reference changes

  useEffect(() => { onPointsChange?.(startPoint, endPoint) }, [startPoint, endPoint, onPointsChange])
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }, [])

  // Handle placement from the canvas DOM in capture phase. Plan elements may cancel Konva's
  // bubbling mousedown event, but scale adjustment must still receive the second point click.
  useEffect(() => {
    const stage = groupRef.current?.getStage()
    if (!stage) return

    const handleMouseDown = (event: MouseEvent) => {
      if (!isScaleRulerPlacementButton(event.button)) return
      stage.setPointersPositions(event)
      const canvasPoint = pointerToCanvas(stage)
      if (!canvasPoint) return

      const hitShape = stage.getIntersection(stage.getPointerPosition() ?? canvasPoint)
      if (startPoint && endPoint && isNodeInsideGroup(hitShape, groupRef.current)) return

      if (!startPoint) {
        setStartPoint(canvasPoint)
        setEndPoint(null)
        setCurrentPoint(canvasPoint)
      } else if (!endPoint) {
        setEndPoint(canvasPoint)
        setCurrentPoint(null)
        onPointsReady?.(startPoint, canvasPoint, meters)
      } else {
        // Clicking away from an existing ruler starts a replacement. This also
        // recovers legacy references whose handles were saved outside the plan.
        setStartPoint(canvasPoint)
        setEndPoint(null)
        setCurrentPoint(canvasPoint)
      }

      // Prevent BaseCanvas and plan elements from treating this placement as a
      // pan, selection, or another plan interaction.
      event.stopPropagation()
    }

    const handleMouseMove = (_e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!startPoint || endPoint) return
      const canvasPoint = pointerToCanvas(stage)
      if (!canvasPoint) return
      setCurrentPoint(canvasPoint)
    }

    const content = stage.getContent()
    content.addEventListener('mousedown', handleMouseDown, true)
    stage.on('mousemove', handleMouseMove)

    return () => {
      content.removeEventListener('mousedown', handleMouseDown, true)
      stage.off('mousemove', handleMouseMove)
    }
  }, [startPoint, endPoint, onPointsReady, meters])

  const handleComplete = useCallback(() => {
    if (startPoint && endPoint && createPlanScaleReference(startPoint, endPoint, meters)) {
      onComplete(startPoint, endPoint, meters)
    }
  }, [startPoint, endPoint, meters, onComplete])

  // When parent bumps commitSignal (e.g. OK button), commit with latest points + meters.
  useEffect(() => {
    if (commitSignal == null) return
    if (lastCommitSignalRef.current === commitSignal) return
    lastCommitSignalRef.current = commitSignal
    if (startPoint && endPoint) {
      handleComplete()
    }
  }, [commitSignal, handleComplete, startPoint, endPoint])

  // Don't treat click on our ruler (circles/line) as placing a new point when we already have both ends
  // When we have both points, ignore mousedown on our group so dragging circles works
  useEffect(() => {
    const stage = groupRef.current?.getStage()
    if (!stage) return
    const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isScaleRulerPlacementButton(e.evt.button)) return
      if (startPoint && endPoint && isNodeInsideGroup(e.target, groupRef.current)) {
        e.cancelBubble = true
      }
    }
    stage.on('mousedown', handleMouseDown)
    return () => {
      stage.off('mousedown', handleMouseDown)
    }
  }, [startPoint, endPoint])

  // Double-click to commit (complete)
  useEffect(() => {
    const stage = groupRef.current?.getStage()
    if (!stage) return
    const handleDblClick = (_e: Konva.KonvaEventObject<MouseEvent>) => {
      if (startPoint && endPoint) {
        handleComplete()
      }
    }
    stage.on('dblclick', handleDblClick)
    return () => {
      stage.off('dblclick', handleDblClick)
    }
  }, [startPoint, endPoint, handleComplete])

  // Get display point (endPoint if set, otherwise currentPoint while drawing)
  const displayEndPoint = endPoint || currentPoint

  return (
    <Group ref={groupRef} listening={true}>
        {/* Ruler line */}
        {startPoint && displayEndPoint && (
          <>
            <Line
              points={[startPoint.x, startPoint.y, displayEndPoint.x, displayEndPoint.y]}
              stroke="#0284c7"
              strokeWidth={rulerStrokeCanvas}
              lineCap="round"
              listening={false}
            />
            <Circle
              x={startPoint.x}
              y={startPoint.y}
              radius={handleRadiusCanvas}
              fill="#0284c7"
              draggable={!!endPoint}
              onDragMove={(e) => {
                const pos = e.target.position()
                pendingDragRef.current = { ...pendingDragRef.current, start: { x: pos.x, y: pos.y } }
                if (rafRef.current == null) {
                  rafRef.current = requestAnimationFrame(() => {
                    rafRef.current = null
                    const p = pendingDragRef.current
                    if (p?.start) setStartPoint(p.start)
                    if (p?.end) setEndPoint(p.end)
                    pendingDragRef.current = null
                  })
                }
              }}
              onDragEnd={(e) => {
                if (rafRef.current != null) {
                  cancelAnimationFrame(rafRef.current)
                  rafRef.current = null
                }
                const pos = e.target.position()
                setStartPoint({ x: pos.x, y: pos.y })
                pendingDragRef.current = null
              }}
              onMouseDown={(e) => e.cancelBubble = true}
            />
            <Circle
              x={displayEndPoint.x}
              y={displayEndPoint.y}
              radius={handleRadiusCanvas}
              fill="#0284c7"
              draggable={!!endPoint}
              onDragMove={(e) => {
                const pos = e.target.position()
                pendingDragRef.current = { ...pendingDragRef.current, end: { x: pos.x, y: pos.y } }
                if (rafRef.current == null) {
                  rafRef.current = requestAnimationFrame(() => {
                    rafRef.current = null
                    const p = pendingDragRef.current
                    if (p?.start) setStartPoint(p.start)
                    if (p?.end) setEndPoint(p.end)
                    pendingDragRef.current = null
                  })
                }
              }}
              onDragEnd={(e) => {
                if (rafRef.current != null) {
                  cancelAnimationFrame(rafRef.current)
                  rafRef.current = null
                }
                const pos = e.target.position()
                setEndPoint({ x: pos.x, y: pos.y })
                pendingDragRef.current = null
              }}
              onMouseDown={(e) => e.cancelBubble = true}
            />
            {/* Distance label (Konva Text above the line) */}
            {endPoint && (
              <Group
                x={(startPoint.x + endPoint.x) / 2}
                y={(startPoint.y + endPoint.y) / 2}
                listening={false}
              >
                <Rect
                  x={-labelWidthCanvas / 2}
                  y={-labelHeightCanvas / 2}
                  width={labelWidthCanvas}
                  height={labelHeightCanvas}
                  fill="white"
                  cornerRadius={labelCornerRadiusCanvas}
                  opacity={0.9}
                />
                <Text
                  text={distanceLabel}
                  fontSize={labelFontSizeCanvas}
                  fontFamily={fontFamily}
                  fill="#0284c7"
                  align="center"
                  verticalAlign="middle"
                  x={-labelWidthCanvas / 2}
                  y={-labelHeightCanvas / 2}
                  width={labelWidthCanvas}
                  height={labelHeightCanvas}
                />
              </Group>
            )}
          </>
        )}
    </Group>
  )
}

export default ScaleRulerCanvas
