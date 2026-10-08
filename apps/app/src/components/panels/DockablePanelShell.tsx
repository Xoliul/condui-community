import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import { ChevronDown, ChevronLeft, GripVertical, X } from 'lucide-react'
import type { LeftDockPanel } from '@/stores/uiStore'
import { logger } from '@/lib/logger'
import {
  COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX,
  FLOATING_DOCKABLE_PANEL_Z_INDEX,
} from '@/constants/layoutConstants'

export interface DockablePanelOption {
  id: LeftDockPanel
  title: string
  icon?: ReactNode
}

interface DockablePanelShellProps {
  /** Floating-only panels that never dock use their own id. */
  panelId: LeftDockPanel | 'junction-editor'
  title: string
  mode: 'docked' | 'floating'
  children: ReactNode
  className?: string
  bodyClassName?: string
  panelStyle?: CSSProperties
  panelRef?: Ref<HTMLDivElement>
  headerActions?: ReactNode
  floatingCollapsed?: boolean
  dockedCollapsed?: boolean
  onFloatingCollapseToggle?: () => void
  onDockedCollapseToggle?: () => void
  onClose?: () => void
  onHeaderPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  onWindowPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  onResizeHandlePointerDown?: (
    edge: 'left' | 'right' | 'bottomRight'
  ) => (event: React.PointerEvent<HTMLDivElement>) => void
  onDockedUndockPointerDown?: (
    payload: {
      pointerId: number
      pointerType: string
      clientX: number
      clientY: number
      initialLeft: number
      initialTop: number
      offsetX: number
      offsetY: number
    }
  ) => void
  switchOptions?: DockablePanelOption[]
  onSwitchPanel?: (panel: LeftDockPanel) => void
}

export function DockablePanelShell({
  panelId,
  title,
  mode,
  children,
  className = '',
  bodyClassName = '',
  panelStyle,
  panelRef,
  headerActions,
  floatingCollapsed = false,
  dockedCollapsed = false,
  onFloatingCollapseToggle,
  onDockedCollapseToggle,
  onClose,
  onHeaderPointerDown,
  onWindowPointerDown,
  onResizeHandlePointerDown,
  onDockedUndockPointerDown,
  switchOptions = [],
  onSwitchPanel,
}: DockablePanelShellProps) {
  const DOCK_TEAR_OUT_THRESHOLD_PX = 6
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement | null>(null)
  const dockedDragRef = useRef<{
    pointerId: number
    pointerType: string
    startX: number
    startY: number
    initialLeft: number
    initialTop: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const isDocked = mode === 'docked'
  const isCollapsed = isDocked ? dockedCollapsed : floatingCollapsed
  const logDockTearOut = useCallback((message: string, details?: Record<string, unknown>) => {
    // Temporary instrumentation for dock-to-floating handoff debugging.

    logger.debug(`[DockTearOut:${panelId}] ${message}`, details ?? {})
  }, [panelId])

  const shouldIgnoreWindowDrag = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return !!target.closest(
      'button, input, textarea, select, option, a, label, summary, [role="button"], [role="link"], [draggable="true"], [contenteditable="true"], [data-no-window-drag]'
    )
  }

  useEffect(() => {
    if (!switcherOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [switcherOpen])

  useEffect(() => {
    if (!isDocked) return

    const handlePointerMove = (event: PointerEvent) => {
      const drag = dockedDragRef.current
      if (!drag) return
      if (event.pointerId !== drag.pointerId) return

      const distanceX = event.clientX - drag.startX
      const distanceY = event.clientY - drag.startY
      if (Math.hypot(distanceX, distanceY) < DOCK_TEAR_OUT_THRESHOLD_PX) return

      const detachedLeft = event.clientX - drag.offsetX
      const detachedTop = event.clientY - drag.offsetY
      logDockTearOut('threshold crossed', {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: drag.startX,
        startY: drag.startY,
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: drag.offsetX,
        offsetY: drag.offsetY,
        detachedLeft,
        detachedTop,
      })
      dockedDragRef.current = null
      onDockedUndockPointerDown?.({
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        clientX: event.clientX,
        clientY: event.clientY,
        initialLeft: detachedLeft,
        initialTop: detachedTop,
        offsetX: drag.offsetX,
        offsetY: drag.offsetY,
      })
    }

    const clearDockedDrag = (event?: PointerEvent) => {
      if (!dockedDragRef.current) return
      if (event && event.pointerId !== dockedDragRef.current.pointerId) return
      dockedDragRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', clearDockedDrag)
    window.addEventListener('pointercancel', clearDockedDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', clearDockedDrag)
      window.removeEventListener('pointercancel', clearDockedDrag)
    }
  }, [DOCK_TEAR_OUT_THRESHOLD_PX, isDocked, logDockTearOut, onDockedUndockPointerDown])

  const shellClassName = useMemo(() => {
    if (isDocked) {
      return `relative flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800 ${className}`.trim()
    }
    return `relative flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800 ${className}`.trim()
  }, [className, isDocked])

  const blurActiveControl = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }

  const handleSelectPanel = (nextPanel: LeftDockPanel) => {
    setSwitcherOpen(false)
    blurActiveControl()
    if (nextPanel !== panelId) {
      onSwitchPanel?.(nextPanel)
    }
  }
  const selectedSwitchOption = switchOptions.find((option) => option.id === panelId)

  const resolvedPanelStyle = useMemo(() => {
    if (isDocked) return panelStyle
    return { ...panelStyle, zIndex: FLOATING_DOCKABLE_PANEL_Z_INDEX }
  }, [isDocked, panelStyle])

  if (isDocked && isCollapsed) {
    return (
      <div
        className="flex h-full flex-col border-r border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
        style={{ width: COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX }}
      >
        <button
          type="button"
          onClick={onDockedCollapseToggle}
          className="flex h-full w-full items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700"
          title={title}
          aria-label={`Expand ${title}`}
        >
          <ChevronLeft className="h-5 w-5 rotate-180 text-gray-600 dark:text-gray-400" />
        </button>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className={shellClassName}
      style={resolvedPanelStyle}
      onPointerDownCapture={(event) => {
        if (isDocked) return
        if (!onWindowPointerDown) return
        const target = event.target instanceof Element ? event.target : null
        if (shouldIgnoreWindowDrag(target)) return
        if (target?.closest('[data-panel-header-drag="true"]')) return
        onWindowPointerDown(event)
      }}
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-600"
        onPointerDownCapture={(event) => {
          if (!isDocked) return
          if (!onDockedUndockPointerDown) return
          const target = event.target instanceof Element ? event.target : null
          if (shouldIgnoreWindowDrag(target)) return
          if (event.button !== 0) return
          event.preventDefault()
          const headerRect = event.currentTarget.getBoundingClientRect()
          logDockTearOut('header pointer down', {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            clientX: event.clientX,
            clientY: event.clientY,
            headerLeft: headerRect.left,
            headerTop: headerRect.top,
            headerWidth: headerRect.width,
            headerHeight: headerRect.height,
          })
          dockedDragRef.current = {
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            startX: event.clientX,
            startY: event.clientY,
            initialLeft: headerRect.left,
            initialTop: headerRect.top,
            offsetX: event.clientX - headerRect.left,
            offsetY: event.clientY - headerRect.top,
          }
        }}
      >
        <div
          data-panel-header-drag="true"
          className={`relative flex min-w-0 flex-1 items-center gap-2 ${onHeaderPointerDown ? 'cursor-grab active:cursor-grabbing select-none' : ''}`}
          ref={switcherRef}
          onPointerDown={isDocked ? undefined : onHeaderPointerDown}
        >
          {!isDocked && <GripVertical className="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500" />}
          {isDocked ? (
            <button
              type="button"
              onClick={() => {
                setSwitcherOpen((open) => !open)
                blurActiveControl()
              }}
              className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {selectedSwitchOption?.icon && (
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-gray-600 dark:text-gray-300 [&>svg]:h-4 [&>svg]:w-4 [&>span]:h-4 [&>span]:w-4">
                  {selectedSwitchOption.icon}
                </span>
              )}
              <span className="truncate text-lg font-semibold text-gray-900 dark:text-white">{title}</span>
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" />
            </button>
          ) : (
            <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          )}
          {isDocked && switcherOpen && switchOptions.length > 0 && (
            <div className="absolute left-0 top-full z-30 mt-2 min-w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
              {switchOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-testid={`dock-panel-switch-${option.id}`}
                  onClick={() => handleSelectPanel(option.id)}
                  className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                    option.id === panelId
                      ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {option.icon && (
                    <span className="mr-2 flex h-4 w-4 flex-shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4 [&>span]:h-4 [&>span]:w-4">
                      {option.icon}
                    </span>
                  )}
                  {option.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {headerActions}
          {isDocked ? (
            <button
              type="button"
              onClick={onDockedCollapseToggle}
              className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label={`Collapse ${title}`}
            >
              <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onFloatingCollapseToggle}
                className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
              >
                <ChevronDown className={`h-5 w-5 text-gray-600 transition-transform dark:text-gray-400 ${isCollapsed ? '-rotate-90' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label={`Close ${title}`}
              >
                <X className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </button>
            </>
          )}
        </div>
      </div>
      {!isDocked && onResizeHandlePointerDown && (
        <>
          <div
            data-no-window-drag
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize"
            onPointerDown={onResizeHandlePointerDown('left')}
          />
          <div
            data-no-window-drag
            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize"
            onPointerDown={onResizeHandlePointerDown('right')}
          />
          <div
            data-no-window-drag
            className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-se-resize"
            onPointerDown={onResizeHandlePointerDown('bottomRight')}
          />
        </>
      )}
      {!isCollapsed && <div className={`min-h-0 flex-1 ${bodyClassName}`.trim()}>{children}</div>}
    </div>
  )
}

export default DockablePanelShell
