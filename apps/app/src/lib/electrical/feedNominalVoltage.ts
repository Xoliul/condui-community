import type { Installation, Panel, RootPanelFeedPath, TrunkDevice } from '@/types/schema'
import { collectRootPanels, ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { resolvePanelSupplyLinkForPanelInPanels } from '@/lib/eendraad/panelSupplyLink'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { collectCircuits, findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { getInstallationSupplyTransformer, isSupplyTransformer } from './supplyTransformer'
import { isImmutablePanelReadInput } from '@/lib/panel/panelReadContext'

type NominalVoltage = Installation['nominalVoltage']
const supplyingMainPanelByPanelTree = new WeakMap<Panel[], Map<string, Panel | null>>()

/**
 * A site with its own MV transformer may run main boards at different LV systems
 * (for example 3~ 230 V beside 3N~ 400 V). Only then does a root feed's own voltage apply.
 */
export function installationSupportsFeedVoltages(installation: Installation | undefined): boolean {
  return !!installation && installation.nominalVoltage.system !== 'DC' &&
    !!getInstallationSupplyTransformer(installation)
}

function getPrimaryRootFeed(installation: Installation, panels: Panel[], panel: Panel): RootPanelFeedPath | undefined {
  const primary = getPrimaryPanelBusSectionId(panel)
  return ensureInstallationFeedTopology(installation, panels).rootFeeds.find(
    (feed) => feed.panelId === panel.id && (feed.busSectionId ?? primary) === primary,
  )
}

function findStructuralParent(panels: Panel[], panelId: string): Panel | undefined {
  for (const panel of walkPanels(panels)) {
    if (panel.subPanels?.some((child) => child.id === panelId)) return panel
  }
  return undefined
}

/**
 * A main board directly behind the site transformer: a top-level board on its own root feed,
 * not fed from another board's breaker. Only such a board may run on its own output.
 */
export function isDirectTransformerBoard(panels: Panel[], panelId: string): boolean {
  const panel = collectRootPanels(panels).find((root) => root.id === panelId)
  return !!panel && panel.isMain !== false && !resolvePanelSupplyLinkForPanelInPanels(panels, panelId)
}

/** Main boards directly behind the site transformer, in board order; the first runs on the default output. */
export function getDirectTransformerBoards(panels: Panel[]): Panel[] {
  return collectRootPanels(panels).filter((panel) => isDirectTransformerBoard(panels, panel.id))
}

/** The board directly behind the transformer that feeds this panel, following panel feeders upstream. */
export function findSupplyingMainPanel(panels: Panel[], panelId: string): Panel | undefined {
  // A campus wire derivation resolves the supplying transformer board for each
  // panel. Those answers depend only on the immutable panel tree, but the walk
  // otherwise rescans every feeder circuit for every panel on each render.
  const cacheable = isImmutablePanelReadInput(panels)
  let cachedById = cacheable ? supplyingMainPanelByPanelTree.get(panels) : undefined
  if (cacheable && !cachedById) {
    cachedById = new Map()
    supplyingMainPanelByPanelTree.set(panels, cachedById)
  }
  const cached = cachedById?.get(panelId)
  if (cached !== undefined) return cached ?? undefined

  const visited = new Set<string>()
  let current = findPanelById(panels, panelId)
  while (current && !visited.has(current.id)) {
    if (isDirectTransformerBoard(panels, current.id)) {
      cachedById?.set(panelId, current)
      return current
    }
    visited.add(current.id)
    current = resolvePanelSupplyLinkForPanelInPanels(panels, current.id)?.sourcePanel ??
      findStructuralParent(panels, current.id)
  }
  cachedById?.set(panelId, null)
  return undefined
}

/** Stored override on a main panel's own feed, ignoring whether it is effective. */
export function getRootFeedNominalVoltage(
  installation: Installation,
  panels: Panel[],
  mainPanel: Panel,
): NominalVoltage | undefined {
  return getPrimaryRootFeed(installation, panels, mainPanel)?.nominalVoltage
}

export interface TransformerOutputRating {
  ratedKva?: number
  ukPercent?: number
}

/** Nameplate of the winding behind a main board's own output; the device nameplate covers the rest. */
export function getRootFeedTransformerOutputRating(
  installation: Installation,
  panels: Panel[],
  mainPanel: Panel,
): TransformerOutputRating {
  const feed = getPrimaryRootFeed(installation, panels, mainPanel)
  return {
    ...(feed?.transformerOutputRatedKva != null ? { ratedKva: feed.transformerOutputRatedKva } : {}),
    ...(feed?.transformerOutputUkPercent != null ? { ukPercent: feed.transformerOutputUkPercent } : {}),
  }
}

/** Effective LV system at a panel: its main board's transformer output, else the installation. */
export function resolvePanelNominalVoltage(
  installation: Installation,
  panels: Panel[],
  panelId: string | undefined,
): NominalVoltage {
  if (!panelId || !installationSupportsFeedVoltages(installation)) return installation.nominalVoltage
  const main = findSupplyingMainPanel(panels, panelId)
  return (main && getRootFeedNominalVoltage(installation, panels, main)) ?? installation.nominalVoltage
}

/** Effective LV system for a circuit: the system of the board it is in. */
export function resolveCircuitNominalVoltage(
  installation: Installation,
  panels: Panel[],
  circuitId: string,
): NominalVoltage {
  if (!installationSupportsFeedVoltages(installation)) return installation.nominalVoltage
  for (const panel of walkPanels(panels)) {
    if (collectCircuits(panel).some((circuit) => circuit.id === circuitId))
      return resolvePanelNominalVoltage(installation, panels, panel.id)
  }
  return installation.nominalVoltage
}

const panelInstallationViews = new WeakMap<Installation, Map<string, Installation>>()

/**
 * An installation view carrying the panel's effective voltage, for consumers that read
 * `installation.nominalVoltage`. Returns the installation itself when nothing differs.
 */
export function installationForPanel(
  installation: Installation,
  panels: Panel[],
  panelId: string | undefined,
): Installation {
  const nominalVoltage = resolvePanelNominalVoltage(installation, panels, panelId)
  if (nominalVoltage === installation.nominalVoltage) return installation
  let views = panelInstallationViews.get(installation)
  if (!views) panelInstallationViews.set(installation, views = new Map())
  const key = `${nominalVoltage.system}:${nominalVoltage.uLineToNeutral}:${nominalVoltage.uLineToLine}`
  const cached = views.get(key)
  if (cached) return cached
  const view = { ...installation, nominalVoltage }
  views.set(key, view)
  return view
}

/** Each board directly behind the site transformer with the output it runs on. */
export function getSupplyTransformerOutputBoards(
  installation: Installation,
  panels: Panel[],
): Array<{ panel: Panel; nominalVoltage: NominalVoltage }> {
  if (!installationSupportsFeedVoltages(installation)) return []
  return getDirectTransformerBoards(panels).map((panel) => ({
    panel,
    nominalVoltage: getRootFeedNominalVoltage(installation, panels, panel) ?? installation.nominalVoltage,
  }))
}

/** Line-to-line voltage of each distinct output, for the transformer's Usec: one value per secondary. */
export function getSupplyTransformerSecondaryVoltagesV(installation: Installation, panels: Panel[]): number[] {
  return [...new Set(getSupplyTransformerOutputs(installation, panels).map((output) => output.uLineToLine))]
}

/** Drawing view of supply devices: the site transformer lists every secondary it delivers. */
export function withSupplyTransformerOutputs<T extends TrunkDevice>(
  devices: T[],
  installation: Installation | undefined,
  panels: Panel[],
): T[] {
  if (!installation || !installationSupportsFeedVoltages(installation)) return devices
  const outputs = getSupplyTransformerSecondaryVoltagesV(installation, panels)
  if (outputs.length < 2) return devices
  return devices.map((device) => isSupplyTransformer(device)
    ? { ...device, conversionProps: { ...device.conversionProps, transformerSecondaryOutputsV: outputs } }
    : device)
}

/** Distinct LV outputs the site transformer delivers, the default output first. */
export function getSupplyTransformerOutputs(installation: Installation, panels: Panel[]): NominalVoltage[] {
  const outputs: NominalVoltage[] = [installation.nominalVoltage]
  for (const { nominalVoltage: voltage } of getSupplyTransformerOutputBoards(installation, panels)) {
    if (!outputs.some((known) => known.system === voltage.system && known.uLineToLine === voltage.uLineToLine))
      outputs.push(voltage)
  }
  return outputs
}
