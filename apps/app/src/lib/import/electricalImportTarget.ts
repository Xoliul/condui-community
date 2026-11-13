import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { createDefaultSupplyCable } from '@/lib/electrical/supplyCable'
import type { CableSpec, Installation, Panel, TrunkDevice } from '@/types/schema'
import type { ElectricalImportDocument } from '@/lib/electricalImport/types'

export function getElectricalImportInstallation({ installation }: ElectricalImportDocument) {
  return installation
}

type ApplyElectricalImportInstallationOptions = {
  installation: Installation
  panel: Panel
  voltageSystem: Installation['nominalVoltage']['system'] | null
  origin: Installation['mainSupply']['origin']
  supplyCable?: CableSpec
  supplyDevices: TrunkDevice[]
}

/** Sanctioned import boundary: replace scaffold installation facts with observed import facts. */
export function applyElectricalImportInstallation({
  installation,
  panel,
  voltageSystem,
  origin,
  supplyCable,
  supplyDevices,
}: ApplyElectricalImportInstallationOptions): void {
  if (voltageSystem) installation.nominalVoltage.system = voltageSystem
  installation.mainSupply.origin = origin
  installation.mainSupply.cable = supplyCable ?? createDefaultSupplyCable(installation.nominalVoltage.system)
  installation.mainSupply.supplyTrunkDevices = supplyDevices

  const topology = ensureInstallationFeedTopology(installation, [panel])
  topology.rootFeeds.forEach((feed) => {
    feed.trunkDevices = []
  })
  if (panel.gridView) {
    panel.gridView.slots = panel.gridView.slots.filter(
      ({ module }) => module.kind !== 'trunkDevice' || module.scope !== 'supply'
    )
    panel.gridView.supplyPanelSlots = []
    panel.gridView.supplyPanelVisible = false
  }
}
