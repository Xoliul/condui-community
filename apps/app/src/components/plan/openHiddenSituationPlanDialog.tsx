import type { TFunction } from 'i18next'
import HiddenItemsDialog, { type HiddenItem } from '@/components/common/HiddenItemsDialog'
import { getSymbolById } from '@/lib/symbols'
import { hasCustomPlacement } from '@/lib/plan/customPlacement'
import { restoreHiddenSituationPlanPlacementsToActiveView } from '@/lib/plan/restoreHiddenSituationPlanPlacements'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Placement } from '@/types/schema'

type SitplanPlacementRow = Placement & {
  endpointId?: string
  trunkDeviceId?: string
  enclosureId?: string
  junctionPanelLabel?: string
  isEarthing?: boolean
}

export function openHiddenSituationPlanDialogForFloor(
  floorId: string,
  t: TFunction,
  title = t('contextMenu.showHidden', 'Show hidden…')
): boolean {
  const store = useProjectStore.getState()
  const floor = store.getFloorById(floorId)
  const hiddenIds = floor?.hiddenSitplanPlacementIds ?? []
  if (hiddenIds.length === 0) return false

  const allPlacements = store.getPlacementsByFloor(floorId) as SitplanPlacementRow[]
  const placementMap = new Map(allPlacements.map((placement) => [placement.id, placement]))
  const customPlacementIds = new Set(
    allPlacements.filter(hasCustomPlacement).map((placement) => placement.id)
  )
  const items: HiddenItem[] = hiddenIds.flatMap((id) => {
    const placement = placementMap.get(id)
    if (!placement) return []

    if (placement.isEarthing) {
      const symbol = getSymbolById('earthing')
      return [
        {
          id,
          label: t('symbols.earthing', 'Earthing'),
          icon: symbol ? (
            <img src={symbol.svgPath} alt="" className="h-7 w-7 object-contain dark:invert" />
          ) : undefined,
        },
      ]
    }

    if (placement.enclosureId) {
      const symbol = getSymbolById('panel_distribution')
      const enclosure = store.currentProject?.disciplines?.electrical?.auxiliaryEnclosures?.find(
        (candidate) => candidate.id === placement.enclosureId
      )
      return [
        {
          id,
          label: enclosure?.name.trim() || t('panelCanvas.virtualEnclosure', 'Supply enclosure'),
          icon: symbol ? (
            <img src={symbol.svgPath} alt="" className="h-7 w-7 object-contain dark:invert" />
          ) : undefined,
        },
      ]
    }

    const endpoint = placement.endpointId ? store.getEndpointById(placement.endpointId) : undefined
    const trunkInfo = placement.trunkDeviceId
      ? store.getTrunkDeviceById(placement.trunkDeviceId)
      : undefined
    const trunkDevice = trunkInfo?.device
    const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
    const symbol = symbolKey ? getSymbolById(symbolKey) : undefined
    const typeName = symbol ? t(`symbols.${symbol.id}`, symbol.name) : undefined
    const deviceName =
      typeName ||
      placement.junctionPanelLabel?.trim() ||
      endpoint?.label?.trim() ||
      trunkDevice?.label?.trim() ||
      t('hiddenItemsDialog.unnamedItem', 'Unnamed item')
    const circuit = endpoint
      ? store.findCircuitForEndpoint(endpoint.id)?.circuit
      : trunkInfo?.circuit
    const label = circuit?.code.trim()
      ? t('hiddenItemsDialog.deviceOnCircuit', '{{device}} on {{circuit}}', {
          device: deviceName,
          circuit: circuit.code.trim(),
        })
      : deviceName
    return [
      {
        id,
        label,
        icon: symbol ? (
          <img src={symbol.svgPath} alt="" className="h-7 w-7 object-contain dark:invert" />
        ) : undefined,
      },
    ]
  })

  const { openDialog, closeDialog } = useDialogStore.getState()
  openDialog({
    type: 'custom',
    title,
    content: (
      <HiddenItemsDialog
        items={items}
        showMoveToCurrentView
        getMoveToCurrentViewDefault={(selectedIds) =>
          selectedIds.some((id) => !customPlacementIds.has(id))
        }
        onConfirm={(selectedIds, options) => {
          restoreHiddenSituationPlanPlacementsToActiveView(selectedIds, {
            moveToActiveView: options.moveToCurrentViewOverridden
              ? options.moveToCurrentView
              : undefined,
          })
          closeDialog()
        }}
        onCancel={closeDialog}
      />
    ),
  })
  return true
}
