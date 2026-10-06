import { getPanelInputDeviceStartIndex } from '@/lib/supplyAssembly/electricalTopology'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { PANEL_BUS_FEED_GAP } from '@/lib/panel/panelBusFeedPreview'
import type { Installation, Panel, TrunkDevice } from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

/**
 * Split-feed stub protections may be physically mounted in another main panel.
 * That panel then partly feeds the owner: its one-wire shows a feeder branch
 * (protection, then the fed panel's symbol) tapped from its own supply stub, and
 * the owner's stub names that panel instead of the supply.
 */
export interface FeedStubFeeder {
  /** Panel whose bus section the devices feed. */
  panelId: string
  panelName: string
  busSectionId: string
  busSectionRole: 'normal' | 'backup' | 'custom'
  /** Devices mounted in the hosting panel, in supply-to-bus order. */
  devices: TrunkDevice[]
}

/**
 * Geometry shared by layout reserve, the layout tree and the wires. Like the
 * main bus, the distribution bar takes its supply from below. Its feeder legs
 * stick out to the left of the hosting stub, away from the other stubs, and
 * rise to the fed panel's symbol at the main bus level.
 */
export const FEED_STUB_FEEDER_GEOMETRY = {
  /** Bar below the bus when the hosting stub has no devices of its own. */
  firstTapOffset: 44,
  /** Bar below the lowest own stub device. */
  tapBelowDevice: 50,
  /** Leaves room for a leg's protection text between it and the stub to its right. */
  columnSpacing: 100,
  /** Distribution bar reach past the outer stub and feeder legs. */
  busOverhang: 20,
  protectionRise: 44,
  deviceSpacing: 50,
  panelRise: 50,
  /** Supply leg below the bar before its marker. */
  stubBelowTap: 30,
} as const

/** Bar to bus-level panel symbol height needed by the tallest feeder leg. */
export function getFeedStubFeederLegHeight(feeders: readonly FeedStubFeeder[]): number {
  const g = FEED_STUB_FEEDER_GEOMETRY
  const longest = Math.max(1, ...feeders.map((feeder) => feeder.devices.length))
  return g.protectionRise + (longest - 1) * g.deviceSpacing + g.panelRise
}

function isFeedStubChainDevice(device: TrunkDevice): boolean {
  return device.supplyPath == null || device.supplyPath === 'serial'
}

function slotPanelIdForSupplyDevice(panels: readonly Panel[], deviceId: string): string | undefined {
  for (const panel of panels) {
    if (panel.gridView?.slots.some((slot) =>
      slot.module.kind === 'trunkDevice' && slot.module.id === deviceId &&
      slot.module.scope === 'supply'
    )) return panel.id
    const nested = slotPanelIdForSupplyDevice(panel.subPanels ?? [], deviceId)
    if (nested) return nested
  }
  return undefined
}

/** Physical panel of a panel-side stub device, when it is mounted in a panel. */
export function getFeedStubDeviceMountingPanelId(
  panels: readonly Panel[],
  device: TrunkDevice
): string | undefined {
  if (device.panelMounting) {
    return device.panelMounting.kind === 'panel' ? device.panelMounting.panelId : undefined
  }
  return slotPanelIdForSupplyDevice(panels, device.id)
}

/** Panel-side stub devices of one root feed, nearest the supply first. */
export function getFeedStubChainDevices(
  project: ProjectWithOptionalV2Electrical,
  devices: readonly TrunkDevice[]
): TrunkDevice[] {
  return devices
    .slice(getPanelInputDeviceStartIndex(project, [...devices]))
    .filter(isFeedStubChainDevice)
}

/** Feeders hosted in `host` for other main panels' split-feed stubs. */
export function collectHostedFeedStubFeeders(
  project: ProjectWithOptionalV2Electrical,
  installation: Installation,
  panels: readonly Panel[],
  host: Panel
): FeedStubFeeder[] {
  const topology = ensureInstallationFeedTopology(installation, [...panels])
  const feeders: FeedStubFeeder[] = []
  for (const feed of topology.rootFeeds) {
    if (feed.panelId === host.id) continue
    const owner = panels.find((panel) => panel.id === feed.panelId)
    if (!owner?.busSections?.length) continue
    const hosted = getFeedStubChainDevices(project, feed.trunkDevices ?? [])
      .filter((device) => getFeedStubDeviceMountingPanelId(panels, device) === host.id)
    if (hosted.length === 0) continue
    const busSectionId = feed.busSectionId ?? getPrimaryPanelBusSectionId(owner)
    const section = owner.busSections.find((candidate) => candidate.id === busSectionId)
    feeders.push({
      panelId: owner.id,
      panelName: owner.name,
      busSectionId,
      busSectionRole: section?.role ?? 'normal',
      devices: hosted,
    })
  }
  return feeders
}

/** Panel that feeds a stub because its supply-side device is mounted there. */
export function getFeedStubSourcePanelId(
  project: ProjectWithOptionalV2Electrical,
  panels: readonly Panel[],
  owner: Panel,
  devices: readonly TrunkDevice[]
): string | undefined {
  const supplySide = getFeedStubChainDevices(project, devices)[0]
  if (!supplySide) return undefined
  const mountingPanelId = getFeedStubDeviceMountingPanelId(panels, supplySide)
  return mountingPanelId && mountingPanelId !== owner.id ? mountingPanelId : undefined
}

/** Height below the bus centre needed by a stub's hosted feeder bar and supply leg. */
export function getFeedStubFeederReserve(ownDeviceCount: number, extraLabelHeight: number,
  feeders: readonly FeedStubFeeder[]): number {
  if (feeders.length === 0) return 0
  const g = FEED_STUB_FEEDER_GEOMETRY
  const ownTap = ownDeviceCount === 0
    ? g.firstTapOffset
    : g.firstTapOffset + (ownDeviceCount - 1) * g.deviceSpacing + g.tapBelowDevice + extraLabelHeight
  const tap = Math.max(ownTap, getFeedStubFeederLegHeight(feeders))
  // Supply leg, its marker and caption hang below the bar.
  return tap + g.stubBelowTap + 41 + 12
}

/**
 * Which of the host's bus sections each feeder hangs from: the section that
 * carries the same kind of supply, else the first section.
 */
export function assignHostedFeedStubFeeders(
  host: Panel,
  feeders: readonly FeedStubFeeder[]
): Map<string, FeedStubFeeder[]> {
  const bySection = new Map<string, FeedStubFeeder[]>()
  const sections = host.busSections ?? []
  for (const feeder of feeders) {
    const section =
      sections.find((candidate) => (candidate.role ?? 'normal') === feeder.busSectionRole) ??
      sections[0]
    if (!section) continue
    bySection.set(section.id, [...(bySection.get(section.id) ?? []), feeder])
  }
  return bySection
}

/** Columns shift right by this much before a later section hosting feeders. */
export function getHostedFeederColumnShift(feederCount: number): number {
  return feederCount > 0
    ? FEED_STUB_FEEDER_GEOMETRY.columnSpacing * feederCount + 50
    : 0
}

/**
 * Bus cut before the first run of a later section that hosts feeders. That
 * run starts close to its first circuit and the previous run ends early,
 * leaving a gap for the feeder legs and the fed panels' symbols at bus level.
 */
export function applyHostedFeederSectionCut(
  cut: { leftEndX: number; rightStartX: number },
  previousX: number,
  rightFirstX: number,
  feederCount: number
): { leftEndX: number; rightStartX: number } {
  if (feederCount === 0) return cut
  const rightStartX = Math.max(cut.rightStartX, rightFirstX - 30)
  // Host stub sits about 20 px into its run; the panels stand a column apart
  // to its left, each needing its symbol and a little clearance.
  const gap = FEED_STUB_FEEDER_GEOMETRY.columnSpacing * feederCount + 22
  const leftEndX = Math.max(
    previousX + PANEL_BUS_FEED_GAP / 2,
    Math.min(cut.leftEndX, rightStartX - gap)
  )
  return { leftEndX, rightStartX }
}
