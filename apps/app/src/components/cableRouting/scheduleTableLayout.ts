import { useEffect, useState } from 'react'

/** Shared by the Documents tables (cable schedule, domotica address table). */

export function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Side margin of the list; it gives way first when the table no longer fits. */
const MAX_SIDE_PADDING_PX = 72
const MIN_SIDE_PADDING_PX = 12

/**
 * The widest side margin (up to 72 px) that still lets the table fit; at least 12 px, after
 * which the table scrolls sideways.
 */
export function useSidePaddingThatYields(
  containerRef: React.RefObject<HTMLDivElement | null>,
  tableRef: React.RefObject<HTMLTableElement | null>,
  /** The table is rendered (it is absent while the list is empty). */
  hasTable: boolean
): number {
  const [padding, setPadding] = useState(MAX_SIDE_PADDING_PX)
  useEffect(() => {
    const container = containerRef.current
    const table = tableRef.current
    if (!container || !table || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      // The table's own width when nothing stretches it: its content, unwrapped.
      const previousWidth = table.style.width
      table.style.width = 'max-content'
      const contentWidth = table.getBoundingClientRect().width
      table.style.width = previousWidth
      const spare = (container.clientWidth - contentWidth) / 2
      const next = Math.round(
        Math.min(MAX_SIDE_PADDING_PX, Math.max(MIN_SIDE_PADDING_PX, spare))
      )
      setPadding((current) => (current === next ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(table)
    return () => observer.disconnect()
  }, [containerRef, tableRef, hasTable])
  return padding
}
