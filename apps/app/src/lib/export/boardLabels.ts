import type { TFunction } from 'i18next'
import type { Panel } from '@/types/schema'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findParentPanel, getPanelSymbolLabel } from '@/lib/panel/panelDiagramLabels'
import { resolveEffectiveEarthingSystem } from '@/lib/panel/panelEarthingSync'
import { walkPanels } from '@/lib/panel/panelTree'
import { orderPanelsByNumber } from '@/lib/panel/panelNumberOrder'
import { isBoardPanel } from '@/lib/supplyTaps/virtualPanel'
import { getPanelDisplayName } from '@/utils/panelNames'
import { getVoltageSummaryLabel } from '@/utils/voltageLabel'

/** Identification label for the outside of a cabinet. */
export interface BoardLabel {
  panelId: string
  /** Board number when panel numbering is on (B01), otherwise empty. */
  code: string
  name: string
  /** Feed, supply and location lines, most important first. */
  lines: string[]
}

/** Splits the one-wire symbol label ("B02  Garage") into code and name. */
function panelCodeAndName(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel
): { code: string; name: string } {
  const name = getPanelDisplayName(panel)
  const symbolLabel = getPanelSymbolLabel(project, panel, true)
  const code =
    symbolLabel !== name && symbolLabel.endsWith(name)
      ? symbolLabel.slice(0, symbolLabel.length - name.length).trim()
      : ''
  return { code, name }
}

function findFeederLabel(panels: readonly Panel[], panelId: string): string {
  for (const panel of walkPanels(panels)) {
    const feeder = panel.protections?.find((protection) => protection.subPanelId === panelId)
    if (feeder) return feeder.label?.trim() ?? ''
  }
  return ''
}

export function buildBoardLabels(
  project: ProjectWithOptionalV2Electrical,
  panelIds: readonly string[],
  t: TFunction
): BoardLabel[] {
  const installation = getProjectElectricalInstallation(project)
  const rootPanels = getProjectElectricalPanels(project)
  const selected = new Set(panelIds)
  const labels: BoardLabel[] = []
  for (const panel of orderPanelsByNumber(rootPanels, installation).filter(isBoardPanel)) {
    if (!selected.has(panel.id)) continue
    const { code, name } = panelCodeAndName(project, panel)
    const lines: string[] = []

    const parent = findParentPanel(rootPanels, panel.id)
    if (parent) {
      const parentLabel = panelCodeAndName(project, parent)
      const source = parentLabel.code || parentLabel.name
      const circuit = findFeederLabel(rootPanels, panel.id)
      lines.push(
        circuit
          ? t('labelStripExport.boardFedFromCircuit', {
              source,
              circuit,
              defaultValue: `Fed from ${source}, circuit ${circuit}`,
            })
          : t('panels.diagramFedFrom', { source, defaultValue: `Fed from ${source}` })
      )
    }

    if (installation) {
      const earthing = resolveEffectiveEarthingSystem(panel, rootPanels)
      lines.push(
        [
          getVoltageSummaryLabel(installation.nominalVoltage),
          earthing ? t(`panels.earthingSystem.${earthing}`, earthing) : '',
        ]
          .filter(Boolean)
          .join(' · ')
      )
    }

    // AREI 3.1.2.2.b: the board marking states its expected maximum short-circuit current.
    if (panel.expectedShortCircuitKa != null && panel.expectedShortCircuitKa > 0) {
      const ka = String(Math.round(panel.expectedShortCircuitKa * 100) / 100)
      lines.push(t('panels.diagramShortCircuit', { ka, defaultValue: `Ik max: ${ka} kA` }))
    }
    if (panel.location?.trim()) lines.push(panel.location.trim())
    labels.push({ panelId: panel.id, code, name, lines })
  }
  return labels
}
