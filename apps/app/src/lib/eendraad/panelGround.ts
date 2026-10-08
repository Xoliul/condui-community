import i18n from '@/lib/i18n/domainI18n'
import { findMainPanel, walkPanels } from '@/lib/panel/panelTree'
import type { Installation, Panel, TrunkDevice } from '@/types/schema'
import { generateId } from '@/utils/id'

export const INSTALLATION_GROUND_ELEMENT_ID = 'ground'
const PANEL_GROUND_ELEMENT_PREFIX = 'panel-ground-'

export type EarthingStemLocation =
  | { kind: 'installation' }
  | { kind: 'panel'; panelId: string }

export type GroundTrunkDeviceOwner = {
  devices: TrunkDevice[]
  panel?: Panel
  index: number
}

/** One-wire layout id for the earth electrode on this board. */
export function getGroundElementId(panel: Panel): string {
  return panel.isMain === false
    ? `${PANEL_GROUND_ELEMENT_PREFIX}${panel.id}`
    : INSTALLATION_GROUND_ELEMENT_ID
}

export function isGroundElementId(id: string | undefined | null): boolean {
  return (
    id === INSTALLATION_GROUND_ELEMENT_ID ||
    (typeof id === 'string' && id.startsWith(PANEL_GROUND_ELEMENT_PREFIX))
  )
}

export function parseGroundElementId(
  id: string | undefined | null
): EarthingStemLocation | null {
  if (!id) return null
  if (id === INSTALLATION_GROUND_ELEMENT_ID) return { kind: 'installation' }
  if (id.startsWith(PANEL_GROUND_ELEMENT_PREFIX)) {
    const panelId = id.slice(PANEL_GROUND_ELEMENT_PREFIX.length)
    return panelId ? { kind: 'panel', panelId } : null
  }
  return null
}

export function isSecondaryPanel(panel: Panel, isSubPanelLayout = false): boolean {
  return panel.isMain === false || isSubPanelLayout
}

/** Whether this board currently draws an earth electrode stem. */
export function panelRendersEarthingStem(
  panel: Panel,
  installation: Installation | undefined | null,
  isSubPanelLayout = false
): boolean {
  if (isSecondaryPanel(panel, isSubPanelLayout)) return panel.hasGround === true
  return installation?.hasGround !== false
}

export function getPanelGroundTrunkDevices(
  panel: Panel,
  installation: Installation | undefined | null,
  isSubPanelLayout = false
): TrunkDevice[] {
  if (!panelRendersEarthingStem(panel, installation, isSubPanelLayout)) return []
  if (isSecondaryPanel(panel, isSubPanelLayout)) return panel.groundTrunkDevices ?? []
  return installation?.groundTrunkDevices ?? []
}

export function createLinkedEarthingSeparatorPair(startPosition = 0): TrunkDevice[] {
  const pairId = generateId()
  const label = i18n.t('symbols.earthing_separator', { defaultValue: 'PE' })
  return [0, 1].map((offset) => ({
    id: generateId(),
    type: 'earthing_separator',
    symbol: 'earthing_separator',
    label,
    trunkPosition: startPosition + offset,
    earthingSeparatorPairId: pairId,
  }))
}

/** Create or complete the linked earth stem on a secondary board. */
export function applySecondaryPanelEarthingStem(panel: Panel): boolean {
  if (panel.isMain !== false) return false
  let changed = false
  if (panel.hasGround !== true) {
    panel.hasGround = true
    changed = true
  }
  const devices = panel.groundTrunkDevices ? [...panel.groundTrunkDevices] : []
  const separators = devices.filter((device) => device.type === 'earthing_separator')
  if (separators.length < 2) {
    const nextPosition =
      devices.reduce((max, device) => Math.max(max, device.trunkPosition ?? -1), -1) + 1
    devices.push(...createLinkedEarthingSeparatorPair(nextPosition))
    panel.groundTrunkDevices = devices
    return true
  }
  if (!separators.slice(0, 2).some((device) => device.earthingSeparatorPairId)) {
    const pairId = generateId()
    separators.slice(0, 2).forEach((device) => {
      device.earthingSeparatorPairId = pairId
    })
    panel.groundTrunkDevices = devices
    changed = true
  }
  return changed
}

export function clearSecondaryPanelEarthingStem(panel: Panel): boolean {
  if (panel.isMain !== false) return false
  const hadStem = panel.hasGround === true || (panel.groundTrunkDevices?.length ?? 0) > 0
  if (!hadStem) return false
  panel.hasGround = false
  panel.groundTrunkDevices = []
  return true
}

export function collectEarthingStems(
  panels: readonly Panel[],
  installation?: Installation | null
): EarthingStemLocation[] {
  const stems: EarthingStemLocation[] = []
  if (installation?.hasGround !== false) {
    stems.push({ kind: 'installation' })
  }
  for (const panel of walkPanels(panels)) {
    if (panel.isMain === false && panel.hasGround === true) {
      stems.push({ kind: 'panel', panelId: panel.id })
    }
  }
  return stems
}

export function installationHasAnyEarthing(
  panels: readonly Panel[],
  installation?: Installation | null
): boolean {
  return collectEarthingStems(panels, installation).length > 0
}

export function visitGroundTrunkDeviceLists(
  panels: readonly Panel[],
  installation: Installation | undefined | null,
  visit: (devices: TrunkDevice[], panel?: Panel) => void
): void {
  if (installation?.groundTrunkDevices) visit(installation.groundTrunkDevices)
  for (const panel of walkPanels(panels)) {
    if (panel.groundTrunkDevices) visit(panel.groundTrunkDevices, panel)
  }
}

export function findGroundTrunkDeviceOwner(
  panels: readonly Panel[],
  installation: Installation | undefined | null,
  deviceId: string
): GroundTrunkDeviceOwner | undefined {
  if (installation?.groundTrunkDevices) {
    const index = installation.groundTrunkDevices.findIndex((device) => device.id === deviceId)
    if (index >= 0) return { devices: installation.groundTrunkDevices, index }
  }
  for (const panel of walkPanels(panels)) {
    const devices = panel.groundTrunkDevices
    if (!devices) continue
    const index = devices.findIndex((device) => device.id === deviceId)
    if (index >= 0) return { devices, panel, index }
  }
  return undefined
}

export function collectAllGroundTrunkDevices(
  panels: readonly Panel[],
  installation?: Installation | null
): TrunkDevice[] {
  const devices: TrunkDevice[] = [...(installation?.groundTrunkDevices ?? [])]
  for (const panel of walkPanels(panels)) {
    if (panel.groundTrunkDevices) devices.push(...panel.groundTrunkDevices)
  }
  return devices
}

export function resolveEarthingDeleteScope(
  groundElementId: string | undefined,
  panels: readonly Panel[]
): { mode: 'all' | 'installation' | 'panel'; panelId?: string } {
  const parsed = parseGroundElementId(groundElementId)
  if (parsed?.kind === 'panel') {
    const panel = [...walkPanels(panels)].find((candidate) => candidate.id === parsed.panelId)
    if (panel && panel.isMain === false) {
      return { mode: 'panel', panelId: panel.id }
    }
  }
  if (parsed?.kind === 'installation' || groundElementId === INSTALLATION_GROUND_ELEMENT_ID) {
    return { mode: 'installation' }
  }
  return { mode: 'all' }
}

export function findCanonicalEarthingBoard(
  panels: readonly Panel[]
): Panel | undefined {
  return findMainPanel(panels)
}
