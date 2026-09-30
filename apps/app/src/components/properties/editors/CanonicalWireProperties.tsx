import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import {
  findWireRunForAnchor,
  fromWireRunRoute,
  selectProjectWireRuns,
  toWireRunRoute,
} from '@/lib/projectV2/wireRuns'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import type { CableSpec } from '@/types/schema'
import type { WireRunChanges } from '@/lib/wires/editWireRun'
import {
  isProjectDefaultCableAnchor,
  PROJECT_DEFAULT_CABLE_KINDS,
  resolveProjectDefaultCableKind,
  withProjectDefaultCableKind,
} from '@/lib/wires/circuitWireDefaults'
import { WireRouteAndCableForm, type WireRouteFormState } from '../shared/propertiesShared'
import { panelStringT } from '../shared/propertiesSharedUtils'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import { isSecondaryBusFeederAnchor } from '@/lib/wires/railWireRuns'


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
  const makeProjectDefault = useProjectStore((s) => s.makeWireCableProjectDefault)
  // The anchor whose cable type was just changed here; offers "Make project default" once.
  const [changedAnchor, setChangedAnchor] = useState<string>()
  const liveWires = useMemo(() => project
    ? buildElectricalStructureSnapshot(project).relationships.flatMap((edge) =>
        edge.properties?.wireAnchor === anchor
          ? [{ ...(edge.properties.wire as { medium?: string; followsDefaultCable?: boolean; cable?: CableSpec } | undefined),
              busGroup: edge.properties.wireBusGroup }]
          : [])
    : [], [project, anchor])
  let lengthSuggestion: { placeholder?: string; hint?: ReactNode } = {}
  
  if (!project) return null
  const isRailEdge = liveWires.some((wire) => wire?.medium === 'busbar')
  const liveWire = liveWires[0]
  const railEligible = isRailEdge || !!liveWire?.busGroup || isSecondaryBusFeederAnchor(anchor)
  const defaultKind = resolveProjectDefaultCableKind(getProjectElectricalInstallation(project))
  const defaultEligible = !isRailEdge && domain !== 'DC' && isProjectDefaultCableAnchor(anchor)
  const followsDefault = defaultEligible && liveWire?.followsDefaultCable === true
  const run = findWireRunForAnchor(selectProjectWireRuns(project), anchor)
  const state: WireRouteFormState = {
    cable: isRailEdge && liveWire?.cable ? liveWire.cable : run
      ? followsDefault ? withProjectDefaultCableKind(run.cable, defaultKind) : run.cable
      : cable,
    ...(run
      ? {
          ...fromWireRunRoute(run.route),
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
          route: toWireRunRoute(state.wireRoute, state.inWall),
          inTube: state.inTube,
          lengthM: state.wireLengthM,
          labels: {
            hideWireLabel: state.hideWireLabel,
            showFireClassLabel: state.showFireClassLabel,
            showWireLengthLabel: state.showWireLengthLabel,
          },
        }
    if (value.cable) {
      changes.cable = value.cable
      // Section or core edits keep an inherited type; choosing a type makes it this wire's own.
      if (followsDefault && value.cable.kind === state.cable.kind) changes.followsDefaultCable = true
      else setChangedAnchor(anchor)
    }
    if ('wireRoute' in value) changes.route = toWireRunRoute(value.wireRoute, value.inWall)
    if ('inTube' in value) changes.inTube = value.inTube
    if ('wireLengthM' in value) changes.lengthM = value.wireLengthM
    for (const key of ['hideWireLabel', 'showFireClassLabel', 'showWireLengthLabel'] as const) {
      if (key in value) changes.labels = { ...changes.labels, [key]: value[key] }
    }
    update(anchor, state.cable, changes)
  }
  const canBecomeDefault =
    changedAnchor === anchor &&
    state.cable.kind !== defaultKind &&
    PROJECT_DEFAULT_CABLE_KINDS.includes(state.cable.kind)
  const linkClass = 'text-[11px] leading-4 text-sky-600 hover:underline dark:text-sky-400'
  const cableHint = !defaultEligible ? null : followsDefault ? (
    <p className="text-[11px] leading-4 text-gray-500 dark:text-gray-400">
      {t('wires.cableDefault', 'Default')}
    </p>
  ) : canBecomeDefault ? (
    <button
      type="button"
      className={linkClass}
      onClick={() => {
        makeProjectDefault(anchor, state.cable)
        setChangedAnchor(undefined)
      }}
    >
      {t('wires.makeCableDefault', 'Make default')}
    </button>
  ) : (
    <button
      type="button"
      className={linkClass}
      onClick={() => update(anchor, state.cable, { followsDefaultCable: true })}
    >
      {t('wires.useCableDefault', 'Use default')}
    </button>
  )
  return (
    <WireRouteAndCableForm
      state={state}
      onChange={onChange}
      isDC={domain === 'DC'}
      showLength={!sharedGeometry}
      groundConductor={anchor.startsWith('ground:')}
      busbar={isRailEdge}
      onMediumChange={railEligible ? (medium, cable) => update(anchor, state.cable, { medium, cable }) : undefined}
      cableHint={cableHint}
      lengthPlaceholder={lengthSuggestion.placeholder}
      lengthHint={lengthSuggestion.hint}
      t={panelStringT(t)}
    />
  )
}
