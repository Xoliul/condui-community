import { useEffect, useState } from 'react'
import type { Point2 } from '@/types/schema'
import { parsePlanMeters } from '@/lib/plan/planScale'

interface FloatingDistanceInputProps {
  startPoint: Point2
  endPoint: Point2
  scale: number
  meters: number
  onMetersChange: (meters: number) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

function FloatingDistanceInput({
  startPoint,
  endPoint,
  scale,
  meters,
  onMetersChange,
  inputRef,
  canvasRef,
  containerRef,
}: FloatingDistanceInputProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [draftValue, setDraftValue] = useState(() => String(meters))
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) setDraftValue(String(meters))
  }, [meters, isEditing])

  const commitDraftValue = () => {
    const normalized = parsePlanMeters(draftValue)
    if (normalized == null) { onMetersChange(Number.NaN); return }
    setDraftValue(String(normalized))
    setIsEditing(false)
    onMetersChange(normalized)
  }

  useEffect(() => {
    const updatePosition = () => {
      if (!canvasRef.current || !containerRef.current) return

      const canvas = canvasRef.current
      const container = containerRef.current

      // Get bounding boxes
      const canvasRect = canvas.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      // Calculate midpoint in image coordinates (unscaled, in image pixels)
      const midXImage = (startPoint.x + endPoint.x) / 2
      const midYImage = (startPoint.y + endPoint.y) / 2

      // Convert to canvas pixel coordinates (scaled to display size)
      const midXCanvas = midXImage * scale
      const midYCanvas = midYImage * scale

      // Canvas is positioned relative to container
      // getBoundingClientRect gives screen coordinates, so subtract container's screen position
      const canvasOffsetX = canvasRect.left - containerRect.left
      const canvasOffsetY = canvasRect.top - containerRect.top

      // Final position: canvas offset + scaled midpoint
      const x = canvasOffsetX + midXCanvas
      const y = canvasOffsetY + midYCanvas

      setPosition({ x, y })
    }

    // Update immediately
    updatePosition()

    // Update on resize
    window.addEventListener('resize', updatePosition)
    
    // Update periodically to catch canvas position changes (when handles are dragged)
    const interval = setInterval(updatePosition, 16) // ~60fps

    return () => {
      window.removeEventListener('resize', updatePosition)
      clearInterval(interval)
    }
  }, [startPoint, endPoint, scale, canvasRef, containerRef])

  return (
    <div
      className="absolute pointer-events-auto z-10"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bg-white dark:bg-gray-800 border-2 border-sky-500 rounded-md shadow-lg px-2 py-1 flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draftValue}
          onFocus={() => setIsEditing(true)}
          onChange={(e) => {
            const nextValue = e.target.value
            setIsEditing(true)
            setDraftValue(nextValue)
            onMetersChange(parsePlanMeters(nextValue) ?? Number.NaN)
          }}
          onBlur={commitDraftValue}
          aria-invalid={parsePlanMeters(draftValue) == null}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
            e.stopPropagation()
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-20 px-2 py-1 text-sm font-medium text-gray-900 dark:text-white bg-transparent border-none outline-none focus:outline-none"
          style={{ textAlign: 'center' }}
        />
        <span className="text-sm text-gray-600 dark:text-gray-400">m</span>
      </div>
    </div>
  )
}

export default FloatingDistanceInput
