import { useRef } from 'react'

const SCROLLBAR_MIN_THUMB_PX = 32

/** Vertical scrollbar for the panned page stack: drag the thumb, or click the track to page. */
export function DocumentScrollbar({
  scrollTop,
  maxScroll,
  viewHeight,
  onScrollTo,
}: {
  scrollTop: number
  maxScroll: number
  viewHeight: number
  onScrollTo: (scrollTop: number) => void
}) {
  const drag = useRef<{ startY: number; startScroll: number } | null>(null)
  if (maxScroll <= 0 || viewHeight <= 0) return null
  const contentHeight = viewHeight + maxScroll
  const thumbHeight = Math.max(SCROLLBAR_MIN_THUMB_PX, (viewHeight / contentHeight) * viewHeight)
  const travel = Math.max(1, viewHeight - thumbHeight)
  const clamped = Math.min(maxScroll, Math.max(0, scrollTop))
  const thumbTop = (clamped / maxScroll) * travel

  return (
    <div
      className="absolute bottom-0 right-0 top-0 z-10 w-3 bg-gray-200/40 dark:bg-gray-700/30"
      data-testid="document-scrollbar"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        const clickedTop = event.clientY - rect.top
        onScrollTo(clamped + (clickedTop < thumbTop ? -viewHeight : viewHeight) * 0.9)
      }}
    >
      <div
        className="absolute left-0.5 right-0.5 cursor-default rounded-full bg-gray-400/70 hover:bg-gray-500/80 dark:bg-gray-500/70 dark:hover:bg-gray-400/80"
        style={{ top: thumbTop, height: thumbHeight }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { startY: event.clientY, startScroll: clamped }
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          onScrollTo(
            drag.current.startScroll + ((event.clientY - drag.current.startY) / travel) * maxScroll
          )
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      />
    </div>
  )
}
