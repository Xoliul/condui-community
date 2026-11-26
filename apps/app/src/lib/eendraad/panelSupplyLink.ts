import type { Circuit, Endpoint, Panel, ProtectionDevice } from '@/types/schema'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'

export interface PanelSupplyLink {
  sourcePanel: Panel
  targetPanel: Panel
  protection: ProtectionDevice
  feederCircuit?: Circuit
  sourcePanelEndpoint?: Endpoint
  targetPanelEndpoint?: Endpoint
}

/** Dedicated board feeders are terminal; a board at the end of a mixed circuit is not. */
export function isTerminalPanelFeederCircuit(
  protection: ProtectionDevice,
  circuit: Circuit,
): boolean {
  return !!protection.subPanelId &&
    !(circuit.subCircuitIds?.length) &&
    circuit.endpoints.every((endpoint) => endpoint.symbol === 'panel_distribution')
}

/** A board fed from one precise module output, rather than the whole protection. */
export function isDomoticaPanelFeedEndpoint(
  endpoint: Endpoint | null | undefined,
): endpoint is Endpoint & { panelId: string; domoticaChildProps: NonNullable<Endpoint['domoticaChildProps']> } {
  return endpoint?.symbol === 'panel_distribution' && !!endpoint.panelId &&
    !!endpoint.domoticaChildProps?.parentEndpointId &&
    endpoint.domoticaChildProps.outputGroup === 'endpoint'
}

export function protectionFeedsPanel(protection: ProtectionDevice): boolean {
  return !!protection.subPanelId ||
    (protection.circuits ?? []).some((circuit) => circuit.endpoints.some(isDomoticaPanelFeedEndpoint))
}

export function isPanelDistributionEndpointForPanel(endpoint: Endpoint, panel: Panel): boolean {
  return endpoint?.symbol === 'panel_distribution' &&
    (endpoint.panelId ? endpoint.panelId === panel.id : endpoint.label === panel.name)
}

export function findPanelDistributionEndpointInCircuit(
  circuit: Circuit | undefined,
  panel: Panel
): Endpoint | undefined {
  return circuit?.endpoints?.find((endpoint) => isPanelDistributionEndpointForPanel(endpoint, panel))
}

export function findPanelOwnDistributionEndpoint(panel: Panel): Endpoint | undefined {
  const panelCircuit = panel.circuits?.find((circuit) => circuit.code === 'PANEL')
  return (
    panelCircuit?.endpoints?.find((endpoint) =>
      isPanelDistributionEndpointForPanel(endpoint, panel)
    ) ??
    panel.circuits
      ?.flatMap((circuit) => circuit.endpoints ?? [])
      .find((endpoint) => isPanelDistributionEndpointForPanel(endpoint, panel))
  )
}

function findImplicitDirectPanelFeederCircuit(
  protection: ProtectionDevice,
): Circuit | undefined {
  const circuits = protection.circuits ?? []
  const nestedIds = new Set(circuits.flatMap((circuit) => circuit.subCircuitIds ?? []))
  return circuits.find(
    (circuit) =>
      nestedIds.has(circuit.id) &&
      (circuit.endpoints?.length ?? 0) === 0 &&
      (circuit.branches?.length ?? 0) === 0 &&
      (circuit.subCircuitIds?.length ?? 0) === 0 &&
      (circuit.trunkDevices?.length ?? 0) === 0,
  )
}

export function resolvePanelSupplyLinkForProtection(
  project: ProjectWithOptionalV2Electrical,
  sourcePanel: Panel,
  protection: ProtectionDevice
): PanelSupplyLink | null {
  return resolvePanelSupplyLinkForProtectionInPanels(
    getProjectElectricalPanels(project),
    sourcePanel,
    protection,
  )
}

export function resolvePanelSupplyLinkForProtectionInPanels(
  panels: Panel[],
  sourcePanel: Panel,
  protection: ProtectionDevice,
): PanelSupplyLink | null {
  const links = resolvePanelSupplyLinksForProtectionInPanels(panels, sourcePanel, protection)
  return links.find((link) => link.targetPanel.id === protection.subPanelId) ?? links[0] ?? null
}

export function resolvePanelSupplyLinksForProtection(
  project: ProjectWithOptionalV2Electrical,
  sourcePanel: Panel,
  protection: ProtectionDevice,
): PanelSupplyLink[] {
  return resolvePanelSupplyLinksForProtectionInPanels(getProjectElectricalPanels(project), sourcePanel, protection)
}

/** Output-specific links take priority over a redundant historical whole-protection link. */
export function resolvePanelSupplyLinksForProtectionInPanels(
  panels: Panel[],
  sourcePanel: Panel,
  protection: ProtectionDevice,
): PanelSupplyLink[] {
  const links: PanelSupplyLink[] = []
  const seenPanels = new Set<string>()
  for (const circuit of protection.circuits ?? []) {
    for (const endpoint of circuit.endpoints ?? []) {
      if (!isDomoticaPanelFeedEndpoint(endpoint) || seenPanels.has(endpoint.panelId)) continue
      const parent = circuit.endpoints.find((candidate) => candidate.id === endpoint.domoticaChildProps.parentEndpointId)
      if (parent?.symbol !== 'domotica' || !parent.domoticaProps) continue
      const targetPanel = findPanelById(panels, endpoint.panelId)
      if (!targetPanel || targetPanel.id === sourcePanel.id) continue
      links.push({
        sourcePanel, targetPanel, protection, feederCircuit: circuit,
        sourcePanelEndpoint: endpoint, targetPanelEndpoint: findPanelOwnDistributionEndpoint(targetPanel),
      })
      seenPanels.add(targetPanel.id)
    }
  }
  if (!protection.subPanelId || seenPanels.has(protection.subPanelId)) return links
  const legacy = resolveWholeProtectionPanelSupplyLink(panels, sourcePanel, protection)
  if (legacy) links.push(legacy)
  return links
}

function resolveWholeProtectionPanelSupplyLink(
  panels: Panel[],
  sourcePanel: Panel,
  protection: ProtectionDevice,
): PanelSupplyLink | null {
  if (!protection.subPanelId) return null
  const targetPanel = findPanelById(panels, protection.subPanelId)
  if (!targetPanel) return null

  const circuits = protection.circuits ?? []
  const feederCircuit =
    circuits.find((circuit) => findPanelDistributionEndpointInCircuit(circuit, targetPanel)) ??
    findImplicitDirectPanelFeederCircuit(protection) ??
    circuits[0]
  const sourcePanelEndpoint = findPanelDistributionEndpointInCircuit(feederCircuit, targetPanel)
  const targetPanelEndpoint = findPanelOwnDistributionEndpoint(targetPanel)

  return {
    sourcePanel,
    targetPanel,
    protection,
    feederCircuit,
    sourcePanelEndpoint,
    targetPanelEndpoint,
  }
}

export function resolvePanelSupplyLinkForPanel(
  project: ProjectWithOptionalV2Electrical,
  targetPanelId: string
): PanelSupplyLink | null {
  return resolvePanelSupplyLinkForPanelInPanels(
    getProjectElectricalPanels(project),
    targetPanelId,
  )
}

export function resolvePanelSupplyLinkForPanelInPanels(
  rootPanels: Panel[],
  targetPanelId: string,
): PanelSupplyLink | null {
  const search = (panels: Panel[]): PanelSupplyLink | null => {
    for (const panel of panels) {
      for (const protection of panel.protections ?? []) {
        const link = resolvePanelSupplyLinksForProtectionInPanels(rootPanels, panel, protection)
          .find((candidate) => candidate.targetPanel.id === targetPanelId)
        if (link) return link
      }
      const nested = search(panel.subPanels ?? [])
      if (nested) return nested
    }
    return null
  }

  return search(rootPanels)
}

export function resolvePanelSupplyLinksForSourcePanel(
  project: ProjectWithOptionalV2Electrical,
  sourcePanel: Panel
): PanelSupplyLink[] {
  return resolvePanelSupplyLinksForSourcePanelInPanels(getProjectElectricalPanels(project), sourcePanel)
}

/** Resolve source-panel links when the caller already owns the canonical panel projection. */
export function resolvePanelSupplyLinksForSourcePanelInPanels(
  rootPanels: Panel[],
  sourcePanel: Panel,
): PanelSupplyLink[] {
  const links = (sourcePanel.protections ?? []).flatMap((protection) =>
    resolvePanelSupplyLinksForProtectionInPanels(rootPanels, sourcePanel, protection))
  const seenPanels = new Set<string>()
  return links.filter((link) => {
    if (seenPanels.has(link.targetPanel.id)) return false
    seenPanels.add(link.targetPanel.id)
    return true
  })
}

export function panelSupplyLinkHasRenderableSymbol(link: PanelSupplyLink): boolean {
  return !!(link.sourcePanelEndpoint || link.targetPanelEndpoint)
}
