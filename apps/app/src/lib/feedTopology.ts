import type {
  CableSpec,
  FeedTopology,
  Installation,
  Panel,
  RootPanelFeedPath,
  SharedFeedPath,
  TrunkDevice,
} from '@/types/schema'
import { nanoid } from 'nanoid'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'

export type SupplyFeedScope = 'shared' | 'root'

type FeedTopologyCacheEntry = {
  panels: Panel[]
  topologySource: FeedTopology | undefined
  mainSupply: Installation['mainSupply']
  mainSupplyCable: CableSpec
  mainSupplyOrigin: Installation['mainSupply']['origin']
  mainSupplyHideWireLabel: boolean | undefined
  mainSupplyDevices: TrunkDevice[] | undefined
  mainSupplyDeviceLength: number
  mainSupplyDevicePositions: number[]
  mainSupplySegmentCables: Installation['mainSupply']['supplyTrunkSegmentCables']
  rootFeeds: FeedTopology['rootFeeds'] | undefined
  rootFeedLength: number
  rootFeedCableRefs: Array<CableSpec | undefined>
  rootFeedDeviceRefs: Array<TrunkDevice[] | undefined>
  rootFeedDeviceLengths: number[]
  rootFeedDevicePositions: number[][]
  sharedFeed: FeedTopology['sharedFeed'] | undefined
  sharedFeedDevices: TrunkDevice[] | undefined
  panelLength: number
  panelRefs: Panel[]
  panelIds: string[]
  panelMainFlags: Array<boolean | undefined>
  panelPrimaryBusSectionIds: Array<string | undefined>
  panelBusSectionRefs: Array<Panel['busSections']>
  result: FeedTopology
}

/**
 * Topology projection is read extremely often by layout, wire, phase and canvas code.
 * Keep one result per immutable installation revision. The lightweight guards below
 * also notice the in-place edits used by import/migration code before reusing it.
 */
const feedTopologyCache = new WeakMap<Installation, FeedTopologyCacheEntry>()

function trunkPositionsMatch(
  devices: TrunkDevice[] | undefined,
  length: number,
  positions: number[]
): boolean {
  if ((devices?.length ?? 0) !== length) return false
  for (let index = 0; index < length; index += 1) {
    if (devices?.[index]?.trunkPosition !== positions[index]) return false
  }
  return true
}

function cachedTopologyMatches(
  entry: FeedTopologyCacheEntry,
  installation: Installation,
  panels: Panel[]
): boolean {
  const mainSupply = installation.mainSupply
  const topology = installation.feedTopology
  if (
    entry.panels !== panels ||
    entry.topologySource !== topology ||
    entry.mainSupply !== mainSupply ||
    entry.mainSupplyCable !== mainSupply.cable ||
    entry.mainSupplyOrigin !== mainSupply.origin ||
    entry.mainSupplyHideWireLabel !== mainSupply.hideWireLabel ||
    entry.mainSupplyDevices !== mainSupply.supplyTrunkDevices ||
    entry.mainSupplySegmentCables !== mainSupply.supplyTrunkSegmentCables ||
    entry.rootFeeds !== topology?.rootFeeds ||
    entry.sharedFeed !== topology?.sharedFeed ||
    entry.sharedFeedDevices !== topology?.sharedFeed.trunkDevices ||
    entry.panelLength !== panels.length ||
    entry.rootFeedLength !== (topology?.rootFeeds.length ?? 0) ||
    !trunkPositionsMatch(
      mainSupply.supplyTrunkDevices,
      entry.mainSupplyDeviceLength,
      entry.mainSupplyDevicePositions
    )
  ) {
    return false
  }

  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index]
    if (
      entry.panelRefs[index] !== panel ||
      entry.panelIds[index] !== panel?.id ||
      entry.panelMainFlags[index] !== panel?.isMain ||
      entry.panelPrimaryBusSectionIds[index] !== panel?.primaryBusSectionId ||
      entry.panelBusSectionRefs[index] !== panel?.busSections
    ) {
      return false
    }
  }

  for (let index = 0; index < entry.rootFeedLength; index += 1) {
    const feed = topology?.rootFeeds[index]
    if (
      entry.rootFeedCableRefs[index] !== feed?.cable ||
      entry.rootFeedDeviceRefs[index] !== feed?.trunkDevices ||
      !trunkPositionsMatch(
        feed?.trunkDevices,
        entry.rootFeedDeviceLengths[index] ?? 0,
        entry.rootFeedDevicePositions[index] ?? []
      )
    ) {
      return false
    }
  }
  return true
}

function rememberFeedTopology(
  installation: Installation,
  panels: Panel[],
  result: FeedTopology
): FeedTopology {
  const topologySource = installation.feedTopology
  const rootFeeds = topologySource?.rootFeeds
  const mainSupplyDevices = installation.mainSupply.supplyTrunkDevices
  feedTopologyCache.set(installation, {
    panels,
    topologySource,
    mainSupply: installation.mainSupply,
    mainSupplyCable: installation.mainSupply.cable,
    mainSupplyOrigin: installation.mainSupply.origin,
    mainSupplyHideWireLabel: installation.mainSupply.hideWireLabel,
    mainSupplyDevices,
    mainSupplyDeviceLength: mainSupplyDevices?.length ?? 0,
    mainSupplyDevicePositions: mainSupplyDevices?.map((device) => device.trunkPosition) ?? [],
    mainSupplySegmentCables: installation.mainSupply.supplyTrunkSegmentCables,
    rootFeeds,
    rootFeedLength: rootFeeds?.length ?? 0,
    rootFeedCableRefs: rootFeeds?.map((feed) => feed.cable) ?? [],
    rootFeedDeviceRefs: rootFeeds?.map((feed) => feed.trunkDevices) ?? [],
    rootFeedDeviceLengths: rootFeeds?.map((feed) => feed.trunkDevices?.length ?? 0) ?? [],
    rootFeedDevicePositions:
      rootFeeds?.map((feed) => feed.trunkDevices?.map((device) => device.trunkPosition) ?? []) ?? [],
    sharedFeed: topologySource?.sharedFeed,
    sharedFeedDevices: topologySource?.sharedFeed.trunkDevices,
    panelLength: panels.length,
    panelRefs: [...panels],
    panelIds: panels.map((panel) => panel.id),
    panelMainFlags: panels.map((panel) => panel.isMain),
    panelPrimaryBusSectionIds: panels.map((panel) => panel.primaryBusSectionId),
    panelBusSectionRefs: panels.map((panel) => panel.busSections),
    result,
  })
  return result
}

export function collectRootPanels(panels: Panel[]): Panel[] {
  return panels.filter((panel) => panel.isMain !== false)
}

function normalizeTrunkDevicePositions(devices: TrunkDevice[] | undefined): TrunkDevice[] {
  if (!devices) return []
  let changed = false
  const normalized = devices.map((device, index) => {
    if ((device.trunkPosition ?? 0) === index) return device
    changed = true
    return {
      ...device,
      trunkPosition: index,
    }
  })
  return changed ? normalized : devices
}

function cablesEqual(a: CableSpec | undefined, b: CableSpec | undefined): boolean {
  if (!a || !b) return false
  return (
    a.kind === b.kind &&
    a.conductors === b.conductors &&
    a.sectionMm2 === b.sectionMm2 &&
    (a.hasPE ?? false) === (b.hasPE ?? false) &&
    (a.notes ?? '') === (b.notes ?? '')
  )
}

function buildSharedFeedFromLegacyMainSupply(installation: Installation, connectorId: string): SharedFeedPath {
  const mainSupply = installation.mainSupply
  const trunkDevices = normalizeTrunkDevicePositions(mainSupply.supplyTrunkDevices)
  return {
    id: `shared-feed-${connectorId}`,
    kind: 'shared',
    connectorId,
    cable: mainSupply.cable,
    origin: mainSupply.origin,
    hideWireLabel: mainSupply.hideWireLabel,
    trunkDevices: [...trunkDevices],
    segmentCables: [...(mainSupply.supplyTrunkSegmentCables ?? [])]
      .filter((entry) => entry.panelId === '*')
      .map((entry) => ({
        segmentIndex: entry.segmentIndex,
        cable: entry.cable,
      })),
  }
}

/** `cable` omitted for single-main projects (use `installation.mainSupply.cable`). */
function buildRootFeed(
  panelId: string,
  connectorId: string,
  cable?: CableSpec,
  busSectionId?: string,
): RootPanelFeedPath {
  const feed: RootPanelFeedPath = {
    id: `root-feed-${panelId}`,
    kind: 'root_panel',
    connectorId,
    panelId,
    ...(busSectionId ? { busSectionId } : {}),
    trunkDevices: [],
    segmentCables: [],
  }
  if (cable !== undefined) {
    feed.cable = cable
  }
  return feed
}

/** Cable onto the main panel bus: SSOT is `mainSupply` when there is only one main panel. */
function resolvePanelIncomingSupplyCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  rootFeed: RootPanelFeedPath | null,
  sharedFeed: SharedFeedPath,
): CableSpec {
  const isPrimaryFeed =
    rootFeed == null ||
    (rootFeed.busSectionId ?? getPrimaryPanelBusSectionId(panel)) ===
      getPrimaryPanelBusSectionId(panel)
  if (collectRootPanels(panels).length === 1 && isPrimaryFeed) {
    return installation.mainSupply.cable
  }
  return rootFeed?.cable ?? sharedFeed.cable ?? installation.mainSupply.cable
}

export function ensureInstallationFeedTopology(installation: Installation, panels: Panel[]): FeedTopology {
  const cached = feedTopologyCache.get(installation)
  if (cached && cachedTopologyMatches(cached, installation, panels)) return cached.result

  const rootPanels = collectRootPanels(panels)
  /** One main panel: mainSupply is the UI/schema source for the incoming supply cable. */
  const soleRootPanelId = rootPanels.length === 1 ? rootPanels[0]!.id : null
  const existing = installation.feedTopology
  const mainSupply = installation.mainSupply
  const liveSharedDevices = normalizeTrunkDevicePositions(mainSupply.supplyTrunkDevices)
  if (liveSharedDevices !== mainSupply.supplyTrunkDevices) {
    try {
      mainSupply.supplyTrunkDevices = liveSharedDevices
    } catch {
      // Read-only snapshots can call this during render; derived topology still returned.
    }
  }
  if (existing) {
    const rootFeeds = existing.rootFeeds.map((feed) => {
      const trunkDevices = normalizeTrunkDevicePositions(feed.trunkDevices)
      let nextFeed: RootPanelFeedPath = trunkDevices === feed.trunkDevices
        ? feed
        : {
            ...feed,
            trunkDevices,
          }
      // Single main panel: never persist root-feed cable (avoids drift vs mainSupply).
      const owningPanel = rootPanels.find((panel) => panel.id === feed.panelId)
      const isPrimaryFeed =
        owningPanel != null &&
        (feed.busSectionId ?? getPrimaryPanelBusSectionId(owningPanel)) ===
          getPrimaryPanelBusSectionId(owningPanel)
      if (soleRootPanelId !== null && feed.panelId === soleRootPanelId && isPrimaryFeed) {
        nextFeed = { ...nextFeed }
        delete nextFeed.cable
      } else if (cablesEqual(feed.cable, existing.sharedFeed.cable)) {
        // Root feeds that still match the previous shared cable are effectively inherited.
        // Keep them in sync when the main-supply cable changes through imports or UI edits.
        nextFeed = {
          ...nextFeed,
          cable: mainSupply.cable,
        }
      }
      return nextFeed
    })
    for (const panel of rootPanels) {
      const primaryBusSectionId = getPrimaryPanelBusSectionId(panel)
      if (
        !rootFeeds.some(
          (feed) =>
            feed.panelId === panel.id &&
            (feed.busSectionId ?? primaryBusSectionId) === primaryBusSectionId,
        )
      ) {
        rootFeeds.push(
          buildRootFeed(
            panel.id,
            existing.rootConnector.id,
            soleRootPanelId !== null ? undefined : mainSupply.cable,
          ),
        )
      }
    }
    const topology: FeedTopology = {
      ...existing,
      sharedFeed: {
        ...existing.sharedFeed,
        cable: mainSupply.cable,
        origin: mainSupply.origin,
        hideWireLabel: mainSupply.hideWireLabel,
        trunkDevices: [...liveSharedDevices],
        segmentCables: [...(mainSupply.supplyTrunkSegmentCables ?? [])]
          .filter((entry) => entry.panelId === '*')
          .map((entry) => ({
            segmentIndex: entry.segmentIndex,
            cable: entry.cable,
          })),
      },
      rootFeeds,
    }
    try {
      installation.feedTopology = topology
    } catch {
      // Read-only snapshots can call this during render; derived topology still returned.
    }
    return rememberFeedTopology(installation, panels, topology)
  }

  const connectorId = nanoid(16)
  const topology: FeedTopology = {
    version: 1,
    rootConnector: {
      id: connectorId,
      kind: 'connector',
      role: 'root_split',
    },
    sharedFeed: buildSharedFeedFromLegacyMainSupply(installation, connectorId),
    rootFeeds: rootPanels.map((panel) =>
      buildRootFeed(
        panel.id,
        connectorId,
        rootPanels.length === 1 ? undefined : installation.mainSupply.cable,
      ),
    ),
  }
  try {
    installation.feedTopology = topology
  } catch {
    // Read-only snapshots can call this during render; derived topology still returned.
  }
  return rememberFeedTopology(installation, panels, topology)
}

export interface PanelFeedProjection {
  sharedFeed: SharedFeedPath
  rootFeed: RootPanelFeedPath | null
  devices: TrunkDevice[]
  sharedDeviceCount: number
  cable: CableSpec
  hideWireLabel: boolean
  busSectionId: string
}

export function getPanelBusSectionFeedProjection(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  busSectionId: string,
): PanelFeedProjection | null {
  if (panel.isMain !== true) return null
  const topology = ensureInstallationFeedTopology(installation, panels)
  const sharedFeed = topology.sharedFeed
  const rootFeed =
    topology.rootFeeds.find(
      (feed) =>
        feed.panelId === panel.id &&
        (feed.busSectionId ?? getPrimaryPanelBusSectionId(panel)) === busSectionId,
    ) ?? null
  const sharedDevices = sharedFeed.trunkDevices ?? []
  const rootDevices = rootFeed?.trunkDevices ?? []

  return {
    sharedFeed,
    rootFeed,
    devices: [...sharedDevices, ...rootDevices],
    sharedDeviceCount: sharedDevices.length,
    cable: resolvePanelIncomingSupplyCable(installation, panels, panel, rootFeed, sharedFeed),
    hideWireLabel:
      rootFeed?.hideWireLabel ??
      sharedFeed.hideWireLabel ??
      installation.mainSupply.hideWireLabel ??
      true,
    busSectionId,
  }
}

/** Existing single-bus projection; split panels resolve their primary section. */
export function getPanelFeedProjection(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): PanelFeedProjection | null {
  return getPanelBusSectionFeedProjection(
    installation,
    panels,
    panel,
    getPrimaryPanelBusSectionId(panel),
  )
}

export function getPanelSupplyTrunkDevices(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): TrunkDevice[] {
  return getPanelFeedProjection(installation, panels, panel)?.devices ?? []
}

export function getSupplyFeedDevicesForPanel(
  installation: Installation,
  panels: Panel[],
  panelId: string,
  scope: SupplyFeedScope = 'shared',
  busSectionId?: string,
): TrunkDevice[] {
  const topology = ensureInstallationFeedTopology(installation, panels)
  if (scope === 'shared') {
    return topology.sharedFeed.trunkDevices ?? []
  }
  const panel = collectRootPanels(panels).find((candidate) => candidate.id === panelId)
  const targetBusSectionId = busSectionId ?? (panel ? getPrimaryPanelBusSectionId(panel) : undefined)
  return (
    topology.rootFeeds.find(
      (feed) =>
        feed.panelId === panelId &&
        (!targetBusSectionId ||
          (feed.busSectionId ?? (panel ? getPrimaryPanelBusSectionId(panel) : undefined)) ===
            targetBusSectionId),
    )?.trunkDevices ?? []
  )
}

/** Create the section's local device carrier when its first panel-input device is dropped. */
export function ensureRootFeedForBusSection(
  installation: Installation,
  panels: Panel[],
  panelId: string,
  busSectionId: string,
): RootPanelFeedPath | null {
  const panel = collectRootPanels(panels).find((candidate) => candidate.id === panelId)
  if (!panel) return null
  const topology = ensureInstallationFeedTopology(installation, panels)
  const primarySectionId = getPrimaryPanelBusSectionId(panel)
  const existing = topology.rootFeeds.find((feed) =>
    feed.panelId === panelId &&
    (feed.busSectionId ?? primarySectionId) === busSectionId
  )
  if (existing) return existing
  if (!panel.busSections?.some((section) => section.id === busSectionId)) {
    return topology.rootFeeds.find((feed) =>
      feed.panelId === panelId &&
      (feed.busSectionId ?? primarySectionId) === primarySectionId
    ) ?? null
  }
  const feed: RootPanelFeedPath = {
    id: `root-feed-${panelId}-${busSectionId}`,
    kind: 'root_panel',
    connectorId: topology.rootConnector.id,
    panelId,
    busSectionId,
    trunkDevices: [],
    segmentCables: [],
  }
  topology.rootFeeds.push(feed)
  return feed
}

export function getPanelSupplyCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): CableSpec {
  return (
    getPanelFeedProjection(installation, panels, panel)?.cable ??
    installation.mainSupply.cable
  )
}

export type SupplyWireRole = 'upstream' | 'crossing' | 'downstream'

/** Resolved hide flag for supply wire segments (`true` = hidden; default hidden until user shows). */
export function getSupplyWireHideWireLabelForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  const mainSupply = installation.mainSupply
  if (role === 'upstream') {
    return mainSupply.hideWireLabelUpstream ?? true
  }
  if (role === 'crossing') {
    return mainSupply.hideWireLabelCrossing ?? true
  }
  const soleMain = collectRootPanels(panels).length === 1
  if (!soleMain) {
    const projection = getPanelFeedProjection(installation, panels, panel)
    if (projection?.rootFeed?.hideWireLabel !== undefined) {
      return projection.rootFeed.hideWireLabel
    }
  }
  if (mainSupply.hideWireLabelDownstream !== undefined) {
    return mainSupply.hideWireLabelDownstream
  }
  return mainSupply.hideWireLabel ?? true
}

export function isSupplyWireLabelVisibleForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  return getSupplyWireHideWireLabelForRole(installation, panels, panel, role) === false
}

export function getSupplyWireShowFireClassLabelForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean | undefined {
  const mainSupply = installation.mainSupply
  if (role === 'upstream') {
    return mainSupply.showFireClassLabelUpstream
  }
  if (role === 'crossing') {
    return mainSupply.showFireClassLabelCrossing
  }
  const soleMain = collectRootPanels(panels).length === 1
  if (!soleMain) {
    const projection = getPanelFeedProjection(installation, panels, panel)
    if (projection?.rootFeed?.showFireClassLabel !== undefined) {
      return projection.rootFeed.showFireClassLabel
    }
  }
  return mainSupply.showFireClassLabelDownstream
}

export function isSupplyWireFireClassLabelVisibleForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  return getSupplyWireShowFireClassLabelForRole(installation, panels, panel, role) === true
}

export function buildSupplyWireFireClassVisibilityUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  visible: boolean,
): Partial<Installation> {
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1
  const hideKey =
    role === 'upstream'
      ? 'hideWireLabelUpstream'
      : role === 'crossing'
        ? 'hideWireLabelCrossing'
        : 'hideWireLabelDownstream'
  const showFireKey =
    role === 'upstream'
      ? 'showFireClassLabelUpstream'
      : role === 'crossing'
        ? 'showFireClassLabelCrossing'
        : 'showFireClassLabelDownstream'

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id
            ? {
                ...feed,
                showFireClassLabel: visible,
                ...(visible ? { hideWireLabel: false } : {}),
              }
            : feed,
        ),
      },
    }
  }

  return {
    mainSupply: {
      ...mainSupply,
      [showFireKey]: visible,
      ...(visible
        ? {
            [hideKey]: false,
            ...(role === 'downstream' ? { hideWireLabel: false } : {}),
          }
        : {}),
    },
  }
}

export function buildSupplyWireLabelVisibilityUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  visible: boolean,
): Partial<Installation> {
  const hide = visible ? false : true
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id ? { ...feed, hideWireLabel: hide } : feed,
        ),
      },
    }
  }

  const roleKey =
    role === 'upstream'
      ? 'hideWireLabelUpstream'
      : role === 'crossing'
        ? 'hideWireLabelCrossing'
        : 'hideWireLabelDownstream'

  return {
    mainSupply: {
      ...mainSupply,
      [roleKey]: hide,
      ...(role === 'downstream' ? { hideWireLabel: hide } : {}),
    },
  }
}

export function getPanelSupplyHideWireLabel(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
): boolean {
  return getSupplyWireHideWireLabelForRole(installation, panels, panel, 'downstream')
}

export function getPanelSupplySegmentCable(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  segmentIndex: number,
): CableSpec | null {
  const projection = getPanelFeedProjection(installation, panels, panel)
  if (!projection || segmentIndex < 1) return null

  const sharedOverrides = projection.sharedFeed.segmentCables ?? []
  const rootOverrides = projection.rootFeed?.segmentCables ?? []
  const sharedSpan = Math.max(0, projection.sharedDeviceCount - 1)

  if (segmentIndex <= sharedSpan) {
    return sharedOverrides.find((entry) => entry.segmentIndex === segmentIndex)?.cable ?? null
  }

  const rootSegmentIndex = segmentIndex - sharedSpan
  return rootOverrides.find((entry) => entry.segmentIndex === rootSegmentIndex)?.cable ?? null
}

type SupplyWireLengthKey =
  | 'wireLengthMUpstream'
  | 'wireLengthMCrossing'
  | 'wireLengthMDownstream'

type SupplyWireLengthVisibilityKey =
  | 'showWireLengthLabelUpstream'
  | 'showWireLengthLabelCrossing'
  | 'showWireLengthLabelDownstream'

function supplyWireLengthKeyForRole(role: SupplyWireRole): SupplyWireLengthKey {
  if (role === 'upstream') return 'wireLengthMUpstream'
  if (role === 'crossing') return 'wireLengthMCrossing'
  return 'wireLengthMDownstream'
}

function supplyWireLengthVisibilityKeyForRole(role: SupplyWireRole): SupplyWireLengthVisibilityKey {
  if (role === 'upstream') return 'showWireLengthLabelUpstream'
  if (role === 'crossing') return 'showWireLengthLabelCrossing'
  return 'showWireLengthLabelDownstream'
}

export function getSupplyWireLengthMForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): number | undefined {
  const mainSupply = installation.mainSupply
  if (role === 'downstream') {
    const soleMain = collectRootPanels(panels).length === 1
    if (!soleMain) {
      const projection = getPanelFeedProjection(installation, panels, panel)
      if (projection?.rootFeed?.wireLengthM !== undefined) {
        return projection.rootFeed.wireLengthM
      }
    }
  }
  return mainSupply[supplyWireLengthKeyForRole(role)]
}

export function getSupplyWireShowWireLengthLabelForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean | undefined {
  const mainSupply = installation.mainSupply
  if (role === 'downstream') {
    const soleMain = collectRootPanels(panels).length === 1
    if (!soleMain) {
      const projection = getPanelFeedProjection(installation, panels, panel)
      if (projection?.rootFeed?.showWireLengthLabel !== undefined) {
        return projection.rootFeed.showWireLengthLabel
      }
    }
  }
  return mainSupply[supplyWireLengthVisibilityKeyForRole(role)]
}

export function isSupplyWireLengthLabelVisibleForRole(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
): boolean {
  const lengthM = getSupplyWireLengthMForRole(installation, panels, panel, role)
  if (lengthM == null || lengthM <= 0) return false
  return getSupplyWireShowWireLengthLabelForRole(installation, panels, panel, role) === true
}

export function buildSupplyWireLengthUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  wireLengthM: number | undefined,
): Partial<Installation> {
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1
  const lengthKey = supplyWireLengthKeyForRole(role)
  const showKey = supplyWireLengthVisibilityKeyForRole(role)

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id
            ? {
                ...feed,
                wireLengthM,
                ...(wireLengthM == null ? { showWireLengthLabel: false } : {}),
              }
            : feed,
        ),
      },
    }
  }

  return {
    mainSupply: {
      ...mainSupply,
      [lengthKey]: wireLengthM,
      ...(wireLengthM == null ? { [showKey]: false } : {}),
    },
  }
}

export function buildSupplyWireLengthVisibilityUpdate(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  role: SupplyWireRole,
  visible: boolean,
): Partial<Installation> {
  const mainSupply = installation.mainSupply
  const soleMain = collectRootPanels(panels).length === 1
  const showKey = supplyWireLengthVisibilityKeyForRole(role)

  if (role === 'downstream' && !soleMain) {
    const topology = ensureInstallationFeedTopology(installation, panels)
    return {
      feedTopology: {
        ...topology,
        rootFeeds: topology.rootFeeds.map((feed) =>
          feed.panelId === panel.id ? { ...feed, showWireLengthLabel: visible } : feed,
        ),
      },
    }
  }

  return {
    mainSupply: {
      ...mainSupply,
      [showKey]: visible,
    },
  }
}

export function getAllSupplyTrunkDevices(project: ProjectWithOptionalV2Electrical): TrunkDevice[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const topology = ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
  const all: TrunkDevice[] = []
  const seen = new Set<string>()
  const push = (device: TrunkDevice) => {
    if (seen.has(device.id)) return
    seen.add(device.id)
    all.push(device)
  }

  for (const device of topology.sharedFeed.trunkDevices ?? []) push(device)
  for (const feed of topology.rootFeeds) {
    for (const device of feed.trunkDevices ?? []) push(device)
  }
  return all
}
