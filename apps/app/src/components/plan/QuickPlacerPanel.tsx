import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { QuickPlacerFastIcon, QuickPlacerSlowIcon } from '@/components/icons/UiIcons'
import { getSymbolById } from '@/lib/symbols'
import { useThemeColors } from '@/lib/theme/hooks'
import { useDraggableFloatingWindow } from '@/hooks/useDraggableFloatingWindow'
import type { QuickPlacerCircuit, QuickPlacerItem } from '@/lib/plan/quickPlacer'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useUIStore, type FloatingPanelDragSeed } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { DockablePanelShell } from '@/components/panels/DockablePanelShell'
import CustomDropdown from '@/components/common/CustomDropdown'
import { QuickPlacerSymbolPreview, getQuickPlacerPreviewMetrics } from './QuickPlacerSymbolPreview'

type QuickPlacerMode = 'slow' | 'fast'

const DOCKED_SYMBOL_WRAP_OVERFLOW_PX = 10
const TOUCH_DRAG_THRESHOLD_PX = 10

type TouchGestureState = {
  touchId: number
  startX: number
  startY: number
  dragging: boolean
  scrollContainer: HTMLDivElement | null
  lockedScrollTop: number
  restoreScrollLock: (() => void) | null
}

interface QuickPlacerPanelProps {
  open: boolean
  circuits: QuickPlacerCircuit[]
  selectedCircuitId: string | null
  onSelectedCircuitIdChange: (circuitId: string) => void
  onSelectedPanelIdChange: (panelId: string) => void
  mode: QuickPlacerMode
  onModeChange: (mode: QuickPlacerMode) => void
  fastAutoSkipCustom: boolean
  onFastAutoSkipCustomChange: (value: boolean) => void
  currentFastItem: QuickPlacerItem | null
  currentFastIndex: number
  currentFastCount: number
  onClose: () => void
  renderMode?: 'floating' | 'docked'
  dockHost?: HTMLElement | null
  onDockRequest?: () => void
  onDockPreviewChange?: (active: boolean) => void
  externalDragStart?: Omit<FloatingPanelDragSeed, 'panel'> | null
  onItemActivate: (item: QuickPlacerItem) => void
  onItemHoverStart: (item: QuickPlacerItem) => void
  onItemHoverEnd: () => void
  onItemDragStart: (item: QuickPlacerItem) => void
  onItemDragEnd: () => void
  /** Scroll this item into view (e.g. the first symbol not on the plan yet). */
  focusPlacementId?: string | null
}

function withAlpha(color: string, alpha: number) {
  if (color.startsWith('#')) {
    const normalized =
      color.length === 4
        ? color
            .slice(1)
            .split('')
            .map((char) => char + char)
            .join('')
        : color.slice(1)
    const int = Number.parseInt(normalized, 16)
    const r = (int >> 16) & 255
    const g = (int >> 8) & 255
    const b = int & 255
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
  }

  if (color.startsWith('rgba(')) {
    return color.replace(/rgba\((.+),\s*[^,]+\)$/, `rgba($1, ${alpha})`)
  }

  return color
}

function getModeTooltip(mode: QuickPlacerMode, t: (key: string) => string): string {
  return mode === 'fast' ? t('quickPlacer.mode.fastTooltip') : t('quickPlacer.mode.slowTooltip')
}

function selectionIdsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
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

function getItemTypeLabel(item: QuickPlacerItem): string {
  const symbol = item.endpoint.symbol ? getSymbolById(item.endpoint.symbol) : null
  return symbol?.name || item.endpoint.symbol || item.endpoint.type
}

export const QuickPlacerPanel = forwardRef<HTMLDivElement, QuickPlacerPanelProps>(
  function QuickPlacerPanel(
    {
      open,
      circuits,
      selectedCircuitId,
      onSelectedCircuitIdChange,
      onSelectedPanelIdChange,
      mode,
      onModeChange,
      fastAutoSkipCustom,
      onFastAutoSkipCustomChange,
      currentFastItem,
      currentFastIndex,
      currentFastCount,
      onClose,
      renderMode = 'floating',
      dockHost = null,
      onDockRequest,
      onDockPreviewChange,
      externalDragStart,
      onItemActivate,
      onItemHoverStart,
      onItemHoverEnd,
      onItemDragStart,
      onItemDragEnd,
      focusPlacementId = null,
    },
    forwardedRef
  ) {
    const { t } = useTranslation()
    const selectedPlacementIds = useStoreWithEqualityFn(
      useUIStore,
      (s) => (s.selection.type === 'placement' ? s.selection.ids : []),
      selectionIdsEqual
    )
    const selectedEndpointIds = useStoreWithEqualityFn(
      useUIStore,
      (s) => (s.selection.type === 'endpoint' ? s.selection.ids : []),
      selectionIdsEqual
    )
    const theme = useSettingsStore((state) => state.theme)
    const colors = useThemeColors()
    const [collapsed, setCollapsed] = useState(false)
    const compactDockedLayout = renderMode === 'docked'
    const {
      containerRef,
      onHeaderPointerDown,
      onWindowPointerDown,
      onResizeHandlePointerDown,
      windowStyle,
    } = useDraggableFloatingWindow({
      initialTop: 88,
      initialRight: 24,
      initialWidth: 576,
      margin: 16,
      externalDragStart,
      debugName: 'quickPlacer',
      onDockLeft: renderMode === 'floating' ? onDockRequest : undefined,
      onDockPreviewChange: renderMode === 'floating' ? onDockPreviewChange : undefined,
      minWidth: 320,
      minHeight: 240,
    })
    const selectedCircuitButtonRef = useRef<HTMLButtonElement | null>(null)
    const currentFastItemRef = useRef<HTMLButtonElement | null>(null)
    const focusItemRef = useRef<HTMLButtonElement | null>(null)
    const [touchDragItem, setTouchDragItem] = useState<QuickPlacerItem | null>(null)
    const [touchDragPos, setTouchDragPos] = useState<{ x: number; y: number } | null>(null)
    const touchGestureRef = useRef<TouchGestureState | null>(null)
    const touchMoveHandlerRef = useRef<((ev: TouchEvent) => void) | null>(null)
    const touchEndHandlerRef = useRef<((ev: TouchEvent) => void) | null>(null)
    const touchDragFrameRef = useRef<number | null>(null)
    const touchDragLatestPosRef = useRef<{ x: number; y: number } | null>(null)
    const suppressNextItemClickRef = useRef(false)

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        containerRef.current = node
        if (typeof forwardedRef === 'function') {
          forwardedRef(node)
        } else if (forwardedRef) {
          forwardedRef.current = node
        }
      },
      [containerRef, forwardedRef]
    )

    const selectedCircuit =
      circuits.find((circuit) => circuit.id === selectedCircuitId) ?? circuits[0] ?? null
    const panelOptions = useMemo(() => {
      const seenPanelIds = new Set<string>()
      return circuits.flatMap((circuit) => {
        if (seenPanelIds.has(circuit.panelId)) return []
        seenPanelIds.add(circuit.panelId)
        return [
          {
            value: circuit.panelId,
            label: circuit.panelPathLabel || circuit.panelName,
          },
        ]
      })
    }, [circuits])
    const selectedPanelId = selectedCircuit?.panelId ?? panelOptions[0]?.value ?? ''
    const panelCircuits = useMemo(
      () => circuits.filter((circuit) => circuit.panelId === selectedPanelId),
      [circuits, selectedPanelId]
    )
    const handlePanelChange = useCallback(
      (panelId: string) => {
        onSelectedPanelIdChange(panelId)
      },
      [onSelectedPanelIdChange]
    )
    const isDark = theme.mode === 'dark'

    const styles = useMemo(() => {
      const panelBackground = withAlpha(colors.background, 0.98)
      const mutedSurface = withAlpha(colors.moduleBg, isDark ? 0.42 : 0.72)
      const softSurface = withAlpha(colors.moduleBg, isDark ? 0.7 : 0.48)
      const hoverSurface = withAlpha(colors.hoverColor, isDark ? 0.16 : 0.08)
      const activeSurface = withAlpha(colors.hoverColor, isDark ? 0.24 : 0.14)

      return {
        panel: {
          backgroundColor: panelBackground,
          borderColor: colors.toolBubbleBorder,
          boxShadow: isDark
            ? '0 24px 64px rgba(0, 0, 0, 0.42)'
            : '0 24px 64px rgba(15, 23, 42, 0.18)',
          color: colors.textColor,
        },
        header: {
          borderBottomColor: colors.toolBubbleBorder,
        },
        title: {
          color: colors.textColor,
        },
        closeButton: {
          color: colors.secondaryText,
        },
        closeButtonHover: {
          backgroundColor: softSurface,
          color: colors.textColor,
        },
        modeButton: {
          borderColor: colors.toolBubbleBorder,
          backgroundColor: colors.background,
          color: colors.textColor,
        },
        modeButtonActive: {
          borderColor: colors.hoverColor,
          backgroundColor: colors.hoverColor,
          color: '#ffffff',
          boxShadow: isDark ? '0 1px 3px rgba(0, 0, 0, 0.28)' : '0 1px 3px rgba(15, 23, 42, 0.14)',
        },
        checkboxLabel: {
          color: colors.textColor,
        },
        fastCount: {
          color: colors.hoverColor,
        },
        circuitRail: {
          borderRightColor: colors.toolBubbleBorder,
          backgroundColor: mutedSurface,
        },
        circuitButton: {
          color: colors.textColor,
        },
        circuitButtonHover: {
          backgroundColor: colors.background,
        },
        circuitButtonActive: {
          backgroundColor: withAlpha(colors.hoverColor, isDark ? 0.16 : 0.08),
          color: colors.textColor,
          boxShadow: `inset 0 0 0 2px ${colors.hoverColor}`,
        },
        itemCount: {
          color: colors.secondaryText,
        },
        itemCountActive: {
          color: colors.secondaryText,
        },
        notes: {
          color: colors.secondaryText,
        },
        branchLabel: {
          backgroundColor: softSurface,
          color: colors.textColor,
        },
        branchLabelActive: {
          backgroundColor: colors.hoverColor,
          color: '#ffffff',
          boxShadow: isDark ? '0 1px 3px rgba(0, 0, 0, 0.28)' : '0 1px 3px rgba(15, 23, 42, 0.14)',
        },
        symbolCard: {
          borderColor: colors.toolBubbleBorder,
          backgroundColor: colors.background,
        },
        symbolCardHover: {
          borderColor: withAlpha(colors.hoverColor, 0.55),
          backgroundColor: hoverSurface,
        },
        symbolCardCurrent: {
          borderColor: colors.hoverColor,
          backgroundColor: activeSurface,
          boxShadow: isDark ? '0 1px 3px rgba(0, 0, 0, 0.24)' : '0 1px 3px rgba(15, 23, 42, 0.12)',
        },
        customDot: {
          backgroundColor: colors.secondaryText,
          boxShadow: `0 0 0 1px ${panelBackground}`,
        },
        fallbackIcon: {
          color: colors.secondaryText,
        },
        typeLabel: {
          color: colors.textColor,
        },
        currentPill: {
          backgroundColor: colors.hoverColor,
          color: '#ffffff',
        },
        emptyState: {
          borderColor: colors.frameColor,
          color: colors.secondaryText,
        },
      }
    }, [colors, isDark])

    useEffect(() => {
      selectedCircuitButtonRef.current?.scrollIntoView({ block: 'nearest' })
    }, [selectedCircuit?.id])

    useEffect(() => {
      if (mode !== 'fast') return
      currentFastItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, [mode, currentFastItem?.placement.id, selectedCircuit?.id])

    useEffect(() => {
      if (!focusPlacementId) return
      const frame = requestAnimationFrame(() => {
        focusItemRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
      return () => cancelAnimationFrame(frame)
    }, [focusPlacementId, selectedCircuit?.id])

    const handleDragStart = useCallback(
      (event: DragEvent<HTMLButtonElement>, item: QuickPlacerItem) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-eendra-quick-placer', item.placement.id)
        event.dataTransfer.setData('text/plain', item.placement.id)
        onItemDragStart(item)
      },
      [onItemDragStart]
    )

    const cleanupTouchGesture = useCallback(() => {
      const gesture = touchGestureRef.current
      if (gesture?.restoreScrollLock) {
        gesture.restoreScrollLock()
      }

      touchGestureRef.current = null
      setTouchDragItem(null)
      setTouchDragPos(null)
      onItemDragEnd()

      if (touchMoveHandlerRef.current) {
        window.removeEventListener('touchmove', touchMoveHandlerRef.current as EventListener, true)
      }
      if (touchEndHandlerRef.current) {
        window.removeEventListener('touchend', touchEndHandlerRef.current as EventListener, true)
        window.removeEventListener('touchcancel', touchEndHandlerRef.current as EventListener, true)
      }

      touchMoveHandlerRef.current = null
      touchEndHandlerRef.current = null
      touchDragLatestPosRef.current = null
      if (touchDragFrameRef.current != null) {
        window.cancelAnimationFrame(touchDragFrameRef.current)
        touchDragFrameRef.current = null
      }
    }, [onItemDragEnd])

    useEffect(() => {
      return () => {
        cleanupTouchGesture()
      }
    }, [cleanupTouchGesture])

    const handleItemTouchStart = useCallback(
      (event: ReactTouchEvent<HTMLButtonElement>, item: QuickPlacerItem) => {
        if (mode !== 'slow' || event.touches.length !== 1) return
        event.preventDefault()
        const touch = event.touches[0]
        if (!touch) return

        const scrollContainer = event.currentTarget.closest(
          '[data-library-scroll="true"]'
        ) as HTMLDivElement | null
        touchGestureRef.current = {
          touchId: touch.identifier,
          startX: touch.clientX,
          startY: touch.clientY,
          dragging: true,
          scrollContainer,
          lockedScrollTop: scrollContainer?.scrollTop ?? 0,
          restoreScrollLock: scrollContainer ? lockLibraryScroll(scrollContainer) : null,
        }
        setTouchDragItem(item)
        setTouchDragPos({ x: touch.clientX, y: touch.clientY })
        onItemDragStart(item)

        const handleWindowTouchMove = (ev: TouchEvent) => {
          const gesture = touchGestureRef.current
          if (!gesture) return
          const activeTouch =
            findTouchById(ev.touches, gesture.touchId) ||
            findTouchById(ev.changedTouches, gesture.touchId)
          if (!activeTouch) return

          const dx = activeTouch.clientX - gesture.startX
          const dy = activeTouch.clientY - gesture.startY
          const touchDistance = Math.hypot(dx, dy)

          if (touchDistance <= TOUCH_DRAG_THRESHOLD_PX) {
            ev.preventDefault()
            return
          }

          ev.preventDefault()
          if (gesture.scrollContainer) {
            gesture.scrollContainer.scrollTop = gesture.lockedScrollTop
          }
          touchDragLatestPosRef.current = { x: activeTouch.clientX, y: activeTouch.clientY }
          if (touchDragFrameRef.current == null) {
            touchDragFrameRef.current = window.requestAnimationFrame(() => {
              touchDragFrameRef.current = null
              if (touchDragLatestPosRef.current) {
                setTouchDragPos(touchDragLatestPosRef.current)
              }
            })
          }
        }

        const handleWindowTouchEnd = (ev: TouchEvent) => {
          const gesture = touchGestureRef.current
          if (!gesture) return
          const endTouch =
            findTouchById(ev.changedTouches, gesture.touchId) ||
            findTouchById(ev.touches, gesture.touchId)

          if (gesture.dragging && endTouch) {
            ev.preventDefault()
            suppressNextItemClickRef.current = true
            window.dispatchEvent(
              new CustomEvent('quickplacertouchdragend', {
                detail: {
                  placementId: item.placement.id,
                  x: endTouch.clientX,
                  y: endTouch.clientY,
                },
              })
            )
          }

          cleanupTouchGesture()
        }

        touchMoveHandlerRef.current = handleWindowTouchMove
        touchEndHandlerRef.current = handleWindowTouchEnd

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
      [cleanupTouchGesture, mode, onItemDragStart]
    )

    const isItemHighlighted = useCallback(
      (item: QuickPlacerItem) =>
        currentFastItem?.placement.id === item.placement.id ||
        selectedPlacementIds.includes(item.placement.id) ||
        selectedEndpointIds.includes(item.endpoint.id),
      [currentFastItem?.placement.id, selectedEndpointIds, selectedPlacementIds]
    )

    if (!open || typeof document === 'undefined') return null

    const panelBody = (
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b px-4 py-2.5" style={styles.header}>
          <div className="mt-0 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onModeChange('slow')}
              title={getModeTooltip('slow', t)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-[filter]"
              style={mode === 'slow' ? styles.modeButtonActive : styles.modeButton}
            >
              <QuickPlacerSlowIcon className="h-4 w-4" />
              <span>{t('quickPlacer.mode.slow')}</span>
            </button>
            <button
              type="button"
              onClick={() => onModeChange(mode === 'fast' ? 'slow' : 'fast')}
              title={getModeTooltip('fast', t)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-[filter]"
              style={mode === 'fast' ? styles.modeButtonActive : styles.modeButton}
            >
              <QuickPlacerFastIcon className="h-4 w-4" />
              <span>{t('quickPlacer.mode.fast')}</span>
            </button>

            <label
              className={`inline-flex items-center gap-2 text-sm ${compactDockedLayout ? '' : 'ml-1'}`}
              style={styles.checkboxLabel}
            >
              <input
                type="checkbox"
                checked={fastAutoSkipCustom}
                onChange={(event) => onFastAutoSkipCustomChange(event.target.checked)}
                className="rounded"
                style={{ accentColor: colors.hoverColor }}
              />
              <span>
                {compactDockedLayout
                  ? t('quickPlacer.autoSkip.short')
                  : t('quickPlacer.autoSkip.full')}
              </span>
            </label>

            {mode === 'fast' && (
              <div className="text-xs font-medium sm:ml-auto" style={styles.fastCount}>
                {currentFastCount > 0
                  ? `${currentFastIndex + 1} / ${currentFastCount}`
                  : t('quickPlacer.noItems')}
              </div>
            )}
          </div>
        </div>

        {panelOptions.length > 1 && (
          <div className="border-b px-3 py-2" style={styles.header}>
            <CustomDropdown
              value={selectedPanelId}
              onChange={handlePanelChange}
              options={panelOptions}
              ariaLabel={t('quickPlacer.panelSelector')}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              menuPortal
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            data-library-scroll="true"
            className="min-h-0 overflow-y-auto border-r p-2"
            style={{
              ...styles.circuitRail,
              width: compactDockedLayout ? 'clamp(4.5rem, 24%, 7rem)' : '10rem',
              minWidth: compactDockedLayout ? '4.5rem' : '10rem',
              flexShrink: compactDockedLayout ? 1 : 0,
            }}
          >
            <div className="space-y-1">
              {panelCircuits.map((circuit) => {
                const itemCount = circuit.branches.reduce(
                  (sum, branch) => sum + branch.items.length,
                  0
                )
                const showItemCount = !compactDockedLayout && circuit.identifier.trim().length <= 6
                const isSelected = circuit.id === selectedCircuit?.id
                return (
                  <div key={circuit.id}>
                    <button
                      ref={isSelected ? selectedCircuitButtonRef : null}
                      type="button"
                      onClick={() => onSelectedCircuitIdChange(circuit.id)}
                      className={`w-full rounded-md text-left transition-colors ${compactDockedLayout ? 'px-2 py-1.5 text-sm' : 'px-3 py-1.5 text-sm'}`}
                      style={isSelected ? styles.circuitButtonActive : styles.circuitButton}
                      onMouseEnter={(event) => {
                        if (!isSelected) {
                          Object.assign(event.currentTarget.style, styles.circuitButtonHover)
                        }
                      }}
                      onMouseLeave={(event) => {
                        if (!isSelected) {
                          event.currentTarget.style.backgroundColor = 'transparent'
                          event.currentTarget.style.color = styles.circuitButton.color
                        }
                      }}
                      title={`${circuit.identifier} • ${circuit.panelPathLabel}`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className={`min-w-0 flex-1 truncate font-semibold leading-tight ${compactDockedLayout ? 'text-[15px]' : 'text-[17px]'}`}
                        >
                          {circuit.identifier}
                        </div>
                        {circuit.awaitingCount > 0 ? (
                          <span
                            data-testid={`quick-placer-circuit-awaiting-${circuit.id}`}
                            title={t('quickPlacer.unplaced.count', { count: circuit.awaitingCount })}
                            className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-semibold leading-none text-white"
                          >
                            {circuit.awaitingCount > 99 ? '99+' : circuit.awaitingCount}
                          </span>
                        ) : (
                          showItemCount && (
                            <div
                              className="shrink-0 text-[11px]"
                              style={isSelected ? styles.itemCountActive : styles.itemCount}
                            >
                              {t('quickPlacer.itemCount', { count: itemCount })}
                            </div>
                          )
                        )}
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div data-library-scroll="true" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
            {selectedCircuit ? (
              <div className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <div className="text-base font-semibold" style={styles.title}>
                    {selectedCircuit.identifier}
                  </div>
                  <div className="truncate text-xs" style={styles.notes}>
                    {selectedCircuit.notes || t('quickPlacer.noNotes')}
                  </div>
                </div>

                {selectedCircuit.branches.map((branch) => {
                  const isBranchHighlighted = branch.items.some(isItemHighlighted)

                  return (
                    <section key={branch.id} className="flex items-stretch gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const firstItem = branch.items[0]
                          if (firstItem) onItemActivate(firstItem)
                        }}
                        className="flex w-[2.25rem] shrink-0 items-start justify-center rounded-md px-1 py-1 text-[16px] font-semibold transition-[filter] hover:brightness-95"
                        style={isBranchHighlighted ? styles.branchLabelActive : styles.branchLabel}
                        title={branch.label}
                      >
                        {branch.label}
                      </button>

                      <div
                        data-library-scroll="true"
                        className={`min-w-0 flex-1 pb-px ${
                          compactDockedLayout ? 'overflow-x-hidden' : 'overflow-x-auto'
                        }`}
                      >
                        <div
                          className={`flex gap-1 ${
                            compactDockedLayout ? 'min-w-0 flex-wrap content-start' : 'min-w-max'
                          }`}
                          style={
                            compactDockedLayout
                              ? { width: `calc(100% + ${DOCKED_SYMBOL_WRAP_OVERFLOW_PX}px)` }
                              : undefined
                          }
                        >
                          {branch.items.map((item) => {
                            const symbol = item.endpoint.symbol
                              ? getSymbolById(item.endpoint.symbol)
                              : null
                            const isCurrent = currentFastItem?.placement.id === item.placement.id
                            const isHighlighted = isItemHighlighted(item)
                            const typeLabel = getItemTypeLabel(item)
                            const previewMetrics = getQuickPlacerPreviewMetrics(item.endpoint)
                            return (
                              <button
                                ref={(node) => {
                                  if (isCurrent) currentFastItemRef.current = node
                                  if (item.placement.id === focusPlacementId) {
                                    focusItemRef.current = node
                                  }
                                }}
                                data-awaiting-placement={item.isAwaitingPlacement || undefined}
                                key={item.placement.id}
                                type="button"
                                draggable={mode === 'slow'}
                                onDragStart={(event) => handleDragStart(event, item)}
                                onDragEnd={onItemDragEnd}
                                onTouchStart={(event) => handleItemTouchStart(event, item)}
                                onClick={(event) => {
                                  if (suppressNextItemClickRef.current) {
                                    suppressNextItemClickRef.current = false
                                    event.preventDefault()
                                    return
                                  }
                                  onItemActivate(item)
                                }}
                                title={`${item.isCustomPlacement ? t('quickPlacer.customPlacement') : t('quickPlacer.defaultPlacement')} • ${t('quickPlacer.floor')}: ${item.floorName}`}
                                className="relative flex shrink-0 flex-col items-center rounded-[7px] border px-1.5 py-1 text-center transition-colors"
                                style={{
                                  ...(isHighlighted ? styles.symbolCardCurrent : styles.symbolCard),
                                  ...(item.isAwaitingPlacement && !isHighlighted
                                    ? { borderStyle: 'dashed', borderColor: '#0284c7' }
                                    : null),
                                  width: previewMetrics.cardWidth,
                                }}
                                onMouseEnter={(event) => {
                                  onItemHoverStart(item)
                                  if (!isHighlighted) {
                                    Object.assign(event.currentTarget.style, styles.symbolCardHover)
                                  }
                                }}
                                onMouseLeave={(event) => {
                                  onItemHoverEnd()
                                  if (!isHighlighted) {
                                    Object.assign(event.currentTarget.style, styles.symbolCard)
                                    if (item.isAwaitingPlacement) {
                                      event.currentTarget.style.borderStyle = 'dashed'
                                      event.currentTarget.style.borderColor = '#0284c7'
                                    }
                                  }
                                }}
                              >
                                {item.isCustomPlacement && (
                                  <span
                                    aria-label={t('quickPlacer.customPlacement')}
                                    className="absolute right-1 top-1 h-2 w-2 rounded-full"
                                    style={styles.customDot}
                                  />
                                )}
                                <div className="flex min-h-[1.9rem] items-center justify-center">
                                  {symbol?.svgPath ? (
                                    <QuickPlacerSymbolPreview endpoint={item.endpoint} />
                                  ) : (
                                    <div className="text-sm" style={styles.fallbackIcon}>
                                      ?
                                    </div>
                                  )}
                                </div>
                                <div
                                  className="mt-1 line-clamp-2 text-[9px] font-medium leading-tight"
                                  style={styles.typeLabel}
                                >
                                  {typeLabel}
                                </div>
                                {isCurrent && (
                                  <div
                                    className="mt-0.5 rounded-full px-1 py-0.5 text-[7px] font-semibold"
                                    style={styles.currentPill}
                                  >
                                    {t('quickPlacer.current')}
                                  </div>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </section>
                  )
                })}
              </div>
            ) : (
              <div
                className="rounded-md border border-dashed px-4 py-6 text-sm"
                style={styles.emptyState}
              >
                {t('quickPlacer.emptyState')}
              </div>
            )}
          </div>
        </div>
      </div>
    )

    const touchDragPreview =
      touchDragItem && touchDragPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[9999]"
              style={{
                left: touchDragPos.x - 20,
                top: touchDragPos.y - 20,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded border-2 border-sky-500 bg-white shadow-lg opacity-80 dark:bg-gray-800">
                <QuickPlacerSymbolPreview endpoint={touchDragItem.endpoint} />
              </div>
            </div>,
            document.body
          )
        : null

    if (renderMode === 'docked') {
      const dockedPanel = dockHost
        ? createPortal(
            <div ref={setRefs} data-quick-placer-root className="h-full min-h-0">
              {panelBody}
            </div>,
            dockHost
          )
        : null
      return (
        <>
          {dockedPanel}
          {touchDragPreview}
        </>
      )
    }

    return (
      <>
        {createPortal(
          <DockablePanelShell
            panelId="quickPlacer"
            title={t('quickPlacer.title')}
            mode="floating"
            bodyClassName="flex min-h-0 overflow-hidden"
            panelRef={setRefs}
            floatingCollapsed={collapsed}
            onFloatingCollapseToggle={() => setCollapsed((value) => !value)}
            onClose={onClose}
            onHeaderPointerDown={onHeaderPointerDown}
            onWindowPointerDown={onWindowPointerDown}
            onResizeHandlePointerDown={onResizeHandlePointerDown}
            panelStyle={{
              ...styles.panel,
              position: 'fixed',
              width: 'min(94vw,36rem)',
              height: collapsed ? undefined : 'min(78vh,42rem)',
              maxHeight: 'min(78vh,42rem)',
              ...windowStyle,
            }}
          >
            {panelBody}
          </DockablePanelShell>,
          document.body
        )}
        {touchDragPreview}
      </>
    )
  }
)
