import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Point2 } from '@/types/schema'
import FloatingDistanceInput from './FloatingDistanceInput'
import { computePlanImportFitScale } from './planImportViewport'
import { createPlanScaleReference } from '@/lib/plan/planScale'
import { isScaleRulerPlacementButton } from '@/lib/plan/scaleRulerInput'

const MAGNIFIER_ZOOM = 2
const MAGNIFIER_DIAMETER_PX = 144
const MAGNIFIER_EDGE_GAP_PX = 8

interface ScaleRulerProps {
  imageDataUrl: string
  onScaleComplete: (reference: { p1: Point2; p2: Point2; meters: number }) => void
  onSkip: () => void
  onCancel: () => void
  initialReference?: { p1: Point2; p2: Point2; meters: number } | null
  autoCreateInitialReference?: boolean
  onReferenceChange?: (reference: { p1: Point2; p2: Point2; meters: number } | null) => void
  invertPreview?: boolean
  surfaceClassName?: string
  showInlineContinue?: boolean
}

function ScaleRuler({
  imageDataUrl,
  onScaleComplete,
  onSkip,
  onCancel: _onCancel,
  initialReference = null,
  autoCreateInitialReference = false,
  onReferenceChange,
  invertPreview = false,
  surfaceClassName = 'bg-gray-50 dark:bg-gray-800',
  showInlineContinue = true,
}: ScaleRulerProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null)
  const [startPoint, setStartPoint] = useState<Point2 | null>(null)
  const [endPoint, setEndPoint] = useState<Point2 | null>(null)
  const [tempEndPoint, setTempEndPoint] = useState<Point2 | null>(null)
  const [meters, setMeters] = useState<number>(1)
  const [scale, setScale] = useState(1)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastEmittedRef = useRef<string | null>(null)
  const lastAppliedInitialRef = useRef<string | null>(null)
  const initializedImageRef = useRef<string | null>(null)
  const onReferenceChangeRef = useRef<ScaleRulerProps['onReferenceChange']>(onReferenceChange)

  useEffect(() => {
    onReferenceChangeRef.current = onReferenceChange
  }, [onReferenceChange])

  useEffect(() => {
    const initialSignature = initialReference
      ? `${initialReference.p1.x},${initialReference.p1.y},${initialReference.p2.x},${initialReference.p2.y},${initialReference.meters}`
      : null
    if (initialSignature === lastAppliedInitialRef.current) return
    // Don't rehydrate while user is actively interacting; that can fight drag updates.
    if (isDrawing || draggingHandle) return
    if (!initialReference) {
      lastAppliedInitialRef.current = null
      setStartPoint(null)
      setEndPoint(null)
      setTempEndPoint(null)
      setMeters(1)
      setIsDrawing(false)
      setDraggingHandle(null)
      return
    }
    lastAppliedInitialRef.current = initialSignature
    setStartPoint(initialReference.p1)
    setEndPoint(initialReference.p2)
    setTempEndPoint(null)
    setMeters(initialReference.meters)
    setIsDrawing(false)
    setDraggingHandle(null)
  }, [initialReference, isDrawing, draggingHandle])

  // Sync the editable draft. Confirmation validates it before applying the scale.
  useEffect(() => {
    const emit = onReferenceChangeRef.current
    if (!emit) return
    // Never autosync while actively drawing or dragging handles; this prevents
    // feedback loops between local interaction state and parent rehydration.
    if (isDrawing || draggingHandle) return
    if (!startPoint || !endPoint) {
      if (lastEmittedRef.current !== null) {
        lastEmittedRef.current = null
        emit(null)
      }
      return
    }
    const signature = `${startPoint.x},${startPoint.y},${endPoint.x},${endPoint.y},${meters}`
    if (lastEmittedRef.current === signature) return
    lastEmittedRef.current = signature
    emit({
      p1: startPoint,
      p2: endPoint,
      meters,
    })
  }, [startPoint, endPoint, meters, isDrawing, draggingHandle])

  // Load image and set up canvas
  useEffect(() => {
    imageRef.current = null
    setImageLoaded(false)
    setImageSize(null)
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      imageRef.current = img
      setImageSize({ width: img.width, height: img.height })
      setImageLoaded(true)
    }
    img.src = imageDataUrl

    return () => {
      cancelled = true
      if (imageRef.current === img) imageRef.current = null
    }
  }, [imageDataUrl])

  useEffect(() => {
    if (!autoCreateInitialReference || !imageLoaded || !imageSize) return
    if (initializedImageRef.current === imageDataUrl) return
    if (initialReference || startPoint || endPoint) {
      initializedImageRef.current = imageDataUrl
      return
    }
    if (isDrawing || draggingHandle) return
    initializedImageRef.current = imageDataUrl
    setStartPoint({ x: imageSize.width * 0.25, y: imageSize.height * 0.5 })
    setEndPoint({ x: imageSize.width * 0.75, y: imageSize.height * 0.5 })
    setMeters(5)
  }, [
    autoCreateInitialReference, imageLoaded, imageSize, imageDataUrl,
    initialReference, startPoint, endPoint, isDrawing, draggingHandle,
  ])

  // Update scale when container size changes (same fit logic as ImageCropper)
  useEffect(() => {
    if (!imageLoaded || !imageSize) return

    const updateScale = () => {
      const container = containerRef.current
      if (!container) {
        setTimeout(updateScale, 100)
        return
      }

      const containerWidth = container.clientWidth
      const containerHeight = container.clientHeight
      if (containerWidth <= 0 || containerHeight <= 0) {
        setTimeout(updateScale, 100)
        return
      }

      const newScale = computePlanImportFitScale(imageSize, containerWidth, containerHeight)
      if (newScale != null) {
        setScale(newScale)
      }
    }

    requestAnimationFrame(() => {
      updateScale()
    })

    const resizeObserver = new ResizeObserver(() => {
      updateScale()
    })
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [imageLoaded, imageSize])

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current || !imageSize || !imageLoaded) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = imageRef.current
    if (!img) return

    canvas.width = img.width * scale
    canvas.height = img.height * scale

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw image
    ctx.save()
    if (invertPreview) {
      ctx.filter = 'invert(1)'
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    ctx.restore()

    // Draw ruler line if we have points (including preview while dragging)
    const displayEndPoint = endPoint || tempEndPoint
    if (startPoint && displayEndPoint) {
      const x1 = startPoint.x * scale
      const y1 = startPoint.y * scale
      const x2 = displayEndPoint.x * scale
      const y2 = displayEndPoint.y * scale

      // Draw line
      ctx.strokeStyle = '#0284c7'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()

      // Draw start point
      ctx.fillStyle = '#0284c7'
      ctx.beginPath()
      ctx.arc(x1, y1, draggingHandle === 'start' ? 8 : 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()

      // Draw end point
      ctx.fillStyle = '#0284c7'
      ctx.beginPath()
      ctx.arc(x2, y2, draggingHandle === 'end' ? 8 : 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Show a 2× inspection lens only while a scale handle is being moved. The
    // lens changes what is shown, not the point-to-cursor mapping.
    const magnifierPoint = draggingHandle === 'start'
      ? startPoint
      : draggingHandle === 'end'
        ? endPoint
        : null
    if (magnifierPoint) {
      const canvasRect = canvas.getBoundingClientRect()
      const canvasToClientX = canvasRect.width > 0 ? canvas.width / canvasRect.width : 1
      const canvasToClientY = canvasRect.height > 0 ? canvas.height / canvasRect.height : 1
      const lensWidth = MAGNIFIER_DIAMETER_PX * canvasToClientX
      const lensHeight = MAGNIFIER_DIAMETER_PX * canvasToClientY
      const radiusX = lensWidth / 2
      const radiusY = lensHeight / 2
      const pointX = magnifierPoint.x * scale
      const pointY = magnifierPoint.y * scale
      const edgeGapX = MAGNIFIER_EDGE_GAP_PX * canvasToClientX
      const edgeGapY = MAGNIFIER_EDGE_GAP_PX * canvasToClientY
      const lensCenterX = Math.max(radiusX + edgeGapX, Math.min(canvas.width - radiusX - edgeGapX, pointX))
      const lensCenterY = Math.max(radiusY + edgeGapY, Math.min(canvas.height - radiusY - edgeGapY, pointY))
      const sourceWidth = Math.min(img.width, lensWidth / MAGNIFIER_ZOOM / scale)
      const sourceHeight = Math.min(img.height, lensHeight / MAGNIFIER_ZOOM / scale)
      const sourceX = Math.max(0, Math.min(img.width - sourceWidth, magnifierPoint.x - sourceWidth / 2))
      const sourceY = Math.max(0, Math.min(img.height - sourceHeight, magnifierPoint.y - sourceHeight / 2))
      const destinationX = lensCenterX - radiusX
      const destinationY = lensCenterY - radiusY

      ctx.save()
      ctx.beginPath()
      ctx.ellipse(lensCenterX, lensCenterY, radiusX, radiusY, 0, 0, Math.PI * 2)
      ctx.clip()
      if (invertPreview) {
        ctx.filter = 'invert(1)'
      }
      ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, destinationX, destinationY, lensWidth, lensHeight)
      ctx.restore()

      // Mark the exact point being dragged inside the lens.
      const markerX = destinationX + (magnifierPoint.x - sourceX) * scale * MAGNIFIER_ZOOM
      const markerY = destinationY + (magnifierPoint.y - sourceY) * scale * MAGNIFIER_ZOOM
      ctx.save()
      ctx.globalCompositeOperation = 'difference'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = Math.max(2, 2 * canvasToClientX)
      ctx.beginPath()
      ctx.moveTo(markerX - 10 * canvasToClientX, markerY)
      ctx.lineTo(markerX + 10 * canvasToClientX, markerY)
      ctx.moveTo(markerX, markerY - 10 * canvasToClientY)
      ctx.lineTo(markerX, markerY + 10 * canvasToClientY)
      ctx.stroke()
      ctx.restore()

      ctx.strokeStyle = '#0284c7'
      ctx.lineWidth = Math.max(3, 3 * canvasToClientX)
      ctx.beginPath()
      ctx.ellipse(lensCenterX, lensCenterY, radiusX, radiusY, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [imageDataUrl, imageSize, scale, startPoint, endPoint, tempEndPoint, imageLoaded, isDrawing, draggingHandle, invertPreview])

  // Check if point is near a handle
  const getHandleAt = useCallback((x: number, y: number) => {
    if (!startPoint || !endPoint) return null
    
    const handleRadius = 10 / scale // Handle detection radius in image coordinates
    const startDist = Math.sqrt((x - startPoint.x) ** 2 + (y - startPoint.y) ** 2)
    const endDist = Math.sqrt((x - endPoint.x) ** 2 + (y - endPoint.y) ** 2)
    
    if (startDist < handleRadius) return 'start'
    if (endDist < handleRadius) return 'end'
    return null
  }, [startPoint, endPoint, scale])

  // Handle mouse down
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isScaleRulerPlacementButton(e.button)) return
    e.preventDefault()
    e.stopPropagation()
    if (!imageSize) return
    
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    
    const x = (e.clientX - rect.left) * imageSize.width / rect.width
    const y = (e.clientY - rect.top) * imageSize.height / rect.height
    
    // If we have a complete line, check if clicking on a handle
    if (startPoint && endPoint) {
      const handle = getHandleAt(x, y)
      if (handle) {
        setDraggingHandle(handle)
        return
      }
      // Clicked away from handles: start a brand-new line from this point.
      // This lets users quickly redo short/incorrect lines by dragging anywhere.
      setStartPoint({ x, y })
      setEndPoint(null)
      setTempEndPoint(null)
      setIsDrawing(true)
      setDraggingHandle(null)
      return
    }
    
    if (!startPoint) {
      // First click - set start point and start drawing
      setStartPoint({ x, y })
      setEndPoint(null)
      setTempEndPoint(null)
      setIsDrawing(true)
    } else if (startPoint && !endPoint) {
      // Second click - set end point (completes the line)
      setEndPoint({ x, y })
      setTempEndPoint(null)
      setIsDrawing(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [imageSize, scale, startPoint, endPoint, getHandleAt])

  // Handle mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !imageSize) return
    
    const x = (e.clientX - rect.left) * imageSize.width / rect.width
    const y = (e.clientY - rect.top) * imageSize.height / rect.height
    
    // If dragging a handle, update that handle's position
    if (draggingHandle === 'start' && startPoint) {
      setStartPoint({ x, y })
    } else if (draggingHandle === 'end' && endPoint) {
      setEndPoint({ x, y })
    } else if (isDrawing && startPoint && !endPoint) {
      // Update preview end point while drawing new line
      setTempEndPoint({ x, y })
    }
  }, [startPoint, endPoint, imageSize, scale, isDrawing, draggingHandle])

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    // If we were dragging a handle, stop dragging
    if (draggingHandle) {
      setDraggingHandle(null)
      return
    }
    
    // If we were drawing and have a temp end point from drag motion, finalize only
    // when the segment has a meaningful length; otherwise keep waiting for the
    // second click to avoid accidental zero-length lines.
    if (isDrawing && startPoint && !endPoint && tempEndPoint) {
      const minDistance = 2 / Math.max(scale, 0.0001)
      const rulerDistance = Math.hypot(tempEndPoint.x - startPoint.x, tempEndPoint.y - startPoint.y)
      if (rulerDistance >= minDistance) {
        setEndPoint(tempEndPoint)
        setTempEndPoint(null)
        setIsDrawing(false)
        setTimeout(() => inputRef.current?.focus(), 100)
      }
    }
    // If clicking (not dragging), the click handler already handled it
  }, [isDrawing, startPoint, endPoint, tempEndPoint, draggingHandle, scale])

  // Handle complete
  const handleComplete = useCallback(() => {
    if (!startPoint || !endPoint || !createPlanScaleReference(startPoint, endPoint, meters)) return
    
    onScaleComplete({
      p1: startPoint,
      p2: endPoint,
      meters,
    })
  }, [startPoint, endPoint, meters, onScaleComplete])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="flex-shrink-0 text-sm text-gray-600 dark:text-gray-400">
        {t('planImport.scaleDescription')}
      </p>

      <div
        ref={containerRef}
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-gray-300 dark:border-gray-600 ${surfaceClassName}`}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          {!imageLoaded || !imageSize ? (
            <div className="text-gray-500 dark:text-gray-400">{t('planImport.loading')}</div>
          ) : (
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={`max-h-full max-w-full object-contain ${draggingHandle ? 'cursor-move' : 'cursor-crosshair'}`}
            />
          )}
        </div>
        
        {/* Floating distance input on the line */}
        {imageLoaded && imageSize && startPoint && endPoint && (
          <FloatingDistanceInput
            startPoint={startPoint}
            endPoint={endPoint}
            scale={scale}
            meters={meters}
            onMetersChange={setMeters}
            inputRef={inputRef}
            canvasRef={canvasRef}
            containerRef={containerRef}
          />
        )}
      </div>

      <div className="flex flex-shrink-0 flex-wrap gap-3">
        {startPoint && endPoint ? (
          <>
            {showInlineContinue && (
              <button
                type="button"
                onClick={handleComplete}
                disabled={!createPlanScaleReference(startPoint, endPoint, meters)}
                className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-md shadow-md transition-colors"
              >
                {t('common.continue')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStartPoint(null)
                setEndPoint(null)
                setTempEndPoint(null)
                setMeters(1)
                setIsDrawing(false)
              }}
              className={`${showInlineContinue ? '' : 'flex-1'} px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors`}
            >
              {t('planImport.redraw')}
            </button>
          </>
        ) : null}
        <button
          type="button"
          data-testid="e2e-import-plan-skip-scale"
          onClick={onSkip}
          className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('planImport.skipScale')}
        </button>
      </div>
    </div>
  )
}

export default ScaleRuler
