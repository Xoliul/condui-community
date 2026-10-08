import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
  MULTI_SOCKET_OFFSET,
} from '@/components/canvas/eendraad/canvasSymbols'
import {
  LAYOUT_CONSTANTS,
  PROTECTION_LABEL_FONT_SIZE,
  type BottomUpPanelLayout,
} from '@/lib/layout/bottomUpLayout'
import { collectDomoticaRowLabelPlacements } from '@/lib/layout/domoticaRowLabelPlacement'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import type { Endpoint, Frame, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { ResolvedFrameItem } from '@/lib/eendraad/frameContent'
import {
  getProtectionOneWireAnchorLineIndex,
  getProtectionOneWireLabelLines,
} from '@/lib/protectionLabels'
import { getSymbolLabelPosition } from '@/lib/symbolLabels'
import { isVerticalSupplyDevice } from '@/lib/layout/supplyDeviceOrientation'

export interface EendraadFrameBounds {
  x: number
  y: number
  width: number
  height: number
}

const FRAME_SYMBOL_HALF = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
const FRAME_TRUNK_WIRE_LABEL_BOTTOM_OUTSET = 12

function estimateTextWidth(text: string, fontSize: number): number {
  return Math.ceil(text.length * fontSize * 0.62)
}

function findProtectionInPanel(panelLayout: BottomUpPanelLayout, protectionId: string): ProtectionDevice | undefined {
  const scanCircuits = (circuits: { protection?: ProtectionDevice | null }[]) => {
    for (const circuitLayout of circuits) {
      if (circuitLayout.protection?.id === protectionId) return circuitLayout.protection
    }
    return undefined
  }
  return (
    panelLayout.panel.protections.find((protection) => protection.id === protectionId) ??
    scanCircuits(panelLayout.circuits)
  )
}

/** Supply devices on a horizontal run caption below the wire unless placed explicitly. */
function supplyDeviceLabelPosition(
  device: TrunkDevice | undefined
): ReturnType<typeof getSymbolLabelPosition> | undefined {
  if (!device || isVerticalSupplyDevice(device)) return undefined
  return device.symbolLabelDisplay?.position ?? 'bottom'
}

function protectionLikeLabelExtents(
  device: ProtectionDevice | TrunkDevice | undefined,
  x: number,
  y: number,
  positionOverride?: ReturnType<typeof getSymbolLabelPosition>
): { left: number; right: number; top: number; bottom: number } | null {
  if (!device) return null
  const lines = getProtectionOneWireLabelLines(device)
  if (lines.length === 0) return null
  const fontSize = 10
  const lineSpacing = 2
  const lineHeight = fontSize + lineSpacing
  const contentHeight = lines.length * lineHeight
  const maxLineWidth = Math.max(...lines.map((line) => estimateTextWidth(line.text, fontSize)))
  const position = positionOverride ?? getSymbolLabelPosition(device.symbolLabelDisplay)
  const anchorLineIndex = getProtectionOneWireAnchorLineIndex(lines)
  const symbolHalf = FRAME_SYMBOL_HALF
  const offsetFromSymbol = 5

  if (position === 'left' || position === 'right') {
    const labelX = x + (position === 'right' ? symbolHalf + offsetFromSymbol : -(symbolHalf + offsetFromSymbol))
    const blockTop = -anchorLineIndex * lineHeight - fontSize / 2
    return {
      left: position === 'right' ? labelX : labelX - maxLineWidth,
      right: position === 'right' ? labelX + maxLineWidth : labelX,
      top: y + blockTop,
      bottom: y + blockTop + contentHeight,
    }
  }

  const labelY = y + (position === 'top' ? -(symbolHalf + offsetFromSymbol + contentHeight) : symbolHalf + offsetFromSymbol)
  return {
    left: x - maxLineWidth / 2,
    right: x + maxLineWidth / 2,
    top: labelY,
    bottom: labelY + contentHeight,
  }
}

export function computeEendraadFrameBounds({
  items,
  panelLayout,
  getEndpointById,
  padding = 16,
  topExtra = 0,
  includeEndpointLabels = true,
}: {
  items: ResolvedFrameItem[]
  panelLayout: BottomUpPanelLayout
  getEndpointById: (id: string) => Endpoint | undefined
  padding?: number
  topExtra?: number
  includeEndpointLabels?: boolean
}): EendraadFrameBounds | null {
  const extents: Array<{ left: number; right: number; top: number; bottom: number }> = []
  let rowLabels: Map<string, { left: number; right: number; top: number; bottom: number }> | undefined

  for (const { id, kind } of items) {
    if (kind === 'endpoint') {
      const el = panelLayout.elements.find((e) => e.type === 'endpoint' && e.endpointId === id)
      if (!el) continue

      const endpoint = getEndpointById(id)
      const isDomoticaParent = endpoint?.symbol === 'domotica'

      if (isDomoticaParent) {
        const endpointCount = Math.max(
          DOMOTICA_MIN_ENDPOINT_OUTPUTS,
          Math.min(
            DOMOTICA_MAX_ENDPOINT_OUTPUTS,
            Math.trunc(endpoint?.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS),
          ),
        )
        const domoticaHeight =
          DOMOTICA_BASE_HEIGHT + Math.max(0, endpointCount - 1) * DOMOTICA_OUTPUT_SPACING

        const boxTop = el.position.y - domoticaHeight + DOMOTICA_BASE_HEIGHT / 2
        const boxBottom = boxTop + domoticaHeight

        extents.push({
          left: el.position.x - DOMOTICA_BOX_WIDTH / 2,
          right: el.position.x + DOMOTICA_BOX_WIDTH / 2,
          top: boxTop,
          bottom: boxBottom,
        })
      } else {
        const socketCount = (endpoint?.type === 'socket' && endpoint.socketProps?.socketCount) || 1
        const socketExtra = Math.max(0, socketCount - 1) * MULTI_SOCKET_OFFSET
        const endpointLabelReach = 110
        const branchLabelLeft = includeEndpointLabels
          ? panelLayout.elements
              .filter(
                (candidate) =>
                  candidate.type === 'label' &&
                  Math.abs(candidate.position.y - el.position.y) < 1 &&
                  Math.abs(candidate.position.x - el.position.x) <= endpointLabelReach
              )
              .reduce<number | null>(
                (left, label) => (left == null ? label.position.x : Math.min(left, label.position.x)),
                null,
              )
          : null

        const rowLabel = (rowLabels ??= domoticaRowLabelRects(panelLayout)).get(id)
        if (rowLabel) extents.push(rowLabel)
        extents.push({
          left: branchLabelLeft ?? el.position.x,
          right: el.position.x + socketExtra + FRAME_SYMBOL_HALF,
          top: el.position.y - FRAME_SYMBOL_HALF,
          bottom: el.position.y + FRAME_SYMBOL_HALF,
        })
      }
    } else if (kind === 'protection') {
      const el = panelLayout.elements.find(
        (e) => (e.type === 'protection' || e.type === 'rcd') && e.protectionId === id,
      )
      if (el) {
        const symbolExtents = {
          left: el.position.x - FRAME_SYMBOL_HALF,
          right: el.position.x + FRAME_SYMBOL_HALF,
          top: el.position.y - FRAME_SYMBOL_HALF,
          bottom: el.position.y + FRAME_SYMBOL_HALF,
        }
        extents.push(symbolExtents)
        const labelExtents = protectionLikeLabelExtents(
          findProtectionInPanel(panelLayout, id),
          el.position.x,
          el.position.y
        )
        if (labelExtents) extents.push(labelExtents)
      }
    } else if (kind === 'trunkDevice') {
      const el = panelLayout.elements.find((e) => e.type === 'trunkDevice' && e.trunkDeviceId === id)
      let isSupplyDevice = false
      let device = el?.trunkDeviceId
        ? panelLayout.circuits
            .flatMap((circuitLayout) => circuitLayout.circuit.trunkDevices ?? [])
            .find((entry) => entry.id === el.trunkDeviceId)
        : undefined
      // The one-wire draws supply devices as `supplyTrunkDevice-*` elements; their
      // record lives on the supply chain, and feed-stub copies stand upright.
      if (!device && el?.id.startsWith('supplyTrunkDevice-')) {
        device = panelLayout.supplyDevices?.find((entry) => entry.device.id === id)?.device
        isSupplyDevice = device != null && !el.id.includes('--feed-stub-')
      }
      const positionedDevice =
        el ??
        (() => {
          const supplyDevice = panelLayout.supplyDevices?.find((entry) => entry.device.id === id)
          if (supplyDevice) {
            device = supplyDevice.device
            isSupplyDevice = true
            return { position: { x: supplyDevice.x, y: supplyDevice.y } }
          }
          const groundDevice = panelLayout.groundDevices?.find((entry) => entry.device.id === id)
          if (groundDevice) {
            device = groundDevice.device
            return { position: { x: groundDevice.x, y: groundDevice.y } }
          }
          return null
        })()
      if (positionedDevice) {
        extents.push({
          left: positionedDevice.position.x - FRAME_SYMBOL_HALF,
          right: positionedDevice.position.x + FRAME_SYMBOL_HALF,
          top: positionedDevice.position.y - FRAME_SYMBOL_HALF,
          bottom: positionedDevice.position.y + FRAME_SYMBOL_HALF + FRAME_TRUNK_WIRE_LABEL_BOTTOM_OUTSET,
        })
        const labelExtents = protectionLikeLabelExtents(
          device,
          positionedDevice.position.x,
          positionedDevice.position.y,
          isSupplyDevice ? supplyDeviceLabelPosition(device) : undefined
        )
        if (labelExtents) extents.push(labelExtents)
      }
    } else if (kind === 'panelSymbol') {
      const el = panelLayout.elements.find((e) => e.id === id && e.type === 'endpoint')
      if (el) {
        extents.push({
          left: el.position.x - FRAME_SYMBOL_HALF,
          right: el.position.x + FRAME_SYMBOL_HALF,
          top: el.position.y - FRAME_SYMBOL_HALF,
          bottom: el.position.y + FRAME_SYMBOL_HALF,
        })
      }
    } else if (kind === 'ground') {
      if (panelLayout.ground) {
        extents.push({
          left: panelLayout.ground.x,
          right: panelLayout.ground.x,
          top: panelLayout.ground.y,
          bottom: panelLayout.ground.y,
        })
      }
    }
  }

  if (extents.length === 0) return null

  const minX = Math.min(...extents.map((e) => e.left))
  const maxX = Math.max(...extents.map((e) => e.right))
  const minY = Math.min(...extents.map((e) => e.top))
  const maxY = Math.max(...extents.map((e) => e.bottom))

  return {
    x: minX - padding,
    y: minY - padding - topExtra,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2 + topExtra,
  }
}

/** Painted caption rects of every protection and trunk device, for placing other text clear of them. */
export function collectEendraadDeviceLabelRects(
  panelLayout: BottomUpPanelLayout
): EendraadFrameBounds[] {
  const trunkDevices = new Map(
    panelLayout.circuits
      .flatMap((circuitLayout) => circuitLayout.circuit.trunkDevices ?? [])
      .map((device) => [device.id, device] as const)
  )
  type PositionedDevice = {
    device: ProtectionDevice | TrunkDevice | undefined
    x: number
    y: number
    supply?: boolean
  }
  const positioned: PositionedDevice[] = [
    ...panelLayout.elements.flatMap((element): PositionedDevice[] => {
      if ((element.type === 'protection' || element.type === 'rcd') && element.protectionId) {
        return [
          {
            device: findProtectionInPanel(panelLayout, element.protectionId),
            x: element.position.x,
            y: element.position.y,
          },
        ]
      }
      if (element.type === 'trunkDevice' && element.trunkDeviceId) {
        return [
          { device: trunkDevices.get(element.trunkDeviceId), x: element.position.x, y: element.position.y },
        ]
      }
      return []
    }),
    ...(panelLayout.supplyDevices ?? []).map(({ device, x, y }) => ({ device, x, y, supply: true })),
  ]
  return positioned.flatMap(({ device, x, y, supply }) => {
    const extents = protectionLikeLabelExtents(
      device,
      x,
      y,
      supply ? supplyDeviceLabelPosition(device as TrunkDevice) : undefined
    )
    return extents
      ? [
          {
            x: extents.left,
            y: extents.top,
            width: extents.right - extents.left,
            height: extents.bottom - extents.top,
          },
        ]
      : []
  })
}

/** Extra top padding when a one-wire frame's title is inside, so it doesn't overlap symbols. */
export const ONE_WIRE_FRAME_TITLE_INSIDE_TOP_PADDING = 14
const ONE_WIRE_FRAME_TITLE_OUTSIDE_GAP = 3

/** Painted box of a user-drawn one-wire frame, shared by the canvas and the note layout. */
export function computeOneWireFrameBounds(
  frame: Frame,
  items: ResolvedFrameItem[],
  panelLayout: BottomUpPanelLayout,
  getEndpointById: (id: string) => Endpoint | undefined
): EendraadFrameBounds | null {
  const titleInside = (frame.titlePosition || 'inside') === 'inside' && !!frame.title
  return computeEendraadFrameBounds({
    items,
    panelLayout,
    getEndpointById,
    topExtra: titleInside ? ONE_WIRE_FRAME_TITLE_INSIDE_TOP_PADDING + frame.fontSize : 0,
    includeEndpointLabels: false,
  })
}

/** Top of the frame's title text: inset inside the box, or just above it. */
export function getOneWireFrameTitleY(frame: Frame, bounds: EendraadFrameBounds): number {
  return (frame.titlePosition || 'inside') === 'outside'
    ? bounds.y - frame.fontSize - ONE_WIRE_FRAME_TITLE_OUTSIDE_GAP
    : bounds.y + 4
}

const DOMOTICA_ROW_LABEL_LINE_HEIGHT = PROTECTION_LABEL_FONT_SIZE + 4

/** Painted extents of domotica output row labels ("T6.1"), keyed by endpoint id. */
function domoticaRowLabelRects(
  panelLayout: BottomUpPanelLayout
): Map<string, { left: number; right: number; top: number; bottom: number }> {
  return new Map(
    collectDomoticaRowLabelPlacements(panelLayout).map((placement) => [
      placement.endpointId,
      {
        left: placement.x,
        right:
          placement.x +
          measureSymbolLabelTextWidth(placement.text, 'Figtree', PROTECTION_LABEL_FONT_SIZE),
        top: placement.y - DOMOTICA_ROW_LABEL_LINE_HEIGHT / 2,
        bottom: placement.y + DOMOTICA_ROW_LABEL_LINE_HEIGHT / 2,
      },
    ])
  )
}

/** Painted domotica output row labels, for placing other text clear of them. */
export function collectDomoticaRowLabelRects(panelLayout: BottomUpPanelLayout): EendraadFrameBounds[] {
  return [...domoticaRowLabelRects(panelLayout).values()].map((rect) => ({
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  }))
}
