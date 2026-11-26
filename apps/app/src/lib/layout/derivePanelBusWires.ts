/** Main-bus section wires, selectable feed stubs, hosted feeder legs and outgoing handoffs. */

import { applyNodeWireInset, findCircuitByIdInPanel } from './circuitWireDerivationSupport'

import { generateId } from '@/utils'
import type { LayoutNode } from './layoutTree'
import { isSupplyTapNode } from './layoutTreeSupplyTaps'
import type { WireSegment, ProtectionDevice, TrunkDevice } from '@/types/schema'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'
import { applyHostedFeederSectionCut, FEED_STUB_FEEDER_GEOMETRY } from './feedStubFeeders'

import {
  ensurePanelBusCableMinimum,
  resolveDerivedCircuitCable,
} from '@/lib/wires/circuitWireDefaults'

import {
  getFullInstallationPhaseAssignment,
  getPanelIncomingPhaseState,
  isPhaseAssignmentLabelVisible,
} from '@/lib/wires/phaseAssignment'

import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'

import { cableForSupplyWireRole } from '@/lib/supplyWireCables'

import {
  getPrimaryPanelBusSectionId,
  getProtectionBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { getLeftBiasedBusFeedStubX, PANEL_BUS_FEED_GAP } from '@/lib/panel/panelBusFeedPreview'
import { getSecondaryBusSectionBoundaryX } from './mainBusSectionBoundary'

import type {
  PanelWireDerivationInput,
  SupplyWireAssemblyContext,
} from './deriveSupplyWireAssemblyContext'

type DerivePanelBusWiresInput =
  Pick<
    PanelWireDerivationInput,
    | 'panelNode'
    | 'panel'
    | 'panels'
    | 'installation'
    | 'supplyAssemblies'
    | 'segments'
  > &
  Pick<SupplyWireAssemblyContext, 'getDeviceEnclosureKey'> &
  {
    mainBusNode: LayoutNode
    mainBusY: number
    mainBusX: number
    mainBusWidth: number
    diagramKey: string
    isSupplyDiagram: boolean
    panelIncomingPhaseState: ReturnType<typeof getPanelIncomingPhaseState>
    hasMainBusConnections: boolean
    usesInlineEmptySplitAssembly: boolean
  }

export function derivePanelBusWires(input: DerivePanelBusWiresInput) {
  const {
    panelNode,
    panel,
    panels,
    installation,
    supplyAssemblies,
    segments,
    getDeviceEnclosureKey,
    mainBusNode,
    mainBusY,
    mainBusX,
    mainBusWidth,
    diagramKey,
    isSupplyDiagram,
    panelIncomingPhaseState,
    hasMainBusConnections,
    usesInlineEmptySplitAssembly,
  } = input
  // 2. Main bus wire (horizontal), split into sections between each protection/circuit
  const defaultCable = ensurePanelBusCableMinimum(
    resolveDerivedCircuitCable(panel.protections[0]?.circuits?.[0]?.cable, installation?.defaultCableKind)
  )

  // Collect X positions of all RCDs/MCBs attached to the main bus.
  const connectionEntries = mainBusNode.children
    .filter((child) => {
      if (child.type !== 'rcd' && child.type !== 'mcb') return false
      if (isSupplyTapNode(child)) return false
      const circuit = child.circuitIdForWires
        ? findCircuitByIdInPanel(panel, child.circuitIdForWires)
        : null
      return circuit?.supplySource?.kind !== 'converter-backup'
    })
    .map((child) => ({
      x: child.bounds.x,
      busSectionId: getProtectionBusSectionId(
        panel,
        (child.domainRef as ProtectionDevice | undefined) ?? {}
      ),
    }))
    .sort((a, b) => a.x - b.x)
  const connectionXs = connectionEntries.map((entry) => entry.x)

  // A grouped secondary bus is the visual source of truth for where a section
  // transition is cut. The protection midpoint is only a fallback: it drifts
  // when one section contains a wider RCD trunk than the other.
  const secondaryBusSectionRanges = mainBusNode.children.flatMap((node) => {
    if (node.type !== 'rcd' && node.type !== 'mcb') return []
    const protection = node.domainRef as ProtectionDevice | undefined
    if (!protection) return []
    const sectionId = getProtectionBusSectionId(panel, protection)
    return node.children
      .filter((child) => child.type === 'secondaryBus' && child.bounds.width > 0)
      .map((secondaryBus) => ({
        sectionId,
        startX: secondaryBus.bounds.x,
        endX: secondaryBus.bounds.x + secondaryBus.bounds.width,
      }))
  })

  const busStartX = mainBusX
  const busEndX = mainBusX + mainBusWidth
  const busSegmentStartIndex = segments.length
  if (hasExplicitPanelBusSections(panel) && connectionEntries.length > 0) {
    const splitGap = PANEL_BUS_FEED_GAP
    // Hosted feeders leave a gap before their section (see layoutTree).
    const hostedFeederCounts = new Map<string, number>()
    for (const node of panelNode.children) {
      const sectionId = node.feedStubTap?.busSectionId
      if (sectionId) hostedFeederCounts.set(sectionId, (hostedFeederCounts.get(sectionId) ?? 0) + 1)
    }
    const sectionCut = (left: number, right: number) => {
      const previous = connectionEntries[left]!
      const entry = connectionEntries[right]!
      const boundaryX = getSecondaryBusSectionBoundaryX(
        secondaryBusSectionRanges,
        previous.busSectionId,
        entry.busSectionId,
        (previous.x + entry.x) / 2
      )
      const firstOfSection = connectionEntries.findIndex((candidate) =>
        candidate.busSectionId === entry.busSectionId) === right
      return applyHostedFeederSectionCut(
        { leftEndX: boundaryX - splitGap / 2, rightStartX: boundaryX + splitGap / 2 },
        previous.x,
        Math.min(entry.x, ...secondaryBusSectionRanges
          .filter((range) => range.sectionId === entry.busSectionId && range.startX > previous.x)
          .map((range) => range.startX)),
        firstOfSection ? hostedFeederCounts.get(entry.busSectionId) ?? 0 : 0
      )
    }
    for (let index = 0; index < connectionEntries.length; index += 1) {
      const entry = connectionEntries[index]!
      const previous = connectionEntries[index - 1]
      const next = connectionEntries[index + 1]
      let startX = previous ? (previous.x + entry.x) / 2 : busStartX
      let endX = next ? (entry.x + next.x) / 2 : busEndX
      if (previous && previous.busSectionId !== entry.busSectionId) {
        startX = sectionCut(index - 1, index).rightStartX
      }
      if (next && next.busSectionId !== entry.busSectionId) {
        endX = sectionCut(index, index + 1).leftEndX
      }
      if (endX <= startX) continue
      const sectionPhaseState = getPanelIncomingPhaseState(
        installation,
        panels,
        panel,
        entry.busSectionId,
        supplyAssemblies
      )
      segments.push({
        id: `mainBus-${diagramKey}-${entry.busSectionId}-${index}`,
        type: 'mainBus',
        startPoint: { x: startX, y: mainBusY },
        endPoint: { x: endX, y: mainBusY },
        cable: defaultCable,
        panelId: panel.id,
        busSectionId: entry.busSectionId,
        busFeedKind: isSupplyDiagram || usesInlineEmptySplitAssembly
          ? panel.busSections?.find((section) => section.id === entry.busSectionId)?.role ===
            'backup'
            ? 'backup'
            : 'grid'
          : undefined,
        showBusFeedMarker: isSupplyDiagram || usesInlineEmptySplitAssembly,
        busFeedMarkerSide: isSupplyDiagram || usesInlineEmptySplitAssembly
          ? panel.busSections?.find((section) => section.id === entry.busSectionId)?.role ===
            'backup'
            ? 'below-right'
            : 'below-left'
          : undefined,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment:
          sectionPhaseState.assignment ??
          getFullInstallationPhaseAssignment(installation?.nominalVoltage.system),
        fromElementType: 'mainBus',
        toElementType: 'mainBus',
      })
    }
  } else if (hasExplicitPanelBusSections(panel)) {
    const splitGap = PANEL_BUS_FEED_GAP
    const sections = [...(panel.busSections ?? [])].sort((left, right) => {
      const leftBackup = left.role === 'backup'
      const rightBackup = right.role === 'backup'
      if (leftBackup === rightBackup) return 0
      return leftBackup ? 1 : -1
    })
    const sectionWidth =
      (mainBusWidth - splitGap * Math.max(0, sections.length - 1)) / Math.max(1, sections.length)
    sections.forEach((section, index) => {
      const startX = busStartX + index * (sectionWidth + splitGap)
      const endX = startX + sectionWidth
      const sectionPhaseState = getPanelIncomingPhaseState(
        installation,
        panels,
        panel,
        section.id,
        supplyAssemblies
      )
      segments.push({
        id: `mainBus-${diagramKey}-${section.id}-empty`,
        type: 'mainBus',
        startPoint: { x: startX, y: mainBusY },
        endPoint: { x: endX, y: mainBusY },
        cable: defaultCable,
        panelId: panel.id,
        busSectionId: section.id,
        busFeedKind: isSupplyDiagram || usesInlineEmptySplitAssembly
          ? section.role === 'backup'
            ? 'backup'
            : 'grid'
          : undefined,
        showBusFeedMarker: isSupplyDiagram || usesInlineEmptySplitAssembly,
        busFeedMarkerSide: isSupplyDiagram || usesInlineEmptySplitAssembly
          ? section.role === 'backup'
            ? 'below-right'
            : 'below-left'
          : undefined,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment:
          sectionPhaseState.assignment ??
          getFullInstallationPhaseAssignment(installation?.nominalVoltage.system),
        fromElementType: 'mainBus',
        toElementType: 'mainBus',
      })
    })
  } else {
    const mainBusPhaseAssignment =
      panelIncomingPhaseState.assignment ??
      getFullInstallationPhaseAssignment(installation?.nominalVoltage.system)
    const waypoints: number[] = [busStartX, ...connectionXs, busEndX]
    const busSectionId = getPrimaryPanelBusSectionId(panel)

    for (let i = 0; i < waypoints.length - 1; i++) {
      const startX = waypoints[i]!
      const endX = waypoints[i + 1]!
      if (endX <= startX) continue

      segments.push({
        id: generateId(),
        type: 'mainBus',
        startPoint: { x: startX, y: mainBusY },
        endPoint: { x: endX, y: mainBusY },
        cable: defaultCable,
        panelId: panel.id,
        busSectionId,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment: mainBusPhaseAssignment,
        fromElementType: 'mainBus',
        toElementType: 'mainBus',
      })
    }
  }

  const busRuns = segments
    .slice(busSegmentStartIndex)
    .filter((segment) => segment.type === 'mainBus' && segment.busSectionId)
    .sort((left, right) => left.startPoint.x - right.startPoint.x)
    .reduce<WireSegment[]>((runs, segment) => {
      const previous = runs[runs.length - 1]
      if (
        previous &&
        previous.busSectionId === segment.busSectionId &&
        Math.abs(previous.endPoint.x - segment.startPoint.x) < 0.01
      ) {
        previous.endPoint = { ...segment.endPoint }
      } else {
        runs.push({
          ...segment,
          startPoint: { ...segment.startPoint },
          endPoint: { ...segment.endPoint },
        })
      }
      return runs
    }, [])
  const busRunForRole = (role: 'normal' | 'backup') =>
    busRuns.find((run) =>
      panel.busSections?.some((section) => section.id === run.busSectionId && section.role === role)
    )
  const panelFeedStubProtectionNodes = panelNode.children.filter(
    (node) => node.type === 'trunkDevice' && node.id.includes('--feed-stub-')
  )
  const hasPanelFeedStubProtections = panelFeedStubProtectionNodes.length > 0
  const panelFeedStubCable = installation
    ? cableForSupplyWireRole(installation, panels, panel, 'downstream')
    : defaultCable
  const stubProtectionElementType = (node: LayoutNode | undefined) =>
    (node?.domainRef as TrunkDevice | undefined)?.type === 'protection'
      ? ('protection' as const)
      : undefined

  const feedOutputWire = panelNode.children.find((child) =>
    child.id?.startsWith('feed-output-wire-')
  )
  if (
    hasExplicitPanelBusSections(panel) &&
    !isSupplyDiagram &&
    (hasMainBusConnections || usesInlineEmptySplitAssembly)
  ) {
    for (const [index, run] of busRuns.entries()) {
      const section = panel.busSections?.find((candidate) => candidate.id === run.busSectionId)
      const stubX = getLeftBiasedBusFeedStubX(run.startPoint.x, run.endPoint.x)
      const forceStubPhaseLabel = isPhaseAssignmentLabelVisible(
        run.phaseAssignment,
        installation?.nominalVoltage.system
      )
      const stubDevices = panelFeedStubProtectionNodes
        .filter((node) =>
          Math.abs(node.bounds.x - stubX) < 0.01 &&
          node.hitZone?.busSectionId === run.busSectionId
        )
        .sort((left, right) => left.bounds.y - right.bounds.y)
      const stubEndY = stubDevices.length > 0
        ? Math.max(
            stubDevices.at(-1)!.bounds.y + 42,
            ...mainBusNode.children
              .filter((node) =>
                node.id.startsWith('supply-wire-feed-stub-') &&
                Math.abs(node.bounds.x + node.bounds.width / 2 - stubX) < 0.01
              )
              .map((node) => node.bounds.y + node.bounds.height)
          )
        : Math.max(
            mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP,
            ...mainBusNode.children
              .filter((node) =>
                node.id.startsWith('supply-wire-feed-stub-') &&
                Math.abs(node.bounds.x + node.bounds.width / 2 - stubX) < 0.01
              )
              .map((node) => node.bounds.y + node.bounds.height)
          )
      // A stub fed through a protection in another panel names that panel
      // instead of drawing a supply marker.
      const fedFromPanel = panelNode.children.some((node) =>
        node.id.startsWith(`feed-stub-source-label-${panel.id}-${run.busSectionId}-`) &&
        Math.abs(node.bounds.x - stubX) < 0.01
      )
      if (stubDevices.length > 0) {
        const waypoints = [
          { y: mainBusY, node: undefined as LayoutNode | undefined },
          ...stubDevices.map((node) => ({ y: node.bounds.y, node })),
          { y: stubEndY, node: undefined as LayoutNode | undefined },
        ]
        // A stub protection may be mounted in another panel; mark where the
        // chain leaves this panel's enclosure, as on the horizontal supply lane.
        const waypointEnclosures = waypoints.map(({ node }, step) =>
          step === 0
            ? `panel:${panel.id}`
            : node ? getDeviceEnclosureKey(node.domainRef as TrunkDevice) : undefined
        )
        for (let step = 0; step < waypoints.length - 2; step++) {
          const from = waypoints[step]!
          const to = waypoints[step + 1]!
          const start = { x: stubX, y: from.y }
          const end = { x: stubX, y: to.y }
          const fromEnclosure = waypointEnclosures[step]
          const toEnclosure = waypointEnclosures[step + 1]
          segments.push({
            supplyEnclosureBoundary:
              fromEnclosure != null && toEnclosure != null && fromEnclosure !== toEnclosure
                ? true
                : undefined,
            id: `bus-feed-protection-wire-${diagramKey}-${run.busSectionId}-${index}-${step}`,
            type: 'vertical',
            startPoint: from.node ? applyNodeWireInset(start, end, from.node) : start,
            endPoint: to.node ? applyNodeWireInset(end, start, to.node) : end,
            cable: panelFeedStubCable,
            panelId: panel.id,
            busSectionId: run.busSectionId,
            domain: DEFAULT_ELECTRICAL_DOMAIN,
            hideWireLabel: true,
            isSupplyTrunk: true,
            supplyWireRole: 'downstream',
            supplyFeedScope: 'root',
            fromElementType: from.node ? stubProtectionElementType(from.node) : 'mainBus',
            fromElementId: from.node?.domainId,
            toElementType: stubProtectionElementType(to.node),
            toElementId: to.node?.domainId,
          })
        }
      }
      segments.push({
        id: `bus-feed-stub-${diagramKey}-${run.busSectionId}-${index}`,
        type: 'vertical',
        startPoint: stubDevices.length > 0
          ? applyNodeWireInset(
              { x: stubX, y: stubDevices.at(-1)!.bounds.y },
              { x: stubX, y: stubEndY },
              stubDevices.at(-1)!
            )
          : { x: stubX, y: mainBusY },
        endPoint: { x: stubX, y: stubEndY },
        cable: stubDevices.length > 0 ? panelFeedStubCable : defaultCable,
        panelId: panel.id,
        busSectionId: run.busSectionId,
        busFeedKind: section?.role === 'backup' ? 'backup' : 'grid',
        showBusFeedMarker: !usesInlineEmptySplitAssembly && !fedFromPanel,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment: run.phaseAssignment,
        forcePhaseLabel: forceStubPhaseLabel,
        phaseLabelAnchor: forceStubPhaseLabel ? { x: stubX + 5, y: mainBusY + 4 } : undefined,
        hideWireLabel: true,
        isSupplyTrunk: stubDevices.length > 0 ? true : undefined,
        supplyWireRole: stubDevices.length > 0 ? 'downstream' : undefined,
        supplyFeedScope: stubDevices.length > 0 ? 'root' : undefined,
        fromElementType: stubDevices.length > 0
          ? stubProtectionElementType(stubDevices.at(-1))
          : 'mainBus',
        fromElementId: stubDevices.at(-1)?.domainId,
      })
    }
  }

  // Feeders hosted in this panel for another main panel's stub hang from a
  // distribution bar on the supply side of this panel's own stub, like a bus.
  const feederPanelsByTap = new Map<string, LayoutNode[]>()
  for (const node of panelNode.children) {
    if (!node.feedStubTap) continue
    const key = `${node.feedStubTap.x}:${node.feedStubTap.y}`
    feederPanelsByTap.set(key, [...(feederPanelsByTap.get(key) ?? []), node])
  }
  for (const feederPanels of feederPanelsByTap.values()) {
    const tap = feederPanels[0]!.feedStubTap!
    const base = {
      cable: defaultCable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      hideWireLabel: true,
    }
    const branchXs = feederPanels.map((node) => node.bounds.x)
    segments.push({
      ...base,
      id: `feed-stub-feeder-bus-${diagramKey}-${tap.x}-${tap.y}`,
      type: 'mainBus',
      startPoint: { x: Math.min(tap.x, ...branchXs) - FEED_STUB_FEEDER_GEOMETRY.busOverhang, y: tap.y },
      endPoint: { x: Math.max(tap.x, ...branchXs) + FEED_STUB_FEEDER_GEOMETRY.busOverhang, y: tap.y },
    })
    for (const panelSymbol of feederPanels) {
      const branchX = panelSymbol.bounds.x
      const devices = panelNode.children
        .filter((node) =>
          node.type === 'trunkDevice' && node.id.includes('--feed-stub-feeder-') &&
          Math.abs(node.bounds.x - branchX) < 0.01
        )
        .sort((left, right) => right.bounds.y - left.bounds.y)
      const waypoints: Array<{ y: number; node?: LayoutNode }> = [
        { y: tap.y },
        ...devices.map((node) => ({ y: node.bounds.y, node })),
        { y: panelSymbol.bounds.y },
      ]
      for (let step = 0; step < waypoints.length - 1; step++) {
        const from = waypoints[step]!
        const to = waypoints[step + 1]!
        const start = { x: branchX, y: from.y }
        const end = { x: branchX, y: to.y }
        segments.push({
          ...base,
          id: `feed-stub-feeder-wire-${diagramKey}-${panelSymbol.id}-${step}`,
          type: 'vertical',
          startPoint: from.node ? applyNodeWireInset(start, end, from.node) : start,
          endPoint: to.node ? applyNodeWireInset(end, start, to.node) : end,
        })
      }
    }
  }

  if (feedOutputWire && !(isSupplyDiagram && busRuns.length > 1)) {
    const outputX = feedOutputWire.bounds.x + feedOutputWire.bounds.width / 2
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: { x: outputX, y: mainBusY },
      endPoint: { x: outputX, y: feedOutputWire.bounds.y },
      cable: defaultCable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      hideWireLabel: true,
      fromElementType: 'mainBus',
    })
  }

  return {
    busRunForRole,
    hasPanelFeedStubProtections,
  }
}

export type PanelBusWireDerivation = ReturnType<typeof derivePanelBusWires>
