import { memo, useMemo, useRef, useState, useCallback, useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Star } from 'lucide-react'
import { getSymbolIconPath, type SymbolMetadata } from '@/lib/symbols'
import { toPlaceableSymbol } from '@/lib/library/libraryPresets'
import { getLibraryEntryKey } from '@/lib/library/searchPresets'
import { logger } from '@/lib/logger'
import {
  getCachedThemedSymbolBlobUrl,
  loadProcessedSymbol,
} from '@/lib/symbolImage'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  LIBRARY_DOUBLE_SOCKET_OFFSET_SVG,
  SOCKET_SYMBOL_SVG_SIZE,
} from '@/components/canvas/eendraad/canvasSymbols'
import { useUIStore } from '@/stores/uiStore'
import { getCenteredTouchDragPreviewStyle } from '@/lib/canvas/touchDragPreview'
import { setLibrarySymbolDragImage } from '@/lib/ui/libraryDragImage'
import { useProtectionSymbolSvgPath } from '@/hooks/useProtectionSymbolSvgPath'
import { SearchPresetPreview } from './SearchPresetPreview'
import { SymbolHoverCard } from './SymbolHoverCard'

const DRAG_THRESHOLD_PX = 10
const DRAG_AXIS_BIAS_PX = 6

type TouchGestureState = {
  touchId: number
  startX: number
  startY: number
  dragging: boolean
  axisLocked: 'pending' | 'scroll' | 'drag'
  scrollContainer: HTMLDivElement | null
  lockedScrollTop: number
  restoreScrollLock: (() => void) | null
}

function findTouchById(touchList: TouchList, touchId: number): Touch | null {
  for (let i = 0; i < touchList.length; i++) {
    const touch = touchList.item(i)
    if (touch?.identifier === touchId) return touch
  }
  return null
}

function lockLibraryScroll(container: HTMLDivElement) {
  const lockedTop = container.scrollTop
  const style = container.style as CSSStyleDeclaration & {
    WebkitOverflowScrolling?: string
  }

  const prevOverflowY = container.style.overflowY
  const prevTouchAction = container.style.touchAction
  const prevOverscrollBehavior = container.style.overscrollBehavior
  const prevWebkitOverflowScrolling = style.WebkitOverflowScrolling

  container.style.overflowY = 'hidden'
  container.style.touchAction = 'none'
  container.style.overscrollBehavior = 'none'
  style.WebkitOverflowScrolling = 'auto'

  container.scrollTop = lockedTop

  return () => {
    container.style.overflowY = prevOverflowY
    container.style.touchAction = prevTouchAction
    container.style.overscrollBehavior = prevOverscrollBehavior
    style.WebkitOverflowScrolling = prevWebkitOverflowScrolling

    container.scrollTop = lockedTop
  }
}

interface SymbolItemProps {
  symbol: SymbolMetadata
  localizedName: string
  /** Fallback description for symbols without an AREI reference. */
  tooltip?: string
  isFavorite: boolean
  onToggleFavorite: (symbolId: string) => void
  onDragStart?: (symbol: SymbolMetadata) => void
  compact?: boolean
  /** Tighter list row: smaller name, favourite star only takes space on hover or when set. */
  dense?: boolean
  /** Shorter name shown in the row; the full localized name stays in the tooltip and hover card. */
  listName?: string
}

function SymbolItem({
  symbol,
  localizedName,
  tooltip,
  isFavorite,
  onToggleFavorite,
  onDragStart,
  compact = false,
  dense = false,
  listName,
}: SymbolItemProps) {
  const setLibraryDragSymbol = useUIStore((state) => state.setLibraryDragSymbol)
  // A preset entry places its base symbol with the preset; every other symbol places itself.
  const placeable = useMemo(() => toPlaceableSymbol(symbol), [symbol])
  const isArmed = useUIStore((state) => state.armedLibrarySymbol?.id === placeable.id && state.armedLibrarySymbol?.searchPreset === placeable.searchPreset)
  const setArmedLibrarySymbol = useUIStore((state) => state.setArmedLibrarySymbol)
  // Touch keeps drag-only placement; arming needs a hovering pointer to preview under.
  const lastPointerTypeRef = useRef<string>('mouse')
  const iconRef = useRef<HTMLDivElement>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipId = useId()
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipAnchor, setTooltipAnchor] = useState<DOMRect | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  
  // Touch drag state (for preview portal)
  const [touchDragActive, setTouchDragActive] = useState(false)
  const [touchDragPos, setTouchDragPos] = useState<{ x: number; y: number } | null>(null)
  const gestureRef = useRef<TouchGestureState | null>(null)
  const moveHandlerRef = useRef<((ev: TouchEvent) => void) | null>(null)
  const endHandlerRef = useRef<((ev: TouchEvent) => void) | null>(null)

  const clearTooltipTimers = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    if (tooltipCloseTimerRef.current) {
      clearTimeout(tooltipCloseTimerRef.current)
      tooltipCloseTimerRef.current = null
    }
  }, [])

  const dismissTooltip = useCallback(() => {
    clearTooltipTimers()
    setShowTooltip(false)
  }, [clearTooltipTimers])

  const keepTooltipOpen = useCallback(() => {
    clearTooltipTimers()
  }, [clearTooltipTimers])

  const handleMouseEnter = useCallback(() => {
    clearTooltipTimers()
    if (!tooltip || showTooltip) return
    tooltipTimerRef.current = setTimeout(() => {
      if (!itemRef.current) return
      setTooltipAnchor(itemRef.current.getBoundingClientRect())
      setShowTooltip(true)
    }, 1000)
  }, [tooltip, showTooltip, clearTooltipTimers])

  const handleMouseLeave = useCallback(() => {
    clearTooltipTimers()
    // Allow crossing the gap between the gallery tile and its interactive card.
    tooltipCloseTimerRef.current = setTimeout(() => setShowTooltip(false), 200)
  }, [clearTooltipTimers])

  useEffect(() => clearTooltipTimers, [clearTooltipTimers])

  useEffect(() => {
    if (!tooltip) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !showTooltip) return
      const card = document.getElementById(tooltipId)
      if (card?.contains(document.activeElement)) itemRef.current?.focus()
      dismissTooltip()
      event.stopPropagation()
    }
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && document.getElementById(tooltipId)?.contains(event.target)) return
      dismissTooltip()
    }
    window.addEventListener('keydown', handleEscape, true)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', dismissTooltip)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', dismissTooltip)
    }
  }, [tooltip, showTooltip, tooltipId, dismissTooltip])

  const cleanupGesture = useCallback(() => {
    const gesture = gestureRef.current
    if (gesture?.restoreScrollLock) {
      gesture.restoreScrollLock()
    }

    gestureRef.current = null
    setLibraryDragSymbol(null)
    setTouchDragActive(false)
    setTouchDragPos(null)

    if (moveHandlerRef.current) {
      window.removeEventListener('touchmove', moveHandlerRef.current as EventListener, true)
    }
    if (endHandlerRef.current) {
      window.removeEventListener('touchend', endHandlerRef.current as EventListener, true)
      window.removeEventListener('touchcancel', endHandlerRef.current as EventListener, true)
    }

    moveHandlerRef.current = null
    endHandlerRef.current = null
  }, [setLibraryDragSymbol])

  useEffect(() => {
    return () => {
      cleanupGesture()
    }
  }, [cleanupGesture])

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    dismissTooltip()
    // A drag that starts on the preview <img> can arrive with the browser's
    // native image payload (blob URL, text/html, etc.). Keep this an app-owned
    // drag regardless of whether the user grabs the glyph or the label.
    e.dataTransfer.clearData()
    e.dataTransfer.effectAllowed = 'copy'
    const symbolJson = JSON.stringify(placeable)
    e.dataTransfer.setData('application/json', symbolJson)
    // Also set as text/plain as fallback
    e.dataTransfer.setData('text/plain', symbolJson)

    // Use only the SVG icon as the drag image, not the full entry.
    // Blob-URL previews must be drawn onto a canvas first — some browsers
    // (notably Brave on Linux) abort the drag if setDragImage uses blob DOM.
    const iconEl = iconRef.current
    if (iconEl) {
      const dragImageStrategy = setLibrarySymbolDragImage(e.nativeEvent, iconEl)
      logger.info(`[drop-diag] Drag image strategy for symbol=${symbol.id}: ${dragImageStrategy}`)
    }

    logger.info('SymbolItem: Drag started for symbol:', symbol.id)
    setLibraryDragSymbol(placeable)

    if (onDragStart) {
      onDragStart(placeable)
    }
  }

  const handleDragEnd = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      logger.info(
        `[drop-diag] Drag ended for symbol=${symbol.id}, dropEffect=${e.dataTransfer.dropEffect || 'none'}`
      )
      setLibraryDragSymbol(null)
    },
    [setLibraryDragSymbol, symbol.id]
  )

  // After each armed placement, bring the armed tile back if the library was scrolled away
  // from it entirely; a partly visible tile stays put.
  const armedPlacementCount = useUIStore((state) =>
    state.armedLibrarySymbol?.id === placeable.id && state.armedLibrarySymbol?.searchPreset === placeable.searchPreset ? state.armedPlacementCount : 0
  )
  useEffect(() => {
    if (!isArmed || armedPlacementCount === 0) return
    const item = itemRef.current
    const scrollContainer = item?.closest<HTMLElement>('[data-library-scroll="true"]')
    if (!item || !scrollContainer) return
    // The same symbol can be listed twice (recent + category); the first copy decides.
    const armedTiles = Array.from(scrollContainer.querySelectorAll<HTMLElement>('[data-armed]'))
    if (armedTiles[0] !== item) return
    const viewRect = scrollContainer.getBoundingClientRect()
    const isVisible = (tile: HTMLElement) => {
      const rect = tile.getBoundingClientRect()
      return (
        rect.bottom > viewRect.top &&
        rect.top < viewRect.bottom &&
        rect.right > viewRect.left &&
        rect.left < viewRect.right
      )
    }
    if (armedTiles.some(isVisible)) return
    item.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [armedPlacementCount, isArmed])

  const toggleArmed = useCallback(() => {
    setArmedLibrarySymbol(isArmed ? null : placeable)
  }, [isArmed, setArmedLibrarySymbol, placeable])

  const handleClick = useCallback(() => {
    if (lastPointerTypeRef.current === 'touch') return
    toggleArmed()
  }, [toggleArmed])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Tab' && !e.shiftKey && showTooltip) {
        const link = document.getElementById(tooltipId)?.querySelector('a')
        if (link) {
          e.preventDefault()
          e.stopPropagation()
          link.focus()
          return
        }
      }
      if (e.target !== e.currentTarget) return
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      dismissTooltip()
      toggleArmed()
    },
    [toggleArmed, showTooltip, tooltipId, dismissTooltip]
  )

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleFavorite(getLibraryEntryKey(symbol))
  }

  // Touch handlers for drag and drop (iPad) using global native listeners
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return

      const touch = e.touches[0]
      if (!touch) return

      const scrollContainer = itemRef.current?.closest('[data-library-scroll="true"]') as HTMLDivElement | null

      gestureRef.current = {
        touchId: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        dragging: false,
        axisLocked: 'pending',
        scrollContainer,
        lockedScrollTop: scrollContainer?.scrollTop ?? 0,
        restoreScrollLock: null,
      }

      const handleWindowTouchMove = (ev: TouchEvent) => {
        const gesture = gestureRef.current
        if (!gesture) return

        const activeTouch =
          findTouchById(ev.touches, gesture.touchId) ||
          findTouchById(ev.changedTouches, gesture.touchId)

        if (!activeTouch) return

        const dx = activeTouch.clientX - gesture.startX
        const dy = activeTouch.clientY - gesture.startY
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        const dragDistance = Math.hypot(dx, dy)

        if (gesture.axisLocked === 'pending') {
          if (dragDistance <= DRAG_THRESHOLD_PX) return

          const scrollGesture = compact
            ? absDx > absDy + DRAG_AXIS_BIAS_PX
            : absDy > absDx + DRAG_AXIS_BIAS_PX
          const dragGesture = compact
            ? absDy > absDx + DRAG_AXIS_BIAS_PX
            : absDx > absDy + DRAG_AXIS_BIAS_PX

          if (scrollGesture) {
            gesture.axisLocked = 'scroll'
            return
          }

          if (dragGesture) {
            gesture.axisLocked = 'drag'
          } else {
            return
          }
        }

        if (gesture.axisLocked === 'scroll') {
          return
        }

        if (!gesture.dragging) {
          gesture.dragging = true

          if (gesture.scrollContainer) {
            gesture.restoreScrollLock = lockLibraryScroll(gesture.scrollContainer)
            gesture.scrollContainer.scrollTop = gesture.lockedScrollTop
          }

          setTouchDragActive(true)
          setLibraryDragSymbol(placeable)
          onDragStart?.(placeable)
        }

        ev.preventDefault()

        if (gesture.scrollContainer) {
          gesture.scrollContainer.scrollTop = gesture.lockedScrollTop
        }

        setTouchDragPos({ x: activeTouch.clientX, y: activeTouch.clientY })

        window.dispatchEvent(
          new CustomEvent('touchdragmove', {
            detail: {
              symbol,
              x: activeTouch.clientX,
              y: activeTouch.clientY,
            },
          }),
        )
      }

      const handleWindowTouchEnd = (ev: TouchEvent) => {
        const gesture = gestureRef.current
        if (!gesture) {
          return
        }

        const endTouch =
          findTouchById(ev.changedTouches, gesture.touchId) ||
          findTouchById(ev.touches, gesture.touchId)

        if (gesture.dragging && endTouch) {
          ev.preventDefault()

          window.dispatchEvent(
            new CustomEvent('touchdragend', {
              detail: {
                symbol,
                x: endTouch.clientX,
                y: endTouch.clientY,
              },
            }),
          )
        }

        cleanupGesture()
      }

      moveHandlerRef.current = handleWindowTouchMove
      endHandlerRef.current = handleWindowTouchEnd

      window.addEventListener('touchmove', handleWindowTouchMove as EventListener, {
        passive: false,
        capture: true,
      })
      window.addEventListener('touchend', handleWindowTouchEnd as EventListener, {
        passive: false,
        capture: true,
      })
      window.addEventListener('touchcancel', handleWindowTouchEnd as EventListener, {
        passive: false,
        capture: true,
      })
    },
    [cleanupGesture, compact, onDragStart, placeable, setLibraryDragSymbol, symbol],
  )

  const armedClass = isArmed
    ? 'bg-sky-50 ring-2 ring-inset ring-sky-500 dark:bg-sky-900/40'
    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'

  return (
    <>
      <div
        ref={itemRef}
        data-testid={`library-symbol-${getLibraryEntryKey(symbol)}`}
        role="button"
        tabIndex={0}
        aria-pressed={isArmed}
        aria-haspopup={tooltip ? 'dialog' : undefined}
        aria-controls={showTooltip ? tooltipId : undefined}
        data-armed={isArmed || undefined}
        draggable
        onPointerDown={(e) => {
          lastPointerTypeRef.current = e.pointerType
          dismissTooltip()
        }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onTouchStart={handleTouchStart}
        onMouseEnter={(event) => {
          if (event.buttons === 0 && lastPointerTypeRef.current !== 'touch') handleMouseEnter()
        }}
        onMouseLeave={handleMouseLeave}
        onFocus={(event) => {
          if (event.target === event.currentTarget) handleMouseEnter()
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) handleMouseLeave()
        }}
        className={
          compact
            ? `flex h-full w-24 flex-shrink-0 cursor-pointer select-none flex-col items-center justify-start gap-1 rounded px-2 py-1.5 transition-colors group relative outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${armedClass}`
            : `flex items-center ${dense ? 'gap-1.5 px-1.5' : 'gap-3 px-3'} py-1 rounded cursor-pointer transition-colors group relative select-none outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${armedClass}`
        }
      >
      {/* Symbol Icon */}
      <div 
        ref={iconRef}
        className={`${compact ? 'h-10 w-10' : 'h-9 w-9'} flex flex-shrink-0 items-center justify-center rounded border ${
          isArmed
            ? 'border-sky-500 bg-white dark:border-sky-400 dark:bg-gray-800'
            : 'border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700'
        }`}
      >
        <SymbolPreview svgPath={getSymbolIconPath(symbol)} symbolId={symbol.id} searchPreset={symbol.searchPreset} />
      </div>

      {/* Symbol Name */}
      <div className={`${compact ? 'h-auto w-full justify-center' : 'h-9 flex-1'} flex min-w-0 items-center`}>
        <div
          title={listName && listName !== localizedName ? localizedName : undefined}
          className={`${compact ? 'line-clamp-2 text-center text-[11px] leading-tight' : dense ? 'truncate text-sm' : 'truncate text-[0.95rem]'} font-medium text-gray-900 dark:text-white`}
        >
          {listName ?? localizedName}
        </div>
      </div>

      {/* Favorite Button */}
      <button
        onClick={handleFavoriteClick}
        className={`flex-shrink-0 rounded transition-colors ${compact ? 'absolute right-1 top-1 bg-white/80 dark:bg-gray-800/80' : ''} ${
          dense && !isFavorite
            ? 'w-0 overflow-hidden p-0 focus:w-auto focus:p-0.5 group-hover:w-auto group-hover:p-0.5'
            : dense
              ? 'p-0.5'
              : 'p-1'
        } ${
          isFavorite
            ? 'text-yellow-500 hover:text-yellow-600'
            : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 opacity-0 focus:opacity-100 group-hover:opacity-100'
        }`}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star className="w-4 h-4" fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

    </div>

    {showTooltip && tooltip && tooltipAnchor && (
      <SymbolHoverCard
        id={tooltipId}
        symbolId={symbol.id}
        name={localizedName}
        fallback={tooltip}
        anchor={tooltipAnchor}
        onEnter={keepTooltipOpen}
        onLeave={handleMouseLeave}
      />
    )}
    
    {/* Touch drag preview */}
    {touchDragActive && touchDragPos && createPortal(
      <div
        className="fixed pointer-events-none z-[9999]"
        style={getCenteredTouchDragPreviewStyle(touchDragPos)}
      >
        <div className="w-10 h-10 flex items-center justify-center bg-white dark:bg-gray-800 rounded border-2 border-sky-500 shadow-lg opacity-80">
          <SymbolPreview svgPath={getSymbolIconPath(symbol)} symbolId={symbol.id} searchPreset={symbol.searchPreset} />
        </div>
      </div>,
      document.body
    )}
    </>
  )
}

export default memo(SymbolItem)

interface SymbolPreviewProps {
  searchPreset?: string
  svgPath: string
  symbolId?: string
}

// Symbols with wide aspect ratios that need special rendering in the library preview.
// These get rendered via inline SVG with boosted stroke-width so they match the visual
// weight of square symbols, without modifying the actual SVG file.
const WIDE_SYMBOL_OVERRIDES: Record<string, { viewBox: string; strokeWidth: number; content: string }> = {
  panel_distribution: {
    viewBox: '0 0 88.2 48',
    strokeWidth: 3.6,
    content: '<rect x="4.4" y="15.6" width="79.4" height="16.9"/>',
  },
}

/** One outlet glyph in SVG units (matches public/symbols/outlets/*.svg). */
function SocketOutletGlyph({ showGround }: { showGround: boolean }) {
  return (
    <>
      <line x1={0.3} y1={24} x2={18.8} y2={24} />
      <path d="M35.3,8c-8.8,0-16,7.2-16,16s7.2,16,16,16" />
      {showGround && <line x1={19.3} y1={8} x2={19.3} y2={40} />}
      <line x1={35.5} y1={40} x2={35.5} y2={45} />
      <line x1={35.5} y1={3.6} x2={35.5} y2={8} />
    </>
  )
}

/**
 * Library preview for double sockets — spacing matches eendraad/plan:
 * MULTI_SOCKET_OFFSET at SYMBOL_SIZE, scaled to SOCKET_SYMBOL_SVG_SIZE.
 */
function DoubleSocketLibraryIcon({ showGround }: { showGround: boolean }) {
  const spacing = LIBRARY_DOUBLE_SOCKET_OFFSET_SVG
  const clipLeft = 6
  const viewWidth = SOCKET_SYMBOL_SVG_SIZE + spacing + clipLeft

  return (
    <div className="w-10 h-8 flex items-center justify-center overflow-hidden">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${-clipLeft} 0 ${viewWidth} ${SOCKET_SYMBOL_SVG_SIZE}`}
        className="w-full h-full dark:invert"
        fill="none"
        stroke="#000"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g>
          <SocketOutletGlyph showGround={showGround} />
        </g>
        <g transform={`translate(${spacing} 0)`}>
          <SocketOutletGlyph showGround={showGround} />
        </g>
      </svg>
    </div>
  )
}

// Library-only icon for fluorescent: base symbol + 2 tubes (same spacing as canvas: 25% height band).
// Margins and spacing match EndpointSymbol/PlacementSymbol (easy to tweak here).
function FluorescentLibraryIcon() {
  const viewBox = '0 0 48 48'
  const strokeWidth = 2
  const capX = 1.4
  const capX2 = 46.5
  const capY1 = 12.5
  const capY2 = 35.5
  // 2 tubes over 25% of height: bandHeight = 48 * 0.25 = 12, centered → y = 24 - 3 and 24 + 3
  const bandHeight = 48 * 0.25
  const tubeY1 = 24 - bandHeight / 2
  const tubeY2 = 24 + bandHeight / 2

  return (
    <div className="w-8 h-8 flex items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        className="w-full h-full dark:invert"
        fill="none"
        stroke="#000"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* End caps (vertical) */}
        <line x1={capX} y1={capY1} x2={capX} y2={capY2} />
        <line x1={capX2} y1={capY1} x2={capX2} y2={capY2} />
        {/* Tube lines (2 tubes) */}
        <line x1={capX} y1={tubeY1} x2={capX2} y2={tubeY1} />
        <line x1={capX} y1={tubeY2} x2={capX2} y2={tubeY2} />
      </svg>
    </div>
  )
}

function ModularSocketLibraryIcon() {
  return (
    <div className="w-8 h-8 flex items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        className="w-full h-full dark:invert"
        fill="none"
        stroke="#000"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x={1.5} y={1.5} width={45} height={45} rx={1} />
        <g transform="translate(2.2 2.2) scale(0.91)">
          <SocketOutletGlyph showGround />
        </g>
      </svg>
    </div>
  )
}

// Symbol IDs that use a custom React component for library preview only (not the main SVG).
const LIBRARY_ICON_CUSTOM: Record<string, () => ReactNode> = {
  light_fluorescent: () => <FluorescentLibraryIcon />,
  double_socket_gnd_child: () => <DoubleSocketLibraryIcon showGround />,
  double_socket_child: () => <DoubleSocketLibraryIcon showGround={false} />,
  modular_socket: () => <ModularSocketLibraryIcon />,
}

export function SymbolPreview({ svgPath, symbolId, searchPreset }: SymbolPreviewProps) {
  if (symbolId && searchPreset) return <SearchPresetPreview symbolId={symbolId} presetId={searchPreset} />
  const customIcon = symbolId ? LIBRARY_ICON_CUSTOM[symbolId] : undefined
  if (customIcon) {
    return <>{customIcon()}</>
  }

  const override = symbolId ? WIDE_SYMBOL_OVERRIDES[symbolId] : undefined

  if (override) {
    // Render inline SVG with boosted stroke for library preview only
    return (
      <div className="w-8 h-8 flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={override.viewBox}
          className="w-full h-full dark:invert"
        >
          <g
            fill="none"
            stroke="#000"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={override.strokeWidth}
            dangerouslySetInnerHTML={{ __html: override.content }}
          />
        </svg>
      </div>
    )
  }

  const normalizedSvgPath = svgPath.trim()
  if (!normalizedSvgPath) {
    return (
      <div className="w-8 h-8 flex items-center justify-center">
        <span className="text-gray-400 text-xs font-bold">?</span>
      </div>
    )
  }

  return <ThemedSymbolPreviewImg svgPath={normalizedSvgPath} />
}

function ThemedSymbolPreviewImg({ svgPath: catalogSvgPath }: { svgPath: string }) {
  const svgPath = useProtectionSymbolSvgPath(catalogSvgPath)
  const isDark = useSettingsStore((state) => state.theme.mode === 'dark')
  const [src, setSrc] = useState<string | null>(
    () => getCachedThemedSymbolBlobUrl(svgPath, isDark) ?? null,
  )
  const [failed, setFailed] = useState(false)
  const [previousSource, setPreviousSource] = useState({ svgPath, isDark })
  if (previousSource.svgPath !== svgPath || previousSource.isDark !== isDark) {
    setPreviousSource({ svgPath, isDark })
    setFailed(false)
    setSrc(getCachedThemedSymbolBlobUrl(svgPath, isDark) ?? null)
  }

  useEffect(() => {
    let cancelled = false

    const cached = getCachedThemedSymbolBlobUrl(svgPath, isDark)
    if (cached) {
      return
    }

    void loadProcessedSymbol(svgPath, isDark)
      .then((img) => {
        if (!cancelled) setSrc(img.src)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [svgPath, isDark])

  if (failed) {
    return (
      <div className="w-8 h-8 flex items-center justify-center">
        <span className="text-gray-400 text-xs font-bold">?</span>
      </div>
    )
  }

  if (!src) {
    return <div className="w-8 h-8" aria-hidden />
  }

  return (
    <div className="w-8 h-8 flex items-center justify-center">
      <img
        src={src}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full object-contain"
      />
    </div>
  )
}
