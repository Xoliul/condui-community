import {
  findPanelContainingCircuit,
  getDefaultPanelGridModuleRefs,
  getAllCircuits,
  panelGridModuleIsAlwaysVisibleInPanel,
  panelGridModuleIsVisibleByDefault,
  panelGridModuleRefKey,
} from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import {
  readLegacyCompatibilityFloors,
  mutateBuildingFloorViews,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { Endpoint, Placement, TrunkDevice } from '@/types/schema'
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import { getAllSupplyTrunkDevices, getPanelSupplyTrunkDevices } from '@/lib/feedTopology'
import { findConverterBackupPanelFeed } from '@/lib/panel/converterBackupPanelFeed'
import { isSupplyDeviceVisibleInPanel, setSupplyDevicePanelVisibility } from '@/lib/panel/supplyPanelVisibility'

type PanelPlanVisibilityProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building

type PlacementOwner = {
  placements: Placement[]
  visibleInAnyPanel: boolean
  independentVisibility: boolean
}

type PanelVisibilityIntent =
  | { kind: 'show'; panelId: string; moduleRefKey: string }
  | { kind: 'hide'; panelId: string; moduleRefKey: string }

type PanelModuleOccurrence = {
  panel: Panel
  ref: PanelGridModuleRef
  refKey: string
  visible: boolean
  explicitlyHidden: boolean
  explicitlyShown: boolean
}

function moduleOwnerKey(ref: PanelGridModuleRef): string {
  if (ref.kind === 'protection') return `protection:${ref.id}`
  if (ref.kind === 'trunkDevice') return `trunk:${ref.id}`
  return `endpoint:${ref.endpointId}`
}

function ensurePanelGridView(panel: Panel): NonNullable<Panel['gridView']> {
  panel.gridView ??= {
    rows: 8,
    columns: 12,
    feedFromTop: false,
    slots: [],
  }
  return panel.gridView
}

/**
 * Older backup-board projection temporarily stored the real inverter and its
 * upstream feeder as modules in the fed board. They are now represented by a
 * virtual incoming source, so move inverter visibility back to its owning panel
 * and remove the stale borrowed slots.
 */
function healConverterBackupPanelProjection(project: PanelPlanVisibilityProject): boolean {
  const panels = selectProjectElectricalPanels(project)
  let changed = false
  for (const panel of walkPanels(panels)) {
    const feed = findConverterBackupPanelFeed(project, panel.id)
    if (!feed || !panel.gridView) continue
    const converterKey = panelGridModuleRefKey(feed.converterRef)
    const protectionKey = panelGridModuleRefKey(feed.protectionRef)
    const converter = getAllSupplyTrunkDevices(project).find((device) => device.id === feed.converterId)
    const physicallyMountedHere = converter?.panelMounting?.kind === 'panel' && converter.panelMounting.panelId === panel.id
    const borrowedKeys = new Set(physicallyMountedHere ? [protectionKey] : [converterKey, protectionKey])
    const sourcePanel = findPanelById(panels, feed.sourcePanelId)

    if (!physicallyMountedHere && panel.gridView.hiddenModuleKeys?.includes(converterKey) && sourcePanel) {
      const sourceGrid = ensurePanelGridView(sourcePanel)
      const sourceHidden = sourceGrid.hiddenModuleKeys ?? []
      if (!sourceHidden.includes(converterKey)) {
        sourceGrid.hiddenModuleKeys = [...sourceHidden, converterKey]
        changed = true
      }
      if (sourceGrid.shownModuleKeys?.includes(converterKey)) {
        sourceGrid.shownModuleKeys = sourceGrid.shownModuleKeys.filter(
          (key) => key !== converterKey,
        )
        if (sourceGrid.shownModuleKeys.length === 0) sourceGrid.shownModuleKeys = undefined
        changed = true
      }
      const placementIds = new Set((converter?.placements ?? []).map((placement) => placement.id))
      if (placementIds.size > 0 && converter?.symbol !== 'inverter') {
        mutateBuildingFloorViews(project, (floors) => {
          for (const floor of floors) {
            const previous = floor.hiddenSitplanPlacementIds ?? []
            const next = previous.filter((id) => !placementIds.has(id))
            if (next.length === previous.length) continue
            floor.hiddenSitplanPlacementIds = next.length > 0 ? next : undefined
            changed = true
          }
        })
      }
    }

    const slots = panel.gridView.slots ?? []
    const nextSlots = slots.filter((slot) => !borrowedKeys.has(panelGridModuleRefKey(slot.module)))
    if (nextSlots.length !== slots.length) {
      panel.gridView.slots = nextSlots
      changed = true
    }
    const supplySlots = panel.gridView.supplyPanelSlots ?? []
    const nextSupplySlots = supplySlots.filter(
      (slot) => !borrowedKeys.has(panelGridModuleRefKey(slot.module)),
    )
    if (nextSupplySlots.length !== supplySlots.length) {
      panel.gridView.supplyPanelSlots = nextSupplySlots.length > 0 ? nextSupplySlots : undefined
      changed = true
    }
    for (const keyName of ['hiddenModuleKeys', 'shownModuleKeys'] as const) {
      const keys = panel.gridView[keyName] ?? []
      const nextKeys = keys.filter((key) => !borrowedKeys.has(key))
      if (nextKeys.length === keys.length) continue
      panel.gridView[keyName] = nextKeys.length > 0 ? nextKeys : undefined
      changed = true
    }
  }
  return changed
}

function collectPanelModuleOccurrences(
  project: PanelPlanVisibilityProject,
): Map<string, PanelModuleOccurrence[]> {
  const rootPanels = selectProjectElectricalPanels(project)
  const installation = selectProjectElectricalInstallation(project)
  const groups = new Map<string, PanelModuleOccurrence[]>()

  for (const panel of walkPanels(rootPanels)) {
    const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
    const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
    for (const ref of getDefaultPanelGridModuleRefs(panel, installation, rootPanels)) {
      const refKey = panelGridModuleRefKey(ref)
      const occurrence: PanelModuleOccurrence = {
        panel,
        ref,
        refKey,
        explicitlyHidden: hiddenKeys.has(refKey),
        explicitlyShown: shownKeys.has(refKey),
        visible:
          !hiddenKeys.has(refKey) &&
          (panelGridModuleIsVisibleByDefault(ref, panel, installation, rootPanels) ||
            shownKeys.has(refKey)),
      }
      const key = moduleOwnerKey(ref)
      groups.set(key, [...(groups.get(key) ?? []), occurrence])
    }
  }
  return groups
}

/** Enforce that one physical module can appear in at most one distribution panel. */
function normalizeUniquePanelModuleVisibility(
  project: PanelPlanVisibilityProject,
  intent?: PanelVisibilityIntent,
): boolean {
  const groups = collectPanelModuleOccurrences(project)

  const intendedOccurrence = intent
    ? [...groups.values()].flat().find(
        (item) => item.panel.id === intent.panelId && item.refKey === intent.moduleRefKey,
      )
    : undefined
  const intendedOwnerKey = intendedOccurrence ? moduleOwnerKey(intendedOccurrence.ref) : undefined
  const hiddenPlanPlacementIds = new Set(
    readLegacyCompatibilityFloors(project).flatMap(
      (floor) => floor.hiddenSitplanPlacementIds ?? [],
    ),
  )
  const planOwners = collectPanelPlanPlacementOwners(project)
  const inverterSupplyIds = new Set(getAllSupplyTrunkDevices(project).filter((device) => device.symbol === 'inverter').map((device) => device.id))
  let changed = false

  const setHidden = (occurrence: PanelModuleOccurrence, hidden: boolean): void => {
    const grid = ensurePanelGridView(occurrence.panel)
    const hiddenKeys = grid.hiddenModuleKeys ?? []
    const shownKeys = grid.shownModuleKeys ?? []
    if (hidden) {
      if (!hiddenKeys.includes(occurrence.refKey)) {
        grid.hiddenModuleKeys = [...hiddenKeys, occurrence.refKey]
        changed = true
      }
      if (shownKeys.includes(occurrence.refKey)) {
        grid.shownModuleKeys = shownKeys.filter((key) => key !== occurrence.refKey)
        if (grid.shownModuleKeys.length === 0) grid.shownModuleKeys = undefined
        changed = true
      }
      return
    }
    if (hiddenKeys.includes(occurrence.refKey)) {
      grid.hiddenModuleKeys = hiddenKeys.filter((key) => key !== occurrence.refKey)
      if (grid.hiddenModuleKeys.length === 0) grid.hiddenModuleKeys = undefined
      changed = true
    }
  }

  for (const [ownerKey, occurrences] of groups) {
    const matchingIntent = ownerKey === intendedOwnerKey ? intent : undefined
    const supplyRef = occurrences[0]?.ref
    if (supplyRef?.kind === 'trunkDevice' && supplyRef.scope === 'supply' && inverterSupplyIds.has(supplyRef.id)) {
      if (matchingIntent) changed = setSupplyDevicePanelVisibility(project, supplyRef.id, matchingIntent.kind === 'show') || changed
      continue
    }
    if (!matchingIntent && planOwners.get(ownerKey)?.independentVisibility) continue
    if (matchingIntent?.kind === 'hide') {
      for (const occurrence of occurrences) setHidden(occurrence, true)
      continue
    }

    let winner = matchingIntent?.kind === 'show'
      ? intendedOccurrence
      : occurrences.find((item) => item.explicitlyShown && item.visible) ??
        occurrences.find((item) => item.visible)
    const hiddenEverywhere =
      !winner &&
      !planOwners.get(ownerKey)?.independentVisibility &&
      occurrences.some((item) => item.explicitlyHidden) &&
      planOwners.get(ownerKey)?.placements.some((placement) =>
        hiddenPlanPlacementIds.has(placement.id),
      ) === true
    if (hiddenEverywhere) winner = occurrences[0]
    if (!winner) continue

    if (matchingIntent?.kind === 'show' || hiddenEverywhere) {
      const grid = ensurePanelGridView(winner.panel)
      const shownKeys = grid.shownModuleKeys ?? []
      if (!shownKeys.includes(winner.refKey)) {
        grid.shownModuleKeys = [...shownKeys, winner.refKey]
        changed = true
      }
    }

    for (const occurrence of occurrences) {
      setHidden(occurrence, occurrence !== winner)
    }
  }

  return changed
}

/**
 * Where an endpoint that can sit either in a board or in the building is mounted. `panel` means
 * it is shown as a module in a board (and its plan placements are hidden); `field` means it is
 * in no board (and its plan placements show). Derived from panel visibility, so the panel view,
 * the plan and cable routing always agree. Undefined for endpoints that cannot be a board module
 * or are always in their board (modular sockets).
 */
export interface EndpointMounting {
  location: 'panel' | 'field'
  /** The board it is in, or the board it would go into. */
  panelId: string
  panelName: string
  moduleRefKey: string
}

export function getEndpointMounting(
  project: PanelPlanVisibilityProject,
  endpointId: string,
): EndpointMounting | undefined {
  const occurrences = collectPanelModuleOccurrences(project).get(`endpoint:${endpointId}`)
  const first = occurrences?.[0]
  if (!occurrences || !first) return undefined
  if (panelGridModuleIsAlwaysVisibleInPanel(first.ref, selectProjectElectricalPanels(project))) return undefined
  const visible = occurrences.find((occurrence) => occurrence.visible)
  // A device in no board would go into the board that owns its circuit.
  const home =
    visible ??
    occurrences.find(
      (occurrence) =>
        occurrence.ref.kind === 'domotica' &&
        findPanelContainingCircuit(occurrence.panel, occurrence.ref.circuitId) === occurrence.panel,
    ) ??
    first
  return {
    location: visible ? 'panel' : 'field',
    panelId: home.panel.id,
    panelName: home.panel.name,
    moduleRefKey: home.refKey,
  }
}

/** Inverter and supply-meter plan visibility never implicitly changes panel visibility. */
export function hasIndependentSituationPlanVisibility(
  project: PanelPlanVisibilityProject,
  placementId: string,
): boolean {
  return [...collectPanelPlanPlacementOwners(project).values()].some((owner) =>
    owner.independentVisibility && owner.placements.some((placement) => placement.id === placementId)
  )
}

/** Move a plan-backed dual-view device into one panel, preferring the active panel when valid. */
export function showSituationPlanPlacementInPanel(
  project: PanelPlanVisibilityProject,
  placementId: string,
  preferredPanelId?: string | null,
): boolean {
  const ownerEntry = [...collectPanelPlanPlacementOwners(project).entries()].find(([, owner]) =>
    owner.placements.some((placement) => placement.id === placementId),
  )
  if (!ownerEntry) return false

  const occurrences = collectPanelModuleOccurrences(project).get(ownerEntry[0]) ?? []
  const target =
    occurrences.find((occurrence) => occurrence.panel.id === preferredPanelId) ?? occurrences[0]
  if (!target) return false

  return syncPanelAndSituationPlanDeviceVisibility(project, {
    kind: 'show',
    panelId: target.panel.id,
    moduleRefKey: target.refKey,
  })
}

/** Move a dual-view device out of every panel so its existing plan placement is shown. */
export function showSituationPlanPlacementOnPlan(
  project: PanelPlanVisibilityProject,
  placementId: string,
): boolean {
  const ownerEntry = [...collectPanelPlanPlacementOwners(project).entries()].find(([, owner]) =>
    owner.placements.some((placement) => placement.id === placementId),
  )
  if (!ownerEntry) return false
  if (ownerEntry[1].independentVisibility) {
    let changed = false
    mutateBuildingFloorViews(project, (floors) => {
      for (const floor of floors) {
        const previous = floor.hiddenSitplanPlacementIds ?? []
        if (!previous.includes(placementId)) continue
        const next = previous.filter((id) => id !== placementId)
        floor.hiddenSitplanPlacementIds = next.length ? next : undefined
        changed = true
      }
    })
    return changed
  }
  const occurrence = collectPanelModuleOccurrences(project).get(ownerEntry[0])?.[0]
  if (!occurrence) return false
  return syncPanelAndSituationPlanDeviceVisibility(project, {
    kind: 'hide',
    panelId: occurrence.panel.id,
    moduleRefKey: occurrence.refKey,
  })
}

/**
 * Keep physical device visibility mutually exclusive between the distribution-panel view and
 * the situation plan. A device shown in any panel hides all of its plan placements; hiding it
 * from every panel reveals those existing placements again. Inverters retain independent
 * visibility in both views, including an explicit choice to hide them in both.
 */
function collectPanelPlanPlacementOwners(
  project: PanelPlanVisibilityProject
): Map<string, PlacementOwner> {
  const rootPanels = selectProjectElectricalPanels(project)
  const installation = selectProjectElectricalInstallation(project)
  const endpointsById = new Map<string, Endpoint>()
  const trunkDevicesById = new Map<string, TrunkDevice>()
  const independentSupplyMeterIds = new Set<string>()

  if (installation) {
    for (const panel of walkPanels(rootPanels)) {
      for (const device of getPanelSupplyTrunkDevices(installation, rootPanels, panel)) {
        trunkDevicesById.set(device.id, device)
      }
    }
  }
  for (const device of installation?.groundTrunkDevices ?? []) {
    trunkDevicesById.set(device.id, device)
  }
  for (const panel of walkPanels(rootPanels)) {
    for (const circuit of getAllCircuits(panel)) {
      if (circuit.code.trim().toUpperCase() === 'PANEL') {
        for (const device of circuit.trunkDevices ?? []) {
          if (device.type === 'energy_meter') independentSupplyMeterIds.add(device.id)
        }
      }
      for (const endpoint of circuit.endpoints ?? []) endpointsById.set(endpoint.id, endpoint)
      for (const device of circuit.trunkDevices ?? []) trunkDevicesById.set(device.id, device)
    }
  }

  const owners = new Map<string, PlacementOwner>()
  for (const panel of walkPanels(rootPanels)) {
    const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
    const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
    for (const ref of getDefaultPanelGridModuleRefs(panel, installation, rootPanels)) {
      const key = panelGridModuleRefKey(ref)
      let visible =
        !hiddenKeys.has(key) &&
        (panelGridModuleIsVisibleByDefault(ref, panel, installation, rootPanels) ||
          shownKeys.has(key))
      const trunkOwner = ref.kind === 'trunkDevice' ? trunkDevicesById.get(ref.id) : undefined
      const owner =
        ref.kind === 'domotica'
          ? endpointsById.get(ref.endpointId)
          : trunkOwner

      // ProtectionDevice has no situation-plan placement model. Protection-style trunk
      // devices (including rotating switches on a supply wire) are handled above.
      if (!owner?.placements?.length) continue
      if (owner.symbol === 'inverter' && ref.kind === 'trunkDevice' && ref.scope === 'supply') {
        visible = isSupplyDeviceVisibleInPanel(project, ref.id)
      }
      const independentSupplyMeter =
        ref.kind === 'trunkDevice' &&
        owner.type === 'energy_meter' &&
        (ref.scope === 'supply' || independentSupplyMeterIds.has(ref.id))
      if (
        (ref.kind === 'domotica' && owner.symbol === 'energy_meter') ||
        (ref.kind === 'trunkDevice' &&
          owner.type === 'energy_meter' &&
          !independentSupplyMeter)
      ) continue

      const ownerKey = ref.kind === 'domotica' ? `endpoint:${owner.id}` : `trunk:${owner.id}`
      const existing = owners.get(ownerKey)
      if (existing) {
        existing.visibleInAnyPanel ||= visible
      } else {
        owners.set(ownerKey, {
          placements: owner.placements,
          visibleInAnyPanel: visible,
          independentVisibility: owner.symbol === 'inverter' || independentSupplyMeter,
        })
      }
    }
  }

  return owners
}

/** Placement ids intentionally hidden because their device is currently shown in a panel. */
export function getSituationPlanPlacementIdsHiddenByPanel(
  project: PanelPlanVisibilityProject
): Set<string> {
  const hidden = new Set<string>()
  for (const owner of collectPanelPlanPlacementOwners(project).values()) {
    if (!owner.visibleInAnyPanel || owner.independentVisibility) continue
    for (const placement of owner.placements) hidden.add(placement.id)
  }
  return hidden
}

export function syncPanelAndSituationPlanDeviceVisibility(
  project: PanelPlanVisibilityProject,
  intent?: PanelVisibilityIntent,
): boolean {
  const healedConverterBackupProjection = healConverterBackupPanelProjection(project)
  const normalizedPanels = normalizeUniquePanelModuleVisibility(project, intent)
  const owners = new Map([...collectPanelPlanPlacementOwners(project)].filter(([, owner]) => !owner.independentVisibility))
  if (owners.size === 0) return normalizedPanels || healedConverterBackupProjection

  const placementIds = new Set(
    [...owners.values()].flatMap((owner) => owner.placements.map((placement) => placement.id))
  )
  const desiredHiddenByFloor = new Map<string, Set<string>>()
  for (const owner of owners.values()) {
    if (!owner.visibleInAnyPanel) continue
    for (const placement of owner.placements) {
      const desired = desiredHiddenByFloor.get(placement.floorId) ?? new Set<string>()
      desired.add(placement.id)
      desiredHiddenByFloor.set(placement.floorId, desired)
    }
  }

  let changed = false
  mutateBuildingFloorViews(project, (floors) => {
    for (const floor of floors) {
      const previous = floor.hiddenSitplanPlacementIds ?? []
      const desired = desiredHiddenByFloor.get(floor.id) ?? new Set<string>()
      const next = previous.filter((id) => !placementIds.has(id) || desired.has(id))
      for (const id of desired) {
        if (!next.includes(id)) next.push(id)
      }
      if (next.length === previous.length && next.every((id, index) => id === previous[index])) {
        continue
      }
      floor.hiddenSitplanPlacementIds = next.length > 0 ? next : undefined
      changed = true
    }
  })

  return changed || normalizedPanels || healedConverterBackupProjection
}
