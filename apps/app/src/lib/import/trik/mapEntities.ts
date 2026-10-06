import { isVirtualOneWireOnlySymbol } from '@/lib/plan/situationPlanSymbolEligibility'
import type {
  Branch,
  Circuit,
  CircuitPhaseAssignment,
  Endpoint,
  Frame,
  FrameContentItem,
  Panel,
  Placement,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import { calculateBottomUpLayout } from '@/lib/layout/bottomUpLayout'
import { buildLayoutTree, type LayoutNode } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import {
  getProjectElectricalPanels,
  selectProjectElectricalInstallation,
} from '@/lib/projectV2/electrical'
import {
  collectOneWireNoteObstacles,
  getNoteBox,
  placeNotesAvoiding,
} from '@/lib/import/trik/oneWireNotePlacement'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { normalizeStoredProjectToV2 } from '@/lib/projectV2/migration'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { generateId } from '@/utils/project'
import { normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import {
  getAutomaticBusbarPhaseAssignment,
  supportsExplicitPhaseSelection,
} from '@/lib/wires/phaseAssignment'
import type {
  PendingTrikEendraadNote,
  PendingTrikFrameMarkCorner,
  Project,
  TrikCircuit,
  TrikCircuitTrunkDevice,
  TrikNode,
  TrikPanelBoard,
  TrikPlanNode,
} from '@/lib/import/trik/shared'
import type {
  PendingTrikSitplanNote,
  TrikGroundInfo,
  TrikPlanNodesByFloor,
  TrikPlanPanel,
  TrikSupplyInfo,
} from '@/lib/import/trik/parse'
import {
  matchTrikPanelNameInText,
  normalizeTrikPanelNameKey,
  roundRotationDeg,
  scaledPoint,
  trikNotasMentionPanel,
  TRIK_ONE_WIRE_NOTA_FONT_SIZE_PX,
  TRIK_SATELLITE_UNITS_TO_PX,
} from '@/lib/import/trik/shared'

export function finalizePendingTrikEendraadNotes(project: Project, pending: PendingTrikEendraadNote[]): void {
  if (pending.length === 0) return
  if (!project.eendraadNotes) project.eendraadNotes = []
  const normalized = normalizeStoredProjectToV2(structuredClone(project))
  const layout = calculateBottomUpLayout(normalized)
  const panels = getProjectElectricalPanels(normalized)
  const endpointsById = new Map(
    panels.flatMap((panel) => getAllCircuits(panel).flatMap((circuit) => circuit.endpoints)).map(
      (endpoint) => [endpoint.id, endpoint] as const,
    ),
  )
  const tree = buildLayoutTree(layout)
  const endpointCenters = new Map<string, { x: number; y: number }>()
  for (const pl of layout.panels) {
    for (const el of pl.elements) {
      if (el.type === 'endpoint' && el.endpointId) {
        endpointCenters.set(el.endpointId, { x: el.position.x, y: el.position.y })
      }
    }
  }
  // Converter DC output chains exist only in the layout tree (bounds are symbol centers).
  const collectTreeEndpoints = (node: LayoutNode) => {
    if (node.type === 'endpoint' && node.domainId && !endpointCenters.has(node.domainId)) {
      endpointCenters.set(node.domainId, { x: node.bounds.x, y: node.bounds.y })
    }
    node.children.forEach(collectTreeEndpoints)
  }
  tree.panels.forEach(collectTreeEndpoints)
  const placeable = pending.flatMap((p) => {
    const base = endpointCenters.get(p.endpointId)
    if (!base) return []
    return [{
      note: p,
      desired: {
        x: base.x + p.offsetX * TRIK_SATELLITE_UNITS_TO_PX,
        y: base.y + p.offsetY * TRIK_SATELLITE_UNITS_TO_PX,
      },
      box: getNoteBox(p.text, TRIK_ONE_WIRE_NOTA_FONT_SIZE_PX),
    }]
  })
  // TRiK free text is often large and drawn over the schematic; keep it readable but out of the way.
  const wires = deriveWires(
    tree,
    panels,
    selectProjectElectricalInstallation(normalized) ?? undefined,
  )
  const { rects, frames } = collectOneWireNoteObstacles(layout, endpointsById, endpointCenters, wires)
  const positions = placeNotesAvoiding(placeable, rects, frames)
  placeable.forEach(({ note }, index) => {
    project.eendraadNotes!.push({
      id: generateId(),
      text: note.text,
      fontSize: TRIK_ONE_WIRE_NOTA_FONT_SIZE_PX,
      pos: positions[index]!,
      panelId: note.panelId,
    })
  })
}

export function finalizePendingTrikSatelliteMarkFrames(project: Project, pendingCorners: PendingTrikFrameMarkCorner[]): void {
  if (pendingCorners.length === 0) return
  const layout = calculateBottomUpLayout(
    normalizeStoredProjectToV2(structuredClone(project)),
  )
  const endpointPosByPanel = new Map<string, Map<string, { x: number; y: number }>>()
  for (const pl of layout.panels) {
    const m = new Map<string, { x: number; y: number }>()
    for (const el of pl.elements) {
      if (el.type === 'endpoint' && el.endpointId) {
        m.set(el.endpointId, { x: el.position.x, y: el.position.y })
      }
    }
    endpointPosByPanel.set(pl.panel.id, m)
  }

  const byMarkId = new Map<string, PendingTrikFrameMarkCorner>()
  for (const c of pendingCorners) byMarkId.set(c.markId, c)
  const seenPairs = new Set<string>()
  const nextFrames: Frame[] = []

  for (const c of pendingCorners) {
    const pairKey = [c.markId, c.buddyId].sort().join('::')
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)
    const buddy = byMarkId.get(c.buddyId)
    if (!buddy) continue
    if (c.panelId !== buddy.panelId) continue

    const posMap = endpointPosByPanel.get(c.panelId)
    const baseA = posMap?.get(c.endpointId)
    const baseB = posMap?.get(buddy.endpointId)
    if (!baseA || !baseB) continue

    const a = {
      x: baseA.x + c.offsetX * TRIK_SATELLITE_UNITS_TO_PX,
      y: baseA.y + c.offsetY * TRIK_SATELLITE_UNITS_TO_PX,
    }
    const b = {
      x: baseB.x + buddy.offsetX * TRIK_SATELLITE_UNITS_TO_PX,
      y: baseB.y + buddy.offsetY * TRIK_SATELLITE_UNITS_TO_PX,
    }
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    if (Math.abs(maxX - minX) < 2 || Math.abs(maxY - minY) < 2) continue

    const panelLayout = layout.panels.find((pl) => pl.panel.id === c.panelId)
    if (!panelLayout) continue

    const contentItems: FrameContentItem[] = []
    for (const el of panelLayout.elements) {
      const inside =
        el.position.x >= minX
        && el.position.x <= maxX
        && el.position.y >= minY
        && el.position.y <= maxY
      if (!inside) continue
      if (el.type === 'endpoint' && el.endpointId) {
        contentItems.push({ id: el.endpointId, kind: 'endpoint' })
      } else if ((el.type === 'protection' || el.type === 'rcd') && el.protectionId) {
        contentItems.push({ id: el.protectionId, kind: 'protection' })
      } else if (el.type === 'trunkDevice' && el.trunkDeviceId) {
        contentItems.push({ id: el.trunkDeviceId, kind: 'trunkDevice' })
      }
    }
    if (contentItems.length === 0) continue

    const dedup = new Map<string, FrameContentItem>()
    for (const item of contentItems) dedup.set(`${item.kind}:${item.id}`, item)
    const uniqueItems = [...dedup.values()]
    const kinds = new Set(uniqueItems.map((it) => it.kind))
    const contentType: Frame['contentType'] = kinds.size === 1 ? uniqueItems[0]!.kind : 'mixed'

    nextFrames.push({
      id: generateId(),
      title: '',
      fontSize: 10,
      titlePosition: 'inside',
      panelId: c.panelId,
      contentIds: uniqueItems.map((it) => it.id),
      contentType,
      contentItems: uniqueItems,
    })
  }

  if (nextFrames.length > 0) {
    project.eendraadFrames = [...(project.eendraadFrames ?? []), ...nextFrames]
  }
}

export function applyTrikSitplanNotes(
  project: Project,
  floorId: string,
  planNodes: Map<string, TrikPlanNode[]>,
  pendingNotes: PendingTrikSitplanNote[],
): void {
  if (pendingNotes.length === 0) return
  if (!project.sitplanNotes) project.sitplanNotes = []
  for (const note of pendingNotes) {
    const node = planNodes.get(note.nodeId)?.[0]
    if (!node) continue
    project.sitplanNotes.push({
      id: generateId(),
      text: note.text,
      fontSize: note.fontSize,
      pos: scaledPoint({ x: node.x, y: node.y }),
      floorId,
    })
  }
}

export function normalizeCableKind(kind: string | undefined): Circuit['cable']['kind'] {
  if (!kind) return 'other'
  const normalized = kind.trim().toUpperCase()
  if (normalized === 'XVB') return 'XVB'
  if (normalized === 'VOB' || normalized === 'H07V-K') return 'VOB'
  return 'other'
}

export function normalizeCircuitCodeFromFixedLetter(value: string | undefined): string | undefined {
  if (!value) return undefined
  let normalized = value.trim().toUpperCase()
  // Multipanel TRiK prefixes circuit letters with the board number ("2.A" → "A").
  const dotted = normalized.match(/^\d+\.(.+)$/)
  if (dotted?.[1]) normalized = dotted[1]
  if (/^[A-Z][A-Z0-9]*$/.test(normalized)) return normalized
  // Codes like "0H" keep their digit+letter form.
  if (/^[0-9]+[A-Z]+$/.test(normalized)) return normalized
  return undefined
}

export function inferNominalVoltageFromSupplyConductors(
  conductors: number | undefined,
): Project['installation']['nominalVoltage'] | undefined {
  if (conductors == null) return undefined
  // TRiK does not encode voltage system explicitly; infer from supply wire conductors.
  // Ambiguous 2-wire feed is imported as 2~ to match the selectable supply systems.
  if (conductors <= 2) return { system: '2~', uLineToNeutral: 230, uLineToLine: 230 }
  if (conductors === 3) return { system: '3~', uLineToNeutral: 230, uLineToLine: 400 }
  if (conductors >= 4) return { system: '3N~', uLineToNeutral: 230, uLineToLine: 400 }
  return undefined
}

export function applySupplyInfo(project: Project, supply: TrikSupplyInfo): void {
  const inferredVoltage = inferNominalVoltageFromSupplyConductors(supply.cableConductors)
  if (inferredVoltage) {
    project.installation.nominalVoltage = inferredVoltage
  }

  if (supply.cableKind || supply.cableSectionMm2 || supply.cableConductors || supply.cableHasPe != null) {
    project.installation.mainSupply.cable = {
      kind: normalizeCableKind(supply.cableKind),
      conductors: supply.cableConductors ?? project.installation.mainSupply.cable.conductors,
      sectionMm2: supply.cableSectionMm2 ?? project.installation.mainSupply.cable.sectionMm2,
      hasPE: supply.cableHasPe ?? project.installation.mainSupply.cable.hasPE ?? true,
      notes: supply.cableNotes?.trim() || undefined,
    }
  }

  if (supply.trunkDevices.length > 0) {
    project.installation.mainSupply.supplyTrunkDevices = supply.trunkDevices.map((device, index): TrunkDevice => {
      const explicitLabel = device.label?.trim() || undefined
      const hideUnnamedLabel =
        !explicitLabel
          ? ({
              symbolLabelDisplay: { visibility: { supplyProtectionNameLabel: false } },
            } as const)
          : undefined
      if (device.kind === 'energy_meter') {
        return {
          id: generateId(),
          type: 'energy_meter',
          symbol: 'energy_meter',
          label: explicitLabel ?? '',
          ...hideUnnamedLabel,
          energyMeterProps: {
            polesConfig: device.polesConfig,
            poles: device.poles,
          },
          trunkPosition: index,
        }
      }
      return {
        id: generateId(),
        type: 'protection',
        symbol: device.protectionType === 'FUSE' ? 'fuse' : 'mcb',
        label: explicitLabel ?? '',
        ...hideUnnamedLabel,
        protectionType: device.protectionType ?? 'MCB',
        ratingA: device.ratingA,
        sensitivityMa: device.sensitivityMa,
        residualCurrentType: device.residualCurrentType,
        polesConfig: device.polesConfig,
        poles: device.poles,
        curve: device.curve,
        breakingCapacityKa: device.breakingCapacityKa,
        trunkPosition: index,
      }
    })
  }

  // Drop empty-project Main RCBO from the root feed; Trik panel-side devices land via promote.
  const panels = project.panels
  const mainPanel = panels.find((panel) => panel.isMain) ?? panels[0]
  if (mainPanel) {
    const topology = ensureInstallationFeedTopology(project.installation, panels)
    const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === mainPanel.id)
    if (rootFeed) rootFeed.trunkDevices = []
  }
}

function flattenProjectPanels(panels: Panel[]): Panel[] {
  const out: Panel[] = []
  const visit = (list: Panel[]) => {
    for (const panel of list) {
      out.push(panel)
      if (panel.subPanels?.length) visit(panel.subPanels)
    }
  }
  visit(panels)
  return out
}

function resolvePlacedPanelName(placed: TrikPlanPanel): string | undefined {
  const fromVasteLetter = placed.vasteLetter?.trim()
  if (fromVasteLetter) return fromVasteLetter
  const derived = [placed.name?.trim(), placed.number?.trim()].filter(Boolean).join(' ').trim()
  return derived || undefined
}

function findPanelForPlacedTrikPanel(panels: Panel[], placed: TrikPlanPanel): Panel | undefined {
  const targetName = resolvePlacedPanelName(placed)
  if (!targetName) return undefined
  const targetKey = normalizeTrikPanelNameKey(targetName)
  return flattenProjectPanels(panels).find(
    (panel) => normalizeTrikPanelNameKey(panel.name) === targetKey,
  )
}

export function applyPlacedPanelMapping(
  project: Project,
  planNodesByFloor: TrikPlanNodesByFloor,
  placedPanels: TrikPlanPanel[],
): void {
  if (placedPanels.length === 0) return
  const panels = project.panels
  if (!panels.length) return

  for (const placed of placedPanels) {
    const panel =
      findPanelForPlacedTrikPanel(panels, placed) ??
      (placedPanels.length === 1 || placed === placedPanels[0] ? panels[0] : undefined)
    if (!panel) continue

    const derivedName = resolvePlacedPanelName(placed)
    if (derivedName) panel.name = derivedName

    const panelCircuit = panel.circuits.find((circuit) => circuit.code === 'PANEL')
    const panelEndpoint = panelCircuit?.endpoints.find((endpoint) => endpoint.symbol === 'panel_distribution')
    if (!panelEndpoint) continue
    panelEndpoint.label = panel.name
    const placements: Placement[] = []
    for (const [floorId, planNodes] of planNodesByFloor) {
      const planNode = planNodes.get(placed.id)?.[0]
      if (!planNode) continue
      placements.push({
        id: generateId(),
        floorId,
        layer: 'electrical',
        pos: scaledPoint({ x: planNode.x, y: planNode.y }),
        rotationDeg: roundRotationDeg(planNode.rotationRad),
        scale: 1,
      })
    }
    if (placements.length > 0) {
      panelEndpoint.placements = placements
    }
  }
}

export function applyGroundInfo(project: Project, ground: TrikGroundInfo): void {
  const label = ground.separatorLabel?.trim() || ground.earthLabel?.trim()
  if (!label) return
  project.installation.groundTrunkDevices = [
    {
      id: generateId(),
      type: 'earthing_separator',
      symbol: 'earthing_separator',
      label,
      trunkPosition: 0,
    },
  ]
}

export function inferCircuitKind(endpoints: Endpoint[]): Circuit['kind'] {
  const actualEndpoints = endpoints.filter((endpoint) => endpoint.symbol !== 'energy_meter')
  const symbols = new Set(actualEndpoints.map((endpoint) => endpoint.symbol))
  if (actualEndpoints.length === 0) return endpoints.length === 0 ? 'empty' : 'other'
  if (symbols.has('solar_panel')) return symbols.size === 1 ? 'solar' : 'mixed'
  if (symbols.has('battery')) return symbols.size === 1 ? 'battery' : 'mixed'
  if (symbols.has('ev')) return symbols.size === 1 ? 'ev' : 'mixed'
  if (actualEndpoints.every((endpoint) => endpoint.type === 'light_point')) return 'lighting'
  if (actualEndpoints.every((endpoint) => endpoint.type === 'socket')) return 'sockets'
  if (actualEndpoints.every((endpoint) => endpoint.symbol === 'stove')) return 'stove'
  if (actualEndpoints.every((endpoint) => endpoint.symbol === 'boiler')) return 'boiler'
  if (actualEndpoints.every((endpoint) => endpoint.symbol === 'heating')) return 'heating'
  if (actualEndpoints.every((endpoint) => endpoint.symbol === 'furnace')) return 'hvac'
  if (actualEndpoints.every((endpoint) => endpoint.type === 'fixed_appliance')) return 'fixed_appliance'
  return 'mixed'
}

export function mergeBranchMultiplierEndpoints(
  endpoints: Endpoint[],
  endpointBranchKeys: string[],
): {
  endpoints: Endpoint[]
  endpointBranchKeys: string[]
  absorbedToKeep: Map<string, string>
} {
  const mergedEndpoints: Endpoint[] = []
  const mergedBranchKeys: string[] = []
  const absorbedToKeep = new Map<string, string>()

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index]
    if (!endpoint) continue
    const branchKey = endpointBranchKeys[index] ?? `struct-${index + 1}`
    const previousEndpoint = mergedEndpoints[mergedEndpoints.length - 1]
    const previousBranchKey = mergedBranchKeys[mergedBranchKeys.length - 1]
    const canMerge =
      !!previousEndpoint
      && previousBranchKey === branchKey
      && endpointSupportsMultiplier(previousEndpoint)
      && endpointSupportsMultiplier(endpoint)
      && previousEndpoint.type === endpoint.type
      && previousEndpoint.symbol === endpoint.symbol
    if (canMerge && previousEndpoint) {
      previousEndpoint.placements = [...previousEndpoint.placements, ...endpoint.placements]
      absorbedToKeep.set(endpoint.id, previousEndpoint.id)
      continue
    }
    mergedEndpoints.push(endpoint)
    mergedBranchKeys.push(branchKey)
  }

  return {
    endpoints: mergedEndpoints,
    endpointBranchKeys: mergedBranchKeys,
    absorbedToKeep,
  }
}

export type TrikCircuitImportResult = {
  circuit: Circuit
  protection: ProtectionDevice
  source: TrikCircuit
}

export function addTrikCircuits(
  panel: Panel,
  primaryFloorId: string,
  trikCircuits: TrikCircuit[],
  planNodesByFloor: TrikPlanNodesByFloor,
  fallbackOrigin: { x: number; y: number },
  pendingTrikEendraadNotesOut: PendingTrikEendraadNote[],
  pendingTrikFrameMarkCornersOut: PendingTrikFrameMarkCorner[],
  hiddenSitplanPlacementIdsByFloorOut?: Map<string, string[]>,
): Map<string, TrikCircuitImportResult> {
  const usedCodes = new Set<string>()
  const importsBySourceId = new Map<string, TrikCircuitImportResult>()
  let fallbackPlacementIndex = 0

  for (const trikCircuit of trikCircuits) {
    const rawFixed = trikCircuit.fixedLetter?.trim()
    // Only keep an explicit TRiK VasteLetter. Do not invent A/B/C for unlabeled circuits.
    const circuitCode = rawFixed && !usedCodes.has(rawFixed) ? rawFixed : ''
    const manualCodeLock = !!rawFixed && circuitCode === rawFixed
    if (circuitCode) usedCodes.add(circuitCode)

    const endpoints: Endpoint[] = []
    const endpointBranchKeys: string[] = []
    const satelliteNotasPerNode: Array<TrikNode['satelliteNotas'] | undefined> = []
    const satelliteMarksPerNode: Array<TrikNode['satelliteMarks'] | undefined> = []
    const sourceNodeByEndpointId = new Map<string, TrikNode>()
    const endpointIdByNodeId = new Map<string, string>()
    const trunkDeviceIdByTrikId = new Map(
      (trikCircuit.trunkDevices ?? []).map((device) => [device.id, generateId()]),
    )
    for (const node of trikCircuit.nodes) {
      const endpointId = generateId()
      const endpoint: Endpoint = {
        id: endpointId,
        type: node.type,
        label: circuitCode ? `${circuitCode}1` : '1',
        symbol: node.symbol,
        notes: node.endpointNote,
        placements: [],
      }
      if (node.type === 'socket' && node.socketCount && node.socketCount > 1) {
        endpoint.socketProps = { ...(endpoint.socketProps ?? {}), socketCount: node.socketCount as 2 | 3 | 4 }
      }
      if (node.type === 'socket' && node.socketWaterproof) {
        endpoint.socketProps = { ...(endpoint.socketProps ?? {}), waterproof: true }
      }
      if (node.type === 'switch' && node.switchVerklikkerlamp) {
        endpoint.switchProps = { ...(endpoint.switchProps ?? {}), verklikkerlamp: true }
      }
      if (node.type === 'switch' && node.switchPoles) {
        endpoint.switchProps = { ...(endpoint.switchProps ?? {}), poles: node.switchPoles }
      }
      if (node.type === 'domotica') {
        endpoint.domoticaProps = {
          control: node.domoticaControl,
          mainDeviceType: node.domoticaMainDeviceType ?? 'none',
          mainSwitchSymbol: node.domoticaMainSwitchSymbol,
          mainSwitchProps:
            node.domoticaMainDeviceType === 'switch'
              ? { verklikkerlamp: !!node.switchVerklikkerlamp }
              : undefined,
        }
      }
      if (node.fixedApplianceProps) endpoint.fixedApplianceProps = node.fixedApplianceProps
      if (node.hvacProps) endpoint.hvacProps = node.hvacProps
      if (node.relayProps) endpoint.relayProps = node.relayProps
      if (node.smokeDetectorProps) endpoint.smokeDetectorProps = node.smokeDetectorProps
      if (node.motionDetectorProps) endpoint.motionDetectorProps = node.motionDetectorProps
      if (node.energyMeterProps) endpoint.energyMeterProps = node.energyMeterProps
      if (node.lightPointProps) endpoint.lightPointProps = node.lightPointProps
      if (node.lightSpotProps) endpoint.lightSpotProps = node.lightSpotProps
      if (node.lightFluorescentProps) endpoint.lightFluorescentProps = node.lightFluorescentProps
      if (node.solarPanelProps) endpoint.solarPanelProps = node.solarPanelProps
      if (node.batteryProps) endpoint.batteryProps = node.batteryProps
      if (node.energyConversionProps) endpoint.energyConversionProps = node.energyConversionProps
      const converterId = node.converterDcConnection
        ? trunkDeviceIdByTrikId.get(node.converterDcConnection.converterTrunkDeviceId)
        : undefined
      if (converterId && node.converterDcConnection) {
        endpoint.converterDcConnection = {
          converterId,
          connectionIndex: node.converterDcConnection.connectionIndex,
        }
      }

      const planNodePlacements: Array<{ floorId: string; planNode: TrikPlanNode }> = []
      for (const [placementFloorId, floorPlanNodes] of planNodesByFloor) {
        for (const planNode of floorPlanNodes.get(node.id) ?? []) {
          planNodePlacements.push({ floorId: placementFloorId, planNode })
        }
      }
      if (isVirtualOneWireOnlySymbol(node.symbol)) {
        // Virtual one-wire element: no situation-plan placement.
      } else if (planNodePlacements.length > 0) {
        for (const { floorId: placementFloorId, planNode } of planNodePlacements) {
          endpoint.placements.push({
            id: generateId(),
            floorId: placementFloorId,
            layer: 'electrical',
            pos: scaledPoint({ x: planNode.x, y: planNode.y }),
            rotationDeg: roundRotationDeg(planNode.rotationRad),
            scale: 1,
          })
        }
      } else {
        const fallbackPlacements: Placement[] = []
        const placement: Placement = {
          id: generateId(),
          floorId: primaryFloorId,
          layer: 'electrical',
          pos: {
            x: fallbackOrigin.x + (fallbackPlacementIndex % 8) * 36,
            y: fallbackOrigin.y + Math.floor(fallbackPlacementIndex / 8) * 36,
          },
          rotationDeg: 0,
          scale: 1,
        }
        fallbackPlacements.push(placement)
        if (node.multiplierCount && node.multiplierCount > 1 && endpointSupportsMultiplier(endpoint)) {
          for (let i = 1; i < node.multiplierCount; i += 1) {
            fallbackPlacements.push({
              id: generateId(),
              floorId: primaryFloorId,
              layer: 'electrical',
              pos: {
                x: placement.pos.x + (i % 3) * 20,
                y: placement.pos.y + Math.floor(i / 3) * 20,
              },
              rotationDeg: placement.rotationDeg,
              scale: placement.scale,
            })
          }
        }
        endpoint.placements.push(...fallbackPlacements)
        if (hiddenSitplanPlacementIdsByFloorOut) {
          const hidden = hiddenSitplanPlacementIdsByFloorOut.get(primaryFloorId) ?? []
          hidden.push(...fallbackPlacements.map((p) => p.id))
          hiddenSitplanPlacementIdsByFloorOut.set(primaryFloorId, hidden)
        }
        fallbackPlacementIndex += 1
      }
      endpoints.push(endpoint)
      sourceNodeByEndpointId.set(endpoint.id, node)
      endpointIdByNodeId.set(node.id, endpoint.id)
      endpointBranchKeys.push(node.branchKey?.trim() || `struct-${endpoints.length + 1}`)
      satelliteNotasPerNode.push(node.satelliteNotas)
      satelliteMarksPerNode.push(node.satelliteMarks)
    }

    const preMergeEndpoints = endpoints.slice()

    for (const relation of trikCircuit.switchControls) {
      const source = trikCircuit.nodes.find((node) => node.id === relation.switchId)
      const target = trikCircuit.nodes.find((node) => node.id === relation.lightId)
      if (!source || !target) continue
      const sourceEndpoint = endpoints[trikCircuit.nodes.indexOf(source)]
      const targetEndpoint = endpoints[trikCircuit.nodes.indexOf(target)]
      if (!sourceEndpoint || !targetEndpoint || sourceEndpoint.type !== 'switch') continue
      sourceEndpoint.controlledEndpointIds = [targetEndpoint.id]
    }

    const merged = mergeBranchMultiplierEndpoints(endpoints, endpointBranchKeys)
    endpoints.length = 0
    endpoints.push(...merged.endpoints)
    endpointBranchKeys.length = 0
    endpointBranchKeys.push(...merged.endpointBranchKeys)
    if (merged.absorbedToKeep.size > 0) {
      for (const endpoint of endpoints) {
        if (!endpoint.controlledEndpointIds?.length) continue
        endpoint.controlledEndpointIds = endpoint.controlledEndpointIds.map(
          (controlledId) => merged.absorbedToKeep.get(controlledId) ?? controlledId,
        )
      }
    }
    const remapEndpointId = (id: string): string => {
      let cur = id
      while (merged.absorbedToKeep.has(cur)) {
        cur = merged.absorbedToKeep.get(cur) as string
      }
      return cur
    }

    const mergedEndpointIdForPreMerge = (preIdx: number): string | undefined => {
      const start = preMergeEndpoints[preIdx]
      if (!start) return undefined
      const id = remapEndpointId(start.id)
      return merged.endpoints.some((e) => e.id === id) ? id : undefined
    }
    for (let preIdx = 0; preIdx < satelliteNotasPerNode.length; preIdx += 1) {
      const notas = satelliteNotasPerNode[preIdx]
      if (!notas?.length) continue
      const endpointId = mergedEndpointIdForPreMerge(preIdx)
      if (!endpointId) continue
      for (const sn of notas) {
        pendingTrikEendraadNotesOut.push({
          panelId: panel.id,
          endpointId,
          text: sn.text,
          offsetX: sn.offsetX,
          offsetY: sn.offsetY,
        })
      }
    }

    // Map endpoints found inside DomoticaModule trees to domotica child outputs.
    // If one module has >20 children, split over cloned modules in chunks of 20.
    const domoticaChildIdsByParentNodeId = new Map<string, string[]>()
    for (const [endpointId, sourceNode] of sourceNodeByEndpointId.entries()) {
      const parentNodeId = sourceNode.domoticaParentNodeId
      if (!parentNodeId) continue
      // Direct children include nested modules (TRiK PLC → expansion module stacks).
      if (!sourceNode.domoticaDirectChild) continue
      const remappedChildId = remapEndpointId(endpointId)
      const list = domoticaChildIdsByParentNodeId.get(parentNodeId) ?? []
      if (!list.includes(remappedChildId)) list.push(remappedChildId)
      domoticaChildIdsByParentNodeId.set(parentNodeId, list)
    }
    const endpointById = new Map(endpoints.map((ep) => [ep.id, ep]))
    const branchKeyByEndpointId = new Map(endpoints.map((ep, idx) => [ep.id, endpointBranchKeys[idx] ?? '1']))
    const DOMOTICA_OUTPUT_LIMIT = 20
    const endpointIndexById = new Map(endpoints.map((ep, idx) => [ep.id, idx]))
    for (const [parentNodeId, childIds] of domoticaChildIdsByParentNodeId.entries()) {
      const parentEndpointId = endpointIdByNodeId.get(parentNodeId)
      if (!parentEndpointId) continue
      const remappedParentId = remapEndpointId(parentEndpointId)
      const parentEndpoint = endpointById.get(remappedParentId)
      if (!parentEndpoint || parentEndpoint.type !== 'domotica') continue

      const chunkedChildIds: string[][] = []
      for (let idx = 0; idx < childIds.length; idx += DOMOTICA_OUTPUT_LIMIT) {
        chunkedChildIds.push(childIds.slice(idx, idx + DOMOTICA_OUTPUT_LIMIT))
      }
      const moduleEndpointIds: string[] = [parentEndpoint.id]
      const parentBranchKey = branchKeyByEndpointId.get(parentEndpoint.id) ?? '1'
      // Keep all descendants on the same branch as the domotica module (no extra A2/A3… flattening).
      for (const [endpointId, sourceNode] of sourceNodeByEndpointId.entries()) {
        if (sourceNode.domoticaParentNodeId !== parentNodeId) continue
        if (sourceNode.type === 'domotica' && !sourceNode.domoticaDirectChild) continue
        const remappedId = remapEndpointId(endpointId)
        const idx = endpointIndexById.get(remappedId)
        if (idx == null) continue
        endpointBranchKeys[idx] = parentBranchKey
        // Parents are visited before nested modules, which then inherit this branch.
        branchKeyByEndpointId.set(remappedId, parentBranchKey)
      }
      for (let idx = 1; idx < chunkedChildIds.length; idx += 1) {
        const clone: Endpoint = {
          ...parentEndpoint,
          id: generateId(),
          controlledEndpointIds: parentEndpoint.controlledEndpointIds ? [...parentEndpoint.controlledEndpointIds] : undefined,
          domoticaProps: parentEndpoint.domoticaProps ? { ...parentEndpoint.domoticaProps } : undefined,
        }
        endpoints.push(clone)
        endpointBranchKeys.push(branchKeyByEndpointId.get(parentEndpoint.id) ?? '1')
        endpointIndexById.set(clone.id, endpoints.length - 1)
        endpointById.set(clone.id, clone)
        moduleEndpointIds.push(clone.id)
      }
      const outputSlotByRootNodeId = new Map<string, { parentEndpointId: string; outputIndex: number }>()
      chunkedChildIds.forEach((chunk, chunkIdx) => {
        const moduleEndpoint = endpointById.get(moduleEndpointIds[chunkIdx] as string)
        if (!moduleEndpoint) return
        const chunkNodeByEndpointId = new Map<string, TrikNode>()
        for (const [epId, sourceNode] of sourceNodeByEndpointId.entries()) {
          if (!sourceNode.domoticaDirectChild) continue
          const remappedId = remapEndpointId(epId)
          if (chunk.includes(remappedId)) chunkNodeByEndpointId.set(remappedId, sourceNode)
        }
        moduleEndpoint.domoticaProps = {
          ...(moduleEndpoint.domoticaProps ?? {}),
          endpointCount: Math.max(1, chunk.length),
          endpointChildEndpointIds: chunk,
        }
        chunk.forEach((childEndpointId, outputIndex) => {
          const sourceNode = chunkNodeByEndpointId.get(childEndpointId)
          if (sourceNode?.domoticaOutputRootNodeId) {
            outputSlotByRootNodeId.set(sourceNode.domoticaOutputRootNodeId, {
              parentEndpointId: moduleEndpoint.id,
              outputIndex,
            })
          }
          const childEndpoint = endpointById.get(childEndpointId)
          if (!childEndpoint) return
          childEndpoint.domoticaChildProps = {
            parentEndpointId: moduleEndpoint.id,
            outputGroup: 'endpoint',
            outputIndex,
            ...(sourceNode?.controlChannel ? { channel: sourceNode.controlChannel } : {}),
          }
        })
      })

      // Include deeper descendants of each direct child on the same domotica output row.
      for (const [epId, sourceNode] of sourceNodeByEndpointId.entries()) {
        if (sourceNode.domoticaParentNodeId !== parentNodeId) continue
        if (sourceNode.domoticaDirectChild || sourceNode.type === 'domotica') continue
        const outputRootNodeId = sourceNode.domoticaOutputRootNodeId
        if (!outputRootNodeId) continue
        const slot = outputSlotByRootNodeId.get(outputRootNodeId)
        if (!slot) continue
        const remappedId = remapEndpointId(epId)
        const childEndpoint = endpointById.get(remappedId)
        if (!childEndpoint) continue
        childEndpoint.domoticaChildProps = {
          parentEndpointId: slot.parentEndpointId,
          outputGroup: 'endpoint',
          outputIndex: slot.outputIndex,
        }
      }
    }
    for (let preIdx = 0; preIdx < satelliteMarksPerNode.length; preIdx += 1) {
      const marks = satelliteMarksPerNode[preIdx]
      if (!marks?.length) continue
      const endpointId = mergedEndpointIdForPreMerge(preIdx)
      if (!endpointId) continue
      for (const sm of marks) {
        pendingTrikFrameMarkCornersOut.push({
          panelId: panel.id,
          endpointId,
          markId: sm.markId,
          buddyId: sm.buddyId,
          isMain: sm.isMain,
          offsetX: sm.offsetX,
          offsetY: sm.offsetY,
        })
      }
    }

    const branchOrder: string[] = []
    const branchEndpointIds = new Map<string, string[]>()
    endpointBranchKeys.forEach((key, index) => {
      if (!branchEndpointIds.has(key)) {
        branchEndpointIds.set(key, [])
        branchOrder.push(key)
      }
      const endpoint = endpoints[index]
      if (endpoint) branchEndpointIds.get(key)?.push(endpoint.id)
    })
    const branchNumberByKey = new Map<string, number>()
    branchOrder.forEach((key, index) => {
      branchNumberByKey.set(key, index + 1)
    })
    endpoints.forEach((endpoint, index) => {
      const key = endpointBranchKeys[index]
      const branchNumber = key ? branchNumberByKey.get(key) : undefined
      const n = branchNumber ?? 1
      endpoint.label = circuitCode ? `${circuitCode}${n}` : String(n)
    })
    const branches: Branch[] = branchOrder.map((key, index) => {
      const devicesForBranch = (trikCircuit.branchDevices ?? [])
        .filter((device) => device.branchKey === key)
        .map((device, deviceIndex): TrunkDevice => ({
          id: generateId(),
          type: 'protection',
          symbol: 'fuse',
          label: device.label?.trim() || (circuitCode ? `${circuitCode}${index + 1}F` : `${index + 1}F`),
          protectionType: 'FUSE',
          ratingA: device.ratingA,
          notes: device.notes,
          trunkPosition: deviceIndex,
        }))
      return {
        id: generateId(),
        label: circuitCode ? `${circuitCode}${index + 1}` : String(index + 1),
        endpointIds: branchEndpointIds.get(key) ?? [],
        branchDevices: devicesForBranch.length > 0 ? devicesForBranch : undefined,
      }
    })

    const circuitTrunkDevices = (trikCircuit.trunkDevices ?? []).map((device, index): TrunkDevice => {
      if (device.kind === 'converter') {
        // The inverter keeps the plan position TRiK gave the module.
        const placements: Placement[] = []
        for (const [placementFloorId, floorPlanNodes] of planNodesByFloor) {
          for (const planNode of floorPlanNodes.get(device.id) ?? []) {
            placements.push({
              id: generateId(),
              floorId: placementFloorId,
              layer: 'electrical',
              pos: scaledPoint({ x: planNode.x, y: planNode.y }),
              rotationDeg: roundRotationDeg(planNode.rotationRad),
              scale: 1,
            })
          }
        }
        return {
          ...(placements.length > 0 ? { placements } : {}),
          id: trunkDeviceIdByTrikId.get(device.id) ?? generateId(),
          type: 'conversion',
          symbol: device.converterSymbol ?? 'inverter',
          label: device.label?.trim() || '',
          notes: device.notes,
          conversionProps: { ...device.conversionProps, dcConnectionCount: device.dcConnectionCount ?? 1 },
          trunkPosition: index,
        }
      }
      if (device.kind === 'transformer') {
        return {
          id: generateId(),
          type: 'conversion',
          symbol: 'transformer',
          label: device.label?.trim() || 'Trafo',
          trunkPosition: index,
        }
      }
      if (device.kind === 'energy_meter') {
        return {
          id: generateId(),
          type: 'energy_meter',
          symbol: 'energy_meter',
          label: device.label?.trim() || 'kWh',
          energyMeterProps: {
            polesConfig: device.polesConfig,
            poles: device.poles,
          },
          trunkPosition: index,
        }
      }
      return {
        id: generateId(),
        type: 'protection',
        symbol: device.protectionType === 'FUSE' ? 'fuse' : 'mcb',
        label: device.label?.trim() || `T${index + 1}`,
        protectionType: device.protectionType ?? 'MCB',
        ratingA: device.ratingA,
        sensitivityMa: device.sensitivityMa,
        residualCurrentType: device.residualCurrentType,
        polesConfig: device.polesConfig,
        poles: device.poles,
        curve: device.curve,
        breakingCapacityKa: device.breakingCapacityKa,
        trunkPosition: index,
      }
    })

    const circuit: Circuit = {
      id: generateId(),
      code: circuitCode,
      ...(manualCodeLock ? { eendraadManualCodeLock: true as const } : {}),
      kind: inferCircuitKind(endpoints),
      cable: {
        kind: normalizeCableKind(trikCircuit.cableKind),
        conductors: trikCircuit.cableConductors ?? 3,
        sectionMm2: trikCircuit.cableSectionMm2 ?? 2.5,
        hasPE: trikCircuit.cableHasPe ?? true,
      },
      inTube: trikCircuit.inTube,
      notes: trikCircuit.name?.trim() || undefined,
      endpoints,
      branches: endpoints.length > 0 || circuitTrunkDevices.length > 0 ? branches : undefined,
      trunkDevices: circuitTrunkDevices.length > 0 ? circuitTrunkDevices : undefined,
    }
    const isRotatingSwitch = trikCircuit.protectionType === 'ROTATING_SWITCH'
    const isSpd = trikCircuit.protectionType === 'SPD'
    const protection: ProtectionDevice = {
      id: generateId(),
      type: trikCircuit.protectionType ?? 'MCB',
      label: circuitCode,
      ratingA: isSpd || isRotatingSwitch ? trikCircuit.ratingA : (trikCircuit.ratingA ?? 16),
      sensitivityMa: trikCircuit.sensitivityMa,
      residualCurrentType: trikCircuit.residualCurrentType,
      polesConfig: trikCircuit.polesConfig,
      poles: trikCircuit.poles,
      breakingCapacityKa: trikCircuit.breakingCapacityKa,
      ...(isSpd ? { surgeProtectionKind: 'standard' as const } : {}),
      curve:
        isSpd || isRotatingSwitch
          ? trikCircuit.curve === 'B' || trikCircuit.curve === 'C' || trikCircuit.curve === 'D'
            ? trikCircuit.curve
            : undefined
          : trikCircuit.curve === 'B' || trikCircuit.curve === 'C' || trikCircuit.curve === 'D'
            ? trikCircuit.curve
            : 'C',
      circuits: [circuit],
    }
    panel.protections.push(protection)
    importsBySourceId.set(trikCircuit.id, { circuit, protection, source: trikCircuit })
  }

  for (const imported of importsBySourceId.values()) {
    if (imported.source.childCircuitIds.length === 0) continue
    const resolved = imported.source.childCircuitIds
      .map((sourceId) => importsBySourceId.get(sourceId)?.circuit.id)
      .filter((id): id is string => !!id)
    if (resolved.length > 0) {
      imported.circuit.subCircuitIds = resolved
    }
  }
  return importsBySourceId
}

export function createImportedTrikPanelScaffold(name: string, isMain: boolean): Panel {
  return {
    id: generateId(),
    name,
    symbol: 'panel_distribution',
    isMain,
    protections: [],
    circuits: [],
    subPanels: [],
  }
}

export function ensureImportedTrikPanelCircuit(
  panel: Panel,
  primaryFloorId: string,
  preferredPos?: { x: number; y: number },
): Circuit {
  let panelCircuit = panel.circuits.find((circuit) => circuit.code === 'PANEL')
  if (!panelCircuit) {
    panelCircuit = {
      id: generateId(),
      code: 'PANEL',
      kind: 'other',
      cable: {
        kind: 'XVB',
        conductors: 3,
        sectionMm2: 6,
        hasPE: true,
      },
      endpoints: [],
    }
    panel.circuits.push(panelCircuit)
  }
  let panelEndpoint = panelCircuit.endpoints.find((endpoint) => endpoint.symbol === 'panel_distribution')
  if (!panelEndpoint) {
    panelEndpoint = {
      id: generateId(),
      type: 'fixed_appliance',
      label: panel.name,
      panelId: panel.id,
      symbol: 'panel_distribution',
      placements: [],
    }
    panelCircuit.endpoints.push(panelEndpoint)
  } else {
    panelEndpoint.label = panel.name
    panelEndpoint.panelId = panel.id
  }
  if (panelEndpoint.placements.length === 0) {
    panelEndpoint.placements.push({
      id: generateId(),
      floorId: primaryFloorId,
      layer: 'electrical',
      pos: preferredPos ?? { x: 300, y: 300 },
      rotationDeg: 0,
      scale: 1,
    })
  }
  return panelCircuit
}

export function applyTrikPanelLocalSupplyDevices(
  panel: Panel,
  devices: TrikCircuitTrunkDevice[] | undefined,
): void {
  if (!devices?.length) return
  const panelCircuit = panel.circuits.find((circuit) => circuit.code === 'PANEL')
  if (!panelCircuit) return
  panelCircuit.trunkDevices = devices.map((device, index): TrunkDevice => {
    const explicitLabel = device.label?.trim() || undefined
    const hideUnnamedLabel =
      !explicitLabel
        ? ({
            symbolLabelDisplay: { visibility: { supplyProtectionNameLabel: false } },
          } as const)
        : undefined
    if (device.kind === 'energy_meter') {
      return {
        id: generateId(),
        type: 'energy_meter',
        symbol: 'energy_meter',
        label: explicitLabel ?? '',
        ...hideUnnamedLabel,
        energyMeterProps: {
          polesConfig: device.polesConfig,
          poles: device.poles,
        },
        trunkPosition: index,
      }
    }
    if (device.kind === 'transformer') {
      return {
        id: generateId(),
        type: 'conversion',
        symbol: 'transformer',
        label: explicitLabel || 'Trafo',
        trunkPosition: index,
      }
    }
    const isRcd =
      device.protectionType === 'RCD' ||
      device.protectionType === 'RCBO' ||
      (device.sensitivityMa != null && device.sensitivityMa > 0)
    return {
      id: generateId(),
      type: 'protection',
      symbol: device.protectionType === 'FUSE' ? 'fuse' : isRcd ? 'rcd' : 'mcb',
      label: explicitLabel ?? '',
      ...hideUnnamedLabel,
      protectionType: device.protectionType ?? (isRcd ? 'RCBO' : 'MCB'),
      ratingA: device.ratingA,
      sensitivityMa: device.sensitivityMa,
      residualCurrentType: device.residualCurrentType,
      polesConfig: device.polesConfig,
      poles: device.poles,
      curve: device.curve,
      breakingCapacityKa: device.breakingCapacityKa,
      trunkPosition: index,
    }
  })
}

/**
 * Main-panel supply after the Kast demarcation (diff + second meter, etc.) must live on
 * the root feed path — that is what the one-wire supply wire renders. Subpanels keep
 * the same devices on their PANEL circuit trunk.
 */
export function promoteMainPanelLocalSupplyToRootFeed(project: Project): void {
  const panels = project.panels
  const mainPanel = panels.find((panel) => panel.isMain) ?? panels[0]
  if (!mainPanel) return
  const panelCircuit = mainPanel.circuits.find((circuit) => circuit.code === 'PANEL')
  if (!panelCircuit?.trunkDevices?.length) return
  const devices = panelCircuit.trunkDevices

  const topology = ensureInstallationFeedTopology(project.installation, panels)
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === mainPanel.id)
  if (!rootFeed) return
  rootFeed.trunkDevices = devices.map((device, index) => ({
    ...device,
    trunkPosition: index,
  }))
  // Avoid duplicating the same devices on the PANEL circuit for a main board.
  panelCircuit.trunkDevices = undefined
}

/**
 * Empty-project defaults leave a Main RCBO on the root feed and grid slots that point at
 * those default device ids. Trik import replaces shared trunk devices with new ids, so rebuild
 * the main-panel supply grid from the live shared/root feed split (utility strip vs panel).
 */
export function syncTrikImportedMainPanelSupplyGrid(project: Project): void {
  const panels = project.panels
  const mainPanel = panels.find((panel) => panel.isMain) ?? panels[0]
  if (!mainPanel) return
  const topology = ensureInstallationFeedTopology(project.installation, panels)
  const shared = [...(topology.sharedFeed.trunkDevices ?? [])]
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === mainPanel.id)
  const root = [...(rootFeed?.trunkDevices ?? [])]
  const polesForWidth = (device: TrunkDevice): number => {
    const poles = device.poles ?? device.energyMeterProps?.poles
    if (poles === 1 || poles === 2 || poles === 3 || poles === 4) return poles
    const config = device.polesConfig ?? device.energyMeterProps?.polesConfig
    if (config === '1P' || config === '1P+N') return 1
    if (config === '2P') return 2
    if (config === '3P' || config === '3P+N') return 3
    if (config === '4P') return 4
    return 2
  }
  let supplyCol = 0
  const supplyPanelSlots = shared.map((device) => {
    const moduleWidth = polesForWidth(device)
    const slot = {
      row: 0,
      col: supplyCol,
      moduleWidth,
      module: { kind: 'trunkDevice' as const, id: device.id, scope: 'supply' as const },
    }
    supplyCol += moduleWidth
    return slot
  })
  let mainCol = 0
  const mainSlots = root.map((device) => {
    const moduleWidth = polesForWidth(device)
    const slot = {
      row: 0,
      col: mainCol,
      moduleWidth,
      module: { kind: 'trunkDevice' as const, id: device.id, scope: 'supply' as const },
    }
    mainCol += moduleWidth
    return slot
  })
  if (!mainPanel.gridView) {
    mainPanel.gridView = {
      rows: 4,
      columns: 18,
      feedFromTop: false,
      slots: [],
    }
  }
  // Drop stale empty-project supply module refs; keep non-supply modules already placed.
  mainPanel.gridView.slots = [
    ...mainSlots,
    ...(mainPanel.gridView.slots ?? []).filter((slot) => slot.module.kind !== 'trunkDevice' || slot.module.scope !== 'supply'),
  ]
  mainPanel.gridView.supplyPanelSlots = supplyPanelSlots
  mainPanel.gridView.supplyPanelVisible = supplyPanelSlots.length > 0
}

function findImportedProtectionByOutboundHint(
  importsBySourceId: Map<string, TrikCircuitImportResult>,
  targetPanelName: string,
): TrikCircuitImportResult | undefined {
  for (const imported of importsBySourceId.values()) {
    if (trikNotasMentionPanel(imported.source.outboundPanelNotas, targetPanelName)) {
      return imported
    }
  }
  return undefined
}

function synthesizeFeederImport(
  panel: Panel,
  feeder: TrikCircuit,
  targetPanel: Panel,
): TrikCircuitImportResult {
  const usedCodes = new Set(
    panel.protections.flatMap((protection) => [
      protection.label,
      ...(protection.circuits ?? []).map((circuit) => circuit.code),
    ]),
  )
  const rawFixed = feeder.fixedLetter?.trim()
  // Feeder AS devices without VasteLetter stay unlabeled — do not invent A/B/C.
  const circuitCode = rawFixed && !usedCodes.has(rawFixed) ? rawFixed : ''
  const manualCodeLock = !!rawFixed && circuitCode === rawFixed
  if (circuitCode) usedCodes.add(circuitCode)
  const isRotatingSwitch = feeder.protectionType === 'ROTATING_SWITCH'
  const circuit: Circuit = {
    id: generateId(),
    code: circuitCode,
    ...(manualCodeLock ? { eendraadManualCodeLock: true as const } : {}),
    kind: 'empty',
    cable: {
      kind: normalizeCableKind(feeder.cableKind),
      conductors: feeder.cableConductors ?? 3,
      sectionMm2: feeder.cableSectionMm2 ?? 2.5,
      hasPE: feeder.cableHasPe ?? true,
    },
    inTube: feeder.inTube,
    notes: feeder.name?.trim() || targetPanel.name,
    endpoints: [],
  }
  const protection: ProtectionDevice = {
    id: generateId(),
    type: feeder.protectionType ?? 'MCB',
    label: circuitCode,
    ratingA: isRotatingSwitch ? feeder.ratingA : (feeder.ratingA ?? 16),
    sensitivityMa: feeder.sensitivityMa,
    residualCurrentType: feeder.residualCurrentType,
    polesConfig: feeder.polesConfig,
    poles: feeder.poles,
    breakingCapacityKa: feeder.breakingCapacityKa,
    curve:
      isRotatingSwitch
        ? feeder.curve === 'B' || feeder.curve === 'C' || feeder.curve === 'D'
          ? feeder.curve
          : undefined
        : feeder.curve === 'B' || feeder.curve === 'C' || feeder.curve === 'D'
          ? feeder.curve
          : 'C',
    circuits: [circuit],
    subPanelId: targetPanel.id,
  }
  panel.protections.push(protection)
  return { circuit, protection, source: feeder }
}

/**
 * Nest multipanel TRiK boards under parents when there is evidence of a feed link.
 * Evidence is a Nota that mentions a known panel name (outbound on a feeder circuit
 * and/or inbound on the child board). Without that, boards stay separate main panels
 * on the supply so the user can rewire them — we do not invent a hierarchy.
 */
export function linkTrikPanelBoards(
  project: Project,
  boards: TrikPanelBoard[],
  panelByBoardId: Map<string, Panel>,
  importsByBoardId: Map<string, Map<string, TrikCircuitImportResult>>,
): void {
  if (boards.length <= 1) return

  const panelByName = new Map<string, Panel>()
  const knownPanelNames = boards.map((board) => board.name)
  for (const board of boards) {
    const panel = panelByBoardId.get(board.trikBoardId)
    if (!panel) continue
    panelByName.set(normalizeTrikPanelNameKey(board.name), panel)
    // Optimistic: every board is a main until evidence nests it.
    panel.isMain = true
  }

  for (const board of boards) {
    const childPanel = panelByBoardId.get(board.trikBoardId)
    if (!childPanel) continue
    // Supply-spine boards are independent mains even if notas mention them.
    if (board.onSupplySpine) continue

    let parentPanel: Panel | undefined
    let hintedFeeder: TrikCircuitImportResult | undefined
    for (const [sourceBoardId, imports] of importsByBoardId) {
      if (sourceBoardId === board.trikBoardId) continue
      const feeder = findImportedProtectionByOutboundHint(imports, board.name)
      if (!feeder) continue
      parentPanel = panelByBoardId.get(sourceBoardId)
      hintedFeeder = feeder
      break
    }

    if (!parentPanel) {
      const inboundMatchedName = matchTrikPanelNameInText(board.inboundPanelNota, knownPanelNames)
      if (inboundMatchedName) {
        parentPanel = panelByName.get(normalizeTrikPanelNameKey(inboundMatchedName))
      }
    }

    if (!parentPanel || parentPanel.id === childPanel.id) {
      continue
    }

    childPanel.isMain = false
    if (hintedFeeder) {
      hintedFeeder.protection.subPanelId = childPanel.id
    } else if (board.incomingFeeder) {
      synthesizeFeederImport(parentPanel, board.incomingFeeder, childPanel)
    }

    const rootIndex = project.panels.findIndex((panel) => panel.id === childPanel.id)
    if (rootIndex >= 0) project.panels.splice(rootIndex, 1)
    parentPanel.subPanels = parentPanel.subPanels ?? []
    if (!parentPanel.subPanels.some((panel) => panel.id === childPanel.id)) {
      parentPanel.subPanels.push(childPanel)
    }
  }

  for (const board of boards) {
    const panel = panelByBoardId.get(board.trikBoardId)
    if (!panel?.isMain) continue
    if (!project.panels.some((root) => root.id === panel.id)) {
      project.panels.push(panel)
    }
  }
}

export function computeFallbackPlacementOrigin(
  planNodes: Map<string, TrikPlanNode[]>,
  panelPlacementOrigin: { x: number; y: number },
): { x: number; y: number } {
  const scaledNodes = Array.from(planNodes.values())
    .flatMap((nodes) => nodes)
    .map((node) => scaledPoint({ x: node.x, y: node.y }))
  const minX = scaledNodes.length > 0 ? Math.min(...scaledNodes.map((point) => point.x)) : panelPlacementOrigin.x
  const minY = scaledNodes.length > 0 ? Math.min(...scaledNodes.map((point) => point.y)) : panelPlacementOrigin.y
  return {
    // Keep X close to imported content so hidden/off-canvas symbols are still easy to find.
    x: Math.max(40, minX),
    // Reserve a strip above TRiK canvas to avoid collisions with real imported placements/panel.
    y: Math.min(-120, minY - 120),
  }
}

export function computeDefaultPanelPlacementOrigin(planNodes: Map<string, TrikPlanNode[]>): { x: number; y: number } {
  const scaledNodes = Array.from(planNodes.values())
    .flatMap((nodes) => nodes)
    .map((node) => scaledPoint({ x: node.x, y: node.y }))
  if (scaledNodes.length === 0) return { x: 300, y: 300 }
  const minX = Math.min(...scaledNodes.map((p) => p.x))
  const minY = Math.min(...scaledNodes.map((p) => p.y))
  // Place the distribution board top-left of the imported content so:
  // - it never sits on TRiK's (0,0) by accident
  // - endpoints (typically to the right) remain visually separated
  return {
    x: Math.max(40, minX - 220),
    y: Math.min(minY - 80, minY),
  }
}

/**
 * Expand TRiK's single live-phase mark into a Condui assignment.
 * 3N~ 1–2P → Ln+N; 3~ 2P → Ln+(next); 3+ pole breakers keep the full set (no override).
 */
export function mapTrikFaseToPhaseAssignment(
  fase: 'L1' | 'L2' | 'L3',
  system: Project['installation']['nominalVoltage']['system'] | undefined,
  poles: number | undefined,
): CircuitPhaseAssignment | undefined {
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  if (!supportsExplicitPhaseSelection(normalized)) return undefined
  const poleCount = poles ?? 2
  if (poleCount >= 3) return undefined

  if (normalized === '3N~') {
    return {
      kind: 'single_phase',
      phases: [fase, 'N'],
      neutral: 'used',
      source: 'manual',
    }
  }
  if (normalized === '3~') {
    const next = fase === 'L1' ? 'L2' : fase === 'L2' ? 'L3' : 'L1'
    return {
      kind: 'phase_to_phase',
      phases: [fase, next],
      neutral: 'not_present',
      source: 'manual',
    }
  }
  return undefined
}

function phaseAssignmentsMatchElectrically(
  left: CircuitPhaseAssignment | undefined,
  right: CircuitPhaseAssignment | undefined,
): boolean {
  if (!left && !right) return true
  if (!left || !right) return false
  if (left.kind !== right.kind) return false
  if (left.phases.length !== right.phases.length) return false
  const rightSet = new Set(right.phases)
  return left.phases.every((phase) => rightSet.has(phase))
}

/**
 * Persist TRiK `Fase` marks only when they disagree with Condui's automatic busbar
 * rotation. Matching marks stay unset so the automatic system keeps owning them.
 */
export function applyTrikImportedPhaseMarks(
  project: Project,
  importsByBoardId: Map<string, Map<string, TrikCircuitImportResult>>,
): void {
  const system = project.installation.nominalVoltage?.system
  if (!supportsExplicitPhaseSelection(system)) return
  const panels = flattenProjectPanels(project.panels)

  for (const imports of importsByBoardId.values()) {
    for (const imported of imports.values()) {
      const fase = imported.source.fase
      if (!fase) continue
      const proposed = mapTrikFaseToPhaseAssignment(
        fase,
        system,
        imported.protection.poles ?? imported.source.poles,
      )
      if (!proposed) continue
      const automatic = getAutomaticBusbarPhaseAssignment(
        imported.circuit,
        panels,
        system,
      )
      if (phaseAssignmentsMatchElectrically(proposed, automatic)) continue
      imported.circuit.phaseAssignment = proposed
    }
  }
}
