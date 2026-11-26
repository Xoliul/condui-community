import type { Installation, Panel, TrunkDevice } from '@/types/schema'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import {
  deriveWireAnchorKey,
  findWireRunForAnchor,
  selectProjectWireRuns,
} from '@/lib/projectV2/wireRuns'
import { formatWireLabel, measureTextWidth, WIRE_LABEL_FONT_SIZE } from '@/lib/wireTextLabel'
import { formatWireLengthMeters } from '@/lib/wires/wireFingerprint'
import { resolveShowFireClassLabel, resolveShowWireLengthLabel } from '@/lib/wires/circuitWireDefaults'
import {
  buildSupplySectionKey,
  findPanelSupplyAssembly,
  findSupplyAssemblyConnection,
} from './deriveSupplyWireAssemblyContext'

/**
 * Clear wire length kept on each side of a visible cable caption. It leaves room for the
 * enclosure separator, which dodges the caption along the wire (supplyEnclosureBoundaryGeometry).
 */
export const SUPPLY_DC_BRANCH_LABEL_END_CLEARANCE = 14

interface SupplyDcBranchWireSpanInput {
  project: ProjectWithOptionalV2Electrical
  panelId: string
  installation?: Installation
  /** Every root panel, as `deriveWires` receives them. */
  panels: Panel[]
  busDeviceId: string
  /** Devices of one DC-bus branch, in drawing order from the bus outwards. */
  devices: readonly TrunkDevice[]
}

/**
 * Wire length each vertical piece of a DC-bus branch needs for its visible cable caption, by
 * device index: entry `i` is the piece that arrives at device `i` (from the bus or the previous
 * device). `0` means no caption is shown there. The layout lengthens the piece to this span, and
 * `deriveWires` draws the caption on it, so both must agree on which pieces carry one.
 */
export function getSupplyDcBranchWireSpans({
  project,
  panelId,
  installation,
  panels,
  busDeviceId,
  devices,
}: SupplyDcBranchWireSpanInput): number[] {
  const runs = selectProjectWireRuns(project)
  const rootFeed = installation
    ? ensureInstallationFeedTopology(installation, panels).rootFeeds.find(
        (feed) => feed.panelId === panelId
      )
    : undefined
  const assembly = findPanelSupplyAssembly(selectProjectSupplyAssemblies(project), panelId)
  if (runs.length === 0 && !rootFeed?.wireSections) return devices.map(() => 0)

  const branchId = devices[0]?.supplyDcBusBranchId ?? devices[0]?.id
  let previousId = busDeviceId
  // A lane of a multi-port converter starts at that converter and runs on its own.
  const lanePrevious = new Map<string, string>()
  return devices.map((device) => {
    const connection = device.converterDcConnection
    const laneKey = connection ? `${connection.converterId}:${connection.connectionIndex}` : undefined
    const fromId = connection ? (lanePrevious.get(laneKey!) ?? connection.converterId) : previousId
    if (laneKey) lanePrevious.set(laneKey, device.id)
    else previousId = device.id

    // The anchor and section mirror how `deriveWires` stamps the same piece of wire.
    const assemblyConnection = findSupplyAssemblyConnection(assembly, fromId, device.id)
    const sectionKey = buildSupplySectionKey(
      panelId,
      `dc-bus-${busDeviceId}-${branchId}`,
      `device:${fromId}`,
      `device:${device.id}`
    )
    const anchor =
      assembly && assemblyConnection
        ? deriveWireAnchorKey({
            kind: 'supply-connection',
            assemblyId: assembly.id,
            connectionId: assemblyConnection.id,
          })
        : rootFeed
          ? deriveWireAnchorKey({ kind: 'feed-run', feedPathId: rootFeed.id, runKey: sectionKey })
          : undefined
    const run = anchor ? findWireRunForAnchor(runs, anchor) : undefined
    const legacy = rootFeed?.wireSections?.[sectionKey]
    const hidden = run?.labels?.hideWireLabel ?? legacy?.hideWireLabel
    if (hidden !== false) return 0
    const cable = run?.cable ?? legacy?.cable
    if (!cable) return 0
    const showFireClass = run?.labels?.showFireClassLabel ?? legacy?.showFireClassLabel
    const showLength = run?.labels?.showWireLengthLabel ?? legacy?.showWireLengthLabel
    const length = run
      ? anchor && run.segmentLengthSources?.[anchor] !== 'estimated-stale'
        ? run.segmentLengths?.[anchor]
        : undefined
      : legacy?.wireLengthM

    const lines = [formatWireLabel({ cable, wireMaterial: run?.material })]
    if (resolveShowFireClassLabel(showFireClass, 'DC') && cable.fireClass) lines.push(cable.fireClass)
    if (resolveShowWireLengthLabel(showLength) && length) lines.push(formatWireLengthMeters(length))
    const width = Math.max(
      ...lines.map((text) => measureTextWidth(text, 'Figtree', WIRE_LABEL_FONT_SIZE))
    )
    return Math.ceil(width + SUPPLY_DC_BRANCH_LABEL_END_CLEARANCE * 2)
  })
}
