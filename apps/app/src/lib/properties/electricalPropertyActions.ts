import {
  isProjectDefaultCableAnchor,
  PROJECT_DEFAULT_CABLE_KINDS,
} from '@/lib/wires/circuitWireDefaults'
import { supportsCircuitConverterDcConnections } from '@/lib/layout/circuitConverterGeometry'
import { isDcBusConverterEndpoint } from '@/lib/eendraad/resizeConverterDcConnections'
import {
  getSupplyDeviceMultiplier,
  getSupplyDeviceSerialNumbers,
} from '@/lib/supplyAssembly/inverterMultipliers'
import { getSupplyInverterUnitPhaseAssignments } from '@/lib/supplyAssembly/supplyConverterPhases'
import { normalizePatch } from './propertyPatch'
import {
  ensureInstallationFeedTopology,
  getPanelSupplyCable,
  buildSupplyWireFireClassVisibilityUpdate,
  buildSupplyWireLabelVisibilityUpdate,
  buildSupplyWireLengthUpdate,
  buildSupplyWireLengthVisibilityUpdate,
} from '@/lib/feedTopology'
import { collectRootPanels } from '@/lib/feedTopology'
import { updateInstallationInProject } from '@/lib/projectMutations/storeActions'
import type { ProjectV2 } from '@/types/projectV2'
import type { CommandEnv, CommandCheck, EntityRef } from '@/lib/commands/project/types'
import { CommandError } from '@/lib/commands/project/types'
import type { ExtraElectricalAction } from './electricalPropertySchemas'
import { electricalPropertyTargetExists } from './extraElectricalProperties'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import {
  getProjectElectricalPanels,
  getProjectElectricalInstallation,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import {
  collectJunctionPanelOccurrences,
  updateSharedJunctionPanelGrid,
} from '@/lib/junctionPanel/grid'
import { ensureJunctionPanelPlacementForLabelInProject } from '@/lib/plan/placementMutations'
import { setAuxiliaryEnclosureShownOnPlan } from '@/lib/plan/auxiliaryEnclosurePlanPlacement'
import {
  setPanelFeedOrganizationInProject,
  getPanelFeedOrganization,
  applyPanelBusFeedBoundaryInProject,
  panelHasModularChangeover,
  panelHasBackupOutput,
} from '@/lib/panel/panelFeedOrganization'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import {
  getChangeoverGridSourceAvailability,
  setChangeoverGridSourceInProject,
} from '@/lib/supplyAssembly/changeoverGridSourceEdit'
import { editWireRunAtAnchor } from '@/lib/wires/editWireRun'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import { resizeConverterDcConnectionsInProject } from './resizeConverterProperties'
import { planTerminalStripPairAssignment } from '@/lib/terminalStrip/labels'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  updateSupplyTrunkDeviceInProject,
  updateEndpointInProject,
} from '@/lib/projectMutations/storeActions'
import {
  updateCircuitTrunkPropertiesInProject,
  updateGroundTrunkPropertiesInProject,
} from './electricalPropertyMutations'
import { findEndpointById, getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import type { CableSpec, TrunkDevice, CircuitPhaseAssignment } from '@/types/schema'
import { getPanelBusSections, getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { getBusbarPhaseOrder } from '@/lib/wires/phaseAssignment'
import { checkProjectSupplyConnection, setProjectSupplyConnectionInProject } from '@/lib/electrical/projectSupplyConnection'
import {
  checkRootFeedNominalVoltage,
  checkRootFeedTransformerOutput,
  setRootFeedNominalVoltageInProject,
  setRootFeedTransformerOutputInProject,
} from '@/lib/electrical/feedNominalVoltageEdit'
export function checkExtraElectricalAction(
  project: ProjectV2,
  action: ExtraElectricalAction
): CommandCheck {
  if (action.kind === 'projectSupplyConnection') return checkProjectSupplyConnection(project)
  if (action.kind === 'rootFeedNominalVoltage') return checkRootFeedNominalVoltage(project, action.panelId)
  if (action.kind === 'rootFeedTransformerOutput') return checkRootFeedTransformerOutput(project, action.panelId)
  if (action.kind === 'panelBusFeedBoundary') {
    const panel = findPanelById(getProjectElectricalPanels(project), action.panelId)
    if (!panel || panel.isMain === false || !getProjectElectricalInstallation(project))
      return { ok: false, code: 'stale_target', message: 'Main panel no longer exists' }
    if (action.mainBusInsertIndex >= getMainBusOrder(panel).length)
      return { ok: false, code: 'invalid_boundary', message: 'Bus feed boundary is outside the bus' }
    if (
      !panel.busSections?.length &&
      !panelHasBackupOutput(project, panel.id) &&
      !panelHasModularChangeover(project, panel.id)
    )
      return { ok: false, code: 'feed_unavailable', message: 'This panel has no split feed' }
    return { ok: true }
  }
  if (action.kind === 'busbarPhaseOrder') {
    const panel = findPanelById(getProjectElectricalPanels(project), action.panelId)
    const validOwner =
      panel &&
      (action.ownerId
        ? !action.busSectionId &&
          ([...panel.circuits, ...panel.protections.flatMap((p) => p.circuits ?? [])].some(
            (circuit) => circuit.id === action.ownerId && !!circuit.subCircuitIds?.length
          ) ||
            panel.protections.some(
              (protection) =>
                protection.id === action.ownerId &&
                (protection.type === 'RCD' || protection.type === 'RCBO') &&
                (protection.circuits?.length ?? 0) > 1
            ))
        : getPanelBusSections(panel).some(
            (section) => section.id === (action.busSectionId ?? getPrimaryPanelBusSectionId(panel))
          ))
    return validOwner &&
      getBusbarPhaseOrder(panel!, action.ownerId, action.busSectionId).length === 3
      ? { ok: true }
      : { ok: false, code: 'invalid_busbar', message: 'Busbar not found' }
  }
  if (action.kind === 'changeoverGridSource') {
    if (!findPanelById(getProjectElectricalPanels(project), action.panelId))
      return { ok: false, code: 'stale_target', message: 'Panel no longer exists' }
    const availability = getChangeoverGridSourceAvailability(project, action.panelId)
    if (!availability.changeoverId)
      return {
        ok: false,
        code: 'missing_changeover',
        message: 'This panel has no changeover switch',
      }
    if (action.source === 'converter-input' && !availability.available)
      return {
        ok: false,
        code: 'changeover_grid_source_unavailable',
        message: 'The changeover cannot be fed from the inverter grid input on this panel',
      }
    return { ok: true }
  }
  let exists = false
  if (action.kind === 'auxiliaryPlanVisibility')
    exists = selectProjectAuxiliaryElectricalEnclosures(project).some(
      (e) => e.id === action.enclosureId
    )
  else if (action.kind === 'panelFeedOrganization' || action.kind === 'supplyWire')
    exists = !!findPanelById(getProjectElectricalPanels(project), action.panelId)
  else if (action.kind === 'wireCableDefault')
    exists = buildElectricalStructureSnapshot(project).relationships.some(
      (e) => e.properties?.wireAnchor === action.anchor
    )
  else if (action.kind === 'terminalStripPins')
    exists = electricalPropertyTargetExists(project, action.entityId)
  else exists = electricalPropertyTargetExists(project, action.deviceId)
  if (exists && action.kind === 'junctionPanelIdentity') {
    const d = findTrunkDeviceInProject(project, action.deviceId)
    if (!d || (d.symbol !== 'junction_panel' && d.type !== 'junction_panel'))
      return {
        ok: false,
        code: 'invalid_junction_panel',
        message: 'This device is not a junction panel',
      }
  }
  if (exists && action.kind === 'resizeConverter') {
    const d = findTrunkDeviceInProject(project, action.deviceId)
    const e = [...walkPanels(getProjectElectricalPanels(project))]
      .flatMap((p) => [...p.circuits, ...p.protections.flatMap((d) => d.circuits ?? [])])
      .flatMap((c) => c.endpoints)
      .find((e) => e.id === action.deviceId)
    if (!supportsCircuitConverterDcConnections(d ?? undefined) && !isDcBusConverterEndpoint(e))
      return {
        ok: false,
        code: 'unsupported_converter',
        message: 'This device has no editable converter outputs',
      }
  }
  if (
    exists &&
    action.kind === 'wireCableDefault' &&
    (!isProjectDefaultCableAnchor(action.anchor) ||
      !PROJECT_DEFAULT_CABLE_KINDS.includes(action.cable.kind))
  )
    return {
      ok: false,
      code: 'invalid_default_cable',
      message: 'This cable cannot be the project default',
    }
  if (exists && action.kind === 'supplyUnit') {
    const device = findTrunkDeviceInProject(project, action.deviceId)
    if (
      !device ||
      !['battery', 'solar_panel', 'inverter'].includes(device.symbol) ||
      action.index >= getSupplyDeviceMultiplier(device) ||
      (action.set.phaseAssignment && device.symbol !== 'inverter')
    )
      return { ok: false, code: 'invalid_unit', message: 'Supply device unit no longer exists' }
  }
  return exists
    ? { ok: true }
    : {
        ok: false,
        code: 'stale_target',
        message: 'Electrical property action target no longer exists',
      }
}
function setTrunk(project: ProjectV2, id: string, patch: Partial<TrunkDevice>) {
  if (queryAllSupplyTrunkDevices(project).some((d) => d.id === id))
    return updateSupplyTrunkDeviceInProject(project, id, patch).changed
  for (const panel of walkPanels(getProjectElectricalPanels(project)))
    for (const c of getAllCircuits(panel))
      if (
        c.trunkDevices?.some((d) => d.id === id) ||
        c.branches?.some((b) => b.branchDevices?.some((d) => d.id === id))
      )
        return updateCircuitTrunkPropertiesInProject(project, c.id, id, patch)
  return updateGroundTrunkPropertiesInProject(project, id, patch)
}
export function applyExtraElectricalAction(
  project: ProjectV2,
  action: ExtraElectricalAction,
  env: CommandEnv
): EntityRef[] {
  if (action.kind === 'projectSupplyConnection') {
    return setProjectSupplyConnectionInProject(project, action.connection, env)
      ? [{ kind: 'installation', id: 'electrical' }]
      : []
  }
  if (action.kind === 'rootFeedNominalVoltage') {
    return setRootFeedNominalVoltageInProject(project, action.panelId, action.system)
      ? [{ kind: 'installation', id: 'electrical' }]
      : []
  }
  if (action.kind === 'rootFeedTransformerOutput') {
    return setRootFeedTransformerOutputInProject(project, action.panelId, action)
      ? [{ kind: 'installation', id: 'electrical' }]
      : []
  }
  if (action.kind === 'supplyUnit') {
    const device = findTrunkDeviceInProject(project, action.deviceId)!
    const key =
      device.symbol === 'inverter'
        ? 'conversionProps'
        : device.symbol === 'battery'
          ? 'batteryProps'
          : 'solarPanelProps'
    const before = JSON.stringify(device[key])
    const props = { ...device[key] }
    if ('serialNumber' in action.set) {
      const serials = getSupplyDeviceSerialNumbers(device)
      serials[action.index] = action.set.serialNumber!
      Object.assign(props, { serialNumber: undefined, serialNumbers: serials })
    }
    if (action.set.phaseAssignment) {
      const assignments = getSupplyInverterUnitPhaseAssignments(
        device,
        getProjectElectricalInstallation(project)!.nominalVoltage.system,
        getSupplyDeviceMultiplier(device)
      )
      assignments[action.index] = normalizePatch(
        {},
        action.set.phaseAssignment
      ) as unknown as CircuitPhaseAssignment
      Object.assign(props, { acPhaseAssignment: undefined, acPhaseAssignments: assignments })
    }
    if (JSON.stringify(props) === before) return []
    setTrunk(project, action.deviceId, { [key]: props })
    return [{ kind: 'trunkDevice', id: action.deviceId }]
  }
  if (action.kind === 'supplyWire') {
    const installation = getProjectElectricalInstallation(project)!
    const panels = getProjectElectricalPanels(project)
    const panel = findPanelById(panels, action.panelId)!
    ensureInstallationFeedTopology(installation, panels)
    const sole = collectRootPanels(panels).length === 1
    const before = JSON.stringify(installation)
    for (const [key, value] of Object.entries(action.set)) {
      const main = installation.mainSupply
      const feed = installation.feedTopology?.rootFeeds.find((f) => f.panelId === panel.id)
      if (key === 'cable') {
        const cableKey =
          action.role === 'upstream'
            ? 'cable'
            : action.role === 'crossing'
              ? 'crossingCable'
              : 'rootCable'
        const current =
          action.role === 'downstream' && !sole
            ? (feed?.cable ?? getPanelSupplyCable(installation, panels, panel))
            : (main[cableKey] ?? main.cable)
        const next = {
          ...current,
          ...normalizePatch(
            current as unknown as Record<string, unknown>,
            value as Record<string, unknown>
          ),
        } as CableSpec
        if (action.role === 'downstream' && !sole && feed) feed.cable = next
        else main[cableKey] = next
      } else if (key === 'phaseAssignment' || key === 'showPhaseLabel') {
        if (!feed) throw new CommandError('check_failed', 'Supply feed no longer exists')
        Object.assign(feed, { [key]: value === null ? undefined : value })
      } else {
        let updates: Parameters<typeof updateInstallationInProject>[1] | undefined
        if (key === 'hideWireLabel')
          updates = buildSupplyWireLabelVisibilityUpdate(
            installation,
            panels,
            panel,
            action.role,
            value !== true
          )
        if (key === 'showFireClassLabel')
          updates = buildSupplyWireFireClassVisibilityUpdate(
            installation,
            panels,
            panel,
            action.role,
            value === true
          )
        if (key === 'wireLengthM')
          updates = buildSupplyWireLengthUpdate(
            installation,
            panels,
            panel,
            action.role,
            value === null ? undefined : (value as number)
          )
        if (key === 'showWireLengthLabel')
          updates = buildSupplyWireLengthVisibilityUpdate(
            installation,
            panels,
            panel,
            action.role,
            value === true
          )
        if (updates) Object.assign(installation, updates)
      }
    }
    if (JSON.stringify(installation) === before) return []
    updateInstallationInProject(project, {})
    return [{ kind: 'installation', id: 'electrical' }]
  }
  if (action.kind === 'auxiliaryPlanVisibility') {
    return setAuxiliaryEnclosureShownOnPlan(project, action.enclosureId, action.visible)
      ? [{ kind: 'element', id: action.enclosureId }]
      : []
  }
  if (action.kind === 'changeoverGridSource') {
    const availability = getChangeoverGridSourceAvailability(project, action.panelId)
    if (availability.requested === action.source) return []
    if (!setChangeoverGridSourceInProject(project, action.panelId, action.source))
      throw new CommandError(
        'check_failed',
        'The changeover grid input source cannot be changed on this panel',
        { reason: 'changeover_grid_source_unavailable' }
      )
    return [
      { kind: 'trunkDevice', id: availability.changeoverId! },
      { kind: 'panel', id: action.panelId },
    ]
  }
  if (action.kind === 'panelFeedOrganization') {
    const panel = findPanelById(getProjectElectricalPanels(project), action.panelId)!
    if (getPanelFeedOrganization(project, panel) === action.organization) return []
    const before = JSON.stringify(
      findPanelById(getProjectElectricalPanels(project), action.panelId)
    )
    const result = setPanelFeedOrganizationInProject(project, action.panelId, action.organization)
    if (!result)
      throw new CommandError(
        'check_failed',
        'This panel cannot use the requested feed organization'
      )
    if (
      !result &&
      JSON.stringify(findPanelById(getProjectElectricalPanels(project), action.panelId)) === before
    )
      return []
    return [{ kind: 'panel', id: action.panelId }]
  }
  if (action.kind === 'panelBusFeedBoundary') {
    if (
      !applyPanelBusFeedBoundaryInProject(
        project,
        action.panelId,
        action.feed,
        action.mainBusInsertIndex
      )
    )
      return []
    return [{ kind: 'panel', id: action.panelId }]
  }
  if (action.kind === 'busbarPhaseOrder') {
    const panel = findPanelById(getProjectElectricalPanels(project), action.panelId)!
    const order = getBusbarPhaseOrder(panel, action.ownerId, action.busSectionId)
    if (order.every((phase, index) => phase === action.order[index])) return []
    if (action.ownerId) {
      panel.busbarPhases ??= {}
      panel.busbarPhases.secondary ??= {}
      panel.busbarPhases.secondary[action.ownerId] = [...action.order]
    } else if (panel.busSections?.length) {
      panel.busSections.find(
        (section) => section.id === (action.busSectionId ?? getPrimaryPanelBusSectionId(panel))
      )!.phaseOrder = [...action.order]
    } else {
      panel.busbarPhases ??= {}
      panel.busbarPhases.main = [...action.order]
    }
    return [{ kind: 'panel', id: panel.id }]
  }
  if (action.kind === 'wireCableDefault') {
    const installation = getProjectElectricalInstallation(project)!
    const run = findWireRunForAnchor(selectProjectWireRuns(project), action.anchor)
    if (installation.defaultCableKind === action.cable.kind && run?.followsDefaultCable === true)
      return []
    installation.defaultCableKind = action.cable.kind
    editWireRunAtAnchor(
      project,
      action.anchor,
      action.cable as CableSpec,
      { followsDefaultCable: true },
      undefined,
      action.sharedGeometryAnchors
    )
    return [
      { kind: 'installation', id: 'electrical' },
      { kind: 'element', id: action.anchor },
    ]
  }
  if (action.kind === 'resizeConverter') {
    return resizeConverterDcConnectionsInProject(project, action.deviceId, action.count)
      ? [{ kind: 'trunkDevice', id: action.deviceId }]
      : []
  }
  if (action.kind === 'terminalStripPins') {
    const updates = planTerminalStripPairAssignment(
      project,
      action.entityId,
      action.stripId,
      action.incomingPin,
      action.outgoingPin
    )
    if (!updates.length) throw new CommandError('check_failed', 'Terminal strip no longer exists')
    return updates.map((u) => {
      const outgoing = u.id.endsWith(':outgoing')
      const id = u.id.slice(0, -9)
      const patch = {
        junctionIdentity: u.stripId,
        ...(outgoing ? { terminalStripOutgoingPin: u.pin } : { terminalStripPin: u.pin }),
      }
      for (const panel of getProjectElectricalPanels(project))
        if (findEndpointById(panel, id)) {
          updateEndpointInProject(project, id, patch)
          return { kind: 'endpoint' as const, id }
        }
      setTrunk(project, id, patch)
      return { kind: 'trunkDevice' as const, id }
    })
  }
  const target = findTrunkDeviceInProject(project, action.deviceId)!
  if (target.symbol !== 'junction_panel' && target.type !== 'junction_panel')
    throw new CommandError('check_failed', 'This device is not a junction panel')
  const previous = target.junctionIdentity ?? target.label
  const occurrences = [...collectJunctionPanelOccurrences(project).values()].flat()
  const oldPeers = occurrences.filter(
    (o) => (o.device.junctionIdentity ?? o.device.label) === previous
  )
  const newPeer = occurrences.find(
    (o) =>
      o.device.id !== target.id && (o.device.junctionIdentity ?? o.device.label) === action.identity
  )
  if (previous === action.identity && target.label === action.identity) return []
  setTrunk(project, target.id, { label: action.identity, junctionIdentity: action.identity })
  if (newPeer?.device.junctionPanelGridView)
    updateSharedJunctionPanelGrid(project, target.id, newPeer.device.junctionPanelGridView)
  const installation = getProjectElectricalInstallation(project)!
  const oldPlacement = installation.junctionPanelPlacements?.find((p) => p.label === previous)
  if (action.identity && !newPeer && oldPeers.length > 1 && oldPlacement) {
    installation.junctionPanelPlacements ??= []
    installation.junctionPanelPlacements.push({
      ...oldPlacement,
      id: env.newId(),
      label: action.identity,
      floorId: action.floorId ?? oldPlacement.floorId,
      pos: { x: oldPlacement.pos.x + 40, y: oldPlacement.pos.y },
    })
  } else if (action.identity)
    ensureJunctionPanelPlacementForLabelInProject(project, action.identity, action.floorId)
  if (
    previous !== action.identity &&
    ![...collectJunctionPanelOccurrences(project).values()]
      .flat()
      .some((o) => (o.device.junctionIdentity ?? o.device.label) === previous)
  )
    installation.junctionPanelPlacements = installation.junctionPanelPlacements?.filter(
      (p) => p.label !== previous
    )
  return [
    { kind: 'trunkDevice', id: target.id },
    { kind: 'installation', id: 'electrical' },
  ]
}

/** References created or removed by property follow-ups (converter lanes, physical placements). */
export function collectElectricalPropertyRefs(project: ProjectV2): EntityRef[] {
  const refs: EntityRef[] = []
  const addDevice = (device: TrunkDevice) => {
    refs.push({ kind: 'trunkDevice', id: device.id })
    for (const p of device.placements ?? []) refs.push({ kind: 'placement', id: p.id })
  }
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    refs.push({ kind: 'panel', id: panel.id })
    for (const p of panel.protections) refs.push({ kind: 'protection', id: p.id })
    for (const c of [...panel.circuits, ...panel.protections.flatMap((p) => p.circuits ?? [])]) {
      refs.push({ kind: 'circuit', id: c.id })
      for (const e of c.endpoints) {
        refs.push({ kind: 'endpoint', id: e.id })
        for (const p of e.placements) refs.push({ kind: 'placement', id: p.id })
      }
      for (const d of [
        ...(c.trunkDevices ?? []),
        ...(c.branches?.flatMap((b) => b.branchDevices ?? []) ?? []),
      ])
        addDevice(d)
    }
    for (const d of panel.groundTrunkDevices ?? []) addDevice(d)
  }
  for (const d of queryAllSupplyTrunkDevices(project)) addDevice(d)
  const installation = getProjectElectricalInstallation(project)
  for (const d of installation?.groundTrunkDevices ?? []) addDevice(d)
  for (const p of [
    ...(installation?.junctionPanelPlacements ?? []),
    ...(installation?.earthingPlacements ?? []),
  ])
    refs.push({ kind: 'placement', id: p.id })
  for (const e of selectProjectAuxiliaryElectricalEnclosures(project)) {
    refs.push({ kind: 'auxiliaryEnclosure', id: e.id })
    for (const p of e.placements ?? []) refs.push({ kind: 'placement', id: p.id })
  }
  return [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()]
}
