import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { resolveOneWireBranchTopology } from '@/lib/eendraad/oneWireBranchTopology'
import { hasOneWireForks, canEditOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import type { Issue, ValidationProject } from './core/types'

export function collectOneWireForkIssues(project: ValidationProject, t: (key: string) => string): Issue[] {
  const result: Issue[] = []
  for (const circuit of [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits)) {
    if (!hasOneWireForks(circuit)) continue
    const topology = resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches ?? [] })
    if (topology.valid && canEditOneWireForks(circuit)) continue
    result.push({ id: `onewire.fork:${circuit.id}`, ruleId: 'onewire.fork', severity: 'error', jurisdiction: '', rulesetVersion: '',
      scope: { type: 'circuit', id: circuit.id }, offenders: [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
      message: t('oneWireFork.invalidConnection'), citations: [], tags: ['topology'],
    })
  }
  return result
}
