import type { Placement } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { getEditableProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { updateSupplyTrunkDeviceInProject } from '@/lib/projectMutations/storeActions'
import { syncSupplyDeviceMultiplierCount } from './supplyDeviceMultiplierCore'

/**
 * Resizes a supply device (inverter, battery, solar panel) multiplier on a project draft with the
 * same rules as the live editor. Returns false when the device cannot be resized.
 */
export function syncSupplyDeviceMultiplierInProject(
  project: ProjectV2,
  deviceId: string,
  target: number,
  options: {
    activeFloorId?: string | null
    sourcePlacement?: Placement
    newId: () => string
  }
): boolean {
  return syncSupplyDeviceMultiplierCount(
    {
      getDevice: (id) => queryAllSupplyTrunkDevices(project).find((device) => device.id === id),
      updateDevice: (id, updates) => {
        updateSupplyTrunkDeviceInProject(project, id, updates)
      },
      getActiveFloorId: () => options.activeFloorId ?? null,
      getFallbackFloorId: () => selectProjectBuildingFloors(project)[0]?.id,
      getInstallationSystem: () =>
        getEditableProjectElectricalInstallation(project)?.nominalVoltage.system ?? '1N~',
      newId: options.newId,
    },
    deviceId,
    target,
    options.sourcePlacement ? { placement: options.sourcePlacement } : undefined
  )
}
