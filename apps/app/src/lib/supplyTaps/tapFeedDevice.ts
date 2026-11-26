import type { Circuit, Installation, Panel, PanelGridModuleRef, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { getSupplyTapUpstreamDevices } from './upstreamTrunkDevices'
import { getSupplyTapsPanel, isSupplyTapsPanel } from './virtualPanel'

/**
 * Owner supply devices upstream of a tap, in supply order, including the installation's shared
 * feed. The owner's root feed is the one holding the anchor device, else its first feed.
 */
export function getSupplyTapUpstreamDevicesForOwner(
  installation: Pick<Installation, 'feedTopology' | 'mainSupply'>,
  ownerPanelId: string,
  anchor: SupplyTapAnchor
): TrunkDevice[] {
  const topology = installation.feedTopology
  const feeds = (topology?.rootFeeds ?? []).filter((feed) => feed.panelId === ownerPanelId)
  const feed =
    feeds.find((candidate) =>
      (candidate.trunkDevices ?? []).some((device) => device.id === anchor.afterTrunkDeviceId)
    ) ?? feeds[0]
  return getSupplyTapUpstreamDevices(
    topology?.sharedFeed.trunkDevices ?? installation.mainSupply.supplyTrunkDevices,
    feed?.trunkDevices,
    anchor
  )
}

/** The supply device a tap is wired from: the nearest device upstream of its anchor. */
export function getSupplyTapFeedDevice(
  installation: Pick<Installation, 'feedTopology' | 'mainSupply'>,
  ownerPanelId: string,
  anchor: SupplyTapAnchor
): TrunkDevice | undefined {
  return getSupplyTapUpstreamDevicesForOwner(installation, ownerPanelId, anchor).at(-1)
}

/** First panel module of an unprotected tap circuit, when it has one. */
function firstCircuitModule(circuit: Circuit): PanelGridModuleRef | undefined {
  const first = [...(circuit.trunkDevices ?? [])].sort(
    (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
  )[0]
  return first ? { kind: 'trunkDevice', id: first.id, scope: 'circuit', circuitId: circuit.id } : undefined
}

/**
 * Panel modules that a supply device feeds directly as supply taps: tap breakers, and the first
 * module of unprotected tap circuits, whose nearest upstream device is `deviceId`.
 */
export function getSupplyTapModulesFedByDevice(
  installation: Pick<Installation, 'feedTopology' | 'mainSupply'>,
  panels: readonly Panel[],
  deviceId: string
): PanelGridModuleRef[] {
  const refs: PanelGridModuleRef[] = []
  const visit = (panel: Panel) => {
    const taps = isSupplyTapsPanel(panel) ? undefined : getSupplyTapsPanel(panel)
    if (taps) {
      const fedHere = (anchor: SupplyTapAnchor | undefined) =>
        anchor != null && getSupplyTapFeedDevice(installation, panel.id, anchor)?.id === deviceId
      for (const protection of taps.protections)
        if (fedHere(protection.supplyTap)) refs.push({ kind: 'protection', id: protection.id })
      for (const circuit of taps.circuits) {
        const module = fedHere(circuit.supplyTap) ? firstCircuitModule(circuit) : undefined
        if (module) refs.push(module)
      }
    }
    for (const child of panel.subPanels ?? []) visit(child)
  }
  panels.forEach(visit)
  return refs
}

/** The supply device a top-level tap breaker is wired from, given the panels of its project. */
export function getSupplyTapProtectionFeedDevice(
  installation: Pick<Installation, 'feedTopology' | 'mainSupply'>,
  panels: readonly Panel[],
  protection: ProtectionDevice
): TrunkDevice | undefined {
  if (!protection.supplyTap) return undefined
  const findOwner = (list: readonly Panel[]): Panel | undefined => {
    for (const panel of list) {
      if (getSupplyTapsPanel(panel)?.protections.some((item) => item.id === protection.id)) return panel
      const nested = findOwner(panel.subPanels ?? [])
      if (nested) return nested
    }
    return undefined
  }
  const owner = findOwner(panels)
  return owner ? getSupplyTapFeedDevice(installation, owner.id, protection.supplyTap) : undefined
}

/**
 * The supply device the first module of a tap without a breaker (a meter on a bare tap circuit)
 * is wired from, when `ref` is that module.
 */
export function getSupplyTapModuleFeedDevice(
  installation: Pick<Installation, 'feedTopology' | 'mainSupply'>,
  panels: readonly Panel[],
  ref: PanelGridModuleRef
): TrunkDevice | undefined {
  if (ref.kind !== 'trunkDevice' || ref.scope !== 'circuit' || !ref.circuitId) return undefined
  const visit = (list: readonly Panel[]): TrunkDevice | undefined => {
    for (const panel of list) {
      const circuit = getSupplyTapsPanel(panel)?.circuits.find((item) => item.id === ref.circuitId)
      const first = circuit ? firstCircuitModule(circuit) : undefined
      if (circuit?.supplyTap && first?.kind === 'trunkDevice' && first.id === ref.id)
        return getSupplyTapFeedDevice(installation, panel.id, circuit.supplyTap)
      const nested = visit(panel.subPanels ?? [])
      if (nested) return nested
    }
    return undefined
  }
  return visit(panels)
}
