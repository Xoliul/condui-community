import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCanvasOverlayScale } from '@/contexts/CanvasOverlayScaleContext'
import { useResponsiveEditorMode } from '@/hooks/useResponsiveEditorMode'
import { preventCanvasToolbarMouseFocus } from '@/lib/ui/preventCanvasToolbarMouseFocus'
import { CANVAS_OVERLAY_DISMISS_EVENT } from '@/lib/ui/canvasOverlayDismiss'
import { APP_MODAL_BACKDROP_ATTR } from '@/lib/ui/appModalInteraction'

/** Canvas root marker for overlay menu positioning (see PlanCanvas). */
export const CANVAS_OVERLAY_ROOT_ATTR = 'data-canvas-overlay-root'

const MOBILE_MENU_TOP_INSET_PX = 12
const MOBILE_MENU_BOTTOM_INSET_PX = 12
const MOBILE_MENU_MIN_HEIGHT_PX = 120

/** The canvas an overlay control sits on: the marked root, else the rail's container. */
function findCanvasOverlayRoot(element: HTMLElement | null): HTMLElement | null {
  return (
    (element?.closest(`[${CANVAS_OVERLAY_ROOT_ATTR}]`) as HTMLElement | null) ??
    (element?.closest('[data-canvas-overlay-anchor]')?.parentElement ?? null)
  )
}

interface FloatingControlProps {
  icon: React.ReactNode
  /** Label shown in the hover bubble (and used for aria-label) */
  label: string
  /** Optional second tooltip line, useful for disabled-state guidance. */
  tooltipDescription?: string
  /** Optional hotkey hint, rendered in italic in the hover bubble */
  hotkey?: string
  /** Round = active tool, roundedSquare = menu bubble */
  variant?: 'tool' | 'menu'
  /** Which side of the canvas edge this control is docked to */
  side?: 'left' | 'right'
  /** Optional controlled open state for menu bubbles */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Optional active state for tool bubbles (e.g. draw mode) */
  active?: boolean
  /** Whether this tool bubble should use the primary (blue) active styling. Defaults to true. */
  primary?: boolean
  /** Use subtle destructive styling for an active exit/remove action. */
  danger?: boolean
  /** Menu content to show when open (for menu bubbles). If omitted, behaves like a simple button. */
  children?: React.ReactNode
  /** Optional click handler for simple tool bubbles (no menu) */
  onClick?: () => void
  /** Disabled tool/menu trigger state. */
  disabled?: boolean
  /** For E2E / perf tests (scoped under each viewport panel). */
  triggerTestId?: string
  suppressTooltip?: boolean
  /**
   * In compact/mobile editor: pin open menu top to canvas top and make content
   * vertically scrollable so tall panels stay in view.
   */
  mobileMenuFitCanvas?: boolean
}

export function FloatingControl({
  icon,
  label,
  tooltipDescription,
  hotkey,
  variant = 'tool',
  side = 'right',
  open,
  onOpenChange,
  children,
  active = false,
  primary = true,
  danger = false,
  onClick,
  disabled = false,
  triggerTestId,
  suppressTooltip = false,
  mobileMenuFitCanvas = false,
}: FloatingControlProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [mobileMenuLayout, setMobileMenuLayout] = useState({ top: 0, maxHeight: 0 })
  const { isCompact: editorCompact } = useResponsiveEditorMode()
  const { height: overlayHeight, scale: overlayScale } = useCanvasOverlayScale()
  const menuContentRef = useRef<HTMLDivElement>(null)
  // Desktop: keep a tall menu inside the canvas, shifted up and scrollable when needed.
  const [fitLayout, setFitLayout] = useState<{ top: number; maxHeight: number } | null>(null)

  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen

  const setOpen = useCallback((next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next)
    } else {
      setInternalOpen(next)
    }
  }, [isControlled, onOpenChange])

  const shapeClasses = variant === 'tool' ? 'rounded-full' : 'rounded-md'

  const baseButtonClasses =
    'inline-flex items-center justify-center w-12 h-12 shadow-lg border transition-all text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-500'

  const menuSideClass = side === 'right' ? 'right-full mr-2 top-0' : 'left-full ml-2 top-0'

  const showTooltip = hovered && !isOpen && !suppressTooltip

  useLayoutEffect(() => {
    if (!showTooltip) return
    const positionTooltip = () => {
      const rect = wrapperRef.current?.getBoundingClientRect()
      if (!rect) return
      setTooltipPosition({
        left: side === 'right' ? rect.left - 8 : rect.right + 8,
        top: rect.top + rect.height / 2,
      })
    }
    positionTooltip()
    window.addEventListener('resize', positionTooltip)
    window.addEventListener('scroll', positionTooltip, true)
    return () => {
      window.removeEventListener('resize', positionTooltip)
      window.removeEventListener('scroll', positionTooltip, true)
    }
  }, [showTooltip, side])

  useEffect(() => {
    if (!isOpen || !children) return

    const handleCanvasDismiss = () => setOpen(false)
    window.addEventListener(CANVAS_OVERLAY_DISMISS_EVENT, handleCanvasDismiss)
    return () => window.removeEventListener(CANVAS_OVERLAY_DISMISS_EVENT, handleCanvasDismiss)
  }, [children, isOpen, setOpen])

  const useMobileMenuLayout = Boolean(
    mobileMenuFitCanvas && editorCompact && isOpen && children
  )

  useLayoutEffect(() => {
    if (!useMobileMenuLayout) {
      setMobileMenuLayout({ top: 0, maxHeight: 0 })
      return
    }

    const measure = () => {
      const wrapper = wrapperRef.current
      const canvasRoot = wrapper?.closest(`[${CANVAS_OVERLAY_ROOT_ATTR}]`) as HTMLElement | null
      if (!wrapper || !canvasRoot) return

      const wrapperRect = wrapper.getBoundingClientRect()
      const canvasRect = canvasRoot.getBoundingClientRect()
      const top = -(wrapperRect.top - canvasRect.top) + MOBILE_MENU_TOP_INSET_PX
      const maxHeight = Math.max(
        MOBILE_MENU_MIN_HEIGHT_PX,
        overlayHeight - MOBILE_MENU_TOP_INSET_PX - MOBILE_MENU_BOTTOM_INSET_PX
      )
      setMobileMenuLayout({ top, maxHeight })
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [useMobileMenuLayout, overlayHeight])

  useLayoutEffect(() => {
    if (!isOpen || !children || useMobileMenuLayout) {
      setFitLayout(null)
      return
    }
    const measure = () => {
      const wrapper = wrapperRef.current
      const menu = menuContentRef.current
      const canvasRoot = findCanvasOverlayRoot(wrapper)
      if (!wrapper || !menu || !canvasRoot) return
      // Menus live inside the scaled overlay rail: convert screen pixels to its units.
      const scale = overlayScale > 0 ? overlayScale : 1
      const canvasRect = canvasRoot.getBoundingClientRect()
      const wrapperTop = (wrapper.getBoundingClientRect().top - canvasRect.top) / scale
      const canvasHeight = canvasRect.height / scale
      const maxHeight = Math.max(
        MOBILE_MENU_MIN_HEIGHT_PX,
        canvasHeight - MOBILE_MENU_TOP_INSET_PX - MOBILE_MENU_BOTTOM_INSET_PX
      )
      const height = Math.min(menu.scrollHeight, maxHeight)
      const bottomLimit = canvasHeight - MOBILE_MENU_BOTTOM_INSET_PX
      let top = wrapperTop + height > bottomLimit ? bottomLimit - height - wrapperTop : 0
      top = Math.max(top, MOBILE_MENU_TOP_INSET_PX - wrapperTop)
      setFitLayout((current) =>
        current && current.top === top && current.maxHeight === maxHeight
          ? current
          : { top, maxHeight }
      )
    }
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    const content = menuContentRef.current?.firstElementChild
    if (content) observer?.observe(content)
    const canvasRoot = findCanvasOverlayRoot(wrapperRef.current)
    if (canvasRoot) observer?.observe(canvasRoot)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [children, isOpen, overlayScale, useMobileMenuLayout])

  const bgClasses =
    isOpen && children
      ? 'bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500'
      : active && variant === 'tool' && danger
        ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40'
      : active && variant === 'tool' && primary
        ? 'bg-sky-600 dark:bg-sky-500 text-white border-sky-600 dark:border-sky-400 hover:bg-sky-700 dark:hover:bg-sky-400'
        : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-400/35'
  const disabledClasses = disabled
    ? 'opacity-50 cursor-not-allowed'
    : ''
  const menuHorizontalClass = side === 'right' ? 'right-full mr-2' : 'left-full ml-2'

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        data-testid={triggerTestId}
        onPointerDown={(e) => {
          if (!disabled) preventCanvasToolbarMouseFocus(e)
        }}
        onClick={
          disabled
            ? undefined
            : children
              ? () => {
                  setHovered(false)
                  setOpen(!isOpen)
                }
              : onClick
        }
        className={`${baseButtonClasses} ${shapeClasses} ${bgClasses} ${disabledClasses}`}
        aria-label={label}
        aria-expanded={children ? isOpen : undefined}
        aria-disabled={disabled}
      >
        {icon}
      </button>

      {showTooltip && typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none fixed z-[100] -translate-y-1/2"
          style={{
            left: tooltipPosition.left,
            top: tooltipPosition.top,
            transform: `translate(${side === 'right' ? '-100%' : '0'}, -50%)`,
          }}
        >
          <div className="rounded-md bg-gray-900 text-white text-xs px-2 py-1 shadow-lg whitespace-nowrap">
            <div className="font-semibold">{label}</div>
            {tooltipDescription && (
              <div className="opacity-90">{tooltipDescription}</div>
            )}
            {hotkey && <span className="ml-1 italic opacity-80">{hotkey}</span>}
          </div>
        </div>,
        document.body
      )}

      {isOpen && children && (
        <>
          <div
            {...{ [APP_MODAL_BACKDROP_ATTR]: 'true' }}
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className={`absolute z-40 ${
              useMobileMenuLayout ? menuHorizontalClass : menuSideClass
            }`}
            style={
              useMobileMenuLayout
                ? { top: mobileMenuLayout.top }
                : fitLayout
                  ? { top: fitLayout.top }
                  : undefined
            }
          >
            {useMobileMenuLayout ? (
              <div
                data-app-scroll="true"
                className="pointer-events-auto overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]"
                style={{
                  maxHeight:
                    mobileMenuLayout.maxHeight > 0
                      ? mobileMenuLayout.maxHeight
                      : Math.max(
                          MOBILE_MENU_MIN_HEIGHT_PX,
                          overlayHeight -
                            MOBILE_MENU_TOP_INSET_PX -
                            MOBILE_MENU_BOTTOM_INSET_PX
                        ),
                }}
              >
                {children}
              </div>
            ) : (
              <div
                ref={menuContentRef}
                data-app-scroll="true"
                className="pointer-events-auto overflow-y-auto overscroll-contain"
                style={fitLayout ? { maxHeight: fitLayout.maxHeight } : undefined}
              >
                {children}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
