import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import {
  isPanelDistributionEndpointForPanel,
  resolvePanelSupplyLinkForPanelInPanels,
} from '@/lib/eendraad/panelSupplyLink'
import {
  findCircuitOwner,
  findProtectionSupplyingPanel,
  panelContainsDescendant,
  removePanelFromHierarchy,
} from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { detachPanelInputHandoffs } from '@/lib/supplyAssembly/detachPanelHandoffs'
import type { ProjectV2 } from '@/types/projectV2'
import type { Installation, Panel, PanelGridModuleRef, PanelGridSlot } from '@/types/schema'

export interface PromotePanelToRootSupplyResult {
  panelId: string
  previousSourcePanelId?: string
  previousFeederProtectionId?: string
  movedIncomingDeviceIds: string[]
}

/** Reattach an existing board to an unoccupied circuit protection. Mutates only the supplied draft. */
export function movePanelToCircuitInProject(
  project: ProjectV2,
  panelId: string,
  circuitId: string
): { ok: true; panelName: string; circuitCode: string; sourcePanelName: string } |
  { ok: false; code: 'unknown_target' | 'unsupported_topology'; message: string } {
  const panels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  const panel = findPanelById(panels, panelId)
  const target = findCircuitOwner(panels, circuitId)
  if (!installation || !panel || !target)
    return { ok: false, code: 'unknown_target', message: 'Panel or target circuit was not found.' }
  if (!target.protection)
    return { ok: false, code: 'unsupported_topology', message: 'The target circuit has no protection that can feed a panel.' }
  if (target.protection.subPanelId && target.protection.subPanelId !== panelId)
    return { ok: false, code: 'unsupported_topology', message: 'The target protection already feeds another panel.' }
  if (target.panel.id === panelId || panelContainsDescendant(panel, target.panel.id))
    return { ok: false, code: 'unsupported_topology', message: 'A panel cannot be fed from itself or a descendant.' }
  const previousLink = resolvePanelSupplyLinkForPanelInPanels(panels, panelId)
  if (previousLink?.protection.id === target.protection.id)
    return { ok: false, code: 'unsupported_topology', message: 'The panel is already fed by that circuit.' }

  const detachedPanel = removePanelFromHierarchy(panels, panelId)
  if (!detachedPanel)
    return { ok: false, code: 'unknown_target', message: 'The panel could not be detached.' }
  detachPanelInputHandoffs(project, panelId)
  const previousFeeder = findProtectionSupplyingPanel(panels, panelId)
  const oldProtection = previousFeeder?.protection ?? previousLink?.protection
  if (oldProtection) {
    oldProtection.subPanelId = undefined
    for (const circuit of oldProtection.circuits ?? [])
      circuit.endpoints = circuit.endpoints.filter(
        (endpoint) => !isPanelDistributionEndpointForPanel(endpoint, panel)
      )
  }
  detachedPanel.isMain = false
  target.panel.subPanels.push(detachedPanel)
  target.protection.subPanelId = detachedPanel.id
  const topology = ensureInstallationFeedTopology(installation, panels)
  topology.rootFeeds = topology.rootFeeds.filter((feed) =>
    findPanelById(panels, feed.panelId)?.isMain === true
  )
  return { ok: true, panelName: panel.name, circuitCode: target.circuit.code,
    sourcePanelName: target.panel.name }
}

function rewriteIncomingGridRef(
  ref: PanelGridModuleRef,
  panelCircuitId: string,
  incomingDeviceIds: ReadonlySet<string>
): PanelGridModuleRef {
  if (
    ref.kind !== 'trunkDevice' ||
    ref.scope !== 'circuit' ||
    ref.circuitId !== panelCircuitId ||
    !incomingDeviceIds.has(ref.id)
  ) {
    return ref
  }
  return { kind: 'trunkDevice', id: ref.id, scope: 'supply' }
}

function rewriteIncomingGridSlots(
  slots: PanelGridSlot[] | undefined,
  panelCircuitId: string,
  incomingDeviceIds: ReadonlySet<string>
): PanelGridSlot[] | undefined {
  if (!slots) return undefined
  return slots.map((slot) => ({
    ...slot,
    module: rewriteIncomingGridRef(slot.module, panelCircuitId, incomingDeviceIds),
  }))
}

function rewriteIncomingVisibilityKeys(
  keys: string[] | undefined,
  panelCircuitId: string,
  incomingDeviceIds: ReadonlySet<string>
): string[] | undefined {
  if (!keys) return undefined
  const oldKeys = new Map(
    [...incomingDeviceIds].map((id) => [
      `trunkDevice:${id}:circuit${panelCircuitId}`,
      `trunkDevice:${id}:supply`,
    ])
  )
  return [...new Set(keys.map((key) => oldKeys.get(key) ?? key))]
}

function detachPreviousPanelLink(
  panels: Panel[],
  panel: Panel
): {
  previousSourcePanelId?: string
  previousFeederProtectionId?: string
} {
  const link = resolvePanelSupplyLinkForPanelInPanels(panels, panel.id)
  const fallback = findProtectionSupplyingPanel(panels, panel.id)
  const protection = link?.protection ?? fallback?.protection
  if (!protection) return {}

  protection.subPanelId = undefined
  for (const circuit of protection.circuits ?? []) {
    circuit.endpoints = circuit.endpoints.filter(
      (endpoint) => !isPanelDistributionEndpointForPanel(endpoint, panel)
    )
  }

  return {
    previousSourcePanelId: link?.sourcePanel.id ?? fallback?.panel.id,
    previousFeederProtectionId: protection.id,
  }
}

/**
 * Promote a nested/secondary panel onto the installation's parallel root supply.
 *
 * The operation preserves local incoming devices by moving them from the
 * secondary-panel `PANEL` circuit to the new root feed. The former feeder
 * protection remains in its source panel, but no longer links to or renders the
 * promoted panel.
 */
export function promotePanelToRootSupply(
  panels: Panel[],
  installation: Installation,
  panelId: string
): PromotePanelToRootSupplyResult | null {
  const panel = findPanelById(panels, panelId)
  if (!panel || (panels.includes(panel) && panel.isMain === true)) return null

  const previousLink = detachPreviousPanelLink(panels, panel)
  const detachedPanel = removePanelFromHierarchy(panels, panelId)
  if (!detachedPanel) return null

  const panelCircuit = detachedPanel.circuits.find((circuit) => circuit.code === 'PANEL')
  const incomingDevices = [...(panelCircuit?.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )

  detachedPanel.isMain = true
  panels.push(detachedPanel)

  const topology = ensureInstallationFeedTopology(installation, panels)
  topology.rootFeeds = topology.rootFeeds.filter((feed) => {
    const rootPanel = panels.find((panel) => panel.id === feed.panelId)
    return rootPanel?.isMain === true
  })
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === detachedPanel.id)
  if (!rootFeed) return null

  if (incomingDevices.length > 0 && panelCircuit) {
    const merged = [
      ...incomingDevices,
      ...(rootFeed.trunkDevices ?? []).filter(
        (device) => !incomingDevices.some((incoming) => incoming.id === device.id)
      ),
    ]
    rootFeed.trunkDevices = merged.map((device, index) => ({
      ...device,
      trunkPosition: index,
    }))
    panelCircuit.trunkDevices = undefined

    const movedIds = new Set(incomingDevices.map((device) => device.id))
    detachedPanel.gridView &&= {
      ...detachedPanel.gridView,
      slots:
        rewriteIncomingGridSlots(detachedPanel.gridView.slots, panelCircuit.id, movedIds) ?? [],
      supplyPanelSlots: rewriteIncomingGridSlots(
        detachedPanel.gridView.supplyPanelSlots,
        panelCircuit.id,
        movedIds
      ),
      shownModuleKeys: rewriteIncomingVisibilityKeys(
        detachedPanel.gridView.shownModuleKeys,
        panelCircuit.id,
        movedIds
      ),
      hiddenModuleKeys: rewriteIncomingVisibilityKeys(
        detachedPanel.gridView.hiddenModuleKeys,
        panelCircuit.id,
        movedIds
      ),
    }
  }

  return {
    panelId: detachedPanel.id,
    ...previousLink,
    movedIncomingDeviceIds: incomingDevices.map((device) => device.id),
  }
}
