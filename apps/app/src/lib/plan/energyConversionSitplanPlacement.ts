import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import {
  selectProjectBuildingFloors,
  mutateBuildingFloorViews,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { SymbolKey } from '@/types/schema'
import { generateId } from '@/utils/project'
import { buildAutoSitplanPlacement } from './autoSitplanPlacement'
import { getSituationPlanPlacementIdsHiddenByPanel } from './panelPlanPlacementVisibility'
import { resolveCircuitSitplanTargetFloorId } from './sitplanTargetFloor'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'

type EnergyConversionSitplanProject = ProjectWithOptionalV2Building &
  ProjectWithOptionalV2Electrical & {
    project?: { lastActiveFloorId?: string | null }
  }

const CONVERSION_SYMBOLS = new Set<SymbolKey>([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])
const PHYSICAL_SUPPLY_SYMBOLS = new Set<SymbolKey>([
  ...CONVERSION_SYMBOLS,
  'solar_panel',
  'battery',
  'energy_meter',
])

/**
 * Gives legacy conversion and physical supply devices the placement behavior used for new drops.
 * Supply energy meters receive a plan placement hidden by default.
 * Non-inverter conversion placements that are not represented in a panel are visible,
 * including placements that older editor versions stored in the hidden-items
 * list. Placements intentionally represented in a panel remain hidden on the
 * situation plan. Missing conversion placements are optional and are never
 * treated as orphaned data. Existing inverter plan visibility is an independent
 * user choice and is preserved even when its panel module is hidden.
 */
export function healEnergyConversionSitplanPlacements(
  project: EnergyConversionSitplanProject
): boolean {
  let changed = false

  const floors = selectProjectBuildingFloors(project)
  const fallbackFloorId = floors[0]?.id
  if (!fallbackFloorId) return changed

  const conversionPlacementIds = new Set<string>()
  const defaultHiddenSupplyMeterPlacementIdsByFloor = new Map<string, Set<string>>()
  for (const panel of selectProjectElectricalPanels(project)) {
    for (const circuit of getAllCircuits(panel)) {
      const floorId =
        resolveCircuitSitplanTargetFloorId(project, null, circuit.id) ?? fallbackFloorId
      const addPlacement = () => {
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: circuit.id,
          floorId,
          placementId: generateId(),
          ignoreManualPlacementPreference: true,
        })
        if (!placement) return null
        changed = true
        return placement
      }

      for (const endpoint of circuit.endpoints) {
        if (!endpoint.symbol || !CONVERSION_SYMBOLS.has(endpoint.symbol)) continue
        if (endpoint.placements.length === 0) {
          const placement = addPlacement()
          if (placement) endpoint.placements.push(placement)
        }
        for (const endpointPlacement of endpoint.placements) {
          if (endpoint.symbol !== 'inverter') conversionPlacementIds.add(endpointPlacement.id)
        }
      }

      for (const device of circuit.trunkDevices ?? []) {
        const isPanelSupplyMeter =
          device.type === 'energy_meter' && circuit.code.trim().toUpperCase() === 'PANEL'
        if (!CONVERSION_SYMBOLS.has(device.symbol) && !isPanelSupplyMeter) continue
        if ((device.placements?.length ?? 0) === 0) {
          const placement = addPlacement()
          if (placement) {
            device.placements = [placement]
            if (isPanelSupplyMeter) {
              const placementIds =
                defaultHiddenSupplyMeterPlacementIdsByFloor.get(placement.floorId) ??
                new Set<string>()
              placementIds.add(placement.id)
              defaultHiddenSupplyMeterPlacementIdsByFloor.set(placement.floorId, placementIds)
            }
          }
        }
        for (const devicePlacement of device.placements ?? []) {
          if (device.symbol !== 'inverter' && !isPanelSupplyMeter) {
            conversionPlacementIds.add(devicePlacement.id)
          }
        }
      }
    }
  }

  const supplyFloorId =
    floors.find((floor) => floor.id === project.project?.lastActiveFloorId)?.id ?? fallbackFloorId
  const supplyDevices = getAllSupplyTrunkDevices(project)
  for (const device of supplyDevices) {
    if (!PHYSICAL_SUPPLY_SYMBOLS.has(device.symbol)) continue
    if ((device.placements?.length ?? 0) === 0) {
      const placement = buildAutoSitplanPlacement(project, {
        circuitId: 'panel-supply',
        floorId: supplyFloorId,
        placementId: generateId(),
        ignoreManualPlacementPreference: true,
      })
      if (placement) {
        device.placements = [placement]
        if (device.symbol === 'energy_meter') {
          const placementIds =
            defaultHiddenSupplyMeterPlacementIdsByFloor.get(placement.floorId) ??
            new Set<string>()
          placementIds.add(placement.id)
          defaultHiddenSupplyMeterPlacementIdsByFloor.set(placement.floorId, placementIds)
        }
        changed = true
      }
    }
    for (const placement of device.placements ?? []) {
      if (device.symbol !== 'inverter' && device.symbol !== 'energy_meter') {
        conversionPlacementIds.add(placement.id)
      }
    }
  }

  const placementsHiddenByPanel = getSituationPlanPlacementIdsHiddenByPanel(project)
  mutateBuildingFloorViews(project, (floors) => {
    for (const floor of floors) {
      const hiddenIds = floor.hiddenSitplanPlacementIds ?? []
      const visibleIds = hiddenIds.filter(
        (id) => !conversionPlacementIds.has(id) || placementsHiddenByPanel.has(id),
      )
      const nextHiddenIds = [...visibleIds]
      for (const id of defaultHiddenSupplyMeterPlacementIdsByFloor.get(floor.id) ?? []) {
        if (!nextHiddenIds.includes(id)) {
          nextHiddenIds.push(id)
        }
      }
      if (
        nextHiddenIds.length === hiddenIds.length &&
        nextHiddenIds.every((id, index) => id === hiddenIds[index])
      ) continue
      floor.hiddenSitplanPlacementIds = nextHiddenIds.length > 0 ? nextHiddenIds : undefined
      changed = true
    }
  })
  return changed
}
