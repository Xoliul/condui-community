import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { resolveOneWireBranchTopology } from '@/lib/eendraad/oneWireBranchTopology'
import { hasOneWireForks, canEditOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { canEditOneWireRisers, hasOneWireRisers } from '@/lib/eendraad/oneWireRisers'
import type { Issue, ValidationProject } from './core/types'

export function collectOneWireForkIssues(project: ValidationProject, t: (key: string) => string): Issue[] {
  const result: Issue[] = []
  for (const circuit of [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits)) {
    if (!hasOneWireForks(circuit)) continue
    const topology = resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches ?? [] })
    if (topology.valid && canEditOneWireForks(circuit)) continue
    const riserOnly = topology.valid && hasOneWireRisers(circuit) && !canEditOneWireRisers(circuit)
    result.push({ id: `onewire.fork:${circuit.id}`, ruleId: riserOnly ? 'onewire.riser' : 'onewire.fork', severity: 'error', jurisdiction: '', rulesetVersion: '',
      scope: { type: 'circuit', id: circuit.id }, offenders: [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
      message: t(riserOnly ? 'oneWireFork.invalidRiser' : 'oneWireFork.invalidConnection'), citations: [], tags: ['topology'],
    })
  }
  return result
}
