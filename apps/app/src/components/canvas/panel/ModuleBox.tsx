import { useModuleArtwork } from './useModuleArtwork'
import { memo, useCallback, useRef, useEffect, useState } from 'react'
import { Circle, Rect, Group, Text, Image, Line } from 'react-konva'
import { useUIStore } from '@/stores/uiStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { PanelGridModuleRef, Endpoint } from '@/types/schema'
import type { Selection } from '@/types/ui'
import { toggleSelection, selectMultiple } from '@/utils/selection'
import type { ModuleDisplayInfo } from '@/lib/panel/getModuleDisplayInfo'
import { CELL_W, panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'
import { findPanelContainingModuleRef, getRelationEdges } from './panelRelationEdges'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  getSymbolById,
  getDomainForSymbol,
} from '@/lib/symbols'
import { getSurgeProtectionSymbolPath } from '@/lib/surgeProtectionSymbol'
import { useProtectionSymbolSvgPath } from '@/hooks/useProtectionSymbolSvgPath'
import {
  getConverterArtworkLayout,
  getConverterCornerPosition,
  getConverterDomainCorner,
  isDirectionalConverterSymbol,
  SUPPLY_ASSEMBLY_CONNECTION_DOMAINS,
} from '@/lib/converterArtwork'
import { logger } from '@/lib/logger'
import { useIsMarqueeSelecting, useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import { getSpdPanelModuleLayout } from './spdPanelModuleLayout'
import { snapTerminalStripWidth } from '@/lib/panel/panelGridUnits'
import {
  isModularSocket,
  snapModularSocketModuleWidthWithin,
  socketCountForModularWidth,
} from '@/lib/socket/modularSocket'
import { ModularSocketModuleGraphic } from './ModularSocketModuleGraphic'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { getPanelModuleLabelFontSize } from './panelModuleLabelLayout'
import { getPanelModuleSpecLayout } from './panelModuleSpecLayout'
import { getSelectionForRef } from './moduleSelection'

const DRAG_THRESHOLD = 8
const RESIZE_HANDLE_W = 10

export interface ModuleTooltipData {
  text: string
  clientX: number
  clientY: number
}

interface ModuleBoxProps {
  moduleRef: PanelGridModuleRef
  terminalStripMemberRefs?: PanelGridModuleRef[]
  selectionOverride?: Selection
  x: number
  y: number
  width: number
  height: number
  info: ModuleDisplayInfo
  onDragEnd?: (
    ref: PanelGridModuleRef,
    x: number,
    y: number,
    shiftKey: boolean,
    altKey: boolean
  ) => void
  onDragMove?: (
    ref: PanelGridModuleRef,
    x: number,
    y: number,
    shiftKey: boolean,
    altKey: boolean
  ) => void
  onDragStart?: (ref: PanelGridModuleRef, x: number, y: number) => void
  draggable?: boolean
  onAssignTargetClick?: (ref: PanelGridModuleRef) => void
  onHoverChange?: (data: ModuleTooltipData | null) => void
  onHoverRefChange?: (ref: PanelGridModuleRef | null) => void
  onResizeEnd?: (ref: PanelGridModuleRef, newWidthCols: number) => void
  isResizeWidthValid?: (ref: PanelGridModuleRef, newWidthCols: number) => boolean
  maxWidthCols?: number
  onRewireDragStart?: (ref: PanelGridModuleRef, x: number, y: number) => boolean
  onRewireDragMove?: (stage: Konva.Stage, pointerPos: { x: number; y: number }) => void
  onRewireDragEnd?: () => void
  isRewireOrigin?: boolean
  isRewireTarget?: boolean
  isRewireTargetValid?: boolean
  onSelectionIntent?: (
    nextSelection: Selection,
    context: {
      ref: PanelGridModuleRef
      event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
      currentSelection: Selection
    }
  ) => Selection | null
  /** Dev-only panel relation debug palette for module role overlays. */
  debugMode?: boolean
  /** Dev-only: classify trunk supply devices as shared vs unique. */
  debugSupplyTrunkKind?: 'shared' | 'unique'
  /** Render the module without accepting pointer selection or drag gestures. */
  interactive?: boolean
  /** Keep the source in place while the parent renders an Alt-drag copy preview. */
  resetPositionOnAltDrag?: boolean
  /** Visual-only copy used by drag previews. */
  opacity?: number
  /** Compress identification and essential ratings into the center band while labels are edited. */
  compactLabelMode?: boolean
}

const SPEC_FONT_SIZE = 7.5
const SPEC_LINE_HEIGHT = 8.5
const MAX_SPEC_LINES = 3
const MODULE_TOP_BAND_RATIO = 0.25
const MODULE_BOTTOM_BAND_RATIO = 0.75
const MODULE_BAND_PADDING = 3
const PHASE_FONT_SIZE = 7

const TOOLTIP_DELAY_MS = 650

interface KonvaDragEntry {
  dragStatus?: string
}

interface KonvaDragDropInternals {
  _dragElements?: Map<number, KonvaDragEntry>
}

type KonvaWithDragDropInternals = typeof Konva & {
  DD?: KonvaDragDropInternals
}

type KonvaNodeWithId = Konva.Node & {
  _id?: number
}

type ModuleMouseEvent = KonvaEventObject<MouseEvent>
type ModuleClickEvent = KonvaEventObject<MouseEvent | TouchEvent>
type ModuleDragEvent = KonvaEventObject<DragEvent>

function ModuleBox({
  moduleRef,
  terminalStripMemberRefs,
  selectionOverride,
  x,
  y,
  width,
  height,
  info,
  onDragEnd,
  onDragMove,
  onDragStart,
  draggable = false,
  onAssignTargetClick,
  onHoverChange,
  onHoverRefChange,
  onResizeEnd,
  isResizeWidthValid,
  maxWidthCols,
  onRewireDragStart,
  onRewireDragMove,
  onRewireDragEnd,
  isRewireOrigin = false,
  isRewireTarget = false,
  isRewireTargetValid = true,
  onSelectionIntent,
  debugMode = false,
  debugSupplyTrunkKind,
  interactive = true,
  resetPositionOnAltDrag = false,
  opacity = 1,
  compactLabelMode = false,
}: ModuleBoxProps) {
  const setSelection = useUIStore((s) => s.setSelection)
  const colors = useThemeColors()
  const themeMode = useSettingsStore((s) => s.theme.mode)
  const fontFamily = useCanvasFontFamily()
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const getProtectionById = useProjectStore((s: ProjectState) => s.getProtectionById)
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const groupRef = useRef<Konva.Group>(null)
  const isDragging = useRef(false)
  // Konva's node is reset to the source during an Alt-drag, so preserve the
  // pointer-derived position separately for the eventual duplicate-on-drop.
  const altDuplicateDropPositionRef = useRef<{ x: number; y: number } | null>(null)
  const bgRectRef = useRef<Konva.Rect>(null)
  const labelTextRef = useRef<Konva.Text>(null)
  const specTextRef = useRef<Konva.Text>(null)
  const handleVisualRef = useRef<Konva.Rect>(null)
  const resizeWidthRef = useRef<number | null>(null)
  const resizeInvalidRef = useRef(false)
  const [isHovered, setIsHovered] = useState(false)
  const isMarqueeSelecting = useIsMarqueeSelecting()
  const isPreviewSelected = useIsPreviewSelected(
    moduleRef.kind === 'domotica' ? 'endpoint' : moduleRef.kind,
    moduleRef.kind === 'domotica' ? moduleRef.endpointId : moduleRef.id
  )
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipVisibleRef = useRef(false)
  const mousePositionRef = useRef<{ clientX: number; clientY: number }>({ clientX: 0, clientY: 0 })

  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const [resizeInvalid, setResizeInvalid] = useState(false)

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
    }
  }, [])

  if (isMarqueeSelecting && isHovered) setIsHovered(false)
  useEffect(() => {
    if (!isMarqueeSelecting) return
    onHoverRefChange?.(null)
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    tooltipVisibleRef.current = false
    onHoverChange?.(null)
  }, [isMarqueeSelecting, onHoverChange, onHoverRefChange])

  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.dragDistance(DRAG_THRESHOLD)
    }
  }, [])

  // Force Konva node position to match React props after every render.
  // react-konva's diffing doesn't detect divergence caused by drag internals.
  useEffect(() => {
    const node = groupRef.current
    if (node && !isDragging.current) {
      node.x(x)
      node.y(y)
    }
  }, [x, y])

  const domoticaEndpoint: Endpoint | undefined =
    moduleRef.kind === 'domotica' ? getEndpointById(moduleRef.endpointId) : undefined
  const sel = selectionOverride ?? getSelectionForRef(moduleRef, domoticaEndpoint)
  const selectedModuleIds =
    terminalStripMemberRefs?.flatMap((ref) =>
      ref.kind === 'domotica' ? [ref.endpointId] : 'id' in ref ? [ref.id] : []
    ) ?? sel.ids
  const isSelected = useUIStore((state) =>
    sel.type !== null &&
    sel.ids.length > 0 &&
    sel.ids[0] != null &&
    selectedModuleIds.some((id) => state.selection.ids.includes(id)) &&
    (state.selection.type === sel.type || state.selection.ids.length > 1)
  )

  // Promote hovered/selected module to top so its outline is never clipped by neighbours.
  // Selection wins over hover — both call moveToTop so the last selected module stays on top
  // even if another module is hovered afterwards.
  useEffect(() => {
    if (isPreviewSelected || isHovered || isSelected) {
      groupRef.current?.moveToTop()
    }
  }, [isHovered, isPreviewSelected, isSelected])

  // Workaround for Konva bug: DD._dragElements entries with dragStatus "ready"
  // are not cleaned up on pointerup/mouseup for nodes inside react-konva trees.
  // This leaves a stale "ready" entry that triggers a spurious drag on the next
  // mousemove, even though no button is held. We flush these stale entries
  // whenever a click fires (click = the gesture was NOT a drag).
  const flushStaleDragEntry = useCallback(() => {
    const dd = (Konva as KonvaWithDragDropInternals).DD
    const nodeId = (groupRef.current as KonvaNodeWithId | null)?._id
    if (!dd?._dragElements || nodeId == null) return
    const entry = dd._dragElements.get(nodeId)
    if (entry && entry.dragStatus === 'ready') {
      dd._dragElements.delete(nodeId)
    }
  }, [])

  const handleMouseDown = useCallback(
    (e: ModuleMouseEvent) => {
      if (e.evt.button != null && e.evt.button !== 0) {
        flushStaleDragEntry()
      }
    },
    [flushStaleDragEntry]
  )

  const handleDragStart = useCallback(
    (e: ModuleDragEvent) => {
      const selection = useUIStore.getState().selection
      altDuplicateDropPositionRef.current = null
      // In rewire mode, handle differently
      if (onRewireDragStart) {
        const pos = e.target.position()
        const shouldPrevent = onRewireDragStart(moduleRef, pos.x, pos.y)
        if (shouldPrevent) {
          // Don't stop drag, but mark it as rewire drag
          // Clear any existing tooltip when starting rewire drag
          if (tooltipTimerRef.current) {
            clearTimeout(tooltipTimerRef.current)
            tooltipTimerRef.current = null
          }
          tooltipVisibleRef.current = false
          onHoverChange?.(null)
          isDragging.current = true
          return
        }
      }

      isDragging.current = true
      setIsHovered(false)
      onHoverRefChange?.(null)
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current)
        tooltipTimerRef.current = null
      }
      tooltipVisibleRef.current = false
      onHoverChange?.(null)
      const sel = selectionOverride ?? getSelectionForRef(moduleRef)
      if (sel.type === null) return
      const id = sel.ids[0] as string
      const isInMultiSelection = selection.ids.length > 1 && selection.ids.includes(id)
      if (!isInMultiSelection) {
        setSelection(sel)
      } else if (onDragStart) {
        const pos = e.target.position()
        onDragStart(moduleRef, pos.x, pos.y)
      }
    },
    [
      moduleRef,
      selectionOverride,
      setSelection,
      onHoverRefChange,
      onHoverChange,
      onRewireDragStart,
      onDragStart,
    ]
  )

  const handleDragMove = useCallback(
    (e: ModuleDragEvent) => {
      const pos = e.target.position()

      // In rewire mode, track position for preview wire (use stage coordinates)
      if (onRewireDragMove) {
        const stage = e.target.getStage()
        if (!stage) return
        const pointerPos = stage.getPointerPosition()
        if (pointerPos) {
          // Pass stage and pointer position for hit detection and preview wire
          onRewireDragMove(stage, pointerPos)
        }
        // Reset module position to prevent movement during rewire drag
        e.target.x(x)
        e.target.y(y)
        return
      }

      if (onDragMove) {
        const altKey = e.evt.altKey === true
        onDragMove(moduleRef, pos.x, pos.y, e.evt.shiftKey === true, altKey)
        if (altKey && resetPositionOnAltDrag) {
          altDuplicateDropPositionRef.current = pos
          e.target.position({ x, y })
        }
      }
    },
    [moduleRef, onDragMove, onRewireDragMove, resetPositionOnAltDrag, x, y]
  )

  const handleDragEnd = useCallback(
    (e: ModuleDragEvent) => {
      isDragging.current = false

      // In rewire mode, handle rewire end
      if (onRewireDragEnd) {
        onRewireDragEnd()
        e.target.x(x)
        e.target.y(y)
        return
      }

      if (!onDragEnd) return
      const pos = altDuplicateDropPositionRef.current ?? e.target.position()
      altDuplicateDropPositionRef.current = null
      logger.warn('[ModuleBox drag] dragEnd', {
        ref: moduleRef,
        pos,
        hasOnDragEnd: !!onDragEnd,
        hasOnRewireDragEnd: !!onRewireDragEnd,
      })
      e.target.x(x)
      e.target.y(y)
      onDragEnd(moduleRef, pos.x, pos.y, e.evt.shiftKey === true, e.evt.altKey === true)
    },
    [moduleRef, onDragEnd, onRewireDragEnd, x, y]
  )

  const handleClick = useCallback(
    (e: ModuleClickEvent) => {
      const selection = useUIStore.getState().selection
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) return
      e.cancelBubble = true
      flushStaleDragEntry()
      if (onAssignTargetClick) {
        onAssignTargetClick(moduleRef)
        return
      }
      const sel = selectionOverride ?? getSelectionForRef(moduleRef)
      if (sel.type === null) return
      const id = sel.ids[0] as string
      const shift = e.evt.shiftKey === true
      const ctrl = e.evt.ctrlKey === true || e.evt.metaKey === true
      const applySelection = (nextSelection: Selection) => {
        const resolvedSelection = onSelectionIntent?.(nextSelection, {
          ref: moduleRef,
          event: {
            shiftKey: shift,
            ctrlKey: ctrl,
            metaKey: e.evt.metaKey === true,
          },
          currentSelection: selection,
        })
        if (resolvedSelection === null) return
        setSelection(resolvedSelection ?? nextSelection)
      }
      if (shift) {
        if (selection.type === sel.type) {
          applySelection(selectMultiple(sel.type, [...new Set([...selection.ids, id])]))
        } else if (
          selection.type === 'protection' ||
          selection.type === 'trunkDevice' ||
          selection.type === 'endpoint'
        ) {
          // Mixed module selection (e.g. protections + MUNQ trunk): merge ids; parent
          // onSelectionIntent scopes to same panel zone.
          applySelection(selectMultiple(sel.type, [...new Set([...selection.ids, id])]))
        } else {
          applySelection(sel)
        }
      } else if (ctrl) {
        if (selection.type === sel.type) {
          applySelection(toggleSelection(selection, id))
        } else if (
          selection.type === 'protection' ||
          selection.type === 'trunkDevice' ||
          selection.type === 'endpoint'
        ) {
          applySelection(toggleSelection({ ...selection, type: sel.type }, id))
        } else {
          applySelection(sel)
        }
      } else {
        applySelection(sel)
      }
    },
    [
      moduleRef,
      selectionOverride,
      setSelection,
      onAssignTargetClick,
      flushStaleDragEntry,
      onSelectionIntent,
    ]
  )

  const handleMouseEnter = useCallback(
    (e: { evt: MouseEvent }) => {
      if (isMarqueeSelecting) return
      setIsHovered(true)
      onHoverRefChange?.(moduleRef)
      mousePositionRef.current = { clientX: e.evt.clientX, clientY: e.evt.clientY }
      // Disable tooltips in rewire mode
      if (info.tooltipText && onHoverChange && !onRewireDragStart) {
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current)
        tooltipTimerRef.current = setTimeout(() => {
          tooltipVisibleRef.current = true
          tooltipTimerRef.current = null
          onHoverChange({
            text: info.tooltipText!,
            clientX: mousePositionRef.current.clientX,
            clientY: mousePositionRef.current.clientY,
          })
        }, TOOLTIP_DELAY_MS)
      }
    },
    [
      info.tooltipText,
      isMarqueeSelecting,
      onHoverChange,
      onHoverRefChange,
      moduleRef,
      onRewireDragStart,
    ]
  )

  const handleMouseMove = useCallback(
    (e: { evt: MouseEvent }) => {
      if (isMarqueeSelecting) return
      mousePositionRef.current = { clientX: e.evt.clientX, clientY: e.evt.clientY }
      // Disable tooltips in rewire mode
      if (tooltipVisibleRef.current && info.tooltipText && onHoverChange && !onRewireDragStart) {
        onHoverChange({ text: info.tooltipText, clientX: e.evt.clientX, clientY: e.evt.clientY })
      }
    },
    [info.tooltipText, isMarqueeSelecting, onHoverChange, onRewireDragStart]
  )

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
    onHoverRefChange?.(null)
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    tooltipVisibleRef.current = false
    // Clear tooltip even in rewire mode to ensure clean state
    onHoverChange?.(null)
  }, [onHoverChange, onHoverRefChange])

  const bg = colors.moduleBg
  const isMspfProtectionModule = (() => {
    if (!debugMode) return false
    if (moduleRef.kind !== 'protection') return false
    if (!currentProject) return false
    const sourcePanel = findPanelContainingModuleRef(moduleRef, currentProject)
    if (!sourcePanel) return false
    const sourcePanelId = sourcePanel.id

    const seen = new Set<string>()
    const stack: string[] = [moduleRef.id]
    while (stack.length > 0) {
      const id = stack.pop()
      if (!id || seen.has(id)) continue
      seen.add(id)

      const pRef = { kind: 'protection' as const, id }
      const owner = findPanelContainingModuleRef(pRef, currentProject)
      if (!owner) continue
      const { childRefs } = getRelationEdges(pRef, owner, currentProject)

      for (const child of childRefs) {
        if (child.kind === 'protection') {
          const childOwner = findPanelContainingModuleRef(child, currentProject)
          if (childOwner && childOwner.id !== sourcePanelId) return true
          if (!seen.has(child.id)) stack.push(child.id)
          continue
        }
        if (child.kind === 'trunkDevice' && child.scope === 'circuit') {
          const childOwner = findPanelContainingModuleRef(child, currentProject)
          if (childOwner && childOwner.id !== sourcePanelId) return true
        }
      }
    }
    return false
  })()
  const debugModuleColor = (() => {
    if (!debugMode) return null
    if (moduleRef.kind === 'protection') {
      if (isMspfProtectionModule) return '#2563eb' // MSPF
      return '#f43f5e' // MPRO
    }
    if (moduleRef.kind === 'domotica') return '#8b5cf6' // MDOM
    if (moduleRef.kind === 'trunkDevice' && moduleRef.scope === 'supply') {
      if (debugSupplyTrunkKind === 'unique') return '#f97316' // MUNQ
      return '#a855f7' // MSUP
    }
    if (moduleRef.kind === 'trunkDevice' && moduleRef.scope === 'circuit') return '#06b6d4' // MCIR
    return '#22c55e' // MINT (unexpected)
  })()
  const border = resizeInvalid
    ? '#ef4444'
    : isRewireTarget
      ? isRewireTargetValid
        ? '#10b981'
        : '#ef4444' // Green for valid rewire target, red for invalid
      : isRewireOrigin
        ? '#f59e0b' // Amber for rewire origin
        : isSelected || isPreviewSelected || (isHovered && !isMarqueeSelecting)
          ? colors.moduleBorderSelected
          : colors.moduleBorder
  const debugBorder = debugModuleColor ?? border
  const debugBg = resizeInvalid ? '#ef44441a' : debugModuleColor ? `${debugModuleColor}14` : bg
  const borderWidth =
    resizeInvalid || isRewireTarget || isRewireOrigin ? 3 : isSelected || isPreviewSelected ? 2 : 1
  const borderDash =
    isRewireTarget || isRewireOrigin
      ? [6, 4]
      : isHovered && !isMarqueeSelecting && !isSelected && !isPreviewSelected
        ? [4, 3]
        : undefined
  const textColor = colors.moduleText
  const secondaryColor = colors.moduleSecondary

  const compactRating = info.specLines.find((line) => /^(?:[A-Z]\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?A)$/i.test(line))
  const compactCurve = info.specLines.find((line) => /^[A-Z]$/i.test(line))
  const compactResidualType = info.specLines.find((line) => /^Type\s+/i.test(line))
  const compactSensitivity = info.specLines
    .find((line) => /^IΔn\s+/i.test(line))
    ?.replace(/^IΔn\s+/i, '')
  const compactSpecs = [
    compactResidualType && compactSensitivity
      ? `${compactResidualType} ${compactSensitivity}`
      : compactCurve && compactRating
        ? `${compactCurve} ${compactRating}`
        : compactRating,
  ]
    .filter((line): line is string => Boolean(line))
  const visibleSpecLines = (compactLabelMode ? compactSpecs : info.specLines).slice(0, MAX_SPEC_LINES)
  const isTerminalStripModule = info.terminalStrip != null

  const effectiveModuleWidth = liveWidth ?? width
  const terminalHandleScale = Math.max(0, Math.min(1, effectiveModuleWidth / CELL_W / 0.5))
  const resizeHandleVisualWidth =
    isTerminalStripModule && effectiveModuleWidth < CELL_W * 0.5
      ? 1.5 + terminalHandleScale * 1.5
      : 4
  const resizeHandleHitWidth =
    isTerminalStripModule && effectiveModuleWidth < CELL_W * 0.5 ? 5 : RESIZE_HANDLE_W
  const resizeHandleOffset =
    isTerminalStripModule && effectiveModuleWidth < CELL_W * 0.5 ? 0 : resizeHandleHitWidth / 2
  const topBandHeight = height * MODULE_TOP_BAND_RATIO
  const bottomBandTop = height * MODULE_BOTTOM_BAND_RATIO
  const centerBandHeight = bottomBandTop - topBandHeight
  const bottomBandHeight = height - bottomBandTop
  const textSidePadding = Math.min(4, Math.max(2, effectiveModuleWidth * 0.08))
  const textWidth = Math.max(1, effectiveModuleWidth - textSidePadding * 2)
  const topTextY = compactLabelMode ? topBandHeight + 1 : MODULE_BAND_PADDING
  const topTextHeight = compactLabelMode ? centerBandHeight * 0.46 : Math.max(1, topBandHeight - MODULE_BAND_PADDING * 2)
  const middleTextY = compactLabelMode ? topBandHeight + centerBandHeight * 0.46 : topBandHeight + MODULE_BAND_PADDING
  const middleTextHeight = compactLabelMode ? centerBandHeight * 0.5 : Math.max(1, centerBandHeight - MODULE_BAND_PADDING * 2)
  const bottomTextY = bottomBandTop + MODULE_BAND_PADDING
  const bottomTextHeight = Math.max(1, bottomBandHeight - MODULE_BAND_PADDING * 2)
  const protectionSpecLayout = info.specRows && !compactLabelMode
    ? getPanelModuleSpecLayout(info.specRows, textWidth, middleTextHeight,
      (text, size) => measureSymbolLabelTextWidth(text, fontFamily, size))
    : null

  // In rewire mode, disable dragging only on target modules (not on origin or other modules)
  const effectiveDraggable = isRewireTarget ? false : draggable

  const domoticaProps = domoticaEndpoint?.domoticaProps
  const domoticaMainType = domoticaProps?.mainDeviceType

  const trunkInfo = moduleRef.kind === 'trunkDevice' ? getTrunkDeviceById(moduleRef.id) : undefined
  const protectionDevice =
    moduleRef.kind === 'protection' ? getProtectionById(moduleRef.id) : undefined
  const isEnergyMeterDevice = !!trunkInfo && trunkInfo.device.symbol === 'energy_meter'
  const energyMeterCircuitLabel =
    isEnergyMeterDevice && trunkInfo?.circuit?.code ? trunkInfo.circuit.code : info.label

  // Energy conversion modules (rectifier, inverter, transformer, etc.)
  const energyDeviceSymbol = trunkInfo?.device.symbol ?? domoticaEndpoint?.symbol
  const energySymbolMeta = energyDeviceSymbol ? getSymbolById(energyDeviceSymbol) : null
  const isEnergyConversionModule =
    !!energySymbolMeta && energySymbolMeta.category === 'energyConversion'
  const isDirectionalEnergyConversion = isDirectionalConverterSymbol(energyDeviceSymbol)
  const energyDomains =
    isEnergyConversionModule && energyDeviceSymbol ? getDomainForSymbol(energyDeviceSymbol) : null
  const isRotatingSwitchModule =
    trunkInfo?.device.symbol === 'rotating_switch' || protectionDevice?.type === 'ROTATING_SWITCH'
  const isSourceChangeoverModule = trunkInfo?.device.symbol === 'source_changeover'
  const isSelectorSwitchModule = isRotatingSwitchModule || isSourceChangeoverModule
  const selectorSwitchCustomLabel = (
    trunkInfo?.device.label ??
    protectionDevice?.label ??
    ''
  ).trim()
  const rotatingSwitchSymbolMeta = isSelectorSwitchModule
    ? getSymbolById(isSourceChangeoverModule ? 'source_changeover' : 'rotating_switch')
    : null
  const spdDevice =
    protectionDevice?.type === 'SPD'
      ? protectionDevice
      : trunkInfo?.device.protectionType === 'SPD'
        ? trunkInfo.device
        : null
  const isSpdModule = spdDevice != null
  const isModularSocketModule = isModularSocket(domoticaEndpoint)
  const modularSocketCount = isModularSocketModule
    ? socketCountForModularWidth(effectiveModuleWidth / CELL_W)
    : 1
  const spdRawLabel = spdDevice?.label.trim() ?? ''
  const hasSpdLabel = spdRawLabel.length > 0 && spdRawLabel.toUpperCase() !== 'SPD'
  const moduleLabel = compactLabelMode
    ? info.label
    : isSelectorSwitchModule
      ? selectorSwitchCustomLabel
      : isSpdModule
        ? hasSpdLabel ? spdRawLabel : ''
        : energyMeterCircuitLabel
  const moduleLabelFontStyle = isEnergyMeterDevice ? 'italic bold' : 'bold'
  const moduleLabelFontSize = getPanelModuleLabelFontSize(
    moduleLabel, textWidth, topTextHeight,
    (text, size) => measureSymbolLabelTextWidth(text, fontFamily, size, moduleLabelFontStyle),
  )
  const spdSymbolPath = useProtectionSymbolSvgPath(spdDevice ? getSurgeProtectionSymbolPath(spdDevice.surgeProtectionKind) : null)

  const { acSymbolImage, dcSymbolImage, energyDeviceImage, energyBaseImage, energyDiagonalImage, rotatingSwitchImage, spdSymbolImage, relaySymbolImage, relayControlOverlayImage, domoticaMainImage, domoticaControlImages } = useModuleArtwork({
    moduleKind: moduleRef.kind, domoticaProps, info, themeMode, isEnergyConversionModule,
    isDirectionalEnergyConversion, energySymbolMeta, isSelectorSwitchModule, rotatingSwitchSymbolMeta, spdSymbolPath,
  })

  return (
    <Group
      name={`panelModule-${panelGridModuleRefKey(moduleRef)}`}
      ref={groupRef}
      x={x}
      y={y}
      opacity={opacity}
      draggable={effectiveDraggable}
      listening={interactive}
      onMouseDown={handleMouseDown}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Rect
        ref={bgRectRef}
        width={effectiveModuleWidth}
        height={height}
        fill={debugBg}
        stroke={debugBorder}
        strokeWidth={borderWidth}
        dash={borderDash}
        perfectDrawEnabled={false}
        listening={true}
      />
      {/* Subtle guides divide the module into label, symbol/detail, and phase bands. */}
      {!isTerminalStripModule && (
        <Line
          points={[1, topBandHeight, effectiveModuleWidth - 1, topBandHeight]}
          stroke={secondaryColor}
          strokeWidth={0.75}
          opacity={0.45}
          perfectDrawEnabled={false}
          listening={false}
        />
      )}
      {!isTerminalStripModule && (
        <Line
          points={[1, bottomBandTop, effectiveModuleWidth - 1, bottomBandTop]}
          stroke={secondaryColor}
          strokeWidth={0.75}
          opacity={0.45}
          perfectDrawEnabled={false}
          listening={false}
        />
      )}
      {info.terminalStrip &&
        (() => {
          const terminal = info.terminalStrip
          const dotRadius = Math.min(3.2, Math.max(1.5, effectiveModuleWidth * 0.18))
          const pinCount = Math.max(2, terminal.maxPin)
          const labelFontSize = Math.max(4.5, Math.min(9, effectiveModuleWidth * 0.42))
          const pinFontSize = Math.max(4, Math.min(8, effectiveModuleWidth * 0.38))
          const slim = effectiveModuleWidth < CELL_W * 0.55
          const horizontal = effectiveModuleWidth > CELL_W * 0.55
          const dotsX = effectiveModuleWidth / 2
          const labelHeight = horizontal
            ? Math.min(10, Math.max(7, labelFontSize + 1))
            : Math.max(8, labelFontSize + 3)
          const labelY = height / 2 - labelHeight / 2
          const reservedTop = slim ? 13 : 4
          const connectedPins = terminal.connectedPins
          const displayedPins = connectedPins.length > 0
            ? connectedPins
            : Array.from({ length: pinCount }, (_, index) => index + 1)
          const positions = displayedPins.map((pin, index) =>
            horizontal
              ? {
                  x: (effectiveModuleWidth * (index + 1)) / (displayedPins.length + 1),
                  y: height - Math.max(4, dotRadius + 2),
                }
              : {
                  x: dotsX,
                  y: reservedTop + ((height - reservedTop - 4) * pin) / (pinCount + 1),
                }
          )
          const pointByPin = new Map(displayedPins.map((pin, index) => [pin, positions[index]!]))
          const connectedPositions = connectedPins.map(
            (pin) => pointByPin.get(pin) ?? positions[0]!
          )
          const labelCandidates = horizontal ? [1] : [labelY, 2, height - labelHeight - 2]
          const resolvedLabelY = labelCandidates.reduce((best, candidate) => {
            const clearance = Math.min(
              ...connectedPositions.map((point) =>
                Math.abs(point.y - (candidate + labelHeight / 2))
              )
            )
            const bestClearance = Math.min(
              ...connectedPositions.map((point) => Math.abs(point.y - (best + labelHeight / 2)))
            )
            return clearance > bestClearance ? candidate : best
          }, labelY)
          return (
            <Group name="panel-terminal-strip-graphic" listening={false}>
              {positions.map((point, index) => (
                <Circle
                  key={index}
                  x={point.x}
                  y={point.y}
                  radius={dotRadius}
                  fill={secondaryColor}
                  listening={false}
                />
              ))}
              {connectedPins.map((pin) => {
                const point = pointByPin.get(pin) ?? positions[0]!
                const horizontalLabelWidth = Math.min(
                  16,
                  effectiveModuleWidth / (displayedPins.length + 1)
                )
                return (
                  <Text
                    key={`terminal-pin-${pin}`}
                    x={horizontal
                      ? point.x - horizontalLabelWidth / 2
                      : slim ? 0 : dotsX + dotRadius + 2}
                    y={
                      horizontal
                        ? point.y - dotRadius - pinFontSize - 1
                        : slim
                          ? point.y - dotRadius - pinFontSize - 1
                          : point.y - pinFontSize / 2
                    }
                    width={
                      horizontal
                        ? horizontalLabelWidth
                        : slim
                          ? effectiveModuleWidth
                          : Math.max(1, effectiveModuleWidth - dotsX - dotRadius - 3)
                    }
                    text={String(pin)}
                    fontSize={pinFontSize}
                    fontStyle="bold"
                    fontFamily={fontFamily}
                    fill={textColor}
                    align={horizontal || slim ? 'center' : 'left'}
                    listening={false}
                  />
                )
              })}
              <Rect
                x={1}
                y={resolvedLabelY}
                width={Math.max(1, effectiveModuleWidth - 2)}
                height={labelHeight}
                fill={bg}
                stroke={secondaryColor}
                strokeWidth={0.7}
                cornerRadius={1.5}
                listening={false}
              />
              <Text
                x={1}
                y={resolvedLabelY}
                width={Math.max(1, effectiveModuleWidth - 2)}
                height={labelHeight}
                text={`X${terminal.stripId}`}
                fontSize={labelFontSize}
                fontStyle="bold"
                fontFamily={fontFamily}
                fill={textColor}
                align="center"
                verticalAlign="middle"
                wrap="none"
                listening={false}
              />
            </Group>
          )
        })()}
      {isSpdModule &&
        (() => {
          const { symbolSize, symbolX, symbolY, specsY, specsHeight } = getSpdPanelModuleLayout({
            moduleWidth: effectiveModuleWidth,
            topBandHeight,
            centerBandHeight,
            bottomBandTop,
            padding: MODULE_BAND_PADDING,
            hasLabel: hasSpdLabel,
          })

          return (
            <Group name="panel-spd-graphic" listening={false}>
              {spdSymbolImage && (
                <Image
                  name="panel-spd-symbol"
                  image={spdSymbolImage}
                  x={symbolX}
                  y={symbolY}
                  width={symbolSize}
                  height={symbolSize}
                  offsetX={symbolSize / 2}
                  listening={false}
                />
              )}
              {visibleSpecLines.length > 0 && (
                <Text
                  ref={specTextRef}
                  x={textSidePadding}
                  y={specsY}
                  width={textWidth}
                  height={specsHeight}
                  text={visibleSpecLines.join('\n')}
                  fontSize={SPEC_FONT_SIZE}
                  lineHeight={SPEC_LINE_HEIGHT / SPEC_FONT_SIZE}
                  fontFamily={fontFamily}
                  fill={secondaryColor}
                  perfectDrawEnabled={false}
                  listening={false}
                  wrap="word"
                  ellipsis={true}
                  align="center"
                  verticalAlign="middle"
                />
              )}
            </Group>
          )
        })()}
      {/* Energy conversion domain indicators (AC/DC) for trunk devices */}
      {isEnergyConversionModule &&
        energyDomains &&
        (() => {
          const effectiveWidth = effectiveModuleWidth
          const iconSize = Math.min(effectiveWidth, centerBandHeight) * 0.22
          const padding = 3
          const centerTop = topBandHeight
          const centerBottom = bottomBandTop

          const artworkLayout = isDirectionalEnergyConversion
            ? getConverterArtworkLayout(
                energyDomains.inputDomain,
                energyDomains.outputDomain,
                SUPPLY_ASSEMBLY_CONNECTION_DOMAINS
              )
            : null

          const getImageForDomain = (domain: 'AC' | 'DC') =>
            domain === 'DC' ? dcSymbolImage : acSymbolImage

          const getDomainPosition = (domain: 'AC' | 'DC') => {
            const corner = artworkLayout
              ? getConverterDomainCorner(artworkLayout, domain)
              : undefined
            if (!corner) {
              const isOutput = domain === energyDomains.outputDomain
              return {
                x: isOutput ? padding + iconSize / 2 : effectiveWidth - padding - iconSize / 2,
                y: isOutput
                  ? centerTop + padding + iconSize / 2
                  : centerBottom - padding - iconSize / 2,
              }
            }
            const point = getConverterCornerPosition(
              corner,
              effectiveWidth,
              centerBandHeight,
              padding,
              iconSize
            )
            return {
              x: effectiveWidth / 2 + point.x,
              y: centerTop + centerBandHeight / 2 + point.y,
            }
          }

          return (
            <>
              {/* The diagonal follows the same domain-aware corner choice as the symbols. */}
              <Line
                points={
                  artworkLayout?.diagonal === 'top-left-to-bottom-right'
                    ? [
                        padding,
                        centerTop + padding,
                        effectiveWidth - padding,
                        centerBottom - padding,
                      ]
                    : [
                        padding,
                        centerBottom - padding,
                        effectiveWidth - padding,
                        centerTop + padding,
                      ]
                }
                stroke={debugBorder}
                strokeWidth={1}
                listening={false}
              />
              {(['AC', 'DC'] as const).map((domain) => {
                const image = getImageForDomain(domain)
                const point = getDomainPosition(domain)
                if (!image || !point) return null
                return (
                  <Image
                    key={domain}
                    image={image}
                    width={iconSize}
                    height={iconSize}
                    offsetX={iconSize / 2}
                    offsetY={iconSize / 2}
                    x={point.x}
                    y={point.y}
                    listening={false}
                  />
                )
              })}
            </>
          )
        })()}
      {isDirectionalEnergyConversion &&
        energyBaseImage &&
        energyDiagonalImage &&
        (() => {
          const symbolSize = Math.min(effectiveModuleWidth * 0.48, centerBandHeight * 0.72)
          return (
            <>
              <Image
                image={energyBaseImage}
                width={symbolSize}
                height={symbolSize}
                offsetX={symbolSize / 2}
                offsetY={symbolSize / 2}
                x={effectiveModuleWidth / 2}
                y={topBandHeight + centerBandHeight / 2}
                listening={false}
              />
              <Image
                image={energyDiagonalImage}
                width={symbolSize}
                height={symbolSize}
                offsetX={symbolSize / 2}
                offsetY={symbolSize / 2}
                x={effectiveModuleWidth / 2}
                y={topBandHeight + centerBandHeight / 2}
                scaleX={
                  getConverterArtworkLayout(
                    energyDomains?.inputDomain ?? 'AC',
                    energyDomains?.outputDomain ?? 'DC',
                    SUPPLY_ASSEMBLY_CONNECTION_DOMAINS
                  ).diagonal === 'top-left-to-bottom-right'
                    ? -1
                    : 1
                }
                listening={false}
              />
            </>
          )
        })()}
      {isEnergyConversionModule &&
        energyDeviceImage &&
        (() => {
          const effectiveWidth = effectiveModuleWidth
          const symbolSize = Math.min(effectiveWidth * 0.48, centerBandHeight * 0.72)
          return (
            <Image
              image={energyDeviceImage}
              x={effectiveWidth / 2}
              y={topBandHeight + centerBandHeight / 2}
              width={symbolSize}
              height={symbolSize}
              offsetX={symbolSize / 2}
              offsetY={symbolSize / 2}
              listening={false}
            />
          )
        })()}
      {isSelectorSwitchModule &&
        (() => {
          const padding = 3
          const centerTop = topBandHeight
          const dialRadius = Math.max(
            4.5,
            Math.min(centerBandHeight * 0.29, effectiveModuleWidth * 0.23)
          )
          const dialX = effectiveModuleWidth / 2
          const dialY = centerTop + centerBandHeight / 2
          const positionFontSize = SPEC_FONT_SIZE
          const symbolSize = Math.max(
            6,
            Math.min(topBandHeight - padding * 2, effectiveModuleWidth * 0.34)
          )
          return (
            <Group name="panel-rotating-switch-graphic" listening={false}>
              {rotatingSwitchImage && !selectorSwitchCustomLabel && (
                <Image
                  name="panel-rotating-switch-symbol"
                  image={rotatingSwitchImage}
                  x={(effectiveModuleWidth - symbolSize) / 2}
                  y={(topBandHeight - symbolSize) / 2}
                  width={symbolSize}
                  height={symbolSize}
                  listening={false}
                />
              )}
              <Text
                x={dialX - dialRadius * 1.75 - positionFontSize * 0.65}
                y={dialY - dialRadius * 1.15 + positionFontSize}
                width={positionFontSize * 1.3}
                text={isSourceChangeoverModule ? '1' : '0'}
                fontSize={positionFontSize}
                fontFamily={fontFamily}
                fill={secondaryColor}
                align="center"
                listening={false}
              />
              <Text
                x={dialX - positionFontSize * 0.65}
                y={dialY - dialRadius * 1.45 - positionFontSize * 0.35}
                width={positionFontSize * 1.3}
                text={isSourceChangeoverModule ? '0' : '1'}
                fontSize={positionFontSize}
                fontFamily={fontFamily}
                fill={secondaryColor}
                align="center"
                listening={false}
              />
              {isSourceChangeoverModule && (
                <Text
                  x={dialX + dialRadius * 1.75 - positionFontSize * 0.65}
                  y={dialY - dialRadius * 1.15 + positionFontSize}
                  width={positionFontSize * 1.3}
                  text="2"
                  fontSize={positionFontSize}
                  fontFamily={fontFamily}
                  fill={secondaryColor}
                  align="center"
                  listening={false}
                />
              )}
              <Circle
                x={dialX}
                y={dialY}
                radius={dialRadius}
                stroke={secondaryColor}
                strokeWidth={1.2}
                fill={bg}
                perfectDrawEnabled={false}
                listening={false}
              />
              <Line
                points={[dialX, dialY + dialRadius * 0.72, dialX, dialY - dialRadius * 0.72]}
                stroke={secondaryColor}
                strokeWidth={Math.max(1.4, dialRadius * 0.24)}
                lineCap="round"
                perfectDrawEnabled={false}
                listening={false}
              />
              <Circle
                x={dialX}
                y={dialY}
                radius={Math.max(1.1, dialRadius * 0.16)}
                fill={secondaryColor}
                perfectDrawEnabled={false}
                listening={false}
              />
            </Group>
          )
        })()}
      {info.relay &&
        (() => {
          const symbolSize = Math.min(effectiveModuleWidth * 0.72, centerBandHeight * 0.58)
          const symbolX = effectiveModuleWidth / 2
          const symbolY = topBandHeight + centerBandHeight * 0.42
          const polesHeight = Math.max(1, centerBandHeight * 0.2)
          return (
            <Group name="panel-relay-graphic" listening={false}>
              {relaySymbolImage && (
                <Image
                  name="panel-relay-symbol"
                  image={relaySymbolImage}
                  x={symbolX}
                  y={symbolY}
                  width={symbolSize}
                  height={symbolSize}
                  offsetX={symbolSize / 2}
                  offsetY={symbolSize / 2}
                  listening={false}
                />
              )}
              {relayControlOverlayImage && (
                <Image
                  name="panel-relay-control-overlay"
                  image={relayControlOverlayImage}
                  x={symbolX}
                  y={symbolY}
                  width={symbolSize}
                  height={symbolSize}
                  offsetX={symbolSize / 2}
                  offsetY={symbolSize / 2}
                  listening={false}
                />
              )}
              <Text
                name="panel-relay-poles"
                x={textSidePadding}
                y={bottomBandTop - polesHeight - 1}
                width={textWidth}
                height={polesHeight}
                text={info.relay.polesLabel}
                fontSize={SPEC_FONT_SIZE}
                fontStyle="bold"
                fontFamily={fontFamily}
                fill={secondaryColor}
                align="center"
                verticalAlign="middle"
                listening={false}
              />
            </Group>
          )
        })()}
      {isModularSocketModule && (
        <ModularSocketModuleGraphic
          width={effectiveModuleWidth}
          topBandHeight={topBandHeight}
          centerBandHeight={centerBandHeight}
          socketCount={modularSocketCount}
          stroke={textColor}
          faceFill={bg}
          holeFill={textColor}
        />
      )}
      {/* Label - prominent, bold */}
      {!isTerminalStripModule && (
        <Text
          name="panel-module-label"
          ref={labelTextRef}
          x={textSidePadding}
          y={topTextY}
          width={textWidth}
          height={topTextHeight}
          text={moduleLabel}
          fontSize={moduleLabelFontSize}
          fontStyle={moduleLabelFontStyle}
          fontFamily={fontFamily}
          fill={textColor}
          perfectDrawEnabled={false}
          listening={false}
          wrap="none"
          ellipsis={true}
          align="center"
          verticalAlign="middle"
        />
      )}
      {/* Spec block - vertically centered as one multiline text box. */}
      {protectionSpecLayout && !isSpdModule && !isTerminalStripModule && (
        <Group name="panel-protection-specs" x={textSidePadding} y={middleTextY} listening={false}>
          {protectionSpecLayout.map((row, index) => (
            <Group key={index} x={row.x} y={row.y}>
              {row.frame && (
                <Rect
                  name="panel-breaking-capacity-frame"
                  x={0.3}
                  y={0.3}
                  width={Math.max(0, row.width - 0.6)}
                  height={Math.max(0, row.height - 0.6)}
                  stroke={secondaryColor}
                  strokeWidth={0.6}
                  listening={false}
                />
              )}
              <Text
                name="panel-protection-spec"
                x={row.paddingX}
                y={row.paddingY}
                width={row.width - row.paddingX * 2}
                height={row.fontSize}
                text={row.text}
                fontSize={row.fontSize}
                fontFamily={fontFamily}
                fill={secondaryColor}
                wrap="none"
                align="center"
                verticalAlign="middle"
                listening={false}
              />
            </Group>
          ))}
        </Group>
      )}
      {!protectionSpecLayout && visibleSpecLines.length > 0 && !isSpdModule && !isTerminalStripModule && (
        <Text
          ref={specTextRef}
          x={textSidePadding}
          y={middleTextY}
          width={textWidth}
          height={middleTextHeight}
          text={visibleSpecLines.join('\n')}
          fontSize={SPEC_FONT_SIZE}
          lineHeight={SPEC_LINE_HEIGHT / SPEC_FONT_SIZE}
          fontFamily={fontFamily}
          fill={secondaryColor}
          perfectDrawEnabled={false}
          listening={false}
          wrap="word"
          ellipsis={true}
          align="center"
          verticalAlign="middle"
        />
      )}
      {/* Domotica visual overlays inside panel modules */}
      {moduleRef.kind === 'domotica' && domoticaProps && (
        <>
          {/* Control icons: 2x2 grid for 4 controls on narrow modules, otherwise single centered row (live during resize) */}
          {(() => {
            const activeKeys = (domoticaProps.control ?? []).filter((key) =>
              [
                'programmed_control',
                'wireless_control',
                'detection_control',
                'button_control',
              ].includes(key)
            ) as Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS>
            const count = activeKeys.length
            if (count === 0) return null

            const effectiveWidth = effectiveModuleWidth

            const moduleCols = Math.max(1, Math.round(effectiveWidth / CELL_W))
            const isOneWide = moduleCols === 1
            const baseSize = Math.min(effectiveWidth, centerBandHeight)
            const iconSize = isOneWide ? baseSize * 0.33 : baseSize * 0.22

            if (isOneWide && count === 4) {
              const positions = [
                { x: effectiveWidth * 0.3, y: topBandHeight + centerBandHeight * 0.3 },
                { x: effectiveWidth * 0.7, y: topBandHeight + centerBandHeight * 0.3 },
                { x: effectiveWidth * 0.3, y: topBandHeight + centerBandHeight * 0.7 },
                { x: effectiveWidth * 0.7, y: topBandHeight + centerBandHeight * 0.7 },
              ]
              return activeKeys.map((key, index) => {
                const img = domoticaControlImages[key]
                if (!img) return null
                const pos = positions[index]!
                return (
                  <Image
                    key={key}
                    image={img}
                    width={iconSize}
                    height={iconSize}
                    offsetX={iconSize / 2}
                    offsetY={iconSize / 2}
                    x={pos.x}
                    y={pos.y}
                    listening={false}
                  />
                )
              })
            }

            // Single row, centered horizontally regardless of count
            const rowY = topBandHeight + centerBandHeight * 0.34
            return activeKeys.map((key, index) => {
              const img = domoticaControlImages[key]
              if (!img) return null
              const cx = (effectiveWidth * (index + 1)) / (count + 1)
              return (
                <Image
                  key={key}
                  image={img}
                  width={iconSize}
                  height={iconSize}
                  offsetX={iconSize / 2}
                  offsetY={iconSize / 2}
                  x={cx}
                  y={rowY}
                  listening={false}
                />
              )
            })
          })()}

          {/* Main device symbol, centered underneath controls (live during resize) */}
          {domoticaMainImage &&
            domoticaMainType &&
            (() => {
              const effectiveWidth = effectiveModuleWidth
              const moduleCols = Math.max(1, Math.round(effectiveWidth / CELL_W))
              const sizeFactor = moduleCols === 1 ? 0.55 : 0.4
              const size = Math.min(effectiveWidth, centerBandHeight) * sizeFactor
              const yFactor = moduleCols === 1 ? 0.75 : 0.7
              return (
                <Image
                  image={domoticaMainImage}
                  width={size}
                  height={size}
                  offsetX={size / 2}
                  offsetY={size / 2}
                  x={effectiveWidth / 2}
                  y={topBandHeight + centerBandHeight * yFactor}
                  listening={false}
                />
              )
            })()}
        </>
      )}

      {/* Energy meter label: draw centered \"kWh\" text inside module, with a box (live during resize) */}
      {isEnergyMeterDevice &&
        (() => {
          const effectiveWidth = effectiveModuleWidth
          const boxWidth = effectiveWidth * 0.6
          const boxHeight = SPEC_LINE_HEIGHT + 4
          const boxX = (effectiveWidth - boxWidth) / 2
          const boxY = topBandHeight + centerBandHeight / 2 - boxHeight / 2
          return (
            <>
              <Rect
                x={boxX}
                y={boxY}
                width={boxWidth}
                height={boxHeight}
                stroke={textColor}
                strokeWidth={1}
                fill="transparent"
                perfectDrawEnabled={false}
                listening={false}
              />
              <Text
                x={boxX}
                y={boxY + 2}
                width={boxWidth}
                height={SPEC_LINE_HEIGHT}
                text="kWh"
                fontSize={SPEC_FONT_SIZE + 1}
                fontStyle="bold"
                fontFamily={fontFamily}
                fill={textColor}
                perfectDrawEnabled={false}
                listening={false}
                align="center"
              />
            </>
          )
        })()}
      {info.phaseLabel && (
        <Text
          x={textSidePadding}
          y={bottomTextY}
          width={textWidth}
          height={bottomTextHeight}
          text={info.phaseLabel}
          fontSize={PHASE_FONT_SIZE}
          fontStyle="bold"
          fontFamily={fontFamily}
          fill={secondaryColor}
          perfectDrawEnabled={false}
          listening={false}
          wrap="none"
          ellipsis={true}
          align="center"
          verticalAlign="middle"
        />
      )}
      {isTerminalStripModule && liveWidth != null && (
        <Group x={effectiveModuleWidth + 8} y={height / 2 - 9} listening={false}>
          <Rect
            width={48}
            height={18}
            fill={colors.panelFrameFill}
            stroke={colors.moduleBorderSelected}
            strokeWidth={1}
            cornerRadius={5}
            shadowColor="#000"
            shadowBlur={3}
            shadowOpacity={0.18}
          />
          <Text
            x={3}
            y={3}
            width={42}
            height={12}
            text={`~${((effectiveModuleWidth / CELL_W) * 18).toFixed(1)} mm`}
            fontSize={8}
            fontFamily={fontFamily}
            fontStyle="bold"
            fill={textColor}
            align="center"
            verticalAlign="middle"
          />
        </Group>
      )}
      {/* Resize handle — visible when selected, but not during rewire mode */}
      {isSelected && onResizeEnd && !onRewireDragStart && !isRewireTarget && (
        <>
          <Rect
            ref={handleVisualRef}
            x={width - (isTerminalStripModule && width < CELL_W * 0.5 ? 0 : 2)}
            y={height * 0.15}
            width={resizeHandleVisualWidth}
            height={height * 0.7}
            fill={resizeInvalid ? '#ef4444' : '#0284c7'}
            opacity={0.9}
            cornerRadius={2}
            perfectDrawEnabled={false}
            listening={false}
          />
          <Rect
            x={width - resizeHandleOffset}
            y={0}
            width={resizeHandleHitWidth}
            height={height}
            fill="transparent"
            draggable
            onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true
            }}
            onClick={(e: KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true
            }}
            onTap={(e: KonvaEventObject<TouchEvent>) => {
              e.cancelBubble = true
            }}
            onDragStart={(e: KonvaEventObject<DragEvent>) => {
              e.cancelBubble = true
              resizeWidthRef.current = width
              resizeInvalidRef.current = false
              setResizeInvalid(false)
            }}
            onDragMove={(e: KonvaEventObject<DragEvent>) => {
              e.cancelBubble = true
              const node = e.target
              const handleCenter = node.x() + resizeHandleOffset
              const rawCols = isTerminalStripModule
                ? width / CELL_W + ((handleCenter - width) / CELL_W) * (width < CELL_W ? 0.3 : 0.55)
                : handleCenter / CELL_W
              const newCols = isTerminalStripModule
                ? snapTerminalStripWidth(rawCols, maxWidthCols ?? 999)
                : isModularSocketModule
                  ? snapModularSocketModuleWidthWithin(rawCols, maxWidthCols ?? 4)
                  : Math.max(1, Math.min(maxWidthCols ?? 999, Math.round(rawCols)))
              const snapped = newCols * CELL_W
              // The handle itself moves on every event; module geometry changes only at a new width.
              if (resizeWidthRef.current === snapped) {
                const thin = isTerminalStripModule && snapped < CELL_W * 0.5
                node.x(snapped - (thin ? 0 : RESIZE_HANDLE_W / 2))
                node.y(0)
                return
              }
              const invalid = isResizeWidthValid ? !isResizeWidthValid(moduleRef, newCols) : false
              const nextTextPadding = Math.min(4, Math.max(2, snapped * 0.08))
              const nextTextWidth = Math.max(1, snapped - nextTextPadding * 2)
              const nextThin = isTerminalStripModule && snapped < CELL_W * 0.5
              const nextHitWidth = nextThin ? 5 : RESIZE_HANDLE_W
              node.width(nextHitWidth)
              node.x(snapped - (nextThin ? 0 : nextHitWidth / 2))
              node.y(0)
              bgRectRef.current?.width(snapped)
              handleVisualRef.current?.x(snapped - (nextThin ? 0 : 2))
              handleVisualRef.current?.width(
                nextThin ? 1.5 + Math.max(0, Math.min(1, snapped / CELL_W / 0.5)) * 1.5 : 4
              )
              labelTextRef.current?.x(nextTextPadding)
              labelTextRef.current?.width(nextTextWidth)
              specTextRef.current?.x(nextTextPadding)
              specTextRef.current?.width(nextTextWidth)
              resizeWidthRef.current = snapped
              resizeInvalidRef.current = invalid
              setResizeInvalid(invalid)
              setLiveWidth(snapped)
            }}
            onDragEnd={(e: KonvaEventObject<DragEvent>) => {
              e.cancelBubble = true
              const finalWidthPx = resizeWidthRef.current ?? width
              const finalCols = isTerminalStripModule
                ? snapTerminalStripWidth(finalWidthPx / CELL_W, maxWidthCols ?? 999)
                : isModularSocketModule
                  ? snapModularSocketModuleWidthWithin(finalWidthPx / CELL_W, maxWidthCols ?? 4)
                  : Math.round(finalWidthPx / CELL_W)
              const originalCols = isTerminalStripModule
                ? snapTerminalStripWidth(width / CELL_W, maxWidthCols ?? 999)
                : isModularSocketModule
                  ? snapModularSocketModuleWidthWithin(width / CELL_W, maxWidthCols ?? 4)
                  : Math.round(width / CELL_W)
              resizeWidthRef.current = null
              if (!resizeInvalidRef.current && finalCols !== originalCols && onResizeEnd) {
                onResizeEnd(moduleRef, finalCols)
              } else {
                e.target.width(resizeHandleHitWidth)
                e.target.x(width - resizeHandleOffset)
                bgRectRef.current?.width(width)
                handleVisualRef.current?.x(
                  width - (isTerminalStripModule && width < CELL_W * 0.5 ? 0 : 2)
                )
                handleVisualRef.current?.width(resizeHandleVisualWidth)
                labelTextRef.current?.x(textSidePadding)
                labelTextRef.current?.width(textWidth)
                specTextRef.current?.x(textSidePadding)
                specTextRef.current?.width(textWidth)
              }
              resizeInvalidRef.current = false
              setResizeInvalid(false)
              setLiveWidth(null)
            }}
            onMouseEnter={(e: KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage()
              if (stage) stage.container().style.cursor = 'ew-resize'
            }}
            onMouseLeave={(e: KonvaEventObject<MouseEvent>) => {
              const stage = e.target.getStage()
              if (stage) stage.container().style.cursor = ''
            }}
          />
        </>
      )}
    </Group>
  )
}

ModuleBox.displayName = 'ModuleBox'
export default memo(ModuleBox)
