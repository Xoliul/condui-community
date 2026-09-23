import { ensureInstallationFeedTopology, getPanelFeedProjection } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getCircuitIdFromModuleRef } from '@/components/canvas/panel/panelRelationEdges'
import { panelGridModuleRefKey } from '@/components/canvas/panel/panelGridLayout'
import {
  buildSupplyElectricalTopology,
  getSupplyNodePhysicalDeviceId,
  resolveAssemblyPanelInput,
  resolveCommonLoadTail,
} from '@/lib/supplyAssembly/electricalTopology'
import type {
  Circuit,
  Panel,
  PanelGridModuleRef,
  ProtectionDevice,
  SymbolKey,
  TrunkDevice,
} from '@/types/schema'

export type SupplyTrunkModuleRef = {
  kind: 'trunkDevice'
  id: string
  scope: 'supply'
  circuitId?: string
}

export type PanelRewireOperation =
  | { kind: 'promotePanelToRootSupply'; panelId: string }
  | { kind: 'moveSharedSupplyDevice'; targetSupplyId: string; direction: 'left' | 'right' }
  | {
      kind: 'promoteProtectionToSharedSupply'
      protectionId: string
      circuit: Circuit
      insertIndex: number
      trunkDevice: Omit<TrunkDevice, 'id'>
    }
  | {
      kind: 'promoteProtectionToRootSupply'
      protectionId: string
      circuit: Circuit
      insertIndex: number
      trunkDevice: Omit<TrunkDevice, 'id'>
    }
  | { kind: 'detachCircuitFromSupplyParent'; parentCircuitId: string; subCircuitIds?: string[] }
  | { kind: 'rewireCircuit'; originCircuitId: string; targetCircuitId: string }

export function isSupplyTrunkRef(ref: PanelGridModuleRef): ref is SupplyTrunkModuleRef {
  return ref.kind === 'trunkDevice' && ref.scope === 'supply'
}

export function getSharedSupplyRefKeysForPanel(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel | null,
): Set<string> {
  if (!panel?.isMain) return new Set()
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return new Set()
  const projection = getPanelFeedProjection(installation, getProjectElectricalPanels(project), panel)
  return new Set(
    (projection?.sharedFeed.trunkDevices ?? []).map((device) =>
      panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' }),
    ),
  )
}

export function getSharedSupplyRefsForPanel(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel | null,
): PanelGridModuleRef[] {
  if (!panel?.isMain) return []
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const projection = getPanelFeedProjection(installation, getProjectElectricalPanels(project), panel)
  return (projection?.sharedFeed.trunkDevices ?? []).map(
    (device) => ({ kind: 'trunkDevice', id: device.id, scope: 'supply' }) as PanelGridModuleRef,
  )
}

export function isSharedSupplyTrunkRef(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel | null,
  ref: PanelGridModuleRef,
): ref is SupplyTrunkModuleRef {
  if (!isSupplyTrunkRef(ref)) return false
  return getSharedSupplyRefKeysForPanel(project, panel).has(panelGridModuleRefKey(ref))
}

export function isSharedSupplyTailRef(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef
): ref is SupplyTrunkModuleRef {
  if (!isSupplyTrunkRef(ref)) return false
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const topology = ensureInstallationFeedTopology(
    installation,
    getProjectElectricalPanels(project)
  )
  const ownedTail = assemblySupplyTail(project, ref)
  return ownedTail ?? topology.sharedFeed.trunkDevices?.at(-1)?.id === ref.id
}

/** Undefined means the source is outside assembly ownership, not an unresolved output. */
function assemblySupplyTail(
  project: ProjectWithOptionalV2Electrical,
  ref: SupplyTrunkModuleRef
): boolean | undefined {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return undefined
  const topology = ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
  const shared = topology.sharedFeed.trunkDevices?.some((device) => device.id === ref.id)
  const feeds = topology.rootFeeds.filter((feed) => feed.trunkDevices?.some((device) => device.id === ref.id))
  const assemblies = selectProjectSupplyAssemblies(project).filter((assembly) =>
    shared ||
    assembly.nodes.some((node) => getSupplyNodePhysicalDeviceId(node) === ref.id) ||
    [assembly.incomingAttachment, ...assembly.loadHandoffs.map((handoff) => handoff.target)].some(
      (target) => feeds.some((feed) => resolveAssemblyPanelInput(project, target)?.panelId === feed.panelId)
    )
  )
  if (!assemblies.length) return undefined
  return assemblies.some((assembly) => {
    const tail = resolveCommonLoadTail(assembly, project)
    const node = tail && assembly.nodes.find((candidate) => candidate.id === tail.nodeId)
    if (!node) return false
    const physicalId = getSupplyNodePhysicalDeviceId(node)
    if (physicalId) return physicalId === ref.id
    const parents = buildSupplyElectricalTopology(project).assemblyNodeParents(assembly.id, node.id)
    return parents.length === 1 && parents[0]?.kind === 'device' && parents[0].deviceId === ref.id
  })
}

/** True when a supply-strip device is the terminal device of any root-panel feed. */
export function isRootSupplyTailRef(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef
): ref is SupplyTrunkModuleRef {
  if (!isSupplyTrunkRef(ref)) return false
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const topology = ensureInstallationFeedTopology(
    installation,
    getProjectElectricalPanels(project)
  )
  const ownedTail = assemblySupplyTail(project, ref)
  return ownedTail ?? topology.rootFeeds.some((feed) => feed.trunkDevices?.at(-1)?.id === ref.id)
}

export function isRootSupplyTailOrSharedSupplyTailRef(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef
): ref is SupplyTrunkModuleRef {
  return isSharedSupplyTailRef(project, ref) || isRootSupplyTailRef(project, ref)
}

export function isModuleRefOnSupplyStrip(panel: Panel | null, ref: PanelGridModuleRef): boolean | null {
  if (!panel?.gridView) return null
  const key = panelGridModuleRefKey(ref)
  if (panel.gridView.supplyPanelSlots?.some((slot) => panelGridModuleRefKey(slot.module) === key)) {
    return true
  }
  if (panel.gridView.slots?.some((slot) => panelGridModuleRefKey(slot.module) === key)) {
    return false
  }
  return null
}

function flattenPanelsDepthFirst(panels: Panel[]): Panel[] {
  const out: Panel[] = []
  const walk = (panel: Panel) => {
    out.push(panel)
    for (const subPanel of panel.subPanels ?? []) walk(subPanel)
  }
  for (const panel of panels) walk(panel)
  return out
}

function findCircuitInPanels(panels: Panel[], circuitId: string): Circuit | null {
  for (const panel of flattenPanelsDepthFirst(panels)) {
    const direct = panel.circuits.find((circuit) => circuit.id === circuitId)
    if (direct) return direct
    for (const protection of panel.protections) {
      const protectedCircuit = protection.circuits?.find((circuit) => circuit.id === circuitId)
      if (protectedCircuit) return protectedCircuit
    }
  }
  return null
}

function findProtectionById(panels: Panel[], protectionId: string): ProtectionDevice | null {
  for (const panel of flattenPanelsDepthFirst(panels)) {
    const protection = panel.protections.find((candidate) => candidate.id === protectionId)
    if (protection) return protection
  }
  return null
}

function findParentCircuitId(panels: Panel[], targetCircuitId: string): string | null {
  for (const panel of flattenPanelsDepthFirst(panels)) {
    for (const circuit of panel.circuits) {
      if (circuit.subCircuitIds?.includes(targetCircuitId)) return circuit.id
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        if (circuit.subCircuitIds?.includes(targetCircuitId)) return circuit.id
      }
    }
  }
  return null
}

function canReachCircuit(panels: Panel[], fromCircuitId: string, targetId: string, visited = new Set<string>()): boolean {
  if (visited.has(fromCircuitId)) return false
  visited.add(fromCircuitId)
  const from = findCircuitInPanels(panels, fromCircuitId)
  if (!from?.subCircuitIds?.length) return false
  if (from.subCircuitIds.includes(targetId)) return true
  for (const subId of from.subCircuitIds) {
    if (canReachCircuit(panels, subId, targetId, visited)) return true
  }
  return false
}

function getSharedSupplyDeviceIndex(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel,
  supplyId: string,
): number {
  return getSharedSupplyRefsForPanel(project, panel)
    .filter(isSupplyTrunkRef)
    .findIndex((device) => device.id === supplyId)
}

function trunkDeviceFromProtection(
  targetProtection: ProtectionDevice,
  circuit: Circuit,
  insertIndex: number,
): Omit<TrunkDevice, 'id'> {
  return {
    type: 'protection',
    symbol: targetProtection.type.toLowerCase() as SymbolKey,
    label: targetProtection.label || circuit.code || '',
    trunkPosition: insertIndex,
    protectionType: targetProtection.type,
    ...(targetProtection.ratingA ? { ratingA: targetProtection.ratingA } : {}),
    ...(targetProtection.curve ? { curve: targetProtection.curve } : {}),
    ...(targetProtection.sensitivityMa ? { sensitivityMa: targetProtection.sensitivityMa } : {}),
    ...(targetProtection.residualCurrentType
      ? { residualCurrentType: targetProtection.residualCurrentType }
      : {}),
    ...(targetProtection.poles ? { poles: targetProtection.poles } : {}),
  }
}

function isMainBusProtection(panel: Panel, protection: ProtectionDevice): boolean {
  const circuitIds = new Set((protection.circuits ?? []).map((circuit) => circuit.id))
  if (circuitIds.size === 0) return true
  return !panel.protections.some(
    (candidate) =>
      candidate.id !== protection.id &&
      (candidate.circuits ?? []).some((circuit) =>
        (circuit.subCircuitIds ?? []).some((id) => circuitIds.has(id))
      )
  )
}

/**
 * The one module that represents the incoming/main-bus side of a secondary
 * panel. When this is null, the panel has no protection and its frame is the
 * promotion target.
 */
export function getPanelRootPromotionTargetRef(panel: Panel): PanelGridModuleRef | null {
  if (panel.isMain === true) return null

  const panelCircuit = panel.circuits.find((circuit) => circuit.code === 'PANEL')
  const incomingProtection = [...(panelCircuit?.trunkDevices ?? [])]
    .sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    .find((device) => device.type === 'protection')
  if (incomingProtection && panelCircuit) {
    return {
      kind: 'trunkDevice',
      id: incomingProtection.id,
      scope: 'circuit',
      circuitId: panelCircuit.id,
    }
  }

  const firstProtection =
    panel.protections.find((protection) => isMainBusProtection(panel, protection)) ??
    panel.protections[0]
  return firstProtection
    ? { kind: 'protection', id: firstProtection.id }
    : null
}

function getPanelRootPromotionOperation(
  panel: Panel,
  currentProject: ProjectWithOptionalV2Electrical,
  origin: PanelGridModuleRef,
  target: PanelGridModuleRef | null
): PanelRewireOperation | null {
  if (panel.isMain === true || !isRootSupplyTailOrSharedSupplyTailRef(currentProject, origin)) return null

  const canonicalTarget = getPanelRootPromotionTargetRef(panel)
  if (canonicalTarget === null) {
    if (target !== null) return null
  } else if (
    target === null ||
    panelGridModuleRefKey(target) !== panelGridModuleRefKey(canonicalTarget)
  ) {
    return null
  }

  return { kind: 'promotePanelToRootSupply', panelId: panel.id }
}

export function getPanelRewireOperation(
  panel: Panel | null,
  currentProject: ProjectWithOptionalV2Electrical | null,
  origin: PanelGridModuleRef,
  target: PanelGridModuleRef | null,
): PanelRewireOperation | null {
  if (!panel || !currentProject) return null
  const panelPromotion = getPanelRootPromotionOperation(panel, currentProject, origin, target)
  if (panelPromotion) return panelPromotion
  if (!target) return null
  if (panelGridModuleRefKey(origin) === panelGridModuleRefKey(target)) return null

  const originStrip = isModuleRefOnSupplyStrip(panel, origin)
  const targetStrip = isModuleRefOnSupplyStrip(panel, target)
  const mainInput = panel.isMain === true
    ? getPanelRootPromotionTargetRef({ ...panel, isMain: false })
    : null
  const connectsMainInput = mainInput != null && (
    (isSupplyTrunkRef(origin) && panelGridModuleRefKey(mainInput) === panelGridModuleRefKey(target)) ||
    (isSupplyTrunkRef(target) && panelGridModuleRefKey(mainInput) === panelGridModuleRefKey(origin))
  )
  if (
    originStrip != null && targetStrip != null && originStrip !== targetStrip &&
    !connectsMainInput
  ) return null

  const panels = getProjectElectricalPanels(currentProject)
  const originIsSupply = isSupplyTrunkRef(origin)
  const targetIsSupply = isSupplyTrunkRef(target)

  if (originIsSupply && targetIsSupply) {
    if (
      !isSharedSupplyTrunkRef(currentProject, panel, origin) ||
      !isSharedSupplyTrunkRef(currentProject, panel, target)
    ) {
      return null
    }

    const originIndex = getSharedSupplyDeviceIndex(currentProject, panel, origin.id)
    const targetIndex = getSharedSupplyDeviceIndex(currentProject, panel, target.id)
    if (originIndex === -1 || targetIndex === -1 || originIndex === targetIndex) return null

    const newIndex = originIndex + 1
    if (targetIndex === newIndex) return null

    return {
      kind: 'moveSharedSupplyDevice',
      targetSupplyId: target.id,
      direction: targetIndex > originIndex ? 'left' : 'right',
    }
  }

  if (originIsSupply || targetIsSupply) {
    const supplyRef = originIsSupply ? origin : target
    const otherRef = originIsSupply ? target : origin
    // A panel input cannot be moved into the middle of an assembly by mistaking
    // an attempted panel rewire for promotion of its first protection.
    const incomingRef = getPanelRootPromotionTargetRef({ ...panel, isMain: false })
    if (
      isSupplyTrunkRef(supplyRef) && assemblySupplyTail(currentProject, supplyRef) !== undefined &&
      incomingRef &&
      panelGridModuleRefKey(incomingRef) === panelGridModuleRefKey(otherRef)
    ) return null
    if (!isSharedSupplyTrunkRef(currentProject, panel, supplyRef)) return null

    if (otherRef.kind === 'protection') {
      const targetProtection = findProtectionById(panels, otherRef.id)
      if (!targetProtection?.circuits?.length) return null
      const circuit = targetProtection.circuits[0]
      if (!circuit || (circuit.subCircuitIds?.length ?? 0) > 1) return null
      const isPanelInput = panel.isMain === true && incomingRef != null &&
        panelGridModuleRefKey(incomingRef) === panelGridModuleRefKey(otherRef)
      if (isPanelInput) {
        // Connecting a main-panel input must never turn its protection into a
        // common device upstream of every other main panel.
        // The promotion writer transfers one circuit; reject a multi-circuit
        // protection rather than leaving a duplicate protection behind.
        if (targetProtection.circuits.length !== 1) return null
        if (!isSharedSupplyTailRef(currentProject, supplyRef)) return null
        const installation = getProjectElectricalInstallation(currentProject)
        if (!installation) return null
        const projection = getPanelFeedProjection(installation, panels, panel)
        if (projection?.rootFeed?.trunkDevices?.length) return null
        return {
          kind: 'promoteProtectionToRootSupply',
          protectionId: otherRef.id,
          circuit,
          insertIndex: 0,
          trunkDevice: trunkDeviceFromProtection(targetProtection, circuit, 0),
        }
      }
      const supplyDeviceIndex = getSharedSupplyDeviceIndex(currentProject, panel, supplyRef.id)
      const insertIndex = supplyDeviceIndex >= 0
        ? supplyDeviceIndex + 1
        : getSharedSupplyRefsForPanel(currentProject, panel).length

      return {
        kind: 'promoteProtectionToSharedSupply',
        protectionId: otherRef.id,
        circuit,
        insertIndex,
        trunkDevice: trunkDeviceFromProtection(targetProtection, circuit, insertIndex),
      }
    }

    const targetCircuitId = getCircuitIdFromModuleRef(otherRef, panel, currentProject)
    if (!targetCircuitId) return null
    const parentCircuitId = findParentCircuitId(panels, targetCircuitId)
    if (!parentCircuitId) return null
    const parentCircuit = findCircuitInPanels(panels, parentCircuitId)
    if (!parentCircuit) return null
    const index = (parentCircuit.subCircuitIds ?? []).indexOf(targetCircuitId)
    if (index === -1) return null
    const updatedSubCircuitIds = [...(parentCircuit.subCircuitIds ?? [])]
    updatedSubCircuitIds.splice(index, 1)

    return {
      kind: 'detachCircuitFromSupplyParent',
      parentCircuitId,
      subCircuitIds: updatedSubCircuitIds.length > 0 ? updatedSubCircuitIds : undefined,
    }
  }

  const originCircuitId = getCircuitIdFromModuleRef(origin, panel, currentProject)
  const targetCircuitId = getCircuitIdFromModuleRef(target, panel, currentProject)
  if (!originCircuitId || !targetCircuitId || originCircuitId === targetCircuitId) return null
  if (canReachCircuit(panels, targetCircuitId, originCircuitId)) return null

  return { kind: 'rewireCircuit', originCircuitId, targetCircuitId }
}

export function validatePanelRewireOperation(
  panel: Panel | null,
  currentProject: ProjectWithOptionalV2Electrical | null,
  origin: PanelGridModuleRef,
  target: PanelGridModuleRef | null,
): boolean {
  return getPanelRewireOperation(panel, currentProject, origin, target) != null
}
