import { editProperties, updateCanonicalWireProperties } from '@/handlers/properties/editProperties'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import {
  findWireRunForAnchor,
  fromWireRunRoute,
  selectProjectWireRuns,
  toWireRunRoute,
} from '@/lib/projectV2/wireRuns'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { circuitWireSpecifications } from '@/lib/wires/circuitWireSpecifications'
import type { CableSpec } from '@/types/schema'
import type { WireRunChanges } from '@/lib/wires/editWireRun'
import {
  isProjectDefaultCableAnchor,
  PROJECT_DEFAULT_CABLE_KINDS,
  resolveProjectDefaultCableKind,
  withProjectDefaultCableKind,
} from '@/lib/wires/circuitWireDefaults'
import CustomDropdown from '@/components/common/CustomDropdown'
import { WireRouteAndCableForm, type WireRouteFormState } from '../shared/propertiesShared'
import { panelStringT } from '../shared/propertiesSharedUtils'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import { isRailFeederAnchor } from '@/lib/wires/railWireRuns'
import { buildWireBusIndex } from '@/lib/wires/wireBusIndex'
import { circuitIdFromWireAnchor, resolveConductorMarks } from '@/lib/wires/conductorMarks'


export function CanonicalWireProperties({
  anchor,
  cable,
  domain,
  defaults,
  sharedGeometry,
  sharedGeometryAnchors,
  conductorMarksOnBranch = false,
}: {
  anchor: string
  cable: CableSpec
  sharedGeometry?: boolean
  sharedGeometryAnchors?: readonly string[]
  defaults?: Partial<WireRouteFormState>
  domain?: 'AC' | 'DC'
  /** The selected piece is a stem's branch, whose conductor marks toggle apart from the stem. */
  conductorMarksOnBranch?: boolean
}) {
  const { t } = useTranslation()
  const project = useProjectStore((s) => s.currentProject)
  const inherited = useMemo(() => project
    ? circuitWireSpecifications(getProjectElectricalPanels(project), selectProjectWireRuns(project)).get(anchor)
    : undefined, [project, anchor])
  const update = (anchor: string, cable: CableSpec, changes: WireRunChanges) =>
    updateCanonicalWireProperties(anchor, cable, changes, sharedGeometryAnchors)
  const makeProjectDefault = (anchor: string, cable: CableSpec) =>
    editProperties({
      actions: [
        {
          kind: 'wireCableDefault',
          anchor,
          cable,
          ...(sharedGeometryAnchors ? { sharedGeometryAnchors: [...sharedGeometryAnchors] } : {}),
        },
      ],
    })
  // The anchor whose cable type was just changed here; offers "Make project default" once.
  const [changedAnchor, setChangedAnchor] = useState<string>()
  const liveWires = useMemo(
    () =>
      project
        ? buildElectricalStructureSnapshot(project).relationships.flatMap((edge) =>
            edge.properties?.wireAnchor === anchor
              ? [
                  {
                    ...(edge.properties.wire as
                      | { medium?: string; followsDefaultCable?: boolean; cable?: CableSpec }
                      | undefined),
                    busGroup: edge.properties.wireBusGroup,
                  },
                ]
              : []
          )
        : [],
    [project, anchor]
  )
  let lengthSuggestion: { placeholder?: string; hint?: ReactNode } = {}
  
  if (!project) return null
  const isRailEdge = liveWires.some((wire) => wire?.medium === 'busbar')
  const liveWire = liveWires[0]
  const railEligible = isRailEdge || !!liveWire?.busGroup ||
    isRailFeederAnchor(anchor, buildWireBusIndex(getProjectElectricalPanels(project)))
  const defaultKind = resolveProjectDefaultCableKind(getProjectElectricalInstallation(project))
  const defaultEligible = !isRailEdge && domain !== 'DC' && isProjectDefaultCableAnchor(anchor)
  const followsDefault = defaultEligible && liveWire?.followsDefaultCable === true
  const run = findWireRunForAnchor(selectProjectWireRuns(project), anchor)
  const state: WireRouteFormState = {
    cable:
      isRailEdge && liveWire?.cable
        ? liveWire.cable
        : run
          ? followsDefault
            ? withProjectDefaultCableKind(run.cable, defaultKind)
            : run.cable
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
  // The form's toggle edits the selected piece's own flag.
  const marksKey = conductorMarksOnBranch ? 'showBranchConductorMarks' : 'showConductorMarks'
  if (run) state.showConductorMarks = run.labels?.[marksKey]
  if (!isRailEdge && inherited) {
    state.cable = { ...state.cable, fireClass: inherited.fireClass ?? state.cable.fireClass }
    Object.assign(state, fromWireRunRoute(inherited.route), { inTube: inherited.inTube })
  }
  const onChange = (value: Partial<WireRouteFormState>) => {
    const changes: WireRunChanges =
      isRailEdge || run
        ? {}
        : {
            route: toWireRunRoute(state.wireRoute, state.inWall),
            inTube: state.inTube,
            lengthM: state.wireLengthM,
            labels: {
              hideWireLabel: state.hideWireLabel,
              showFireClassLabel: state.showFireClassLabel,
              showWireLengthLabel: state.showWireLengthLabel,
              [marksKey]: state.showConductorMarks,
            },
          }
    if (value.cable) {
      changes.cable = value.cable
      // Section or core edits keep an inherited type; choosing a type makes it this wire's own.
      if (followsDefault && value.cable.kind === state.cable.kind)
        changes.followsDefaultCable = true
      else setChangedAnchor(anchor)
      // None is a choice of its own; an empty class would otherwise inherit the circuit's again.
      if (!value.cable.fireClass && state.cable.fireClass) changes.fireClassNone = true
    }
    if ('wireRoute' in value) changes.route = toWireRunRoute(value.wireRoute, value.inWall) ?? 'none'
    if ('inTube' in value) changes.inTube = value.inTube
    if ('wireLengthM' in value) changes.lengthM = value.wireLengthM
    for (const key of ['hideWireLabel', 'showFireClassLabel', 'showWireLengthLabel'] as const) {
      if (key in value) changes.labels = { ...changes.labels, [key]: value[key] }
    }
    if ('showConductorMarks' in value)
      changes.labels = { ...changes.labels, [marksKey]: value.showConductorMarks }
    update(anchor, state.cable, changes)
  }
  // Same derivation the diagrams use, so the button previews exactly what will be drawn.
  const conductorMarks = isRailEdge
    ? undefined
    : resolveConductorMarks({
        cable: state.cable,
        domain,
        circuitId: circuitIdFromWireAnchor(anchor),
        panels: getProjectElectricalPanels(project),
        installation: getProjectElectricalInstallation(project),
      })
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
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('wires.material')}
        </label>
        <CustomDropdown
          value={run?.material ?? 'copper'}
          onChange={(value) =>
            update(anchor, state.cable, { material: value === 'aluminium' ? 'aluminium' : 'copper' })
          }
          options={[
            { value: 'copper', label: t('wires.copper') },
            { value: 'aluminium', label: t('wires.aluminium') },
          ]}
        />
      </div>
    <WireRouteAndCableForm
      state={state}
      onChange={onChange}
      isDC={domain === 'DC'}
      showLength={!sharedGeometry}
      groundConductor={anchor.startsWith('ground:')}
      busbar={isRailEdge}
      onMediumChange={
        railEligible ? (medium, cable) => update(anchor, state.cable, { medium, cable }) : undefined
      }
      cableHint={cableHint}
      routeHint={run?.route !== undefined ? (
        <button type="button" className={linkClass}
          onClick={() => update(anchor, state.cable, { route: undefined })}>
          {t('wires.useUpstreamRoute')}
        </button>
      ) : null}
      conductorMarks={conductorMarks}
      lengthPlaceholder={lengthSuggestion.placeholder}
      lengthHint={lengthSuggestion.hint}
      t={panelStringT(t)}
    />
    </div>
  )
}
