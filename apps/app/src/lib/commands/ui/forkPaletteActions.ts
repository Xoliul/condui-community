import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'
import type { ProjectPaletteAction } from './projectPaletteActions'
import { electricalCreateFork } from '../project/commands/electricalFork'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { canForkAfterEndpoint, oneWireForksEnabled } from '@/lib/eendraad/oneWireForkProject'

export function getForkPaletteActions(project: ProjectV2, selection: Selection): ProjectPaletteAction[] {
  if (!oneWireForksEnabled() || selection.type !== 'endpoint' || selection.ids.length !== 1) return []
  const afterEndpointId = selection.ids[0]!
  if (!electricalCreateFork.check(project, { afterEndpointId }).ok) return []
  const circuit = [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits)
    .find((item) => item.endpoints.some((endpoint) => endpoint.id === afterEndpointId))!
  const actions: ProjectPaletteAction[] = canForkAfterEndpoint(circuit, afterEndpointId) ? [{
    id: 'electrical.createFork', labelKey: 'commandPalette.createFork', fields: [],
    invocation: () => ({ id: 'electrical.createFork', input: { afterEndpointId } }) }] : []
  const empty = circuit.branches?.filter((branch) => !branch.endpointIds.length && branch.forkFrom?.afterEndpointId === afterEndpointId) ?? []
  if (empty.length) actions.push({ id: 'electrical.deleteEmptyFork', labelKey: 'commandPalette.deleteEmptyFork',
    fields: [{ name: 'branch', labelKey: 'commandPalette.fields.branch', value: empty[0]!.id,
      options: empty.map((branch, index) => ({ value: branch.id, label: `${branch.label} · ${index + 1}` })) }],
    invocation: (values) => ({ id: 'electrical.deleteEmptyFork', input: { circuitId: circuit.id, branchId: values.branch } }),
  })
  return actions
}
