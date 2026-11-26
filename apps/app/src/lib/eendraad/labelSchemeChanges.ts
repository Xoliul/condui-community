import { produce } from 'immer'
import type { LabelScheme, Panel } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { forEachCircuitOnPanel } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { applyAutomaticEendraadNamingAllPanelsInProject } from '@/lib/eendraad/projectElectricalDomain'
import { labelSchemeForStorage } from '@/lib/eendraad/labelScheme'
import {
  collectTerminalStripOccurrences,
  formatTerminalNumber,
  getProjectTerminalNumberFormat,
} from '@/lib/terminalStrip/labels'
import {
  getEditableProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

/**
 * Labels a user reads as separate: circuit codes, branch labels and domotica output rows. A
 * protection repeats its circuit's code and symbols repeat their branch label, so those are skipped.
 */
function collectLabels(panels: readonly Panel[], into = new Map<string, string>()): Map<string, string> {
  for (const panel of panels) {
    forEachCircuitOnPanel(panel, (circuit) => {
      into.set(`c:${circuit.id}`, circuit.code ?? '')
      for (const branch of circuit.branches ?? []) into.set(`b:${circuit.id}:${branch.id}`, branch.label ?? '')
      for (const endpoint of circuit.endpoints) {
        if (endpoint.domoticaChildProps) into.set(`e:${endpoint.id}`, endpoint.label ?? '')
      }
    })
    collectLabels(panel.subPanels ?? [], into)
  }
  return into
}

/** Terminal strip numbers as drawn, one per terminal (in and out of a through terminal are one). */
function collectTerminalLabels(project: ProjectV2, into: Map<string, string>): Map<string, string> {
  const format = getProjectTerminalNumberFormat(project)
  for (const occurrence of collectTerminalStripOccurrences(project)) {
    if (occurrence.side === 'incoming') {
      into.set(`t:${occurrence.entityId}`, formatTerminalNumber(occurrence.stripId, occurrence.pin, format))
    }
  }
  return into
}

/**
 * How many labels (circuits, branches, domotica outputs) automatic naming would
 * rewrite, plus terminal numbers shown differently, if the project switched to `scheme` and `panelNumberingEnabled`.
 */
export function countLabelChangesForScheme(
  project: ProjectV2,
  scheme: LabelScheme,
  panelNumberingEnabled: boolean
): number {
  const before = collectTerminalLabels(project, collectLabels(getProjectElectricalPanels(project)))
  const after = produce(project, (draft) => {
    const installation = getEditableProjectElectricalInstallation(draft)
    if (!installation?.eendraadAutomaticNaming) return
    installation.labelScheme = labelSchemeForStorage(scheme)
    installation.panelNumberingEnabled = panelNumberingEnabled
    applyAutomaticEendraadNamingAllPanelsInProject(draft)
  })
  if (after === project) return 0
  let changed = 0
  const afterLabels = collectTerminalLabels(after, collectLabels(getProjectElectricalPanels(after)))
  for (const [key, label] of afterLabels) {
    if (before.get(key) !== label) changed += 1
  }
  return changed
}
