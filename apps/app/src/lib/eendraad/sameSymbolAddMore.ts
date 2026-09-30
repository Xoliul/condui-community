import type { Endpoint, TrunkDevice } from '@/types/schema'
import { getSymbolById } from '@/lib/symbols'
import { getHitZoneBounds } from '@/lib/layout/findDropTarget'
import { DOMOTICA_BOX_WIDTH } from '@/lib/domoticaLayout'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'
import type { Point } from '@/types/ui'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import {
  getSupplyDeviceMultiplier,
  supportsSupplyDeviceMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'
import { isModularSocket, isModularSocketLibraryId } from '@/lib/socket/modularSocket'
import {
  applyLibraryPresetToEndpoint,
  getEndpointTypeFromSymbol,
  getSymbolKeyFromSymbol,
} from '@/utils/symbolMapping'
import {
  getMultiplierBadgePosition,
  getMultiplierBadgeWidth,
  MULTIPLIER_BADGE_HEIGHT,
} from './multiplierBadgeGeometry'

export type SameSymbolAddMoreTarget =
  | { endpoint: Endpoint; trunkDevice?: never }
  | { endpoint?: never; trunkDevice: TrunkDevice }

export interface SameSymbolAddMoreDeps {
  syncEndpointCount: (endpointId: string, count: number) => boolean
  syncSupplyDeviceCount: (deviceId: string, count: number) => boolean
}

export interface SameSymbolAddMoreUndoDeps extends SameSymbolAddMoreDeps {
  withSingleUndoEntry: (fn: () => boolean, options?: { sessionLabel?: string }) => boolean
}

export type SameSymbolAddMoreResult = 'not-applicable' | 'incremented' | 'blocked'

const ENDPOINT_SETTING_FIELDS = [
  'relayProps',
  'smokeDetectorProps',
  'motionDetectorProps',
  'energyMeterProps',
  'socketProps',
  'switchProps',
  'lightPointProps',
  'lightSpotProps',
  'lightFluorescentProps',
  'fixedApplianceProps',
  'solarPanelProps',
  'batteryProps',
  'evChargerProps',
  'hvacProps',
  'energyConversionProps',
] as const

function normalizeSetting(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSetting)
  if (value && typeof value === 'object') {
    const normalized = Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, normalizeSetting(entry)] as const)
        .filter(([, entry]) => entry !== undefined)
    )
    return Object.keys(normalized).length > 0 ? normalized : undefined
  }
  // These are the implicit defaults used by endpoint property editors.
  if (value === false || value === 1) return undefined
  return value
}

function getEndpointMergeSettings(endpoint: Endpoint): string {
  const settings = Object.fromEntries(
    ENDPOINT_SETTING_FIELDS.map((field) => [field, normalizeSetting(endpoint[field])])
      .filter(([, value]) => value !== undefined)
  )
  return JSON.stringify({ symbol: endpoint.symbol, settings })
}

function getDefaultEndpointForLibrarySymbol(symbolId: string): Endpoint | null {
  const symbol = getSymbolById(symbolId)
  const type = symbol && getEndpointTypeFromSymbol(symbol)
  if (!symbol || !type) return null

  const endpoint: Endpoint = {
    id: '',
    type,
    label: '',
    symbol: getSymbolKeyFromSymbol(symbol),
    placements: [],
  }
  applyLibraryPresetToEndpoint(symbol, endpoint)
  return endpoint
}

/** Settings on an existing endpoint must match the library item before a drop can merge into it. */
export function endpointMergeSettingsMatchLibrarySymbol(
  symbolId: string,
  endpoint: Endpoint
): boolean {
  const incoming = getDefaultEndpointForLibrarySymbol(symbolId)
  return !!incoming && getEndpointMergeSettings(endpoint) === getEndpointMergeSettings(incoming)
}

export function endpointMergeSettingsMatchEndpoints(
  left: Endpoint,
  right: Endpoint
): boolean {
  return getEndpointMergeSettings(left) === getEndpointMergeSettings(right)
}

export function endpointsShareMergeFamily(left: Endpoint, right: Endpoint): boolean {
  return left.symbol === right.symbol || (left.type === 'socket' && right.type === 'socket')
}

/** A same-symbol or socket-variant drop onto a Domotica output cannot replace differing settings. */
export function isConflictingOnSymbolDrop(symbolId: string, endpoint: Endpoint): boolean {
  const incoming = getDefaultEndpointForLibrarySymbol(symbolId)
  if (!incoming) return false
  const sameMergeFamily =
    endpoint.symbol === incoming.symbol ||
    (endpoint.type === 'socket' && incoming.type === 'socket')
  return sameMergeFamily && getEndpointMergeSettings(endpoint) !== getEndpointMergeSettings(incoming)
}

function droppedSymbolMatchesEndpoint(droppedSymbolId: string, endpoint: Endpoint): boolean {
  // Sockets use a count in properties, never the drop-to-multiply badge.
  // Modular sockets share socket_gnd_child with wall sockets and must not match them.
  if (endpoint.type === 'socket') return false
  if (isModularSocket(endpoint) || isModularSocketLibraryId(droppedSymbolId)) return false
  return endpoint.symbol === droppedSymbolId
}

function hasSameSymbolButDifferentSettings(droppedSymbolId: string, endpoint: Endpoint): boolean {
  return droppedSymbolMatchesEndpoint(droppedSymbolId, endpoint) &&
    !endpointMergeSettingsMatchLibrarySymbol(droppedSymbolId, endpoint)
}

export function canIncrementSameSymbolAddMoreTarget(
  droppedSymbolId: string,
  target: SameSymbolAddMoreTarget
): boolean {
  if (target.endpoint) {
    return (
      droppedSymbolMatchesEndpoint(droppedSymbolId, target.endpoint) &&
      endpointMergeSettingsMatchLibrarySymbol(droppedSymbolId, target.endpoint) &&
      endpointSupportsMultiplier(target.endpoint)
    )
  }
  return (
    target.trunkDevice.symbol === droppedSymbolId &&
    supportsSupplyDeviceMultiplier(target.trunkDevice)
  )
}

export interface SameSymbolAddMoreLayoutTarget {
  nodeId: string
  target: SameSymbolAddMoreTarget
  center: Point
  badgePosition: Point
  outline: { x: number; y: number; width: number; height: number; cornerRadius: number }
}

const SAME_SYMBOL_PREVIEW_SIZE = 24
function getTargetMultiplier(target: SameSymbolAddMoreTarget): number {
  if (target.endpoint) return getEndpointMultiplier(target.endpoint)
  return getSupplyDeviceMultiplier(target.trunkDevice)
}

function multiplierBadgePosition(
  bounds: ReturnType<typeof getHitZoneBounds>,
  count: number
): Point {
  // Layout nodes use center-based bounds for symbols. Their top-right corner
  // is therefore the same anchor used by the rendered multiplier badge.
  return getMultiplierBadgePosition({ x: bounds.right, y: bounds.top }, count)
}

function getMultiplierBadgeBounds(node: LayoutNode): ReturnType<typeof getHitZoneBounds> {
  const endpoint = node.type === 'endpoint' ? (node.domainRef as Endpoint | undefined) : undefined
  if (endpoint?.domoticaChildProps) {
    // The child endpoint node includes layout spacing for its label, while the
    // rendered badge is anchored to the compact symbol itself.
    return {
      left: node.bounds.x - DOMOTICA_BOX_WIDTH / 2,
      top: node.bounds.y - DOMOTICA_BOX_WIDTH / 2,
      right: node.bounds.x + DOMOTICA_BOX_WIDTH / 2,
      bottom: node.bounds.y + DOMOTICA_BOX_WIDTH / 2,
    }
  }
  return getHitZoneBounds(node, 'core')
}

function supportsSameSymbolTarget(
  symbolId: string,
  node: LayoutNode
): SameSymbolAddMoreTarget | null {
  if (node.type === 'endpoint') {
    const endpoint = node.domainRef as Endpoint | undefined
    if (!endpoint) return null
    if (!droppedSymbolMatchesEndpoint(symbolId, endpoint)) return null
    if (!endpointSupportsMultiplier(endpoint)) return null
    return { endpoint }
  }
  if (node.type === 'trunkDevice') {
    const trunkDevice = node.domainRef as TrunkDevice | undefined
    if (
      !trunkDevice ||
      trunkDevice.symbol !== symbolId ||
      !supportsSupplyDeviceMultiplier(trunkDevice)
    ) {
      return null
    }
    return { trunkDevice }
  }
  return null
}

/** Find multiplier-capable symbols themselves, rather than their surrounding wire hit zones. */
export function findSameSymbolAddMoreLayoutTargets(
  symbolId: string,
  layoutTree: LayoutTree,
  position?: Point
): SameSymbolAddMoreLayoutTarget[] {
  const matches: SameSymbolAddMoreLayoutTarget[] = []
  const visit = (node: LayoutNode) => {
    const target = supportsSameSymbolTarget(symbolId, node)
    if (target) {
      const bounds = getMultiplierBadgeBounds(node)
      const center = {
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2,
      }
      const badgePosition = multiplierBadgePosition(bounds, getTargetMultiplier(target))
      const outline = {
        x: center.x - SAME_SYMBOL_PREVIEW_SIZE / 2,
        y: center.y - SAME_SYMBOL_PREVIEW_SIZE / 2,
        width: SAME_SYMBOL_PREVIEW_SIZE,
        height: SAME_SYMBOL_PREVIEW_SIZE,
        cornerRadius: 5,
      }
      const isHit =
        !position ||
        (position.x >= outline.x &&
          position.x <= outline.x + outline.width &&
          position.y >= outline.y &&
          position.y <= outline.y + outline.height)
      if (isHit) {
        matches.push({
          nodeId: node.id,
          target,
          center,
          badgePosition,
          outline,
        })
      }
    }
    node.children.forEach(visit)
  }
  layoutTree.panels.forEach(visit)
  return matches
}

/** Multiplier text is an editor control, never a library drop target. */
export function positionHitsMultiplierBadge(layoutTree: LayoutTree, position: Point): boolean {
  let hit = false
  const visit = (node: LayoutNode) => {
    if (hit) return
    const endpoint = node.type === 'endpoint' ? (node.domainRef as Endpoint | undefined) : undefined
    const trunkDevice =
      node.type === 'trunkDevice' ? (node.domainRef as TrunkDevice | undefined) : undefined
    const target = endpoint
      ? supportsSameSymbolTarget(endpoint.symbol ?? '', node)
      : trunkDevice
        ? supportsSameSymbolTarget(trunkDevice.symbol, node)
        : null
    if (target) {
      const count = getTargetMultiplier(target)
      if (count > 1) {
        const bounds = getMultiplierBadgeBounds(node)
        const badge = multiplierBadgePosition(bounds, count)
        const width = getMultiplierBadgeWidth(count)
        hit =
          position.x >= badge.x - 1 &&
          position.x <= badge.x + width + 1 &&
          position.y >= badge.y - 1 &&
          position.y <= badge.y + MULTIPLIER_BADGE_HEIGHT + 1
      }
    }
    node.children.forEach(visit)
  }
  layoutTree.panels.forEach(visit)
  return hit
}

/** Increment an existing entity only when the dropped symbol is one of its supported multipliers. */
export function incrementSameSymbolAddMoreTarget(
  droppedSymbolId: string,
  target: SameSymbolAddMoreTarget,
  deps: SameSymbolAddMoreDeps
): SameSymbolAddMoreResult {
  if (target.endpoint && hasSameSymbolButDifferentSettings(droppedSymbolId, target.endpoint)) {
    return 'blocked'
  }
  if (!canIncrementSameSymbolAddMoreTarget(droppedSymbolId, target)) return 'not-applicable'
  if (target.endpoint) {
    const endpoint = target.endpoint
    return deps.syncEndpointCount(endpoint.id, getEndpointMultiplier(endpoint) + 1)
      ? 'incremented'
      : 'blocked'
  }

  const device = target.trunkDevice
  return deps.syncSupplyDeviceCount(device.id, getSupplyDeviceMultiplier(device) + 1)
    ? 'incremented'
    : 'blocked'
}

/** Avoid paying for a whole-project history snapshot unless this drop can add a multiplier. */
export function incrementSameSymbolAddMoreTargetWithUndo(
  droppedSymbolId: string,
  target: SameSymbolAddMoreTarget | null,
  deps: SameSymbolAddMoreUndoDeps
): SameSymbolAddMoreResult {
  if (target?.endpoint && hasSameSymbolButDifferentSettings(droppedSymbolId, target.endpoint)) {
    return 'blocked'
  }
  if (!target || !canIncrementSameSymbolAddMoreTarget(droppedSymbolId, target)) {
    return 'not-applicable'
  }

  let result: SameSymbolAddMoreResult = 'not-applicable'
  deps.withSingleUndoEntry(
    () => {
      result = incrementSameSymbolAddMoreTarget(droppedSymbolId, target, deps)
      return result === 'incremented'
    },
    { sessionLabel: 'add more by dropping same symbol' }
  )
  return result
}
