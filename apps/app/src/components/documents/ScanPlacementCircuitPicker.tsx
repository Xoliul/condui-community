import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { isBoardPanel } from '@/lib/supplyTaps/virtualPanel'
import { projectCommands } from '@/lib/commands/project'
import { endpointTypeToPlanDropKind } from '@/lib/plan/planDropPicker'

/** Existing plan assignment command owns creation, moves and empty scan-circuit cleanup. */
export function ScanPlacementCircuitPicker({ endpointIds, circuitId, scanId, disabled, onAssigned }: {
  endpointIds: string[]; circuitId?: string; scanId?: string; disabled?: boolean; onAssigned?: () => void
}) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.currentProject)
  const [failed, setFailed] = useState(false)
  if (!project) return null
  const panels = [...walkPanels(getProjectElectricalPanels(project))]
  const owners = panels.flatMap((panel) => collectCircuits(panel).map((circuit) => ({ panel, circuit })))
  const selected = owners.flatMap(({ circuit }) => circuit.endpoints).filter((endpoint) => endpointIds.includes(endpoint.id))
  const kinds = new Set(selected.map((endpoint) => endpointTypeToPlanDropKind(endpoint.type)))
  const kind = kinds.size === 1 ? [...kinds][0]! : 'other'
  const provisionalCircuitIds = owners.filter(({ circuit }) => !!scanId && circuit.scanReview?.scanId === scanId && selected.some((endpoint) => circuit.endpoints.some((entry) => entry.id === endpoint.id))).map(({ circuit }) => circuit.id)
  const existing = owners.filter(({ circuit }) => {
    if (circuit.code === 'PANEL' || !endpointIds.length) return false
    const parsed = projectCommands.parseOne({ id: 'electrical.assignEndpoints', input: { endpointIds, targetCircuitId: circuit.id } })
    return parsed.command.check(project, parsed.input).ok
  })
  return <div className="min-w-0">
    <select aria-label={t('nativeRoomScan.assignCircuit')} disabled={disabled || !endpointIds.length}
      value={circuitId ? `circuit:${circuitId}` : ''}
      className="min-h-11 w-full min-w-0 max-w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
      onChange={(event) => {
        const value = event.target.value
        const owner = owners.find(({ circuit }) => `circuit:${circuit.id}` === value)
        const panelId = owner?.panel.id ?? (value.startsWith('new:') ? value.slice(4) : undefined)
        if (!panelId) return
        const result = runProjectCommand('plan.assignCircuit', {
          panelId, endpointIds, provisionalCircuitIds,
          circuit: owner ? { mode: 'existing', circuitId: owner.circuit.id } : { mode: 'new', kind },
        }, { label: 'nativeRoomScan.assignCircuit', source: 'scan-placements' })
        setFailed(!result)
        if (result) onAssigned?.()
      }}>
      <option value="" disabled>{t('nativeRoomScan.assignCircuit')}</option>
      {existing.map(({ panel, circuit }) => <option key={circuit.id} value={`circuit:${circuit.id}`}>
        {panel.name} · {circuit.code}{circuit.notes ? ` — ${circuit.notes.split(' · ')[0]}` : ''}
      </option>)}
      {panels.filter(isBoardPanel).map((panel) => <option key={`new:${panel.id}`} value={`new:${panel.id}`}>+ {t('nativeRoomScan.newCircuit')} · {panel.name}</option>)}
    </select>
    {failed && <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{t('nativeRoomScan.assignmentFailed')}</p>}
  </div>
}
