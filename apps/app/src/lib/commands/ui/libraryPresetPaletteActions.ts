import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { DOMOTICA_HORIZONTAL_PRESET_ID } from '@/lib/library/libraryPresets'
import { projectCommands, type CommandInvocation } from '../project'
import type { ProjectPaletteAction } from './projectPaletteActions'

function accepts(project: ProjectV2, invocation: CommandInvocation): boolean {
  try {
    const { command, input } = projectCommands.parseOne(invocation)
    return command.check(project, input).ok
  } catch {
    return false
  }
}

/**
 * Library presets that create something on the one-wire canvas (Ctrl/Cmd+K). The palette has no
 * symbol browser: each preset is one action that appends it to a circuit, offering only the
 * circuits where the placement command accepts it (never the supply side, never after a
 * horizontal domotica module).
 */
export function getLibraryPresetPaletteActions(
  project: ProjectV2,
  selection: Selection
): ProjectPaletteAction[] {
  const invocation = (circuitId: string): CommandInvocation => ({
    id: 'electrical.placeSymbol',
    input: {
      symbolId: DOMOTICA_HORIZONTAL_PRESET_ID,
      destination: { kind: 'circuit', circuitId },
    },
  })
  const options = [...walkPanels(getProjectElectricalPanels(project))]
    .flatMap((panel) => collectCircuits(panel).map((circuit) => ({ panel, circuit })))
    .filter(({ circuit }) => accepts(project, invocation(circuit.id)))
    .map(({ panel, circuit }) => ({
      value: circuit.id,
      label: `${panel.name} · ${circuit.code}${circuit.notes ? ` — ${circuit.notes}` : ''}`,
    }))
  if (!options.length) return []
  const selected = selection.type === 'circuit' ? selection.ids[0] : undefined
  return [
    {
      id: 'electrical.addDomoticaHorizontal',
      labelKey: 'commandPalette.addDomoticaHorizontal',
      fields: [
        {
          name: 'circuit',
          labelKey: 'commandPalette.fields.circuit',
          value: options.find((option) => option.value === selected)?.value ?? options[0]!.value,
          options,
        },
      ],
      invocation: (values) => invocation(values.circuit ?? ''),
    },
  ]
}
