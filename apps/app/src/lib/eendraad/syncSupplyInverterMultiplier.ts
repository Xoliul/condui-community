import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { SyncSupplyInverterMultiplierDeps } from './supplyDeviceMultiplierCore'

export {
  syncSupplyDeviceMultiplierCount,
  syncSupplyInverterMultiplierCount,
  type SyncSupplyInverterMultiplierDeps,
  type SyncSupplyDeviceMultiplierDeps,
  type SupplyDeviceMultiplierPlacementSource,
} from './supplyDeviceMultiplierCore'

export function createSyncSupplyInverterMultiplierDeps(): SyncSupplyInverterMultiplierDeps {
  return {
    getDevice: (deviceId) => useProjectStore.getState().getTrunkDeviceById(deviceId)?.device,
    // Never reached while commitMultiplier is set; kept so the deps stay complete.
    updateDevice: () => {},
    commitMultiplier: (deviceId, target, source) =>
      !!runProjectCommand(
        'properties.edit',
        {
          actions: [
            {
              kind: 'supplyDeviceMultiplier',
              deviceId,
              count: target,
              activeFloorId: useUIStore.getState().activeFloorId,
              ...(source?.placement ? { sourcePlacement: source.placement } : {}),
            },
          ],
        },
        { label: 'Change supply device count' }
      ),
    getActiveFloorId: () => useUIStore.getState().activeFloorId,
    getFallbackFloorId: () => {
      const project = useProjectStore.getState().currentProject
      return project ? readLegacyCompatibilityFloors(project)[0]?.id : undefined
    },
    getInstallationSystem: () => {
      const project = useProjectStore.getState().currentProject
      return getProjectElectricalInstallation(project ?? {})?.nominalVoltage.system ?? '1N~'
    },
  }
}

export {
  getSupplyDeviceMultiplier,
  getSupplyInverterMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'
