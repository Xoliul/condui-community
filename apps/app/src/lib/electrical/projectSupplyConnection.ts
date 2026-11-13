import type { ProjectV2 } from '@/types/projectV2'
import type { CommandCheck, CommandEnv } from '@/lib/commands/project/types'
import { CommandError } from '@/lib/commands/project/types'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { resolveInstallationProfile } from '@/lib/installationProfile'
import { placeElectricalSymbolInProject } from '@/lib/eendraad/electricalSymbolDrop'
import { deleteEntitiesInProject } from '@/lib/eendraad/entityDeletion'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { clearRootFeedNominalVoltages } from './feedNominalVoltageEdit'
import { DEFAULT_SUPPLY_TRANSFORMER_PRIMARY_V, getInstallationSupplyTransformer, getInstallationSupplyTransformers } from './supplyTransformer'

/** The project connection owns the common incoming wire; panel-local transformers stay separate. */
export function getProjectSupplyTransformers(project: ProjectV2) {
  const installation = getProjectElectricalInstallation(project)
  return installation ? getInstallationSupplyTransformers(installation) : []
}

export function checkProjectSupplyConnection(project: ProjectV2): CommandCheck {
  if (resolveInstallationProfile(getProjectElectricalInstallation(project)) !== 'non_household')
    return { ok: false, code: 'non_domestic_required', message: 'This connection choice requires a non-domestic installation' }
  if (!getProjectElectricalPanels(project).some((panel) => panel.isMain !== false))
    return { ok: false, code: 'main_panel_missing', message: 'Main panel not found' }
  if (getProjectElectricalInstallation(project)?.nominalVoltage.system === 'DC')
    return { ok: false, code: 'ac_supply_required', message: 'A supply transformer requires an AC installation' }
  return { ok: true }
}

export function setProjectSupplyConnectionInProject(
  project: ProjectV2,
  connection: 'direct' | 'transformer',
  env: CommandEnv,
): boolean {
  const check = checkProjectSupplyConnection(project)
  if (!check.ok) throw new CommandError('check_failed', check.message, { reason: check.code })
  const transformers = getProjectSupplyTransformers(project)
  if (connection === 'direct') {
    const sources = transformers.filter((device) => device.conversionProps?.transformerRole === 'supply')
    if (!sources.length) return false
    deleteEntitiesInProject(project, {
      refs: sources.map((device) => ({ kind: 'trunkDevice', id: device.id })),
    })
    clearRootFeedNominalVoltages(project)
    return true
  }
  const panel = getProjectElectricalPanels(project).find((candidate) => candidate.isMain !== false)!
  let created = false
  if (!transformers.length) {
    const result = placeElectricalSymbolInProject(project, {
      symbolId: 'transformer',
      target: { type: 'supplyWire', panelId: panel.id, supplyFeedScope: 'shared', supplyDeviceInsertIndex: 0 },
    }, { activeFloorId: null, viewportCenter: null, activePanelId: null }, env.language)
    if (result.status !== 'placed' || !result.mutated)
      throw new CommandError('check_failed', 'Unable to add the supply transformer')
    created = true
  }
  const installation = getProjectElectricalInstallation(project)!
  const transformer = getInstallationSupplyTransformer(installation) ?? getProjectSupplyTransformers(project)[0]!
  const props = transformer.conversionProps ?? {}
  const next = {
    ...props,
    transformerRole: 'supply' as const,
    transformerPrimaryVoltageV: props.transformerPrimaryVoltageV != null && props.transformerPrimaryVoltageV > 1000
      ? props.transformerPrimaryVoltageV : DEFAULT_SUPPLY_TRANSFORMER_PRIMARY_V,
    transformerSecondaryVoltageV: installation.nominalVoltage.uLineToLine,
  }
  let changed = created || props.transformerRole !== next.transformerRole ||
    props.transformerPrimaryVoltageV !== next.transformerPrimaryVoltageV ||
    props.transformerSecondaryVoltageV !== next.transformerSecondaryVoltageV
  const storedDevices = installation.mainSupply.supplyTrunkDevices ?? installation.feedTopology?.sharedFeed.trunkDevices ?? []
  if (!changed && storedDevices[0]?.id === transformer.id) return false
  if (changed) transformer.conversionProps = next
  // A newly adopted source moves before LV metering/protection. An existing source keeps
  // meters and protections the user put before it: that is MV-side metering/protection.
  const devices = [...storedDevices]
  const index = devices.findIndex((device) => device.id === transformer.id)
  const mvSideCount = props.transformerRole === 'supply'
    ? devices.findIndex((device) => device.type !== 'energy_meter' && device.type !== 'protection')
    : 0
  const target = mvSideCount < 0 ? devices.length : mvSideCount
  if (index > target) {
    devices.splice(index, 1)
    devices.splice(target, 0, transformer)
    devices.forEach((device, position) => { device.trunkPosition = position })
    changed = true
  }
  if (changed) {
    installation.mainSupply.supplyTrunkDevices = devices
    ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
  }
  return changed
}
