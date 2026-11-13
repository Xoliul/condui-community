import type { ProjectV2 } from '@/types/projectV2'
import type { CommandCheck } from '@/lib/commands/project/types'
import type { Installation, RootPanelFeedPath } from '@/types/schema'
import { applyNominalVoltageSystem, type SupplyVoltageSystem } from '@/constants/nominalVoltage'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { findPanelById } from '@/lib/panel/panelTree'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { reconcileSupplyAssemblyAcConductorFlow } from '@/lib/supplyAssembly/supplyAssemblyAcConductorFlow'
import { getDirectTransformerBoards, installationSupportsFeedVoltages, isDirectTransformerBoard } from './feedNominalVoltage'
import { syncSupplyTransformerOutput } from './supplyTransformer'

type NominalVoltage = Installation['nominalVoltage']

/** Only a main board directly behind the site transformer chooses its output; others inherit. */
export function checkRootFeedNominalVoltage(project: ProjectV2, panelId: string): CommandCheck {
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  if (!installation || !findPanelById(panels, panelId))
    return { ok: false, code: 'stale_target', message: 'Panel no longer exists' }
  if (!installationSupportsFeedVoltages(installation))
    return { ok: false, code: 'supply_transformer_required', message: 'A separate panel voltage requires an own supply transformer' }
  if (!isDirectTransformerBoard(panels, panelId))
    return { ok: false, code: 'inherited_voltage', message: 'This panel takes the voltage of the main panel that feeds it' }
  return { ok: true }
}

/** `null` (or the installation system) returns the board to the project voltage. */
function getBoardFeeds(project: ProjectV2, panelId: string) {
  const installation = getProjectElectricalInstallation(project)!
  const panels = getProjectElectricalPanels(project)
  const panel = findPanelById(panels, panelId)!
  ensureInstallationFeedTopology(installation, panels)
  const primary = getPrimaryPanelBusSectionId(panel)
  const feeds = installation.feedTopology?.rootFeeds.filter((feed) => feed.panelId === panel.id) ?? []
  return { installation, feeds, feed: feeds.find((candidate) => (candidate.busSectionId ?? primary) === primary) }
}

function clearOutput(feed: RootPanelFeedPath): void {
  delete feed.nominalVoltage
  delete feed.transformerOutputRatedKva
  delete feed.transformerOutputUkPercent
  // A phase set chosen for another system has no meaning on the new output.
  delete feed.phaseAssignment
}

const sameVoltage = (a: NominalVoltage | undefined, b: NominalVoltage | undefined) =>
  a?.system === b?.system && a?.uLineToLine === b?.uLineToLine && a?.uLineToNeutral === b?.uLineToNeutral

/**
 * The first board behind the transformer runs on the default output (the project voltage and the
 * transformer's main secondary). Changing it keeps every other board on the output it already had.
 */
function setDefaultTransformerOutput(project: ProjectV2, next: NominalVoltage): boolean {
  const installation = getProjectElectricalInstallation(project)!
  const panels = getProjectElectricalPanels(project)
  const [primary, ...others] = getDirectTransformerBoards(panels)
  const previous = installation.nominalVoltage
  const primaryFeeds = installation.feedTopology?.rootFeeds.filter((feed) => feed.panelId === primary!.id) ?? []
  if (sameVoltage(previous, next) && !primaryFeeds.some((feed) => feed.nominalVoltage)) return false
  for (const board of others) {
    const feeds = installation.feedTopology?.rootFeeds.filter((feed) => feed.panelId === board.id) ?? []
    for (const feed of feeds) {
      if (sameVoltage(feed.nominalVoltage, next)) clearOutput(feed)
      else if (!feed.nominalVoltage && !sameVoltage(previous, next)) feed.nominalVoltage = { ...previous }
    }
  }
  for (const feed of primaryFeeds) {
    if (feed.nominalVoltage || feed.phaseAssignment && previous.system !== next.system) clearOutput(feed)
  }
  installation.nominalVoltage = next
  syncSupplyTransformerOutput(installation)
  reconcileSupplyAssemblyAcConductorFlow(project)
  return true
}

export function setRootFeedNominalVoltageInProject(
  project: ProjectV2,
  panelId: string,
  system: SupplyVoltageSystem | null,
): boolean {
  const { installation, feeds, feed } = getBoardFeeds(project, panelId)
  if (!feed) return false
  if (getDirectTransformerBoards(getProjectElectricalPanels(project))[0]?.id === panelId)
    return system != null && setDefaultTransformerOutput(project, applyNominalVoltageSystem(installation.nominalVoltage, system))
  const next = system == null || system === installation.nominalVoltage.system
    ? undefined
    : applyNominalVoltageSystem(installation.nominalVoltage, system)
  const current = feed.nominalVoltage
  if (current?.system === next?.system && current?.uLineToLine === next?.uLineToLine &&
    current?.uLineToNeutral === next?.uLineToNeutral) return false
  // Every bus section of one board hangs on the same transformer output.
  for (const section of feeds) {
    if (!next) {
      clearOutput(section)
      continue
    }
    section.nominalVoltage = next
    delete section.phaseAssignment
  }
  return true
}

/** A separate output needs its own winding nameplate for the short-circuit calculation. */
export function checkRootFeedTransformerOutput(project: ProjectV2, panelId: string): CommandCheck {
  const check = checkRootFeedNominalVoltage(project, panelId)
  if (!check.ok) return check
  if (!getBoardFeeds(project, panelId).feed?.nominalVoltage)
    return { ok: false, code: 'own_output_required', message: 'This board uses the project voltage and the transformer nameplate' }
  return { ok: true }
}

/** `null` clears a value; an omitted key keeps it. */
export function setRootFeedTransformerOutputInProject(
  project: ProjectV2,
  panelId: string,
  patch: { ratedKva?: number | null; ukPercent?: number | null },
): boolean {
  const { feeds } = getBoardFeeds(project, panelId)
  let changed = false
  for (const section of feeds) {
    for (const [key, value] of [
      ['transformerOutputRatedKva', patch.ratedKva],
      ['transformerOutputUkPercent', patch.ukPercent],
    ] as const) {
      if (value === undefined || section[key] === (value ?? undefined)) continue
      if (value === null) delete section[key]
      else section[key] = value
      changed = true
    }
  }
  return changed
}

/** Leaving the own-transformer connection drops every board-specific output. */
export function clearRootFeedNominalVoltages(project: ProjectV2): boolean {
  let changed = false
  for (const feed of getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []) {
    if (!feed.nominalVoltage) continue
    clearOutput(feed)
    changed = true
  }
  return changed
}
