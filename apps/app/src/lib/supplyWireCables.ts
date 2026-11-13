import type { CableSpec, Installation, Panel, Point2, TrunkDevice, WireSegment } from '@/types/schema'
import { createDefaultSupplyCable } from '@/lib/electrical/supplyCable'
import {
  collectRootPanels,
  getPanelFeedProjection,
  getSupplyWireHideWireLabelForRole,
  getSupplyWireLengthMForRole,
  getSupplyWireShowFireClassLabelForRole,
  getSupplyWireShowWireLengthLabelForRole,
  type SupplyFeedScope,
  type SupplyWireRole,
} from '@/lib/feedTopology'

export type { SupplyWireRole } from '@/lib/feedTopology'

/** Match dashed separator X on the eendraad supply trunk (see EendraadCanvas.getSupplySeparatorForPanelLayout). */
export function computeSupplySeparatorX(
  devicePositions: Array<{ x: number; feedScope: SupplyFeedScope }>,
  supplyEndX: number,
  bendX: number,
): number | null {
  const sorted = [...devicePositions].sort((a, b) => a.x - b.x)
  const rootDevices = sorted.filter((d) => d.feedScope === 'root')
  const sharedDevices = sorted.filter((d) => d.feedScope === 'shared')
  const rightmostRoot = rootDevices[rootDevices.length - 1]
  const leftmostShared = sharedDevices[0]

  if (!leftmostShared) {
    if (!rightmostRoot) return (bendX + supplyEndX) / 2
    return (rightmostRoot.x + supplyEndX) / 2
  }
  if (!rightmostRoot) return (bendX + leftmostShared.x) / 2
  return (rightmostRoot.x + leftmostShared.x) / 2
}

/** Utility / supply-panel side (from supply symbol through shared trunk devices). */
export function getSupplyUpstreamCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): CableSpec {
  const projection = getPanelFeedProjection(installation, panels, panel)
  return projection?.sharedFeed.cable ?? installation.mainSupply.cable ?? createDefaultSupplyCable(installation.nominalVoltage.system)
}

/** Short segment at the dashed shared/root separator. */
export function getSupplyCrossingCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): CableSpec {
  return (
    installation.mainSupply.crossingCable ??
    getSupplyUpstreamCable(installation, panels, panel)
  )
}

/** Main-panel side (root trunk devices and vertical run to the bus). */
export function getSupplyDownstreamCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): CableSpec {
  const projection = getPanelFeedProjection(installation, panels, panel)
  const soleMain = collectRootPanels(panels).length === 1
  if (soleMain && installation.mainSupply.rootCable) {
    return installation.mainSupply.rootCable
  }
  return (
    projection?.rootFeed?.cable ??
    projection?.cable ??
    installation.mainSupply.cable ??
    createDefaultSupplyCable(installation.nominalVoltage.system)
  )
}

export function cableForSupplyWireRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): CableSpec {
  switch (role) {
    case 'upstream':
      return getSupplyUpstreamCable(installation, panels, panel)
    case 'crossing':
      return getSupplyCrossingCable(installation, panels, panel)
    case 'downstream':
      return getSupplyDownstreamCable(installation, panels, panel)
  }
}

export function resolveSupplyFeedScopeForDeviceId(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  deviceId: string,
): SupplyFeedScope {
  const projection = getPanelFeedProjection(installation, panels, panel)
  const sharedIds = new Set((projection?.sharedFeed.trunkDevices ?? []).map((d) => d.id))
  if (sharedIds.has(deviceId)) return 'shared'
  return 'root'
}

/**
 * Side of the dashed panel boundary a supply device sits on. A device on the board's own feed
 * that is mounted in the supply panel (for example a per-output breaker in the transformer
 * cabin) is upstream of the board, like the shared feed.
 */
export function resolveSupplySeparatorScope(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  deviceId: string,
  device: Pick<TrunkDevice, 'panelMounting'> | undefined,
): SupplyFeedScope {
  const scope = resolveSupplyFeedScopeForDeviceId(installation, panels, panel, deviceId)
  return scope === 'root' && device?.panelMounting?.kind === 'grid' ? 'shared' : scope
}

type HorizontalSpan = { x1: number; x2: number; role: SupplyWireRole }

/** Waypoint kinds along the supply trunk when assigning wire roles. */
export type SupplySpanEndpoint = SupplyFeedScope | 'bend' | 'supply'

export function supplyEndpointRole(endpoint: SupplySpanEndpoint): SupplyWireRole {
  if (endpoint === 'bend') return 'downstream'
  if (endpoint === 'supply') return 'upstream'
  return endpoint === 'shared' ? 'upstream' : 'downstream'
}

/**
 * Assign one wire role to a horizontal span between two trunk waypoints.
 * When the span crosses the dashed separator (root ↔ shared), it is a single
 * crossing segment — not three micro-segments at the line.
 */
export function splitHorizontalSpanAtSeparator(
  x1: number,
  x2: number,
  separatorX: number | null,
  fromEndpoint?: SupplySpanEndpoint,
  toEndpoint?: SupplySpanEndpoint,
): HorizontalSpan[] {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)

  if (fromEndpoint != null && toEndpoint != null) {
    const fromRole = supplyEndpointRole(fromEndpoint)
    const toRole = supplyEndpointRole(toEndpoint)
    if (fromRole === toRole) {
      return [{ x1: left, x2: right, role: fromRole }]
    }
    return [{ x1: left, x2: right, role: 'crossing' }]
  }

  if (separatorX == null || right - left < 0.5) {
    const role: SupplyWireRole = separatorX == null ? 'upstream' : 'downstream'
    return [{ x1: left, x2: right, role }]
  }

  const leftRole: SupplyWireRole = left <= separatorX ? 'downstream' : 'upstream'
  const rightRole: SupplyWireRole = right <= separatorX ? 'downstream' : 'upstream'
  if (leftRole === rightRole) {
    return [{ x1: left, x2: right, role: leftRole }]
  }

  return [{ x1: left, x2: right, role: 'crossing' }]
}

export function applySupplyWireRoleToSegment(
  segment: WireSegment,
  role: SupplyWireRole,
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): void {
  segment.supplyWireRole = role
  segment.cable = cableForSupplyWireRole(installation, panels, panel, role)
  segment.hideWireLabel = getSupplyWireHideWireLabelForRole(
    installation,
    panels,
    panel,
    role,
  )
  segment.showFireClassLabel =
    getSupplyWireShowFireClassLabelForRole(installation, panels, panel, role) === true
  segment.wireLengthM = getSupplyWireLengthMForRole(installation, panels, panel, role)
  segment.showWireLengthLabel =
    getSupplyWireShowWireLengthLabelForRole(installation, panels, panel, role) === true
  if (role === 'upstream') {
    segment.supplyFeedScope = 'shared'
  } else if (role === 'downstream') {
    segment.supplyFeedScope = 'root'
  }
}

export function isSupplyWireSegment(segment: WireSegment): boolean {
  return (
    (segment.type === 'vertical' && !segment.circuitId && !segment.fromElementType) ||
    segment.isSupplyTrunk === true
  )
}

/** True when the user explicitly chose a conductor count without PE/G (e.g. 3 or 4, not 3G). */
export function cableExplicitlyWithoutPe(cable: CableSpec | undefined): boolean {
  return cable != null && cable.hasPE === false
}

/** True when any supply trunk device sits strictly between two x positions on the horizontal run. */
export function hasSupplyTrunkDeviceBetween(
  devicePositions: Array<{ x: number; feedScope: SupplyFeedScope }>,
  x1: number,
  x2: number,
): boolean {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  return devicePositions.some((d) => d.x > left + 0.5 && d.x < right - 0.5)
}

/**
 * When there is no protection on the horizontal path between the bend and the dashed separator,
 * the crossing span and the vertical bus drop are one continuous downstream run.
 */
export function shouldMergeSupplyCrossingWithBusDrop(
  bendX: number,
  separatorX: number | null,
  devicePositions: Array<{ x: number; feedScope: SupplyFeedScope }>,
): boolean {
  if (separatorX == null) return true
  return !hasSupplyTrunkDeviceBetween(devicePositions, bendX, separatorX)
}

export function supplyWirePointOnSegment(segment: WireSegment): Point2 {
  if (segment.supplyWireRole === 'crossing') {
    return {
      x: (segment.startPoint.x + segment.endPoint.x) / 2,
      y: segment.startPoint.y,
    }
  }
  return segment.startPoint
}
