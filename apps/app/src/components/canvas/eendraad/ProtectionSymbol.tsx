import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { getSymbolById } from '@/lib/symbols'
import { protectionTypeToSymbolKey } from '@/lib/protectionKind'
import { SYMBOL_EXPORT_ATTR_SVG_PATH, loadProcessedSymbol } from '@/lib/symbolImage'
import {
  getSurgeProtectionBodyBounds,
  getSurgeProtectionSymbolPath,
  getSurgeProtectionSymbolAnchor,
  getSurgeProtectionSelectionBounds,
} from '@/lib/surgeProtectionSymbol'
import { useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import { logger } from '@/lib/logger'
import {
  useCanvasFontFamily,
  useEffectiveCanvasZoom,
  useHoverIncludes,
  useIsIdSelected,
  useSetSelection,
} from '@/editions/community/communityHooks'
import {
  SYMBOL_SIZE,
  PROTECTION_OUTLINE_SIZE,
  getSelectionOutlineProps,
  getHoverOutlineProps,
  getPreviewOutlineProps,
  getPaddedRectSelectionOutlineProps,
  getPaddedRectHoverOutlineProps,
  getPaddedRectPreviewOutlineProps,
  getTouchAwareHitAreaProps,
  getSymbolColor,
  getSecondaryTextColor,
  getSelectionOutlineStrokeStyle,
} from './canvasSymbols'
import { useTouchPrimaryDevice } from '@/editions/community/communityHooks'
import { ProtectionOneWireLabels } from './ProtectionOneWireLabels'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSecondaryBusOrderForCircuit } from '@/lib/eendraad/protectionDragEligibility'
import type { Circuit, ProtectionDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import { getLayoutSubtreeSelectionIds } from '@/lib/eendraad/downstreamSelection'
import { registerActivation } from '@/utils/repeatActivation'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: {
    button?: number
    shiftKey?: boolean
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
  }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface ProtectionSymbolProps {
  protection: ProtectionDevice
  position: Point
  renderSymbol?: boolean
  /** Artwork rotation resolved by the shared layout tree. */
  symbolRotationDeg?: number
  /** If provided, drop target uses this (cursor) position instead of symbol position. */
  getCanvasPositionFromEvent?: (e: unknown) => Point | null
  onDragEnd: (newPos: Point) => boolean | void
  onDragMove?: (newPos: Point) => void
  onDragStart?: (altKey: boolean, nativeEvt: MouseEvent) => boolean
  shouldSuppressKonvaDragEnd?: () => boolean
  /** Layout subtree selected by a double click/tap (everything fed by this protection). */
  downstreamNode?: LayoutNode
}

export function ProtectionSymbol({
  protection,
  position,
  renderSymbol = true,
  symbolRotationDeg,
  getCanvasPositionFromEvent,
  onDragEnd,
  onDragMove,
  onDragStart,
  shouldSuppressKonvaDragEnd,
  downstreamNode,
}: ProtectionSymbolProps) {
  const setSelection = useSetSelection()
  const isSelected = useIsIdSelected(protection.id)
  const isHoveredFromBreadcrumb = useHoverIncludes('protection', protection.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const meterSelectionStroke = getSelectionOutlineStrokeStyle(canvasZoom).strokeWidth
  const touchPrimary = useTouchPrimaryDevice()
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const isPreviewSelected = useIsPreviewSelected('protection', protection.id)
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const dragOriginParentRef = useRef<Konva.Container | null>(null)
  const dragOriginLayerListeningRef = useRef<{ layer: Konva.Layer; listening: boolean } | null>(null)
  const isolateDragNode = useCallback((target: Konva.Node) => {
    const dragLayer = target.getStage()?.findOne('.canvas-drag-layer')
    const originParent = target.getParent()
    if (!dragLayer || !originParent || dragLayer === originParent) return
    const absolutePosition = target.getAbsolutePosition()
    const originLayer = target.getLayer()
    if (originLayer) {
      dragOriginLayerListeningRef.current = {
        layer: originLayer,
        listening: originLayer.listening(),
      }
      originLayer.listening(false)
    }
    dragOriginParentRef.current = originParent
    target.moveTo(dragLayer)
    target.setAbsolutePosition(absolutePosition)
  }, [])
  const restoreDragNode = useCallback((target: Konva.Node) => {
    const originParent = dragOriginParentRef.current
    if (!originParent) return
    const absolutePosition = target.getAbsolutePosition()
    target.moveTo(originParent)
    target.setAbsolutePosition(absolutePosition)
    dragOriginParentRef.current = null
    const originLayerListening = dragOriginLayerListeningRef.current
    if (originLayerListening) {
      originLayerListening.layer.listening(originLayerListening.listening)
      dragOriginLayerListeningRef.current = null
    }
  }, [])
  useEffect(
    () => () => {
      const originLayerListening = dragOriginLayerListeningRef.current
      if (originLayerListening) {
        originLayerListening.layer.listening(originLayerListening.listening)
      }
    },
    []
  )
  type ProjectStoreState = ReturnType<typeof useProjectStore.getState>
  // Subscribe to actual data to make moveInfo reactive
  const circuit = protection.circuits?.[0]
  const isHorizontalConverterBackup = circuit?.supplySource?.kind === 'converter-backup'
  const secondaryBusOrder = useProjectStore((state: ProjectStoreState) => {
    if (!isSelected || !circuit || !state.currentProject) return null
    return getSecondaryBusOrderForCircuit(
      getProjectElectricalPanels(state.currentProject),
      circuit.id
    )
  })

  const mainBusOrder = useProjectStore((state: ProjectStoreState) => {
    if (!isSelected || !circuit || !state.currentProject) {
      return null
    }
    const panel = state.findPanelForCircuit(circuit.id)
    if (!panel) {
      return null
    }

    const isDirectCircuit = panel.circuits.some((c: Circuit) => c.id === circuit.id)
    // Any protection with circuits can be on the main bus (MCB, RCBO, RCD)
    const isProtectionOnMainBus = protection.circuits && protection.circuits.length > 0

    if (!isDirectCircuit && !isProtectionOnMainBus) {
      return null
    }

    // Build order string for main bus items
    // IMPORTANT: We need to preserve the order from panel.protections and panel.circuits arrays
    const items: string[] = []

    // Add direct circuits (preserve order from panel.circuits)
    panel.circuits.forEach((c: Circuit) => {
      if (c.code !== 'PANEL') {
        items.push(`circuit:${c.id}`)
      }
    })

    // Add protections with circuits (MCB, RCBO, RCD) - preserve order from panel.protections
    // Use the same logic as isMainBusProtection: check if this protection's circuit
    // is in any OTHER protection's circuit's subCircuitIds
    panel.protections.forEach((p: ProtectionDevice) => {
      // Include any protection that has circuits (MCB, RCBO, RCD)
      if (p.circuits && p.circuits.length > 0) {
        const pCircuit = p.circuits[0] // Use first circuit
        if (!pCircuit) {
          return
        }
        const myCircuitId = pCircuit.id

        // Check if this circuit is nested (in a parent protection's circuit's subCircuitIds)
        // A protection is on main bus if its circuit is NOT in any other protection's circuit's subCircuitIds
        let isNested = false
        for (const otherPr of panel.protections) {
          if (otherPr.id === p.id) continue // Skip self
          for (const otherCircuit of otherPr.circuits ?? []) {
            if (otherCircuit.subCircuitIds?.includes(myCircuitId)) {
              isNested = true
              break
            }
          }
          if (isNested) break
        }

        if (!isNested) {
          items.push(`protection:${p.id}`)
        }
      }
    })

    const result = items.join(',')
    return result
  })

  // Determine move capabilities - now reactive to data changes
  const moveInfo = useMemo(() => {
    if (!circuit) {
      return null
    }

    // Check secondary bus first
    if (secondaryBusOrder) {
      const circuitIds = secondaryBusOrder.split(',')
      const index = circuitIds.indexOf(circuit.id)
      if (index !== -1) {
        return {
          type: 'secondaryBus' as const,
          canMoveLeft: index > 0,
          canMoveRight: index < circuitIds.length - 1,
        }
      }
    }

    // Check main bus
    if (mainBusOrder) {
      const items = mainBusOrder.split(',')
      const currentItem = items.find(
        (item: string) => item === `circuit:${circuit.id}` || item === `protection:${protection.id}`
      )
      if (currentItem) {
        const index = items.indexOf(currentItem)
        return {
          type: 'mainBus' as const,
          panelId: useProjectStore.getState().findPanelForCircuit(circuit.id)?.id || '',
          circuitId: circuit.id,
          canMoveLeft: index > 0,
          canMoveRight: index < items.length - 1,
        }
      }
    }

    return null
  }, [circuit, protection.id, secondaryBusOrder, mainBusOrder])

  // Check if selected - allow selection even if type doesn't match (for multi-type drag rect selection)
  // If ID is in the list, it's selected regardless of selection.type

  const symbolKey = protectionTypeToSymbolKey(protection.type)
  const symbol = symbolKey ? getSymbolById(symbolKey) : null
  const isSurgeProtection = protection.type === 'SPD'
  const renderedSymbolPath = isSurgeProtection
    ? getSurgeProtectionSymbolPath(protection.surgeProtectionKind)
    : symbol?.svgPath
  const surgeBodyBounds = getSurgeProtectionBodyBounds(SYMBOL_SIZE, SYMBOL_SIZE, false)
  const surgeSelectionBounds = getSurgeProtectionSelectionBounds(SYMBOL_SIZE, SYMBOL_SIZE, false)
  const surgeSymbolAnchor = getSurgeProtectionSymbolAnchor(SYMBOL_SIZE, SYMBOL_SIZE)

  // Load symbol image
  useEffect(() => {
    if (!renderedSymbolPath) return
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(renderedSymbolPath, isDark)
      .then(setProcessedImage)
      .catch(() => {
        logger.error('Failed to load symbol:', renderedSymbolPath)
        setProcessedImage(null)
      })
  }, [renderedSymbolPath, theme.mode])

  const handleClick = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      const eendraWindow = window as WindowWithEendraTapSuppression
      if (eendraWindow.__eendraSuppressNextElementTap) {
        eendraWindow.__eendraSuppressNextElementTap = false
        return
      }
      e.cancelBubble = true

      if (e.evt.button != null && e.evt.button !== 0) {
        return
      }

      const activation = registerActivation(`protection:${protection.id}`)
      if (activation === 'absorbed') return
      if (activation === 'double' && downstreamNode) {
        setSelection({ type: 'protection', ids: getLayoutSubtreeSelectionIds(downstreamNode) })
        return
      }
      setSelection({ type: 'protection', ids: [protection.id] })
    },
    [downstreamNode, protection.id, setSelection]
  )

  const isDark = theme.mode === 'dark'
  const symbolColor = getSymbolColor(isDark)
  const [isHovered, setIsHovered] = useState(false)
  const isHoveredAny = isHovered || isHoveredFromBreadcrumb

  if (!renderSymbol) {
    return (
      <Group x={position.x} y={position.y}>
        <ProtectionOneWireLabels
          source={protection}
          defaultPosition={isHorizontalConverterBackup ? 'bottom' : 'right'}
          textColor={getSecondaryTextColor(isDark)}
          fontFamily={fontFamily}
          fontSize={10}
          symbolSize={SYMBOL_SIZE}
        />
      </Group>
    )
  }

  // If no symbol, fallback to simple rectangle
  if (!symbol || !processedImage) {
    return (
      <Group
        x={position.x}
        y={position.y}
        draggable={!!moveInfo && isSelected}
        onClick={handleClick}
        onTap={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDragStart={
          moveInfo && isSelected && onDragStart
            ? (e) => {
                const evt = e.evt as MouseEvent
                if (onDragStart(!!evt.altKey, evt)) {
                  e.target.stopDrag()
                  e.target.position({ x: position.x, y: position.y })
                  return
                }
                isolateDragNode(e.target)
              }
            : undefined
        }
        onDragMove={
          moveInfo && isSelected && onDragMove
            ? (e) => {
                onDragMove(
                  getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
                )
              }
            : undefined
        }
        onDragEnd={
          moveInfo && isSelected
            ? (e) => {
                if (shouldSuppressKonvaDragEnd?.()) {
                  restoreDragNode(e.target)
                  e.target.position({ x: position.x, y: position.y })
                  return
                }
                const pos = getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
                onDragEnd(pos)
                restoreDragNode(e.target)
                e.target.position({ x: position.x, y: position.y })
              }
            : undefined
        }
      >
        <Rect
          x={-15}
          y={-7.5}
          width={30}
          height={15}
          fill="transparent"
          stroke={isSelected ? '#fbbf24' : symbolColor}
          strokeWidth={isSelected ? meterSelectionStroke : meterSelectionStroke * 0.85}
          cornerRadius={2}
        />
        {/* Preview highlight (during selection rectangle drag) */}
        {isPreviewSelected && !isSelected && (
          <Rect {...getPreviewOutlineProps(canvasZoom, PROTECTION_OUTLINE_SIZE)} />
        )}
        {/* Hover highlight (from breadcrumb or mouse) */}
        {(isHovered || isHoveredFromBreadcrumb) && !isSelected && !isPreviewSelected && (
          <Rect {...getHoverOutlineProps(canvasZoom, PROTECTION_OUTLINE_SIZE)} />
        )}
        {circuit?.eendraadLetterVisible !== false && (
          <Text
            x={-12.5}
            y={-4}
            width={25}
            text={protection.label}
            fontSize={10}
            fontFamily={fontFamily}
            fill={symbolColor}
            align="center"
          />
        )}
      </Group>
    )
  }

  return (
    <Group
      name={`protection-${protection.id}`}
      x={position.x}
      y={position.y}
      draggable={!!moveInfo && isSelected}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragStart={
        moveInfo && isSelected && onDragStart
          ? (e) => {
              const evt = e.evt as MouseEvent
              if (onDragStart(!!evt.altKey, evt)) {
                e.target.stopDrag()
                e.target.position({ x: position.x, y: position.y })
                return
              }
              isolateDragNode(e.target)
            }
          : undefined
      }
      onDragMove={
        moveInfo && isSelected && onDragMove
          ? (e) => {
              onDragMove(
                getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
              )
            }
          : undefined
      }
      onDragEnd={
        moveInfo && isSelected
          ? (e) => {
              if (shouldSuppressKonvaDragEnd?.()) {
                restoreDragNode(e.target)
                e.target.position({ x: position.x, y: position.y })
                return
              }
              const pos = getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
              onDragEnd(pos)
              restoreDragNode(e.target)
              e.target.position({ x: position.x, y: position.y })
            }
          : undefined
      }
    >
      {renderSymbol && (
        <>
          {/* Invisible hit area - matches outline size for hover detection */}
          {isSurgeProtection ? (
            <Rect
              x={surgeBodyBounds.x - (touchPrimary ? 7 : 4)}
              y={surgeBodyBounds.y - (touchPrimary ? 7 : 4)}
              width={surgeBodyBounds.width + (touchPrimary ? 14 : 8)}
              height={surgeBodyBounds.height + (touchPrimary ? 14 : 8)}
              fill="transparent"
            />
          ) : (
            <Rect
              {...getTouchAwareHitAreaProps(
                PROTECTION_OUTLINE_SIZE,
                canvasZoom,
                isSelected,
                touchPrimary
              )}
            />
          )}

          {/* Symbol image */}
          <Image
            key={`${renderedSymbolPath}-${theme.mode}`}
            image={processedImage}
            {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: renderedSymbolPath }}
            width={SYMBOL_SIZE}
            height={SYMBOL_SIZE}
            offsetX={isSurgeProtection ? surgeSymbolAnchor.x : SYMBOL_SIZE / 2}
            offsetY={isSurgeProtection ? surgeSymbolAnchor.y : SYMBOL_SIZE / 2}
            y={0}
            rotation={symbolRotationDeg ?? (isHorizontalConverterBackup ? 90 : 0)}
            listening={false}
          />

          {/* Preview highlight (during selection rectangle drag) */}
          {isPreviewSelected && !isSelected && (
            <Rect
              {...(isSurgeProtection
                ? getPaddedRectPreviewOutlineProps(
                    canvasZoom,
                    surgeSelectionBounds.x,
                    surgeSelectionBounds.y,
                    surgeSelectionBounds.width,
                    surgeSelectionBounds.height,
                    2
                  )
                : getPreviewOutlineProps(canvasZoom, PROTECTION_OUTLINE_SIZE))}
            />
          )}
          {/* Hover highlight (from breadcrumb or mouse) */}
          {isHoveredAny && !isSelected && !isPreviewSelected && (
            <Rect
              {...(isSurgeProtection
                ? getPaddedRectHoverOutlineProps(
                    canvasZoom,
                    surgeSelectionBounds.x,
                    surgeSelectionBounds.y,
                    surgeSelectionBounds.width,
                    surgeSelectionBounds.height,
                    2
                  )
                : getHoverOutlineProps(canvasZoom, PROTECTION_OUTLINE_SIZE))}
            />
          )}

          {/* Selection outline */}
          {isSelected && (
            <Rect
              {...(isSurgeProtection
                ? getPaddedRectSelectionOutlineProps(
                    canvasZoom,
                    surgeSelectionBounds.x,
                    surgeSelectionBounds.y,
                    surgeSelectionBounds.width,
                    surgeSelectionBounds.height,
                    2
                  )
                : getSelectionOutlineProps(canvasZoom, PROTECTION_OUTLINE_SIZE))}
            />
          )}
        </>
      )}

      <ProtectionOneWireLabels
        source={protection}
        defaultPosition={isHorizontalConverterBackup ? 'bottom' : 'right'}
        textColor={getSecondaryTextColor(isDark)}
        fontFamily={fontFamily}
        fontSize={10}
        symbolSize={SYMBOL_SIZE}
        symbolWidth={isSurgeProtection ? 0 : undefined}
        symbolHeight={isSurgeProtection ? surgeBodyBounds.height : undefined}
        onLabelClick={handleClick}
      />
    </Group>
  )
}
