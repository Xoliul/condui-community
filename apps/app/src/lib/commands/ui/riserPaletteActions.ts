import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'
import type { Circuit } from '@/types/schema'
import type { ProjectPaletteAction } from './projectPaletteActions'
import { electricalCreateRiser, electricalJoinRisers } from '../project/commands/electricalRiser'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { getOneWireBranchRoots } from '@/lib/eendraad/oneWireForkProject'
import { hasOneWireRisers } from '@/lib/eendraad/oneWireRisers'

/** Circuit wires (trunk, crossbar, riser, branch) carry their circuit; supply and ground wires do not. */
function selectedCircuits(project: ProjectV2, selection: Selection): Circuit[] {
  const circuits = [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits)
  const ids = new Set<string>()
  if (selection.type === 'circuit') selection.ids.forEach((id) => ids.add(id))
  if (selection.type === 'protection') {
    for (const panel of walkPanels(getProjectElectricalPanels(project)))
      for (const protection of panel.protections)
        if (selection.ids.includes(protection.id)) protection.circuits?.forEach((circuit) => ids.add(circuit.id))
  }
  if (selection.type === 'wire') {
    for (const meta of selection.wireMetadata ?? [])
      if (meta.circuitId && !meta.isSupply && !meta.isGround && meta.type !== 'mainBus' && meta.type !== 'secondaryBus') ids.add(meta.circuitId)
  }
  return circuits.filter((circuit) => ids.has(circuit.id))
}

export function getRiserPaletteActions(project: ProjectV2, selection: Selection): ProjectPaletteAction[] {
  const actions: ProjectPaletteAction[] = []
  const circuits = selectedCircuits(project, selection)
  const circuitField = (items: Circuit[]) => items.length > 1
    ? [{ name: 'circuit', labelKey: 'commandPalette.fields.circuit', value: items[0]!.id,
      options: items.map((circuit) => ({ value: circuit.id, label: circuit.code || circuit.id })) }] : []
  const addable = circuits.filter((circuit) => electricalCreateRiser.check(project, { circuitId: circuit.id }).ok)
  if (addable.length) actions.push({ id: 'electrical.createRiser', labelKey: 'commandPalette.addRiser', fields: circuitField(addable),
    invocation: (values) => ({ id: 'electrical.createRiser', input: { circuitId: values.circuit ?? addable[0]!.id } }) })
  const joinable = circuits.filter((circuit) => hasOneWireRisers(circuit) && electricalJoinRisers.check(project, { circuitId: circuit.id }).ok)
  if (joinable.length) actions.push({ id: 'electrical.joinRisers', labelKey: 'commandPalette.joinRisers', fields: circuitField(joinable),
    invocation: (values) => ({ id: 'electrical.joinRisers', input: { circuitId: values.circuit ?? joinable[0]!.id } }) })
  const empties = circuits.flatMap((circuit) => (circuit.branches ?? [])
    .filter((branch) => !branch.forkFrom && (branch.stem ?? 0) > 0 && !branch.endpointIds.length)
    .map((branch) => ({ circuit, branch })))
  if (empties.length) actions.push({ id: 'electrical.deleteEmptyRiser', labelKey: 'commandPalette.deleteEmptyRiser',
    fields: [{ name: 'branch', labelKey: 'commandPalette.fields.branch', value: empties[0]!.branch.id,
      options: empties.map(({ circuit, branch }) => ({ value: branch.id, label: `${circuit.code} · ${branch.stem}` })) }],
    invocation: (values) => {
      const entry = empties.find(({ branch }) => branch.id === values.branch) ?? empties[0]!
      return { id: 'electrical.deleteEmptyRiser', input: { circuitId: entry.circuit.id, branchId: entry.branch.id } }
    } })
  if (selection.type === 'endpoint' && selection.ids.length) {
    const all = [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits)
    const owner = all.find((circuit) => selection.ids.every((id) => circuit.endpoints.some((endpoint) => endpoint.id === id)))
    if (owner?.branches?.length) {
      const roots = getOneWireBranchRoots(owner.branches)
      const rootIds = [...new Set(selection.ids.map((id) => {
        const branch = owner.branches!.find((item) => item.endpointIds.includes(id))
        return branch ? roots.get(branch.id) ?? null : null
      }))]
      if (rootIds.length && rootIds.every((id): id is string => !!id) &&
        electricalCreateRiser.check(project, { circuitId: owner.id, branchIds: rootIds }).ok)
        actions.push({ id: 'electrical.moveToOwnRiser', labelKey: 'commandPalette.moveToOwnRiser', fields: [],
          invocation: () => ({ id: 'electrical.createRiser', input: { circuitId: owner.id, branchIds: rootIds } }) })
    }
  }
  return actions
}
