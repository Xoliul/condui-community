import { logger } from '@/lib/logger'
import { symbolCanAppearInPanelGrid } from '@/lib/panel/panelGridSymbolEligibility'
export { symbolCanAppearInPanelGrid } from '@/lib/panel/panelGridSymbolEligibility'
import { isModularSocket } from '@/lib/socket/modularSocket'
import type {
  Circuit,
  DomoticaOutputWireProps,
  Endpoint,
  ImportedPlanAsset,
  Installation,
  Panel,
  PanelGridModuleRef,
  PanelGridSlot,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import type { ElementModelV2, RelationshipModelV2 } from '@/types/projectV2'
import { clamp } from '@/lib/geometry'
import {
  assignManualInstallYearToTarget as assignManualInstallYear,
  type ChronologyProject,
} from '@/lib/chronology/chronology'
import {
  ensureInstallationFeedTopology,
  ensureRootFeedForBusSection,
  getPanelSupplyTrunkDevices,
  type SupplyFeedScope,
} from '@/lib/feedTopology'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getTerminalStripId } from '@/lib/terminalStrip/labels'
import { removeSupplyAssemblyHandoffsForTargets } from '@/lib/supplyAssembly/repairDanglingReferences'
import { queryOneWireFrames, replaceOneWireFrames } from '@/lib/projectV2/annotations'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import {
  findPanelOwnDistributionEndpoint,
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinkForPanelInPanels,
} from '@/lib/eendraad/panelSupplyLink'
import { syncDerivedEndpointFlags } from '@/lib/eendraad/endpointInsertAfter'
import { relabelDomoticaChildRows } from '@/lib/eendraad/domoticaOutputOrdering'
import {
  applyAutomaticMainBusNamingToPanel,
  resolveAutomaticNamingOptsFromInstallation,
} from '@/lib/eendraad/automaticMainBusNaming'
import {
  dedupeAllPanelsProtectionsInProject,
  dedupePanelProtectionsInPanelTree,
} from '@/lib/eendraad/mainBusOrder'
import { findPanelById, findPanelByName } from '@/lib/panel/panelTree'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import { findPanelGridDuplicateFindings } from '@/lib/panel/panelGridDuplicates'
import { DEFAULT_RCBO_SENSITIVITY_MA } from '@/lib/protectionDefaults'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { generateId } from '@/utils/project'

export type ElectricalDomainProject = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2Building &
  ChronologyProject & {
    project: {
      id?: string
      yearOfConstruction?: number
      installDateColors?: Record<string, string>
    }
  }

export function maybeApplyAutomaticEendraadNamingForPanel(
  project: ElectricalDomainProject,
  panelId: string
): void {
  const installation = getProjectElectricalInstallation(project)
  if (!installation?.eendraadAutomaticNaming) return
  const panels = getProjectElectricalPanels(project)
  const panel = findPanelById(panels, panelId)
  if (!panel) return
  dedupePanelProtectionsInPanelTree(panel)
  applyAutomaticMainBusNamingToPanel(
    panel,
    resolveAutomaticNamingOptsFromInstallation(installation),
    project
  )
}

export function findPanelOwningSupplyDevice(
  project: ElectricalDomainProject,
  deviceId: string
): Panel | undefined {
  const installation = getProjectElectricalInstallation(project)
  const projectPanels = getProjectElectricalPanels(project)
  if (!installation) return undefined
  const visit = (panels: Panel[]): Panel | undefined => {
    for (const panel of panels) {
      const devices = getPanelSupplyTrunkDevices(installation, projectPanels, panel)
      if (devices.some((device) => device.id === deviceId)) {
        return panel
      }
      const nested = visit(panel.subPanels ?? [])
      if (nested) return nested
    }
    return undefined
  }
  return visit(projectPanels)
}

export function syncManualChronologyForInstallDateUpdate(
  project: ElectricalDomainProject,
  target: { id: string; type: 'panel' | 'protection' | 'circuit' | 'endpoint' | 'trunkDevice' },
  updates: { rulesetDateOverride?: number }
): void {
  if (!Object.prototype.hasOwnProperty.call(updates, 'rulesetDateOverride')) return
  assignManualInstallYear(project, target, updates.rulesetDateOverride)
}

export function parseInstallYearFromIso(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined
  const year = new Date(iso).getFullYear()
  return Number.isInteger(year) && year >= 1800 && year <= 2100 ? year : undefined
}

export function refreshAutomaticNamingForPanelsShowingSupplyDevice(
  project: ElectricalDomainProject,
  deviceId: string
): void {
  const panel = findPanelOwningSupplyDevice(project, deviceId)
  if (panel) {
    maybeApplyAutomaticEendraadNamingForPanel(project, panel.id)
  }
}

export function isSharedSupplyTrunkModuleRef(
  project: ElectricalDomainProject,
  panel: Panel,
  ref: PanelGridModuleRef
): boolean {
  if (!panel.isMain || ref.kind !== 'trunkDevice' || ref.scope !== 'supply') return false
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const key = panelGridModuleRefKey(ref)
  const sharedDevices = [
    ...(installation.mainSupply.supplyTrunkDevices ?? []),
    ...(installation.feedTopology?.sharedFeed.trunkDevices ?? []),
  ]
  return sharedDevices.some(
    (device) =>
      panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' }) === key
  )
}

export function arePanelGridSlotsEqual(
  a: PanelGridSlot[] | undefined,
  b: PanelGridSlot[] | undefined
): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i]
    const r = right[i]
    if (!l || !r) return false
    if (l.row !== r.row || l.col !== r.col) return false
    if (l.moduleWidth !== r.moduleWidth || l.moduleWidthManual !== r.moduleWidthManual) return false
    if (panelGridModuleRefKey(l.module) !== panelGridModuleRefKey(r.module)) return false
  }
  return true
}

export function applyAutomaticEendraadNamingAllPanelsInProject(
  project: ElectricalDomainProject
): void {
  const installation = getProjectElectricalInstallation(project)
  if (!installation?.eendraadAutomaticNaming) return
  dedupeAllPanelsProtectionsInProject(project)
  const opts = resolveAutomaticNamingOptsFromInstallation(installation)
  const walk = (panels: Panel[]) => {
    for (const p of panels) {
      applyAutomaticMainBusNamingToPanel(p, opts, project)
      if (p.subPanels?.length) walk(p.subPanels)
    }
  }
  walk(getProjectElectricalPanels(project))
}

function supplyFeedListForPanelAndScope(
  project: ElectricalDomainProject,
  panelId?: string,
  scope: SupplyFeedScope = 'shared',
  busSectionId?: string,
): TrunkDevice[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const panels = getProjectElectricalPanels(project)
  if (scope === 'shared' || !panelId) {
    if (!installation.mainSupply.supplyTrunkDevices) {
      installation.mainSupply.supplyTrunkDevices = []
    }
    return installation.mainSupply.supplyTrunkDevices
  }
  const topology = ensureInstallationFeedTopology(installation, panels)
  const rootFeed = busSectionId
    ? ensureRootFeedForBusSection(installation, panels, panelId, busSectionId)
    : topology.rootFeeds.find((feed) => feed.panelId === panelId)
  if (!rootFeed) return []
  if (!rootFeed.trunkDevices) rootFeed.trunkDevices = []
  return rootFeed.trunkDevices
}

export function findSupplyDeviceContainer(
  project: ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building,
  deviceId: string
): { devices: TrunkDevice[]; scope: SupplyFeedScope; panelId?: string } | null {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return null
  const panels = getProjectElectricalPanels(project)
  const legacyDevices = installation.mainSupply?.supplyTrunkDevices ?? []
  if (legacyDevices.some((device) => device.id === deviceId)) {
    return { devices: legacyDevices, scope: 'shared' }
  }
  const topology = ensureInstallationFeedTopology(installation, panels)
  for (const feed of topology.rootFeeds) {
    const devices = feed.trunkDevices ?? []
    if (devices.some((device) => device.id === deviceId)) {
      if (!feed.trunkDevices) feed.trunkDevices = devices
      return { devices, scope: 'root', panelId: feed.panelId }
    }
  }
  const sharedDevices = topology.sharedFeed.trunkDevices ?? []
  if (sharedDevices.some((device) => device.id === deviceId)) {
    return { devices: sharedDevices, scope: 'shared' }
  }
  return null
}

/**
 * Grid slots often store `moduleWidth` after auto-layout; when pole count changes, drop widths that
 * only mirrored the old default so the canvas follows the new pole-based width. User resizes
 * (`moduleWidthManual`) are kept.
 */
export function clearStaleAutoModuleWidthForModuleRef(
  panels: Panel[],
  moduleRef: PanelGridModuleRef,
  oldPoleWidth: number
): void {
  const refKey = panelGridModuleRefKey(moduleRef)
  const visit = (panel: Panel) => {
    const gv = panel.gridView
    if (gv?.slots) {
      for (const s of gv.slots) {
        if (panelGridModuleRefKey(s.module) !== refKey) continue
        if (s.moduleWidthManual === true) continue
        if (s.moduleWidth != null && s.moduleWidth === oldPoleWidth) {
          s.moduleWidth = undefined
        }
      }
    }
    if (gv?.supplyPanelSlots) {
      for (const s of gv.supplyPanelSlots) {
        if (panelGridModuleRefKey(s.module) !== refKey) continue
        if (s.moduleWidthManual === true) continue
        if (s.moduleWidth != null && s.moduleWidth === oldPoleWidth) {
          s.moduleWidth = undefined
        }
      }
    }
    for (const sub of panel.subPanels) visit(sub)
  }
  for (const p of panels) visit(p)
}

export function removePanelFromHierarchy(panels: Panel[], panelId: string): Panel | null {
  const rootIndex = panels.findIndex((panel) => panel.id === panelId)
  if (rootIndex !== -1) {
    const [removed] = panels.splice(rootIndex, 1)
    return removed ?? null
  }

  for (const panel of panels) {
    const childIndex = panel.subPanels.findIndex((subPanel) => subPanel.id === panelId)
    if (childIndex !== -1) {
      const [removed] = panel.subPanels.splice(childIndex, 1)
      return removed ?? null
    }
    const removed = removePanelFromHierarchy(panel.subPanels, panelId)
    if (removed) return removed
  }

  return null
}

export function panelContainsDescendant(panel: Panel, targetPanelId: string): boolean {
  return panel.subPanels.some(
    (subPanel) => subPanel.id === targetPanelId || panelContainsDescendant(subPanel, targetPanelId)
  )
}

export function syncLinkedSubPanelHierarchy(project: ElectricalDomainProject): boolean {
  let changed = false
  const links: Array<{ sourcePanel: Panel; targetPanelId: string }> = []

  const collect = (panels: Panel[]) => {
    for (const panel of panels) {
      for (const protection of panel.protections ?? []) {
        if (protection.subPanelId) {
          links.push({ sourcePanel: panel, targetPanelId: protection.subPanelId })
        }
      }
      collect(panel.subPanels ?? [])
    }
  }

  const panels = getProjectElectricalPanels(project)
  collect(panels)

  for (const link of links) {
    const targetPanel = findPanelById(panels, link.targetPanelId)
    if (!targetPanel || targetPanel.isMain) continue
    if (link.sourcePanel.id === targetPanel.id) continue
    if (link.sourcePanel.subPanels?.some((subPanel) => subPanel.id === targetPanel.id)) continue
    if (panelContainsDescendant(targetPanel, link.sourcePanel.id)) continue

    const detached = removePanelFromHierarchy(panels, targetPanel.id)
    if (!detached) continue
    detached.isMain = false
    link.sourcePanel.subPanels = link.sourcePanel.subPanels ?? []
    link.sourcePanel.subPanels.push(detached)
    changed = true
  }

  return changed
}

export function findProtectionSupplyingPanel(
  panels: Panel[],
  panelId: string
): { panel: Panel; protection: ProtectionDevice } | null {
  const link = resolvePanelSupplyLinkForPanelInPanels(panels, panelId)
  return link ? { panel: link.sourcePanel, protection: link.protection } : null
}

/** After removing feeder device(s), delete linked sub-panel(s) that nothing feeds anymore. */
export function deleteLinkedSubPanelsIfOrphaned(
  project: ElectricalDomainProject,
  candidateSubPanelIds: Iterable<string>
): void {
  const panels = getProjectElectricalPanels(project)
  for (const panelId of candidateSubPanelIds) {
    if (!findProtectionSupplyingPanel(panels, panelId)) {
      deletePanelFromProject(project, panelId)
    }
  }
}

export function findCircuitOwner(
  panels: Panel[],
  circuitId: string
): { panel: Panel; circuit: Circuit; protection?: ProtectionDevice } | null {
  for (const panel of panels) {
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        if (circuit.id === circuitId) {
          return { panel, circuit, protection }
        }
      }
    }
    for (const circuit of panel.circuits) {
      if (circuit.id === circuitId) {
        return { panel, circuit }
      }
    }
    const inSubPanels = findCircuitOwner(panel.subPanels, circuitId)
    if (inSubPanels) return inSubPanels
  }
  return null
}

export function deletePanelFromProject(project: ElectricalDomainProject, panelId: string): boolean {
  const panels = getProjectElectricalPanels(project)
  const targetPanel = findPanelById(panels, panelId)
  if (!targetPanel) return false
  if (targetPanel.isMain) {
    const countMainPanels = (panelList: Panel[]): number =>
      panelList.reduce(
        (count, panel) => count + (panel.isMain ? 1 : 0) + countMainPanels(panel.subPanels ?? []),
        0
      )
    if (countMainPanels(panels) <= 1) return false
  }

  const collectPanelIds = (id: string): string[] => {
    const panel = findPanelById(panels, id)
    if (!panel) return []
    const ids = [id]
    for (const subPanel of panel.subPanels ?? []) {
      ids.push(...collectPanelIds(subPanel.id))
    }
    return ids
  }
  const panelIdsToDelete = collectPanelIds(panelId)
  const panelIdSet = new Set(panelIdsToDelete)
  const deletedRootFeedIds = new Set(
    (getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? [])
      .filter((feed) => panelIdSet.has(feed.panelId))
      .map((feed) => feed.id)
  )

  removeSupplyAssemblyHandoffsForTargets(project, panelIdSet, deletedRootFeedIds)

  const unlinkProtectionsWithSubPanel = (panels: Panel[]) => {
    for (const panel of panels) {
      for (const protection of panel.protections ?? []) {
        if (protection.subPanelId && panelIdSet.has(protection.subPanelId)) {
          protection.subPanelId = undefined
        }
      }
      unlinkProtectionsWithSubPanel(panel.subPanels ?? [])
    }
  }
  unlinkProtectionsWithSubPanel(panels)

  const isDeletedPanelEndpoint = (endpoint: Endpoint): boolean => {
    if (endpoint.symbol !== 'panel_distribution') return false
    if (endpoint.panelId && panelIdSet.has(endpoint.panelId)) return true
    const byName = endpoint.label ? findPanelByName(panels, endpoint.label) : undefined
    return !!byName && panelIdSet.has(byName.id)
  }

  const cleanupPanelCircuits = (panels: Panel[]) => {
    for (const panel of panels) {
      panel.circuits = panel.circuits.filter((circuit) => {
        if (circuit.code !== 'PANEL') return true
        const panelEndpoint = circuit.endpoints.find((e) => e.symbol === 'panel_distribution')
        return panelEndpoint ? !isDeletedPanelEndpoint(panelEndpoint) : true
      })

      for (const protection of panel.protections ?? []) {
        if (!protection.circuits) continue
        protection.circuits = protection.circuits.filter((circuit) => {
          if (circuit.code !== 'PANEL') return true
          const panelEndpoint = circuit.endpoints.find((e) => e.symbol === 'panel_distribution')
          return panelEndpoint ? !isDeletedPanelEndpoint(panelEndpoint) : true
        })
      }
      cleanupPanelCircuits(panel.subPanels ?? [])
    }
  }
  cleanupPanelCircuits(panels)

  const frames = queryOneWireFrames(project)
  const keptFrames = frames.filter((frame) => !panelIdSet.has(frame.panelId))
  if (keptFrames.length !== frames.length) {
    replaceOneWireFrames(project, keptFrames)
  }

  const removePanel = (panels: Panel[], id: string): boolean => {
    const index = panels.findIndex((p) => p.id === id)
    if (index !== -1) {
      panels.splice(index, 1)
      return true
    }
    for (const panel of panels) {
      if (removePanel(panel.subPanels ?? [], id)) return true
    }
    return false
  }

  const removed = removePanel(panels, panelId)
  if (removed) {
    const installation = getProjectElectricalInstallation(project)
    if (installation?.feedTopology) {
      installation.feedTopology.rootFeeds = installation.feedTopology.rootFeeds.filter(
        (feed) => !panelIdSet.has(feed.panelId)
      )
      ensureInstallationFeedTopology(installation, panels)
    }
  }
  return removed
}

export function findProtectionById(panel: Panel, id: string): ProtectionDevice | undefined {
  const protection = panel.protections.find((p) => p.id === id)
  if (protection) return protection

  // Check sub-panels
  for (const subPanel of panel.subPanels) {
    const found = findProtectionById(subPanel, id)
    if (found) return found
  }
  return undefined
}

/** The panel whose `protections` array contains this device (not an ancestor root panel). */
export function findPanelOwningProtection(
  panels: Panel[],
  protectionId: string
): Panel | undefined {
  for (const panel of panels) {
    if (panel.protections?.some((p) => p.id === protectionId)) {
      return panel
    }
    const inSub = findPanelOwningProtection(panel.subPanels ?? [], protectionId)
    if (inSub) return inSub
  }
  return undefined
}

export function rewirePanelGridProtectionModuleId(
  panel: Panel,
  fromProtectionId: string,
  toProtectionId: string
): void {
  const slots = panel.gridView?.slots
  if (!slots?.length) return

  const alreadyHasTarget = slots.some((slot) => {
    const m = slot.module
    return m?.kind === 'protection' && m.id === toProtectionId
  })
  if (alreadyHasTarget) {
    panel.gridView!.slots = slots.filter((slot) => {
      const m = slot.module
      return !(m?.kind === 'protection' && m.id === fromProtectionId)
    })
    return
  }

  for (const slot of slots) {
    const m = slot.module
    if (m?.kind === 'protection' && m.id === fromProtectionId) {
      const protectionModule = m as { kind: 'protection'; id: string }
      protectionModule.id = toProtectionId
    }
  }
}

export function removePanelGridDuplicateRefs(
  project: ElectricalDomainProject,
  panel: Panel
): boolean {
  if (!panel.gridView) return false

  const mainSlots = panel.gridView.slots ?? []
  const supplySlots = panel.gridView.supplyPanelSlots ?? []
  const candidates = [
    ...mainSlots.map((slot, index) => ({
      ref: slot.module,
      area: 'main' as const,
      row: slot.row,
      col: slot.col,
      order: index,
    })),
    ...supplySlots.map((slot, index) => ({
      ref: slot.module,
      area: 'supply' as const,
      row: slot.row,
      col: slot.col,
      order: mainSlots.length + index,
    })),
  ]
  const duplicateRefs = findPanelGridDuplicateFindings(project, candidates)
    .filter((finding) => finding.reason === 'duplicateRef')
    .flatMap((finding) => finding.remove)

  if (duplicateRefs.length === 0) return false

  const removeMain = new Set(
    duplicateRefs
      .filter((entry) => entry.area === 'main')
      .map(
        (entry) => `${entry.order}:${entry.row}:${entry.col}:${panelGridModuleRefKey(entry.ref)}`
      )
  )
  const removeSupply = new Set(
    duplicateRefs
      .filter((entry) => entry.area === 'supply')
      .map(
        (entry) =>
          `${entry.order - mainSlots.length}:${entry.row}:${entry.col}:${panelGridModuleRefKey(entry.ref)}`
      )
  )

  panel.gridView.slots = mainSlots.filter(
    (slot, index) =>
      !removeMain.has(`${index}:${slot.row}:${slot.col}:${panelGridModuleRefKey(slot.module)}`)
  )
  panel.gridView.supplyPanelSlots = supplySlots.filter(
    (slot, index) =>
      !removeSupply.has(`${index}:${slot.row}:${slot.col}:${panelGridModuleRefKey(slot.module)}`)
  )
  return true
}

export function removePanelGridDuplicateRefsInProject(project: ElectricalDomainProject): boolean {
  let changed = false
  const visit = (panel: Panel) => {
    if (removePanelGridDuplicateRefs(project, panel)) changed = true
    for (const subPanel of panel.subPanels ?? []) visit(subPanel)
  }
  for (const panel of getProjectElectricalPanels(project)) visit(panel)
  return changed
}

/**
 * Remove saved panel-grid references to protection rows that no longer exist anywhere in the
 * project. Older rotating-switch deletes could leave these behind, which reserved an empty
 * module position after reopening the project.
 */
export function pruneStalePanelGridProtectionReferencesInProject(
  project: ElectricalDomainProject
): boolean {
  const liveProtectionKeys = new Set<string>()
  const collectProtectionKeys = (panel: Panel) => {
    for (const protection of panel.protections) {
      liveProtectionKeys.add(panelGridModuleRefKey({ kind: 'protection', id: protection.id }))
    }
    for (const subPanel of panel.subPanels ?? []) collectProtectionKeys(subPanel)
  }
  const panels = getProjectElectricalPanels(project)
  for (const panel of panels) collectProtectionKeys(panel)

  let changed = false
  const isLiveProtectionKey = (key: string) =>
    !key.startsWith('protection:') || liveProtectionKeys.has(key)
  const visit = (panel: Panel) => {
    if (panel.gridView) {
      const pruneSlots = (slots: PanelGridSlot[] | undefined): PanelGridSlot[] => {
        const next = (slots ?? []).filter(
          (slot) =>
            slot.module.kind !== 'protection' ||
            liveProtectionKeys.has(panelGridModuleRefKey(slot.module))
        )
        if (next.length !== (slots ?? []).length) changed = true
        return next
      }
      const pruneKeys = (keys: string[] | undefined): string[] | undefined => {
        if (!keys) return undefined
        const next = keys.filter(isLiveProtectionKey)
        if (next.length !== keys.length) changed = true
        return next.length > 0 ? next : undefined
      }

      panel.gridView.slots = pruneSlots(panel.gridView.slots)
      panel.gridView.supplyPanelSlots = pruneSlots(panel.gridView.supplyPanelSlots)
      panel.gridView.hiddenModuleKeys = pruneKeys(panel.gridView.hiddenModuleKeys)
      panel.gridView.shownModuleKeys = pruneKeys(panel.gridView.shownModuleKeys)
    }
    for (const subPanel of panel.subPanels ?? []) visit(subPanel)
  }
  for (const panel of panels) visit(panel)
  return changed
}

/** Drop panel-grid slots whose module no longer exists on this panel (e.g. after subtree cross-panel move). */
export function prunePanelGridSlotsForUnresolvedModules(panel: Panel): void {
  if (!panel.gridView) return

  const refResolves = (ref: PanelGridModuleRef): boolean => {
    if (ref.kind === 'protection') {
      return panel.protections.some((p) => p.id === ref.id)
    }
    if (ref.kind === 'domotica') {
      const c = getAllCircuits(panel).find((x) => x.id === ref.circuitId)
      return !!c?.endpoints.some((e) => e.id === ref.endpointId)
    }
    if (ref.kind === 'trunkDevice') {
      if (ref.scope === 'circuit' && ref.circuitId) {
        const c = getAllCircuits(panel).find((x) => x.id === ref.circuitId)
        return !!c?.trunkDevices?.some((d) => d.id === ref.id)
      }
      return true
    }
    return true
  }

  const filterSlots = (slots: PanelGridSlot[] | undefined): PanelGridSlot[] =>
    (slots ?? []).filter((s) => refResolves(s.module))

  panel.gridView.slots = filterSlots(panel.gridView.slots)
  panel.gridView.supplyPanelSlots = filterSlots(panel.gridView.supplyPanelSlots)
}

/**
 * A protection promoted onto a secondary panel's incoming PANEL circuit keeps its identity,
 * but its panel-grid reference changes from a protection row to a circuit trunk device.
 */
export function rewirePromotedIncomingProtectionGridRef(
  panel: Panel,
  protectionId: string,
  panelCircuitId: string
): boolean {
  if (!panel.gridView) return false

  const oldKey = panelGridModuleRefKey({ kind: 'protection', id: protectionId })
  const newRef: PanelGridModuleRef = {
    kind: 'trunkDevice',
    id: protectionId,
    scope: 'circuit',
    circuitId: panelCircuitId,
  }
  const newKey = panelGridModuleRefKey(newRef)
  let changed = false
  const seen = new Set<string>()

  const rewriteSlots = (slots: PanelGridSlot[] | undefined): PanelGridSlot[] => {
    const rewritten: PanelGridSlot[] = []
    for (const slot of slots ?? []) {
      const key = panelGridModuleRefKey(slot.module)
      const nextSlot = key === oldKey ? { ...slot, module: { ...newRef } } : slot
      const nextKey = panelGridModuleRefKey(nextSlot.module)
      if (key === oldKey) changed = true
      if (seen.has(nextKey)) {
        changed = true
        continue
      }
      seen.add(nextKey)
      rewritten.push(nextSlot)
    }
    return rewritten
  }

  panel.gridView.slots = rewriteSlots(panel.gridView.slots)
  panel.gridView.supplyPanelSlots = rewriteSlots(panel.gridView.supplyPanelSlots)

  const rewriteVisibilityKeys = (keys: string[] | undefined): string[] | undefined => {
    if (!keys) return undefined
    const rewritten = [...new Set(keys.map((key) => (key === oldKey ? newKey : key)))]
    if (rewritten.some((key, index) => key !== keys[index]) || rewritten.length !== keys.length) {
      changed = true
    }
    return rewritten.length > 0 ? rewritten : undefined
  }
  panel.gridView.hiddenModuleKeys = rewriteVisibilityKeys(panel.gridView.hiddenModuleKeys)
  panel.gridView.shownModuleKeys = rewriteVisibilityKeys(panel.gridView.shownModuleKeys)
  return changed
}

/** Repair stale protection-kind panel slots left by older incoming-wire promotion builds. */
export function healPromotedIncomingProtectionGridRefs(project: ElectricalDomainProject): boolean {
  let changed = false
  const visit = (panel: Panel) => {
    const panelCircuit = panel.circuits.find((circuit) => circuit.code === 'PANEL')
    for (const device of panelCircuit?.trunkDevices ?? []) {
      if (device.type !== 'protection') continue
      if (rewirePromotedIncomingProtectionGridRef(panel, device.id, panelCircuit!.id)) {
        changed = true
        logger.error(
          '[Eendraad Orphan] Repaired stale panel-grid protection reference after promotion to incoming supply wire.',
          { panelId: panel.id, protectionId: device.id, panelCircuitId: panelCircuit!.id }
        )
      }
    }
    for (const subPanel of panel.subPanels ?? []) visit(subPanel)
  }
  for (const panel of getProjectElectricalPanels(project)) visit(panel)
  return changed
}

export function removePromotedIncomingProtectionsFromSubPanels(
  project: ElectricalDomainProject
): boolean {
  void project
  return false
}

export function ensureLinkedSubPanelsHaveOwnPanelEndpoint(
  project: ElectricalDomainProject
): boolean {
  let changed = false

  const visit = (panels: Panel[]) => {
    for (const sourcePanel of panels) {
      for (const protection of sourcePanel.protections ?? []) {
        const link = protection.subPanelId
          ? resolvePanelSupplyLinkForPanel(project, protection.subPanelId)
          : null
        if (!link || link.targetPanelEndpoint) continue

        let panelCircuit = link.targetPanel.circuits.find((circuit) => circuit.code === 'PANEL')
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
          link.targetPanel.circuits.push(panelCircuit)
        }

        panelCircuit.endpoints.push({
          id: generateId(),
          type: 'fixed_appliance',
          label: link.targetPanel.name,
          panelId: link.targetPanel.id,
          symbol: 'panel_distribution',
          placements: [],
        })
        changed = true
      }
      visit(sourcePanel.subPanels ?? [])
    }
  }

  visit(getProjectElectricalPanels(project))
  return changed
}

export function findCircuitById(
  panel: Panel,
  id: string
): { circuit: Circuit; parent: Panel | ProtectionDevice } | undefined {
  // Check direct circuits
  const circuit = panel.circuits.find((c) => c.id === id)
  if (circuit) return { circuit, parent: panel }

  // Check circuits under protections
  for (const protection of panel.protections) {
    if (protection.circuits) {
      const circuit = protection.circuits.find((c) => c.id === id)
      if (circuit) return { circuit, parent: protection }
    }
  }

  // Check sub-panels
  for (const subPanel of panel.subPanels) {
    const found = findCircuitById(subPanel, id)
    if (found) return found
  }
  return undefined
}

/**
 * Circuit under a protection: `findCircuitById` returns `parent` = that ProtectionDevice.
 * Direct panel circuit: `parent` is the Panel that owns `panel.circuits` — then find the
 * protection (if any) on that same panel. Must not use a random root panel from a store loop.
 */
export function getOwningProtectionForCircuit(
  result: { circuit: Circuit; parent: Panel | ProtectionDevice },
  circuitId: string
): ProtectionDevice | undefined {
  const { parent } = result
  if ('symbol' in parent && (parent as Panel).symbol === 'panel_distribution') {
    return (parent as Panel).protections.find((p) =>
      (p.circuits ?? []).some((c) => c.id === circuitId)
    )
  }
  return parent as ProtectionDevice
}

/** Set true temporarily to trace protection/circuit auto-naming in the browser console. */
export const EENDRAAD_NAMING_DEBUG = import.meta.env.DEV

export function ensureRcboSensitivityOnProtection(device: ProtectionDevice): void {
  if (device.type === 'RCBO' && device.sensitivityMa == null) {
    device.sensitivityMa = DEFAULT_RCBO_SENSITIVITY_MA
  }
}

export function ensureRcboSensitivityOnTrunkDevice(device: TrunkDevice): void {
  if (device.protectionType === 'RCBO' && device.sensitivityMa == null) {
    device.sensitivityMa = DEFAULT_RCBO_SENSITIVITY_MA
  }
}

export function findEndpointById(
  panel: Panel,
  id: string
): { endpoint: Endpoint; circuit: Circuit } | undefined {
  // Check all circuits in panel
  for (const circuit of panel.circuits) {
    const endpoint = circuit.endpoints.find((e) => e.id === id)
    if (endpoint) return { endpoint, circuit }
  }

  // Check circuits under protections
  for (const protection of panel.protections) {
    if (protection.circuits) {
      for (const circuit of protection.circuits) {
        const endpoint = circuit.endpoints.find((e) => e.id === id)
        if (endpoint) return { endpoint, circuit }
      }
    }
  }

  // Check sub-panels
  for (const subPanel of panel.subPanels) {
    const found = findEndpointById(subPanel, id)
    if (found) return found
  }
  return undefined
}

/** Find the panel that contains the given circuit (searches recursively including subPanels). */
export function findPanelContainingCircuit(panel: Panel, circuitId: string): Panel | undefined {
  const isOwnedDirectly =
    panel.circuits.some((circuit) => circuit.id === circuitId) ||
    panel.protections.some((protection) =>
      (protection.circuits ?? []).some((circuit) => circuit.id === circuitId)
    )
  if (isOwnedDirectly) return panel
  for (const subPanel of panel.subPanels) {
    const found = findPanelContainingCircuit(subPanel, circuitId)
    if (found) return found
  }
  return undefined
}

/** Path from root to the panel (root first, target panel last). Returns null if panel not found. */
export function getPanelPathFromRoot(
  panels: Panel[],
  targetPanelId: string,
  path: Panel[] = []
): Panel[] | null {
  for (const panel of panels) {
    const currentPath = [...path, panel]
    if (panel.id === targetPanelId) return currentPath
    const found = getPanelPathFromRoot(panel.subPanels, targetPanelId, currentPath)
    if (found) return found
  }
  return null
}

export function getAllCircuits(panel: Panel): Circuit[] {
  const circuits: Circuit[] = [...panel.circuits]
  for (const protection of panel.protections) {
    if (protection.circuits) {
      circuits.push(...protection.circuits)
    }
  }
  for (const subPanel of panel.subPanels) {
    circuits.push(...getAllCircuits(subPanel))
  }
  return circuits
}

export function getAllEndpoints(panel: Panel): Endpoint[] {
  const endpoints: Endpoint[] = []
  const circuits = getAllCircuits(panel)
  for (const circuit of circuits) {
    endpoints.push(...circuit.endpoints)
  }
  return endpoints
}

/**
 * Remove canonical endpoint records that no longer have a compatibility endpoint owner.
 * Electrical editing mutates the panel tree, so deleted endpoints must also disappear from
 * materialized V2 records or the structure graph reports them as unsupported orphans.
 */
export function pruneStaleElectricalEndpointRecords(
  project: ElectricalDomainProject & {
    elements?: ElementModelV2[]
    relationships?: RelationshipModelV2[]
  }
): boolean {
  const electrical = project.disciplines?.electrical
  if (!electrical) return false

  const liveEndpointIds = new Set(
    getProjectElectricalPanels(project).flatMap((panel) =>
      getAllEndpoints(panel).map(({ id }) => id)
    )
  )
  const isPanelDevice = (device: { legacyEndpointId: string }) =>
    device.legacyEndpointId.startsWith('panel_')
  const staleDevices = electrical.devices.filter(
    (device) => !liveEndpointIds.has(device.legacyEndpointId) && !isPanelDevice(device)
  )
  const staleElementIds = new Set(staleDevices.flatMap((device) => device.elementIds))

  const endpointIdFromElement = (element: ElementModelV2): string | undefined => {
    const propertyEndpointId = element.properties?.endpointId
    if (typeof propertyEndpointId === 'string') return propertyEndpointId
    return element.sourceRefs?.find((ref) => ref.path?.includes('endpoints'))?.id
  }

  for (const element of project.elements ?? []) {
    const endpointId = endpointIdFromElement(element)
    if (endpointId && !liveEndpointIds.has(endpointId)) staleElementIds.add(element.id)
  }

  let changed = staleDevices.length > 0
  if (changed) {
    electrical.devices = electrical.devices.filter(
      (device) => liveEndpointIds.has(device.legacyEndpointId) || isPanelDevice(device)
    )
  }

  if (staleElementIds.size > 0 && project.elements) {
    const nextElements = project.elements.filter((element) => !staleElementIds.has(element.id))
    changed ||= nextElements.length !== project.elements.length
    project.elements = nextElements
  }

  if (staleElementIds.size > 0 && project.relationships) {
    const nextRelationships = project.relationships.filter(
      (relationship) =>
        !staleElementIds.has(relationship.fromElementId) &&
        !staleElementIds.has(relationship.toElementId)
    )
    changed ||= nextRelationships.length !== project.relationships.length
    project.relationships = nextRelationships
  }

  return changed
}

export function getAllProtections(panel: Panel): ProtectionDevice[] {
  const protections: ProtectionDevice[] = [...panel.protections]
  for (const subPanel of panel.subPanels) {
    protections.push(...getAllProtections(subPanel))
  }
  return protections
}

/** Endpoints that users may explicitly include in the panel view. */
export function endpointCanAppearInPanelGrid(endpoint: Endpoint): boolean {
  return symbolCanAppearInPanelGrid(endpoint.symbol) || isModularSocket(endpoint)
}

function findEndpointForPanelModuleRef(
  panels: Panel[],
  ref: PanelGridModuleRef
): Endpoint | undefined {
  if (ref.kind !== 'domotica') return undefined
  for (const panel of panels) {
    const found = findEndpointById(panel, ref.endpointId)
    if (found) return found.endpoint
  }
  return undefined
}

/** Modular sockets stay in the panel view; hide/show cannot remove them. */
export function panelGridModuleIsAlwaysVisibleInPanel(
  ref: PanelGridModuleRef,
  panels: Panel[]
): boolean {
  return isModularSocket(findEndpointForPanelModuleRef(panels, ref))
}

/** One-wire trunk devices that have a physical representation in the panel view. */
export function trunkDeviceCanAppearInPanelGrid(device: TrunkDevice): boolean {
  return (
    device.type === 'relay' || device.symbol === 'relay' ||
    device.type === 'protection' ||
    device.type === 'energy_meter' ||
    device.type === 'conversion' ||
    device.type === 'changeover' ||
    device.type === 'dc_bus' ||
    device.type === 'domotica' ||
    device.type === 'terminal_strip'
  )
}

/** Structural direct-panel feeder carriers are topology-only, never physical DIN modules. */
export function protectionCanAppearInPanelGrid(protection: ProtectionDevice): boolean {
  return protection.directPanelFeeder !== true && protection.directDcBusFeeder !== true
}

/** Build the ordered list of all modules that are eligible for the panel grid. */
export function getDefaultPanelGridModuleRefs(
  panel: Panel,
  installation: Installation | undefined,
  allPanels: Panel[]
): PanelGridModuleRef[] {
  const refs: PanelGridModuleRef[] = []
  if (panel.isMain && installation) {
    const supplyDevices = getPanelSupplyTrunkDevices(installation, allPanels, panel)
    for (const d of supplyDevices) {
      if (!trunkDeviceCanAppearInPanelGrid(d)) continue
      refs.push({ kind: 'trunkDevice', id: d.id, scope: 'supply' })
    }
  }
  const groundDevices =
    panel.isMain === false ? panel.groundTrunkDevices : installation?.groundTrunkDevices
  if (groundDevices) {
    for (const d of groundDevices) {
      if (!trunkDeviceCanAppearInPanelGrid(d)) continue
      refs.push({ kind: 'trunkDevice', id: d.id, scope: 'ground' })
    }
  }
  for (const protection of panel.protections) {
    if (!protectionCanAppearInPanelGrid(protection)) continue
    refs.push({ kind: 'protection', id: protection.id })
    if (protection.circuits) {
      for (const circuit of protection.circuits) {
        for (const d of circuit.trunkDevices ?? []) {
          if (!trunkDeviceCanAppearInPanelGrid(d)) continue
          refs.push({ kind: 'trunkDevice', id: d.id, scope: 'circuit', circuitId: circuit.id })
        }
        for (const ep of circuit.endpoints) {
          if (endpointCanAppearInPanelGrid(ep)) {
            refs.push({ kind: 'domotica', endpointId: ep.id, circuitId: circuit.id })
          }
        }
      }
    }
  }
  for (const circuit of panel.circuits) {
    for (const d of circuit.trunkDevices ?? []) {
      if (!trunkDeviceCanAppearInPanelGrid(d)) continue
      refs.push({ kind: 'trunkDevice', id: d.id, scope: 'circuit', circuitId: circuit.id })
    }
    for (const ep of circuit.endpoints) {
      if (endpointCanAppearInPanelGrid(ep)) {
        refs.push({ kind: 'domotica', endpointId: ep.id, circuitId: circuit.id })
      }
    }
  }

  // A terminal strip can be physically mounted on another panel without moving its
  // circuit occurrence. Keep the circuit ref so one-wire ownership and relation edges
  // remain intact, but project the physical module onto its assigned panel.
  const existingKeys = new Set(refs.map((ref) => panelGridModuleRefKey(ref)))
  for (const candidatePanel of allPanels) {
    for (const candidateCircuit of getAllCircuits(candidatePanel)) {
      for (const device of candidateCircuit.trunkDevices ?? []) {
        if (!isTerminalStripDevice(device) || device.terminalStripPanelId !== panel.id) {
          continue
        }
        const ref: PanelGridModuleRef = {
          kind: 'trunkDevice',
          id: device.id,
          scope: 'circuit',
          circuitId: candidateCircuit.id,
        }
        const key = panelGridModuleRefKey(ref)
        if (!existingKeys.has(key)) {
          refs.push(ref)
          existingKeys.add(key)
        }
      }
    }
  }
  return refs.filter((ref) => {
    if (ref.kind !== 'trunkDevice' || ref.scope !== 'circuit') return true
    const device = allPanels
      .flatMap((candidatePanel) => getAllCircuits(candidatePanel))
      .flatMap((candidateCircuit) => candidateCircuit.trunkDevices ?? [])
      .find((candidate) => candidate.id === ref.id)
    if (device?.panelMounting?.kind === 'auxiliary') return false
    const assignedPanelId = getTerminalStripPanelId(device)
    return assignedPanelId == null || assignedPanelId === panel.id
  })
}

export function isTerminalStripDevice(
  device: TrunkDevice | null | undefined
): device is TrunkDevice {
  return device != null && (device.type === 'terminal_strip' || device.symbol === 'terminal_strip')
}

export function getTerminalStripPanelId(
  device: TrunkDevice | null | undefined
): string | undefined {
  return isTerminalStripDevice(device) ? device?.terminalStripPanelId : undefined
}

/**
 * Set the physical panel-canvas owner for a circuit terminal strip. Equal
 * `junctionIdentity` values represent one physical strip, so all occurrences
 * move together while their circuit ownership remains unchanged.
 */
export function setTerminalStripPanelId(
  project: ElectricalDomainProject,
  deviceId: string,
  panelId: string | undefined,
  enclosureId?: string
): boolean {
  const panels = getProjectElectricalPanels(project)
  let target: TrunkDevice | undefined
  let targetIdentity: string | undefined
  const devices: TrunkDevice[] = []
  const seenCircuitIds = new Set<string>()

  for (const rootPanel of panels) {
    for (const circuit of getAllCircuits(rootPanel)) {
      if (seenCircuitIds.has(circuit.id)) continue
      seenCircuitIds.add(circuit.id)
      for (const device of circuit.trunkDevices ?? []) {
        if (!isTerminalStripDevice(device)) continue
        devices.push(device)
        if (device.id === deviceId) {
          target = device
          targetIdentity = getTerminalStripIdentity(device)
        }
      }
    }
  }

  if (!target) return false
  const changed = devices.reduce((didChange, device) => {
    if (
      device !== target &&
      targetIdentity &&
      getTerminalStripIdentity(device) !== targetIdentity
    ) {
      return didChange
    }
    if (enclosureId) {
      delete device.terminalStripPanelId
      device.panelMounting = { kind: 'auxiliary', enclosureId }
      return true
    }
    const removedMounting = device.panelMounting != null
    delete device.panelMounting
    if (device.terminalStripPanelId === panelId) return didChange || removedMounting
    if (panelId) device.terminalStripPanelId = panelId
    else delete device.terminalStripPanelId
    return true
  }, false)
  return changed
}

function getTerminalStripIdentity(device: TrunkDevice): string {
  return (getTerminalStripId(device) || device.id).trim().toUpperCase()
}

/** Protections are visible by default; every other eligible device is opt-in. */
export function panelGridModuleIsVisibleByDefault(
  ref: PanelGridModuleRef,
  panel: Panel,
  installation: Installation | undefined,
  allPanels: Panel[]
): boolean {
  if (ref.kind === 'protection') {
    for (const candidatePanel of allPanels) {
      const protection = findProtectionById(candidatePanel, ref.id)
      if (protection) {
        return protectionCanAppearInPanelGrid(protection)
      }
    }
    return false
  }
  if (ref.kind === 'domotica') {
    return isModularSocket(findEndpointForPanelModuleRef(allPanels, ref))
  }

  let device: TrunkDevice | undefined
  if (ref.scope === 'supply' && installation) {
    device = getPanelSupplyTrunkDevices(installation, allPanels, panel).find((d) => d.id === ref.id)
  } else if (ref.scope === 'ground') {
    device =
      panel.groundTrunkDevices?.find((d) => d.id === ref.id) ??
      installation?.groundTrunkDevices?.find((d) => d.id === ref.id)
  } else if (ref.scope === 'circuit') {
    const localCircuit = getAllCircuits(panel).find((candidate) => candidate.id === ref.circuitId)
    device = localCircuit?.trunkDevices?.find((d) => d.id === ref.id)
    if (!device) {
      for (const candidatePanel of allPanels) {
        const circuit = getAllCircuits(candidatePanel).find(
          (candidate) => candidate.id === ref.circuitId
        )
        device = circuit?.trunkDevices?.find((d) => d.id === ref.id)
        if (device) break
      }
    }
  }
  // Direct supply converters are physical panel modules when created on the
  // converter branch. Other supply inverters remain opt-in.
  if (device?.symbol === 'inverter' && device.supplyPath !== 'converter-branch') return false
  if (
    device?.type === 'protection' &&
    device.protectionType === 'FUSE' &&
    (device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top')
  ) {
    return false
  }
  if (device?.type === 'protection') return true
  if (device?.type === 'changeover' || device?.symbol === 'source_changeover') return true
  if (device?.type === 'terminal_strip' || device?.symbol === 'terminal_strip') return true
  return (
    ref.scope === 'supply' &&
    (device?.supplyPath === 'backup' || device?.supplyPath === 'converter-branch')
  )
}
export function panelGridModuleRefKey(ref: PanelGridModuleRef): string {
  if (ref.kind === 'protection') return `protection:${ref.id}`
  if (ref.kind === 'trunkDevice') return `trunkDevice:${ref.id}:${ref.scope}${ref.circuitId ?? ''}`
  return `domotica:${ref.endpointId}:${ref.circuitId}`
}

/** Preserve panel-grid placement and visibility when a circuit trunk device changes circuit. */
export function rewriteRelocatedCircuitTrunkDeviceGridRef(
  project: ElectricalDomainProject,
  deviceId: string,
  sourceCircuitId: string,
  targetCircuitId: string
): void {
  if (sourceCircuitId === targetCircuitId) return

  const panels = getProjectElectricalPanels(project)
  const sourcePanel = panels
    .map((panel) => findPanelContainingCircuit(panel, sourceCircuitId))
    .find((panel): panel is Panel => panel != null)
  const targetPanel = panels
    .map((panel) => findPanelContainingCircuit(panel, targetCircuitId))
    .find((panel): panel is Panel => panel != null)
  if (!sourcePanel?.gridView || !targetPanel) return

  const oldRef: PanelGridModuleRef = {
    kind: 'trunkDevice',
    id: deviceId,
    scope: 'circuit',
    circuitId: sourceCircuitId,
  }
  const newRef: PanelGridModuleRef = { ...oldRef, circuitId: targetCircuitId }
  const oldKey = panelGridModuleRefKey(oldRef)
  const newKey = panelGridModuleRefKey(newRef)
  const wasShown = sourcePanel.gridView.shownModuleKeys?.includes(oldKey) ?? false
  const wasHidden = sourcePanel.gridView.hiddenModuleKeys?.includes(oldKey) ?? false

  const rewriteKeys = (keys: string[] | undefined): string[] | undefined => {
    if (!keys) return undefined
    const next = [...new Set(keys.map((key) => (key === oldKey ? newKey : key)))]
    return next.length > 0 ? next : undefined
  }
  if (sourcePanel === targetPanel) {
    const rewriteSlots = (slots: PanelGridSlot[] | undefined): PanelGridSlot[] =>
      (slots ?? []).map((slot) =>
        panelGridModuleRefKey(slot.module) === oldKey ? { ...slot, module: newRef } : slot
      )
    sourcePanel.gridView.slots = rewriteSlots(sourcePanel.gridView.slots)
    sourcePanel.gridView.supplyPanelSlots = rewriteSlots(sourcePanel.gridView.supplyPanelSlots)
    sourcePanel.gridView.shownModuleKeys = rewriteKeys(sourcePanel.gridView.shownModuleKeys)
    sourcePanel.gridView.hiddenModuleKeys = rewriteKeys(sourcePanel.gridView.hiddenModuleKeys)
    return
  }

  const removeOldKey = (keys: string[] | undefined): string[] | undefined => {
    const next = keys?.filter((key) => key !== oldKey)
    return next && next.length > 0 ? next : undefined
  }
  const removeOldSlots = (slots: PanelGridSlot[] | undefined): PanelGridSlot[] =>
    (slots ?? []).filter((slot) => panelGridModuleRefKey(slot.module) !== oldKey)
  sourcePanel.gridView.slots = removeOldSlots(sourcePanel.gridView.slots)
  sourcePanel.gridView.supplyPanelSlots = removeOldSlots(sourcePanel.gridView.supplyPanelSlots)
  sourcePanel.gridView.shownModuleKeys = removeOldKey(sourcePanel.gridView.shownModuleKeys)
  sourcePanel.gridView.hiddenModuleKeys = removeOldKey(sourcePanel.gridView.hiddenModuleKeys)

  if (!wasShown && !wasHidden) return
  targetPanel.gridView ??= {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  const targetKeys = wasShown
    ? (targetPanel.gridView.shownModuleKeys ?? [])
    : (targetPanel.gridView.hiddenModuleKeys ?? [])
  if (!targetKeys.includes(newKey)) targetKeys.push(newKey)
  if (wasShown) targetPanel.gridView.shownModuleKeys = targetKeys
  else targetPanel.gridView.hiddenModuleKeys = targetKeys
}

/** Check if a module ref references an existing device/endpoint/protection in the project */
export function isModuleRefValid(
  ref: PanelGridModuleRef,
  project: ElectricalDomainProject
): boolean {
  const panels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  if (ref.kind === 'protection') {
    for (const panel of panels) {
      const protection = findProtectionById(panel, ref.id)
      if (protection) return protectionCanAppearInPanelGrid(protection)
    }
    return false
  }
  if (ref.kind === 'trunkDevice') {
    if (ref.scope === 'supply') {
      if (!installation) return false
      return (
        installation.mainSupply.supplyTrunkDevices?.some((d) => d.id === ref.id) ||
        installation.feedTopology?.sharedFeed.trunkDevices?.some((d) => d.id === ref.id) ||
        installation.feedTopology?.rootFeeds.some((feed) =>
          (feed.trunkDevices ?? []).some((device) => device.id === ref.id)
        ) ||
        false
      )
    }
    if (ref.scope === 'ground') {
      return !!findGroundTrunkDeviceOwner(panels, installation, ref.id)
    }
    if (ref.scope === 'circuit' && ref.circuitId) {
      for (const panel of panels) {
        const result = findCircuitById(panel, ref.circuitId)
        if (result && result.circuit.trunkDevices?.find((d) => d.id === ref.id)) {
          return true
        }
      }
    }
    return false
  }
  if (ref.kind === 'domotica') {
    for (const panel of panels) {
      const found = findEndpointById(panel, ref.endpointId)
      if (found && endpointCanAppearInPanelGrid(found.endpoint)) return true
    }
    return false
  }
  return false
}

/** Remove panel grid slots and hidden keys that reference a deleted device */
export function cleanupPanelGridSlotsForDevice(
  panels: Panel[],
  deviceRef: PanelGridModuleRef
): void {
  try {
    const deviceKey = panelGridModuleRefKey(deviceRef)
    for (const panel of panels) {
      if (panel.gridView) {
        // Clean up main panel slots
        if (panel.gridView.slots) {
          panel.gridView.slots = panel.gridView.slots.filter((slot) => {
            try {
              return panelGridModuleRefKey(slot.module) !== deviceKey
            } catch {
              return true // Keep slot if we can't determine its key
            }
          })
        }
        // Clean up supply panel slots
        if (panel.gridView.supplyPanelSlots) {
          panel.gridView.supplyPanelSlots = panel.gridView.supplyPanelSlots.filter((slot) => {
            try {
              return panelGridModuleRefKey(slot.module) !== deviceKey
            } catch {
              return true // Keep slot if we can't determine its key
            }
          })
        }
        // Clean up hidden module keys
        if (panel.gridView.hiddenModuleKeys) {
          panel.gridView.hiddenModuleKeys = panel.gridView.hiddenModuleKeys.filter(
            (key) => key !== deviceKey
          )
          if (panel.gridView.hiddenModuleKeys.length === 0) {
            panel.gridView.hiddenModuleKeys = undefined
          }
        }
        if (panel.gridView.shownModuleKeys) {
          panel.gridView.shownModuleKeys = panel.gridView.shownModuleKeys.filter(
            (key) => key !== deviceKey
          )
          if (panel.gridView.shownModuleKeys.length === 0) {
            panel.gridView.shownModuleKeys = undefined
          }
        }
      }
      // Recursively clean up sub-panels
      cleanupPanelGridSlotsForDevice(panel.subPanels, deviceRef)
    }
  } catch (error) {
    // Silently fail cleanup - don't break deletion
    logger.warn('[cleanupPanelGridSlotsForDevice] Error during cleanup:', error)
  }
}

export const DOMOTICA_MIN_OUTPUTS = 1
export const DOMOTICA_MAX_OUTPUTS = 20
export const DOMOTICA_DEFAULT_SWITCH_TYPE = '1p' as const

export function normalizeDomoticaCount(value: number | undefined, fallback: number): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value as number) : fallback
  return clamp(normalized, DOMOTICA_MIN_OUTPUTS, DOMOTICA_MAX_OUTPUTS)
}

export function isDomoticaParentEndpoint(endpoint: Endpoint): boolean {
  return endpoint.symbol === 'domotica'
}

export function removeEndpointIdsFromCircuit(circuit: Circuit, ids: Set<string>): void {
  circuit.endpoints = circuit.endpoints.filter((endpoint) => !ids.has(endpoint.id))
  if (circuit.branches) {
    circuit.branches = circuit.branches
      .map((branch) => ({
        ...branch,
        endpointIds: branch.endpointIds.filter((endpointId) => !ids.has(endpointId)),
      }))
      .filter((branch) => branch.endpointIds.length > 0 || (branch.branchDevices?.length ?? 0) > 0)
  }
}

export function normalizeDomoticaCircuit(circuit: Circuit): void {
  const byId = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const parentIds = new Set<string>()

  // Repair: any endpoint that has domotica children (parentEndpointId pointing to it) must be
  // treated as a domotica parent. Ensure symbol and type so normalization assigns domoticaProps.
  for (const endpoint of circuit.endpoints) {
    const hasChildPointingHere = circuit.endpoints.some(
      (e) => e.domoticaChildProps?.parentEndpointId === endpoint.id
    )
    if (hasChildPointingHere && (endpoint.symbol !== 'domotica' || endpoint.type !== 'domotica')) {
      endpoint.symbol = 'domotica'
      endpoint.type = 'domotica'
    }
  }

  for (const endpoint of circuit.endpoints) {
    if (!isDomoticaParentEndpoint(endpoint)) continue
    parentIds.add(endpoint.id)

    const props = endpoint.domoticaProps ?? {}
    const legacySwitchType =
      props.baseSymbol === 'switch_2p_twoway'
        ? '2p'
        : props.baseSymbol === 'switch_impulse'
          ? 'impulse'
          : DOMOTICA_DEFAULT_SWITCH_TYPE
    const switchType = props.switchType ?? legacySwitchType

    // Preserve parent list slots exactly. Empty strings are intentional placeholders
    // for unoccupied outputs; removing them collapses output 10 back to output 1.
    // Reordering happens only via moveDomoticaChildOutput (e.g. canvas drag-and-drop), not here.
    const normalizeChildSlots = (ids: string[] | undefined): string[] =>
      (ids ?? []).map((id) => (id && byId.has(id) ? id : ''))

    let endpointChildIds = normalizeChildSlots(props.endpointChildEndpointIds)
    let controlChildIds = normalizeChildSlots(props.controlChildEndpointIds)
    // Control outputs were removed before release; merge old control-linked children
    // into endpoint outputs so existing draft data stays visible/editable.
    endpointChildIds = [...endpointChildIds, ...controlChildIds.filter(Boolean)]
    controlChildIds = []

    const endpointSet = new Set(endpointChildIds.filter(Boolean))
    for (const child of circuit.endpoints) {
      const childRef = child.domoticaChildProps
      if (!childRef || childRef.parentEndpointId !== endpoint.id) continue
      if (childRef.outputGroup === 'endpoint' && !endpointSet.has(child.id)) {
        const index = Number.isFinite(childRef.outputIndex) ? Math.trunc(childRef.outputIndex) : -1
        if (index >= 0 && !endpointChildIds[index]) {
          while (endpointChildIds.length <= index) endpointChildIds.push('')
          endpointChildIds[index] = child.id
          endpointSet.add(child.id)
        } else if (index < 0) {
          endpointChildIds.push(child.id)
          endpointSet.add(child.id)
        }
      }
      if (childRef.outputGroup === 'control' && !endpointSet.has(child.id)) {
        endpointChildIds.push(child.id)
        endpointSet.add(child.id)
      }
    }
    // Dedupe preserving slot count; duplicate non-empty ids become empty slots.
    const dedupeChildSlots = (arr: string[]): string[] => {
      const seen = new Set<string>()
      return arr.map((id) => {
        if (!id) return ''
        if (seen.has(id)) return ''
        seen.add(id)
        return id
      })
    }
    endpointChildIds = dedupeChildSlots(endpointChildIds)
    controlChildIds = dedupeChildSlots(controlChildIds)

    const endpointCount = normalizeDomoticaCount(
      props.endpointCount,
      Math.max(endpointChildIds.length, DOMOTICA_MIN_OUTPUTS)
    )
    if (endpointChildIds.length > endpointCount)
      endpointChildIds = endpointChildIds.slice(0, endpointCount)
    controlChildIds = []

    // Initialize or resize per-output wire overrides so domotica outputs have
    // their own independent wire properties that no longer follow later trunk edits.
    const baseCable = circuit.cable
    const baseRoute = circuit.wireRoute ?? (circuit.inWall ? 'wall' : undefined)
    const baseInWall = circuit.inWall ?? false
    const baseHide = circuit.hideWireLabel

    let endpointOutputWires = [...(props.endpointOutputWires ?? [])]
    let controlOutputWires = [...(props.controlOutputWires ?? [])]

    const ensureWireArray = (
      arr: DomoticaOutputWireProps[],
      desiredCount: number
    ): DomoticaOutputWireProps[] => {
      const next = [...arr]
      while (next.length < desiredCount) {
        next.push({
          cable: { ...baseCable },
          inTube: circuit.inTube,
          wireRoute: baseRoute,
          inWall: baseInWall,
          hideWireLabel: baseHide,
        })
      }
      return next.slice(0, desiredCount)
    }

    endpointOutputWires = ensureWireArray(endpointOutputWires, endpointCount)
    controlOutputWires = []

    endpoint.domoticaProps = {
      ...props,
      switchType,
      endpointCount,
      endpointChildEndpointIds: endpointChildIds,
      controlChildEndpointIds: controlChildIds,
      endpointOutputWires,
      controlOutputWires,
    }

    // Ensure reverse links on children match parent lists.
    endpointChildIds.forEach((childId, index) => {
      const child = circuit.endpoints.find((candidate) => candidate.id === childId)
      if (!child) return
      child.domoticaChildProps = {
        parentEndpointId: endpoint.id,
        outputGroup: 'endpoint',
        outputIndex: index,
      }
    })
    // Ensure no child keeps legacy control-group linkage.
    for (const child of circuit.endpoints) {
      if (child.domoticaChildProps?.parentEndpointId !== endpoint.id) continue
      if (child.domoticaChildProps.outputGroup === 'control') {
        child.domoticaChildProps = {
          ...child.domoticaChildProps,
          outputGroup: 'endpoint',
        }
      }
    }
  }

  circuit.endpoints = relabelDomoticaChildRows(circuit)

  // Remove orphaned child refs when parent no longer exists in this circuit.
  for (const endpoint of circuit.endpoints) {
    const child = endpoint.domoticaChildProps
    if (!child) continue
    if (!parentIds.has(child.parentEndpointId)) {
      delete endpoint.domoticaChildProps
    }
  }
}

export function normalizeDomoticaProject(project: ElectricalDomainProject): void {
  for (const panel of getProjectElectricalPanels(project)) {
    const circuits = getAllCircuits(panel)
    for (const circuit of circuits) {
      normalizeDomoticaCircuit(circuit)
      syncDerivedEndpointFlags(circuit)
      // Domotica is excluded from sitplan; clear stale placements on load/migration.
      for (const endpoint of circuit.endpoints) {
        if (endpoint.symbol === 'domotica' && endpoint.placements.length > 0) {
          endpoint.placements = []
        }
      }
    }
  }
}

export function normalizeFloorPlanAssets(project: ElectricalDomainProject): void {
  selectProjectBuildingFloors(project).forEach((floor) => {
    if ('planAsset' in floor && !floor.planImportAsset && floor.planAsset) {
      const importedAsset: ImportedPlanAsset = {
        id: floor.id,
        kind: 'raster',
        width: 1,
        height: 1,
        dataUrl: floor.planAsset,
        processedDataUrl: floor.planAssetProcessed,
        hasWhiteBackground: floor.planAssetHasWhiteBackground,
      }
      floor.planImportAsset = importedAsset
    }
  })
}

export function getDomoticaChildEndpointIds(endpoint: Endpoint): string[] {
  const props = endpoint.domoticaProps
  if (!props) return []
  return [...(props.endpointChildEndpointIds ?? [])]
}

/** Expand endpoint deletion roots through the complete domotica output tree. */
export function collectDomoticaEndpointIdsForDeletion(
  circuit: Circuit,
  rootEndpointIds: Iterable<string>
): Set<string> {
  const byId = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const ids = new Set(rootEndpointIds)
  const queue = [...ids]

  while (queue.length > 0) {
    const parentId = queue.shift()!
    const parent = byId.get(parentId)
    const childIds = new Set(parent ? getDomoticaChildEndpointIds(parent) : [])
    for (const endpoint of circuit.endpoints) {
      if (endpoint.domoticaChildProps?.parentEndpointId === parentId) childIds.add(endpoint.id)
    }
    for (const childId of childIds) {
      if (!childId || !byId.has(childId) || ids.has(childId)) continue
      ids.add(childId)
      queue.push(childId)
    }
  }

  return ids
}

/**
 * Move a subcircuit's content (endpoints, branches, trunkDevices, sub-subcircuit refs)
 * back into its parent circuit, then remove the subcircuit reference.
 *
 * A{B{content}} → delete B → A{content}
 *
 * Must be called inside an immer mutation callback so all changes are tracked.
 */
export function migrateCircuitContentToParent(circuit: Circuit, parentCircuit: Circuit): void {
  // Move endpoints back to parent
  if (circuit.endpoints.length > 0) {
    parentCircuit.endpoints.push(...circuit.endpoints)
  }

  // Move branches back to parent
  if (circuit.branches && circuit.branches.length > 0) {
    if (!parentCircuit.branches) parentCircuit.branches = []
    parentCircuit.branches.push(...circuit.branches)
  }

  // Move trunk devices back to parent
  if (circuit.trunkDevices && circuit.trunkDevices.length > 0) {
    if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
    parentCircuit.trunkDevices.push(...circuit.trunkDevices)
  }

  // Move sub-subcircuit references back to parent
  if (circuit.subCircuitIds && circuit.subCircuitIds.length > 0) {
    if (!parentCircuit.subCircuitIds) parentCircuit.subCircuitIds = []
    parentCircuit.subCircuitIds.push(...circuit.subCircuitIds)
  }

  // Remove this circuit from parent's subCircuitIds list
  if (parentCircuit.subCircuitIds) {
    const idx = parentCircuit.subCircuitIds.indexOf(circuit.id)
    if (idx !== -1) parentCircuit.subCircuitIds.splice(idx, 1)
  }
}

/**
 * Remove a circuit from its parent's chain while promoting its direct children
 * into the same position. Circuit content stays with the removed circuit and
 * is therefore deleted with its protection.
 *
 * A{B{C}} → delete B → A{C}
 *
 * Must be called inside an immer mutation callback so all changes are tracked.
 */
export function promoteCircuitSubcircuitsToParent(circuit: Circuit, parentCircuit: Circuit): void {
  const parentSubCircuitIds = parentCircuit.subCircuitIds
  if (!parentSubCircuitIds) return

  const index = parentSubCircuitIds.indexOf(circuit.id)
  if (index === -1) return

  const promotedIds = (circuit.subCircuitIds ?? []).filter(
    (subCircuitId) => subCircuitId && subCircuitId !== circuit.id
  )
  const nextIds: string[] = []
  for (const subCircuitId of [
    ...parentSubCircuitIds.slice(0, index),
    ...promotedIds,
    ...parentSubCircuitIds.slice(index + 1),
  ]) {
    if (!subCircuitId || subCircuitId === circuit.id || nextIds.includes(subCircuitId)) continue
    nextIds.push(subCircuitId)
  }
  parentCircuit.subCircuitIds = nextIds
}

/**
 * When deleting a protection whose circuit is a subcircuit of another circuit,
 * move the subcircuit's content back into the parent circuit so nothing is lost.
 * Also transfers subPanelId back to the parent protection if applicable.
 *
 * Must be called BEFORE the protection is actually removed from the panel,
 * inside an immer mutation callback so all changes are tracked.
 */
export function migrateSubCircuitContentToParent(
  protection: ProtectionDevice,
  panels: Panel[]
): void {
  if (!protection.circuits) return

  for (const circuit of protection.circuits) {
    const parentInfo = findParentCircuitInfo(circuit.id, panels)
    if (!parentInfo) continue // not a subcircuit — nothing to migrate

    if (protection.subPanelId && parentInfo.parentProtection) {
      parentInfo.parentProtection.subPanelId = protection.subPanelId
      const targetPanel = findPanelById(panels, protection.subPanelId)
      const ownPanelEndpoint = targetPanel
        ? findPanelOwnDistributionEndpoint(targetPanel)
        : undefined
      if (
        ownPanelEndpoint &&
        !circuit.endpoints.some((endpoint) => endpoint.symbol === 'panel_distribution')
      ) {
        circuit.endpoints.push({
          ...ownPanelEndpoint,
          id: generateId(),
          placements: [],
        })
      }
      parentInfo.parentProtection.circuits ??= []
      if (!parentInfo.parentProtection.circuits.some((candidate) => candidate.id === circuit.id)) {
        parentInfo.parentProtection.circuits.push(circuit)
      }
      continue
    }

    migrateCircuitContentToParent(circuit, parentInfo.parentCircuit)
  }
}

export { supplyFeedListForPanelAndScope as getSupplyFeedListForTarget }
