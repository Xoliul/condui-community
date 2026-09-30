import { useState, useEffect } from 'react'
import { Group, Rect, Line, Circle, Image } from 'react-konva'
import { getSymbolById } from '@/lib/symbols'
import type { SymbolMetadata } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { useSettingsStore } from '@/stores/settingsStore'
import type { Point } from '@/types/ui'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { getPanelDiagramId, LAYOUT_CONSTANTS } from '@/lib/layout/bottomUpLayout'
import type { WireSegment } from '@/types/schema'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { isFixedApplianceSymbol } from '@/utils/symbolMapping'
import { getDomoticaDropContextForCircuit, type DomoticaDropContext } from '@/lib/layout/domoticaDrop'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import {
  getCircuitBusSectionId,
  getProtectionBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { getPanelBusFeedKind } from '@/lib/panel/panelFeedOrganization'
import {
  calculatePanelBusFeedPreview,
  getLeftBiasedBusFeedStubX,
  PANEL_BUS_FEED_GAP,
} from '@/lib/panel/panelBusFeedPreview'

interface DragPreviewProps {
  position: Point
  dropTarget: DropTarget | null
  layout: BottomUpLayoutResult | null
  wireSegments: WireSegment[]
  symbolData: SymbolMetadata | null
  showMainBusPositionMarker?: boolean
}

export function DragPreview({
  position,
  dropTarget,
  layout,
  wireSegments,
  symbolData,
  showMainBusPositionMarker = true,
}: DragPreviewProps) {
  const previewColor = '#0284c7' // Blue for preview
  const previewOpacity = 0.6
  const isDark = useSettingsStore((state) => state.theme.mode === 'dark')
  const [symbolImage, setSymbolImage] = useState<HTMLImageElement | null>(null)

  // Find the target panel for highlighting
  // Try to find panel by panelId first, or infer from drop target
  let targetPanel = null
  if (dropTarget?.panelId) {
    targetPanel =
      layout?.panels.find((p) => p.diagramId === dropTarget.diagramId) ??
      layout?.panels.find((p) => p.panel.id === dropTarget.panelId) ??
      null
  } else if (dropTarget && layout) {
    // Try to infer panel from drop target (e.g., circuitId, endpointId)
    if (dropTarget.circuitId) {
      for (const panel of layout.panels) {
        if (panel.circuits.some(c => c.circuit.id === dropTarget.circuitId)) {
          targetPanel = panel
          break
        }
      }
    } else if (dropTarget.endpointId) {
      for (const panel of layout.panels) {
        if (panel.elements.some(e => e.type === 'endpoint' && e.endpointId === dropTarget.endpointId)) {
          targetPanel = panel
          break
        }
      }
    }
  }

  // Load symbol image if symbolData is provided
  useEffect(() => {
    if (!symbolData) {
      setSymbolImage(null)
      return
    }
    
    const symbol = getSymbolById(symbolData.id)
    if (!symbol || !symbol.svgPath) {
      setSymbolImage(null)
      return
    }

    let cancelled = false
    loadProcessedSymbol(symbol.svgPath, isDark)
      .then((image) => {
        if (!cancelled) setSymbolImage(image)
      })
      .catch(() => {
        if (!cancelled) setSymbolImage(null)
      })
    return () => {
      cancelled = true
    }
  }, [isDark, symbolData])

  if (!layout || !dropTarget) return null

  // Resolve domotica-specific drop context (parent, group, output index) when applicable.
  let domoticaCtx: DomoticaDropContext | null = null
  if (symbolData && dropTarget.circuitId && layout) {
    for (const panelLayout of layout.panels) {
      const circuitLayout = panelLayout.circuits.find(
        (c) => c.circuit.id === dropTarget.circuitId,
      )
      if (circuitLayout) {
        domoticaCtx = getDomoticaDropContextForCircuit(
          circuitLayout.circuit,
          dropTarget,
          symbolData,
        )
        if (domoticaCtx) break
      }
    }
  }

  // Find wire segments being hovered for highlighting
  const hoveredWireSegments: WireSegment[] = []
  if (dropTarget.panelId) {
    const panelWires = wireSegments.filter(
      (ws) =>
        ws.panelId === dropTarget.panelId &&
        (!dropTarget.diagramId || (ws.diagramId ?? ws.panelId) === dropTarget.diagramId)
    )
    
    // Domotica-specific wire highlight: highlight the exact output wire that will
    // receive the new endpoint/switch.
    if (domoticaCtx && dropTarget.circuitId) {
      const domoticaParentId = domoticaCtx.parent.id
      const circuitId = domoticaCtx.circuit.id
      const domoticaWires = panelWires.filter(
        (s) =>
          s.type === 'branch' &&
          s.circuitId === circuitId &&
          s.fromElementId === domoticaParentId,
      )

      if (domoticaWires.length > 0) {
        const sortedByY = [...domoticaWires].sort(
          (a, b) => a.startPoint.y - b.startPoint.y,
        )

        const chosen: WireSegment | undefined =
          sortedByY[domoticaCtx.outputIndex] ??
          sortedByY.reduce<WireSegment | undefined>((best, candidate) => {
            if (!best) return candidate
            const bestDist = Math.abs(best.startPoint.y - position.y)
            const candDist = Math.abs(candidate.startPoint.y - position.y)
            return candDist < bestDist ? candidate : best
          }, undefined)

        if (chosen) {
          hoveredWireSegments.push(chosen)
        }
      }
    } else if (dropTarget.type === 'circuit' && dropTarget.circuitId) {
      // Highlight vertical wire for the circuit
      const verticalWire = panelWires.find(
        s => s.circuitId === dropTarget.circuitId && s.type === 'vertical'
      )
      if (verticalWire) hoveredWireSegments.push(verticalWire)
      
      // Also highlight branch wires for this circuit
      panelWires
        .filter(s => s.circuitId === dropTarget.circuitId && s.type === 'branch')
        .forEach(w => hoveredWireSegments.push(w))
    } else if (dropTarget.type === 'endpoint' && dropTarget.endpointId) {
      // Find the endpoint element from layout to get its position
      const targetPanelLayout =
        layout.panels.find((p) => p.diagramId === dropTarget.diagramId) ??
        layout.panels.find((p) => p.panel.id === dropTarget.panelId)
      if (targetPanelLayout) {
        const endpointElement = targetPanelLayout.elements.find(
          e => e.type === 'endpoint' && e.endpointId === dropTarget.endpointId
        )
        if (endpointElement) {
          // Find branch wire that ends at this endpoint position
          const branchWire = panelWires.find(
            s => s.type === 'branch' && 
            Math.abs(s.endPoint.x - endpointElement.position.x) < 5 &&
            Math.abs(s.endPoint.y - endpointElement.position.y) < 5
          )
          if (branchWire) hoveredWireSegments.push(branchWire)
        }
      }
    } else if (dropTarget.type === 'mainBus') {
      // Highlight main bus wire
      const mainBusWire = panelWires.find(s => s.type === 'mainBus')
      if (mainBusWire) hoveredWireSegments.push(mainBusWire)
    } else if (dropTarget.type === 'supplyWire') {
      // Highlight supply wire segments (vertical and horizontal)
      const supplyWires = panelWires.filter(
        s =>
          (
            (!s.circuitId && !s.fromElementType && (s.type === 'vertical' || s.type === 'branch')) ||
            (s.isSubPanelSupply === true && s.type === 'vertical')
          )
      )
      supplyWires.forEach(w => hoveredWireSegments.push(w))
    }
  }

  return (
    <Group>
      {/* Panel outline highlight */}
      {targetPanel && (
        <Rect
          x={targetPanel.frame.x}
          y={targetPanel.frame.y}
          width={targetPanel.frame.width}
          height={targetPanel.frame.height}
          fill="transparent"
          stroke={previewColor}
          strokeWidth={3}
          opacity={previewOpacity}
          dash={[8, 4]}
          listening={false}
        />
      )}

      {/* Wire segment highlights */}
      {hoveredWireSegments.map(wireSegment => (
        <Line
          key={`highlight-${wireSegment.id}`}
          points={[
            wireSegment.startPoint.x,
            wireSegment.startPoint.y,
            wireSegment.endPoint.x,
            wireSegment.endPoint.y,
          ]}
          stroke={previewColor}
          strokeWidth={Math.max(4, wireSegment.type === 'mainBus' || wireSegment.type === 'trunk' ? 8 : 4)}
          opacity={previewOpacity * 0.8}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ))}

      {/* Domotica output preview: ghost symbol at the selected domotica output. */}
      {domoticaCtx &&
        dropTarget.panelId &&
        dropTarget.circuitId &&
        (() => {
          const domoticaParentId = domoticaCtx.parent.id
          const circuitId = domoticaCtx.circuit.id
          const panelWires = wireSegments.filter(
            (s) =>
              s.panelId === dropTarget.panelId &&
              s.circuitId === circuitId &&
              s.type === 'branch' &&
              s.fromElementId === domoticaParentId,
          )

          if (panelWires.length === 0) return null

          const sortedByY = [...panelWires].sort(
            (a, b) => a.startPoint.y - b.startPoint.y,
          )
          const stub: WireSegment | undefined =
            sortedByY[domoticaCtx.outputIndex] ??
            sortedByY.reduce<WireSegment | undefined>((best, candidate) => {
              if (!best) return candidate
              const bestDist = Math.abs(best.startPoint.y - position.y)
              const candDist = Math.abs(candidate.startPoint.y - position.y)
              return candDist < bestDist ? candidate : best
            }, undefined)
          if (!stub) return null

          const { endPoint } = stub
          const symbolSize = LAYOUT_CONSTANTS.SYMBOL_SIZE
          const symbolX = endPoint.x
          const symbolY = endPoint.y

          return (
            <>
              {/* Ghost symbol at final location */}
              <Rect
                x={symbolX - symbolSize / 2}
                y={symbolY - symbolSize / 2}
                width={symbolSize}
                height={symbolSize}
                fill="rgba(59,130,246,0.10)"
                stroke={previewColor}
                strokeWidth={2}
                dash={[6, 4]}
                cornerRadius={4}
                listening={false}
              />
            </>
          )
        })()}

      {/* Drop target specific previews */}
      {!domoticaCtx && dropTarget.type === 'circuit' && dropTarget.circuitId && (() => {
        // Check if this is an MCB drop (nested circuit creation)
        if (symbolData?.id === 'mcb') {
          // Preview for dropping MCB on circuit trunk to create nested circuit
          for (const panelLayout of layout.panels) {
            const circuitLayout = panelLayout.circuits.find(c => c.circuit.id === dropTarget.circuitId)
            if (!circuitLayout) continue

            // Find the vertical wire for this circuit
            const verticalWires = wireSegments.filter(
              s => s.circuitId === dropTarget.circuitId &&
                   s.type === 'vertical' &&
                   s.panelId === panelLayout.panel.id &&
                   (s.diagramId ?? s.panelId) === getPanelDiagramId(panelLayout)
            )
            if (verticalWires.length === 0) continue

            // Find the topmost vertical wire end (lowest Y = highest on screen)
            let wireEndY = Infinity
            let wireX = verticalWires[0]!.startPoint.x
            for (const vw of verticalWires) {
              const topY = Math.min(vw.startPoint.y, vw.endPoint.y)
              if (topY < wireEndY) {
                wireEndY = topY
                wireX = vw.startPoint.x
              }
            }

            // Count existing nested circuits
            const existingNested = circuitLayout.circuit.subCircuitIds?.length || 0
            const baseWidth = Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE)
            const symbolSize = LAYOUT_CONSTANTS.SYMBOL_SIZE

            if (existingNested === 0) {
              // TIER 1: First nested circuit - MCB appears on parent's wire end
              const mcbX = wireX
              const mcbY = wireEndY

              return (
                <>
                  {/* Ghost MCB on parent's wire end */}
                  <Circle
                    x={mcbX}
                    y={mcbY}
                    radius={20}
                    fill={previewColor}
                    opacity={previewOpacity * 0.3}
                    stroke={previewColor}
                    strokeWidth={2}
                    listening={false}
                  />
                  {symbolImage && (
                    <Group x={mcbX} y={mcbY} rotation={0}>
                      <Image
                        image={symbolImage}
                        width={symbolSize}
                        height={symbolSize}
                        offsetX={symbolSize / 2}
                        offsetY={symbolSize / 2}
                        opacity={previewOpacity}
                        listening={false}
                      />
                    </Group>
                  )}
                  {/* Short wire stub extending upward from new MCB */}
                  <Line
                    points={[mcbX, mcbY, mcbX, mcbY - 50]}
                    stroke={previewColor}
                    strokeWidth={3}
                    opacity={previewOpacity}
                    dash={[8, 4]}
                    listening={false}
                  />
                </>
              )
            } else {
              // TIER 2: Additional nested circuit - show bus bar + new MCB position
              // Find existing nested circuit layouts and their MCB positions
              const nestedLayouts = panelLayout.circuits.filter(
                cl => cl.parentCircuit?.id === dropTarget.circuitId
              )
              const nestedProtectionElements = panelLayout.elements.filter(
                el => el.type === 'protection' &&
                  nestedLayouts.some(nl => nl.protection?.id === el.protectionId)
              )

              // Bus bar Y = parent's wire end
              const busY = wireEndY

              // Calculate new MCB X position after existing nested circuits
              let newMcbX: number
              if (nestedProtectionElements.length > 0) {
                // Find the rightmost existing nested MCB
                const rightmostX = Math.max(...nestedProtectionElements.map(el => el.position.x))
                // Advance by: half baseWidth + branch length + padding
                newMcbX = rightmostX + baseWidth / 2 + LAYOUT_CONSTANTS.BRANCH_LEAD_IN + LAYOUT_CONSTANTS.CIRCUIT_ENVELOPE_GUTTER
              } else {
                // Fallback: place to the right of parent wire
                newMcbX = wireX + baseWidth / 2 + LAYOUT_CONSTANTS.BRANCH_LEAD_IN + LAYOUT_CONSTANTS.CIRCUIT_ENVELOPE_GUTTER
              }

              // New MCB sits below bus bar (like main bus circuits)
              const newMcbY = busY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

              // Bus bar extends from leftmost nested MCB to new MCB position
              const allMcbXPositions = [
                ...nestedProtectionElements.map(el => el.position.x),
                newMcbX
              ]
              // For single existing nested → bus bar starts at parent wire X (it will become multi-nested)
              if (existingNested === 1) {
                allMcbXPositions.push(wireX)
              }
              const busStartX = Math.min(...allMcbXPositions) - LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION
              const busEndX = Math.max(...allMcbXPositions) + LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION

              return (
                <>
                  {/* Secondary bus bar preview */}
                  <Line
                    points={[busStartX, busY, busEndX, busY]}
                    stroke={previewColor}
                    strokeWidth={LAYOUT_CONSTANTS.BUS_THICKNESS}
                    opacity={previewOpacity * 0.6}
                    dash={[8, 4]}
                    lineCap="round"
                    listening={false}
                  />
                  {/* Vertical line from bus bar down to new MCB */}
                  <Line
                    points={[newMcbX, busY, newMcbX, newMcbY]}
                    stroke={previewColor}
                    strokeWidth={3}
                    opacity={previewOpacity}
                    dash={[8, 4]}
                    listening={false}
                  />
                  {/* Ghost MCB at new position */}
                  <Circle
                    x={newMcbX}
                    y={newMcbY}
                    radius={20}
                    fill={previewColor}
                    opacity={previewOpacity * 0.3}
                    stroke={previewColor}
                    strokeWidth={2}
                    listening={false}
                  />
                  {symbolImage && (
                    <Group x={newMcbX} y={newMcbY} rotation={0}>
                      <Image
                        image={symbolImage}
                        width={symbolSize}
                        height={symbolSize}
                        offsetX={symbolSize / 2}
                        offsetY={symbolSize / 2}
                        opacity={previewOpacity}
                        listening={false}
                      />
                    </Group>
                  )}
                  {/* Short wire stub extending upward from new MCB */}
                  <Line
                    points={[newMcbX, newMcbY, newMcbX, newMcbY - 50]}
                    stroke={previewColor}
                    strokeWidth={3}
                    opacity={previewOpacity}
                    dash={[8, 4]}
                    listening={false}
                  />
                </>
              )
            }
          }
          return null
        }

        // Energy meter trunk insertion preview — shows symbol on the vertical wire
        if (symbolData?.id === 'energy_meter') {
          for (const panelLayout of layout.panels) {
            const circuitLayout = panelLayout.circuits.find(c => c.circuit.id === dropTarget.circuitId)
            if (!circuitLayout) continue

            // Find vertical wire segments for this circuit
            const verticalWires = wireSegments.filter(
              s => s.circuitId === dropTarget.circuitId &&
                   s.type === 'vertical' &&
                   s.panelId === panelLayout.panel.id &&
                   (s.diagramId ?? s.panelId) === getPanelDiagramId(panelLayout)
            )
            if (verticalWires.length === 0) continue

            // Find MCB position (bottom of wire, highest Y)
            let mcbY = -Infinity
            let wireX = verticalWires[0]!.startPoint.x
            for (const vw of verticalWires) {
              const bottomY = Math.max(vw.startPoint.y, vw.endPoint.y)
              if (bottomY > mcbY) {
                mcbY = bottomY
                wireX = vw.startPoint.x
              }
            }

            // Position: on the trunk wire, using the same gap constant as layout
            const deviceY = mcbY - LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP

            const symbolSize = LAYOUT_CONSTANTS.SYMBOL_SIZE

            // Find the topmost point to draw the upper wire stub to
            const circuitBranches = panelLayout.branches?.filter(b => b.circuitId === dropTarget.circuitId) || []
            const topWireY = circuitBranches.length > 0
              ? circuitBranches.reduce((closest, b) => b.branchY < closest.branchY ? b : closest).branchY
              : deviceY - symbolSize

            return (
              <>
                {/* Ghost energy meter on the vertical wire */}
                <Circle
                  x={wireX}
                  y={deviceY}
                  radius={22}
                  fill={previewColor}
                  opacity={previewOpacity * 0.2}
                  stroke={previewColor}
                  strokeWidth={2}
                  dash={[4, 4]}
                  listening={false}
                />
                {symbolImage && (
                  <Group x={wireX} y={deviceY}>
                    <Image
                      image={symbolImage}
                      width={symbolSize}
                      height={symbolSize}
                      offsetX={symbolSize / 2}
                      offsetY={symbolSize / 2}
                      opacity={previewOpacity}
                      listening={false}
                    />
                  </Group>
                )}
                {/* Wire stub below: device bottom edge → MCB */}
                <Line
                  points={[wireX, deviceY + symbolSize / 2, wireX, mcbY]}
                  stroke={previewColor}
                  strokeWidth={3}
                  opacity={previewOpacity * 0.5}
                  dash={[6, 3]}
                  listening={false}
                />
                {/* Wire stub above: device top edge → topmost branch */}
                <Line
                  points={[wireX, deviceY - symbolSize / 2, wireX, topWireY]}
                  stroke={previewColor}
                  strokeWidth={3}
                  opacity={previewOpacity * 0.5}
                  dash={[6, 3]}
                  listening={false}
                />
              </>
            )
          }
          return null
        }

        // Endpoint insertion preview (non-MCB, non-energy-meter symbols)
        for (const panelLayout of layout.panels) {
          const circuitLayout = panelLayout.circuits.find(c => c.circuit.id === dropTarget.circuitId)
          if (circuitLayout) {
            // Find the actual vertical wire segment for this circuit to get the correct X position and top end
            const verticalWire = wireSegments.find(
              s => s.circuitId === dropTarget.circuitId && 
                   s.type === 'vertical' && 
                   s.panelId === panelLayout.panel.id &&
                   (s.diagramId ?? s.panelId) === getPanelDiagramId(panelLayout)
            )
            
            if (!verticalWire) {
              // Fallback if no wire found
              return null
            }
            
            // Use the wire segment X position
            const circuitX = verticalWire.startPoint.x
            
            // Find the top end of the vertical wire (lower Y = higher on screen)
            const wireTopY = Math.min(verticalWire.startPoint.y, verticalWire.endPoint.y)
            
            // Find insertion Y position
            let insertY = wireTopY // Default to top of wire
            
            if (dropTarget.insertAfterEndpointId) {
              // Find the branch with this endpoint
              const targetBranch = panelLayout.branches?.find(b => 
                b.circuitId === dropTarget.circuitId && 
                b.endpoints.some(e => e.id === dropTarget.insertAfterEndpointId)
              )
              if (targetBranch) {
                // Insert after this endpoint - next branch position (going up = lower Y)
                insertY = targetBranch.branchY - 50 // 50 is ENDPOINT_BRANCH_SPACING
              }
            } else {
              // Insert at the top - find the topmost branch and add one above it
              const circuitBranches = panelLayout.branches?.filter(b => b.circuitId === dropTarget.circuitId) || []
              if (circuitBranches.length > 0) {
                const topmostBranch = circuitBranches.reduce((top, b) => b.branchY < top.branchY ? b : top)
                insertY = topmostBranch.branchY - 50 // Add new branch above (lower Y)
              } else {
                // No branches yet - use the top of the wire
                insertY = wireTopY
              }
            }

            // Calculate symbol preview position (at the end of horizontal branch)
            const symbolX = circuitX + 80 // End of horizontal branch
            const symbolY = insertY
            const symbolSize = 40

            return (
              <>
                {/* Preview insertion line - horizontal branch */}
                <Line
                  points={[circuitX, wireTopY, circuitX , insertY, circuitX + 80, insertY]}
                  stroke={previewColor}
                  strokeWidth={3}
                  opacity={previewOpacity}
                  dash={[8, 4]}
                  listening={false}
                />
                {/* Preview circle at insertion point */}
                <Circle
                  x={symbolX}
                  y={symbolY}
                  radius={20}
                  fill={previewColor}
                  opacity={previewOpacity * 0.3}
                  stroke={previewColor}
                  strokeWidth={2}
                  listening={false}
                />
                {/* Preview symbol image - facing upward (0° rotation) for bottom-up layout */}
                {symbolImage && (
                  <Group
                    x={symbolX}
                    y={symbolY}
                    rotation={0} // Face upward for bottom-up layout
                  >
                    <Image
                      image={symbolImage}
                      width={symbolSize}
                      height={symbolSize}
                      offsetX={symbolSize / 2}
                      offsetY={symbolSize / 2}
                      opacity={previewOpacity}
                      listening={false}
                    />
                  </Group>
                )}
              </>
            )
          }
        }
        return null
      })()}
      
      {!domoticaCtx && dropTarget.type === 'endpoint' && dropTarget.endpointId && (() => {
        // Static device on socket: show blue preview of module after the socket (same branch)
        const targetEndpointId = dropTarget.insertAfterEndpointId || dropTarget.endpointId
        const isApplianceOnSocket = symbolData && isFixedApplianceSymbol(symbolData)

        for (const panelLayout of layout.panels) {
          for (const circuitLayout of panelLayout.circuits) {
            const branch = circuitLayout.branch
            if (branch) {
              const endpointIndex = branch.endpoints.findIndex(
                e => e.id === targetEndpointId
              )
              if (endpointIndex >= 0) {
                const endpoint = branch.endpoints[endpointIndex]
                const endpointCount = branch.endpoints.length
                const socketX = endpointCount === 1
                  ? branch.branchX + LAYOUT_CONSTANTS.BRANCH_LEAD_IN
                  : branch.branchX + LAYOUT_CONSTANTS.BRANCH_LEAD_IN + endpointIndex * LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING
                const endpointY = branch.branchY

                if (isApplianceOnSocket && endpoint?.type === 'socket') {
                  // Preview: wire segment + appliance symbol well to the right of socket (clear visual gap)
                  const applianceX = socketX + LAYOUT_CONSTANTS.SYMBOL_SIZE + LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING
                  const symbolSize = LAYOUT_CONSTANTS.SYMBOL_SIZE
                  return (
                    <>
                      <Circle
                        x={socketX}
                        y={endpointY}
                        radius={18}
                        fill={previewColor}
                        opacity={previewOpacity * 0.15}
                        stroke={previewColor}
                        strokeWidth={2}
                        listening={false}
                      />
                      <Line
                        points={[socketX, endpointY, applianceX, endpointY]}
                        stroke={previewColor}
                        strokeWidth={3}
                        opacity={previewOpacity}
                        dash={[8, 4]}
                        listening={false}
                      />
                      {symbolImage && (
                        <Group x={applianceX} y={endpointY} listening={false}>
                          <Image
                            image={symbolImage}
                            width={symbolSize}
                            height={symbolSize}
                            offsetX={symbolSize / 2}
                            offsetY={symbolSize / 2}
                            opacity={previewOpacity}
                            listening={false}
                          />
                          <Circle
                            x={0}
                            y={0}
                            radius={symbolSize / 2 + 4}
                            fill={previewColor}
                            opacity={previewOpacity * 0.2}
                            stroke={previewColor}
                            strokeWidth={2}
                            listening={false}
                          />
                        </Group>
                      )}
                    </>
                  )
                }

                // Other drops on endpoint: show branch-off preview (new branch below)
                const branchY = endpointY + 40
                let endpointX = socketX
                if (!branch.isStraight && endpointCount > 1) {
                  endpointX = branch.branchX + LAYOUT_CONSTANTS.BRANCH_LEAD_IN + endpointIndex * LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING
                }
                return (
                  <>
                    <Circle
                      x={endpointX}
                      y={endpointY}
                      radius={25}
                      fill={previewColor}
                      opacity={previewOpacity * 0.2}
                      stroke={previewColor}
                      strokeWidth={2}
                      listening={false}
                    />
                    <Line
                      points={[endpointX, endpointY, endpointX, branchY]}
                      stroke={previewColor}
                      strokeWidth={3}
                      opacity={previewOpacity}
                      dash={[8, 4]}
                      listening={false}
                    />
                    <Line
                      points={[endpointX - 20, branchY, endpointX + 20, branchY]}
                      stroke={previewColor}
                      strokeWidth={3}
                      opacity={previewOpacity}
                      dash={[8, 4]}
                      listening={false}
                    />
                    <Circle
                      x={endpointX}
                      y={branchY}
                      radius={20}
                      fill={previewColor}
                      opacity={previewOpacity * 0.3}
                      stroke={previewColor}
                      strokeWidth={2}
                      listening={false}
                    />
                  </>
                )
              }
            }
          }
        }
        return null
      })()}
  
      {dropTarget.type === 'mainBus' && (() => {
        // Show preview on main bus
        for (const panelLayout of layout.panels) {
          if (
            panelLayout.panel.id === dropTarget.panelId &&
            (!dropTarget.diagramId || panelLayout.diagramId === dropTarget.diagramId)
          ) {
            if (symbolData?.busFeedKind) {
              const busY = panelLayout.mainBus.y
              const busStartX = panelLayout.mainBus.x
              const busEndX = busStartX + panelLayout.mainBus.width
              const stubLength = 28
              const order = getMainBusOrder(panelLayout.panel)
              const items = order.flatMap((item) => {
                const element = panelLayout.elements.find((candidate) =>
                  item.type === 'protection'
                    ? candidate.protectionId === item.id
                    : candidate.circuitId === item.id,
                )
                if (!element) return []
                const busSectionId =
                  item.type === 'protection'
                    ? getProtectionBusSectionId(
                        panelLayout.panel,
                        panelLayout.panel.protections.find(
                          (protection) => protection.id === item.id,
                        ) ?? {},
                      )
                    : getCircuitBusSectionId(
                        panelLayout.panel,
                        panelLayout.panel.circuits.find((circuit) => circuit.id === item.id) ?? {},
                      )
                return [{
                  x: element.position.x,
                  kind: hasExplicitPanelBusSections(panelLayout.panel)
                    ? getPanelBusFeedKind(panelLayout.panel, busSectionId)
                    : 'grid' as const,
                }]
              })
              const referencedId = dropTarget.protectionId ?? dropTarget.circuitId
              const referencedIndex = referencedId
                ? order.findIndex((item) => item.id === referencedId)
                : -1
              const insertIndex =
                typeof dropTarget.mainBusInsertIndex === 'number'
                  ? dropTarget.mainBusInsertIndex
                  : referencedIndex >= 0
                    ? referencedIndex
                    : 0
              const feedPreview = calculatePanelBusFeedPreview(
                items,
                insertIndex,
                symbolData.busFeedKind,
                busStartX,
                busEndX,
                !hasExplicitPanelBusSections(panelLayout.panel),
              )
              const introducedRun = feedPreview.introducedKind
                ? feedPreview.resultRuns.find(
                    (run) =>
                      run.kind === feedPreview.introducedKind &&
                      run.endX > feedPreview.affectedStartX,
                  )
                : undefined
              const stubX = introducedRun
                ? getLeftBiasedBusFeedStubX(introducedRun.startX, introducedRun.endX)
                : undefined
              const highlightedRuns = feedPreview.resultRuns.flatMap((run) => {
                if (feedPreview.action === 'merge') return [run]
                const startX = Math.max(run.startX, feedPreview.affectedStartX)
                return run.endX > startX ? [{ ...run, startX }] : []
              })
              return (
                <>
                  {highlightedRuns.map((run, index) => {
                    const gap = feedPreview.action === 'merge' ? 0 : PANEL_BUS_FEED_GAP / 2
                    const isFirstResultRun = run.startX === feedPreview.resultRuns[0]?.startX
                    const isLastResultRun = run.endX === feedPreview.resultRuns.at(-1)?.endX
                    return (
                      <Line
                        key={`feed-preview-run-${index}`}
                        points={[
                          run.startX + (!isFirstResultRun ? gap : 0),
                          busY,
                          run.endX + (!isLastResultRun ? -gap : 0),
                          busY,
                        ]}
                        stroke={previewColor}
                        strokeWidth={feedPreview.action === 'merge' ? 10 : 8}
                        opacity={previewOpacity}
                        lineCap="round"
                        listening={false}
                      />
                    )
                  })}
                  {feedPreview.resultCutXs.map((cutX) => (
                    <Line
                      key={`feed-preview-cut-${cutX}`}
                      points={[cutX, busY - 13, cutX, busY + 13]}
                      stroke={previewColor}
                      strokeWidth={2}
                      opacity={previewOpacity}
                      dash={[4, 3]}
                      listening={false}
                    />
                  ))}
                  {stubX != null && (
                    <Line
                      points={[stubX, busY, stubX, busY + stubLength]}
                      stroke={previewColor}
                      strokeWidth={3}
                      opacity={previewOpacity}
                      dash={[6, 3]}
                      listening={false}
                    />
                  )}
                  {stubX != null && symbolImage && (
                    <Group x={stubX} y={busY + stubLength + 12}>
                      <Rect
                        x={-15}
                        y={-15}
                        width={30}
                        height={30}
                        stroke={previewColor}
                        strokeWidth={2}
                        dash={[4, 3]}
                        cornerRadius={3}
                        opacity={previewOpacity}
                        listening={false}
                      />
                      <Image
                        image={symbolImage}
                        width={22}
                        height={22}
                        offsetX={11}
                        offsetY={11}
                        opacity={previewOpacity}
                        listening={false}
                      />
                    </Group>
                  )}
                </>
              )
            }
            return (
              <>
                {/* Preview highlight on main bus */}
                <Rect
                  x={panelLayout.mainBus.x}
                  y={panelLayout.mainBus.y - 2}
                  width={panelLayout.mainBus.width}
                  height={4}
                  fill={previewColor}
                  opacity={previewOpacity * 0.5}
                  listening={false}
                />
                {/* Preview circle at drop position */}
                {showMainBusPositionMarker && (
                  <Circle
                    x={position.x}
                    y={panelLayout.mainBus.y}
                    radius={15}
                    fill={previewColor}
                    opacity={previewOpacity * 0.3}
                    stroke={previewColor}
                    strokeWidth={2}
                    listening={false}
                  />
                )}
              </>
            )
          }
        }
        return null
      })()}
  
      {dropTarget.type === 'supplyWire' && (() => {
        // Show preview on supply wire for energy meter or protection device
        for (const panelLayout of layout.panels) {
          if (
            panelLayout.panel.id !== dropTarget.panelId ||
            (dropTarget.diagramId && panelLayout.diagramId !== dropTarget.diagramId)
          ) continue
          
          const supplyElement = panelLayout.elements.find(e => e.type === 'supply')
          if (!supplyElement) continue
          
          const symbolSize = LAYOUT_CONSTANTS.SYMBOL_SIZE
          const supplyX = supplyElement.position.x
          const supplyY = supplyElement.position.y
          const bendX =
            panelLayout.supplyBend?.x ??
            supplyX - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING

          // Calculate preview device position on the horizontal wire
          const existingDevices = panelLayout.supplyDevices || []
          const insertIndex = existingDevices.length
          const deviceX =
            bendX + (insertIndex + 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING

          return (
            <>
              {/* Highlight supply wire */}
              <Line
                points={[bendX, supplyY, deviceX, supplyY]}
                stroke={previewColor}
                strokeWidth={4}
                opacity={previewOpacity * 0.6}
                lineCap="round"
                listening={false}
              />
              {/* Ghost device circle */}
              <Circle
                x={deviceX}
                y={supplyY}
                radius={22}
                fill={previewColor}
                opacity={previewOpacity * 0.2}
                stroke={previewColor}
                strokeWidth={2}
                dash={[4, 4]}
                listening={false}
              />
              {/* Preview symbol image */}
              {symbolImage && (
                <Group x={deviceX} y={supplyY}>
                  <Image
                    image={symbolImage}
                    width={symbolSize}
                    height={symbolSize}
                    offsetX={symbolSize / 2}
                    offsetY={symbolSize / 2}
                    opacity={previewOpacity}
                    listening={false}
                  />
                </Group>
              )}
            </>
          )
        }
        return null
      })()}
  
      {dropTarget.type === 'rcd' && (() => {
        // Show preview on RCD
        for (const panelLayout of layout.panels) {
          const rcdElement = panelLayout.elements.find(
            e => e.type === 'rcd' && e.protectionId === dropTarget.protectionId
          )
          if (rcdElement) {
            return (
              <>
                {/* Preview highlight around RCD */}
                <Circle
                  x={rcdElement.position.x}
                  y={rcdElement.position.y}
                  radius={25}
                  fill={previewColor}
                  opacity={previewOpacity * 0.3}
                  stroke={previewColor}
                  strokeWidth={2}
                  dash={[4, 4]}
                  listening={false}
                />
              </>
            )
          }
        }
        return null
      })()}

      {symbolData?.id === 'panel_distribution' &&
        (dropTarget.type === 'protection' || dropTarget.type === 'circuit') &&
        (() => {
          for (const panelLayout of layout.panels) {
            // Resolve target protection directly or via target circuit.
            let protectionElement = null as (typeof panelLayout.elements[number]) | null
            if (dropTarget.type === 'protection' && dropTarget.protectionId) {
              protectionElement =
                panelLayout.elements.find(
                  (e) => e.type === 'protection' && e.protectionId === dropTarget.protectionId,
                ) ?? null
            } else if (dropTarget.type === 'circuit' && dropTarget.circuitId) {
              const matchingCircuit = panelLayout.circuits.find((c) => c.circuit.id === dropTarget.circuitId)
              const protectionId = matchingCircuit?.protection?.id
              if (protectionId) {
                protectionElement =
                  panelLayout.elements.find(
                    (e) => e.type === 'protection' && e.protectionId === protectionId,
                  ) ?? null
              }
            }
            if (!protectionElement) continue

            const x = protectionElement.position.x
            const y = protectionElement.position.y
            const symbolSize = LAYOUT_CONSTANTS.SYMBOL_SIZE

            return (
              <>
                {/* Highlight feeder protection that will be reused for sub-panel link */}
                <Circle
                  x={x}
                  y={y}
                  radius={24}
                  fill={previewColor}
                  opacity={previewOpacity * 0.22}
                  stroke={previewColor}
                  strokeWidth={2}
                  dash={[6, 4]}
                  listening={false}
                />
                {/* Show the dragged panel symbol near the feeder for clear intent */}
                {symbolImage && (
                  <Group x={x + symbolSize * 1.1} y={y - symbolSize * 0.6} listening={false}>
                    <Image
                      image={symbolImage}
                      width={symbolSize}
                      height={symbolSize}
                      offsetX={symbolSize / 2}
                      offsetY={symbolSize / 2}
                      opacity={previewOpacity}
                      listening={false}
                    />
                  </Group>
                )}
              </>
            )
          }
          return null
        })()}
    </Group>
  )
}
