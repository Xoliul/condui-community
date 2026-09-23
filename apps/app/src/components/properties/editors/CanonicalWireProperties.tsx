import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import type { CableSpec } from '@/types/schema'
import type { WireRunChanges } from '@/lib/wires/editWireRun'
import { WireRouteAndCableForm, type WireRouteFormState } from '../shared/propertiesShared'
import { panelStringT } from '../shared/propertiesSharedUtils'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'

export function CanonicalWireProperties({
  anchor,
  cable,
  domain,
  defaults,
  sharedGeometry,
}: {
  anchor: string
  cable: CableSpec
  sharedGeometry?: boolean
  defaults?: Partial<WireRouteFormState>
  domain?: 'AC' | 'DC'
}) {
  const { t } = useTranslation()
  const project = useProjectStore((s) => s.currentProject)
  const update = useProjectStore((s) => s.updateWireRunAtAnchor)
  const isRailEdge = useMemo(() => project
    ? buildElectricalStructureSnapshot(project).relationships.some((edge) =>
        edge.properties?.wireAnchor === anchor &&
        (edge.properties.wire as { medium?: string } | undefined)?.medium === 'busbar')
    : false, [project, anchor])
  if (!project) return null
  const run = findWireRunForAnchor(selectProjectWireRuns(project), anchor)
  const state: WireRouteFormState = {
    cable: run?.cable ?? cable,
    ...(run
      ? {
          wireRoute: run.route,
          inTube: run.inTube,
          wireLengthM: run.segmentLengths?.[anchor],
          ...run.labels,
        }
      : defaults),
  }
  const onChange = (value: Partial<WireRouteFormState>) => {
    const changes: WireRunChanges = isRailEdge || run
      ? {}
      : {
          route: state.wireRoute,
          inTube: state.inTube,
          lengthM: state.wireLengthM,
          labels: {
            hideWireLabel: state.hideWireLabel,
            showFireClassLabel: state.showFireClassLabel,
            showWireLengthLabel: state.showWireLengthLabel,
          },
        }
    if (value.cable) changes.cable = value.cable
    if ('wireRoute' in value) changes.route = value.wireRoute
    if ('inTube' in value) changes.inTube = value.inTube
    if ('wireLengthM' in value) changes.lengthM = value.wireLengthM
    for (const key of ['hideWireLabel', 'showFireClassLabel', 'showWireLengthLabel'] as const) {
      if (key in value) changes.labels = { ...changes.labels, [key]: value[key] }
    }
    update(anchor, state.cable, changes)
  }
  return (
    <WireRouteAndCableForm
      state={state}
      onChange={onChange}
      isDC={domain === 'DC'}
      showLength={!sharedGeometry}
      groundConductor={anchor.startsWith('ground:')}
      busbar={isRailEdge}
      t={panelStringT(t)}
    />
  )
}
