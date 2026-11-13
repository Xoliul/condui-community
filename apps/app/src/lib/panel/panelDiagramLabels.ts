import type { TFunction } from 'i18next'
import { installationForPanel } from '@/lib/electrical/feedNominalVoltage'
import { normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import type { EarthingSystemType, Installation, Panel } from '@/types/schema'
import { resolveEffectiveEarthingSystem } from '@/lib/panel/panelEarthingSync'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import { getPanelDisplayName } from '@/utils/panelNames'
import { buildPanelCodesById, resolveLabelScheme } from '@/lib/eendraad/labelScheme'

type PanelDiagramProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building & {
  project?: {
    id?: string
    name?: string
    locale?: string
  }
}

export const EARTHING_SYSTEM_VALUES = ['TT', 'TN-S', 'TN-C', 'TN-C-S', 'IT'] as const

export const DEFAULT_GRID_FREQUENCY_HZ = 50

/** Matches Konva header line spacing in PanelFrame. */
export const PANEL_DIAGRAM_HEADER_LINE_HEIGHT = 18

/** Vertical offset from frame top to first header line (PanelFrame titleY). */
export const PANEL_FRAME_HEADER_TOP_INSET = 10

/** Gap between last header line and schematic content (minY). */
export const PANEL_FRAME_HEADER_BOTTOM_CLEARANCE = 24

/** Base top inset in bottomUpLayout for a short single-line title. */
export const PANEL_FRAME_TITLE_PADDING_BASE = 28

/** Depth-first panel order: mains at each level, then nested sub-panels. */
export function orderPanelsForNumbering(panels: Panel[]): Panel[] {
  const result: Panel[] = []
  const visit = (list: Panel[]) => {
    for (const panel of list) {
      result.push(panel)
      visit(panel.subPanels ?? [])
    }
  }
  visit(panels)
  return result
}


export function findParentPanel(panels: Panel[], childId: string): Panel | null {
  for (const panel of panels) {
    if ((panel.subPanels ?? []).some((sub) => sub.id === childId)) return panel
    const nested = findParentPanel(panel.subPanels ?? [], childId)
    if (nested) return nested
  }
  return null
}

/** Panel codes (B01, B02 … or per the installation's label scheme) by panel id. */
export function buildPanelCodeById(
  panels: Panel[],
  installation: Pick<Installation, 'labelScheme'> | undefined
): Map<string, string> {
  const codes = buildPanelCodesById(panels, resolveLabelScheme(installation?.labelScheme))
  return new Map([...codes].map(([id, code]) => [id, code.code]))
}

function formatNetVoltagePart(installation: Installation): string {
  const nv = installation.nominalVoltage
  const system = normalizeNominalVoltageSystem(nv.system)
  const uLn = Math.round(nv.uLineToNeutral)
  const uLl = Math.round(nv.uLineToLine)
  if (system === '3N~' || system === '1N~') {
    return `${system} ${uLl}/${uLn} V`
  }
  if (system === '3~' || system === '2~') {
    return `${system} ${uLl} V`
  }
  if (system === 'DC') {
    return `DC ${uLl} V`
  }
  return `${system} ${uLl} V`
}

function formatEarthingLabel(earthing: EarthingSystemType, t: TFunction): string {
  return t(`panels.earthingSystem.${earthing}`, earthing)
}

export type PanelDiagramHeaderLine = {
  text: string
  variant: 'title' | 'body' | 'muted'
}

type PanelDiagramHeaderOptions = {
  advancedLabelsEnabled: boolean
  parentPanel?: Panel | null
  panelCodeById?: Map<string, string>
  /** Detached supply frames never carry a panel sequence number. */
  suppressNumbering?: boolean
  /** A backup label is meaningful only while a backup feed is connected. */
  backupFeedActive?: boolean
}

export function isPanelNumberingActive(
  installation: Installation,
  advancedLabelsEnabled: boolean
): boolean {
  return advancedLabelsEnabled && !!installation.panelNumberingEnabled
}

export function isPanelNetLabelsActive(
  installation: Installation,
  advancedLabelsEnabled: boolean
): boolean {
  return advancedLabelsEnabled && installationShowsNetTypeLabels(installation)
}

/** Net-type header lines are a non-domestic option; domestic projects never show them. */
export function installationShowsNetTypeLabels(
  installation: Pick<Installation, 'panelNetTypeLabelsEnabled' | 'installationProfile'>
): boolean {
  return !!installation.panelNetTypeLabelsEnabled && !isHouseholdInstallation(installation)
}

/** Extra top padding for the panel frame from multi-line diagram headers. */
export function getPanelFrameTitlePadding(
  panel: Panel,
  installation: Installation,
  rootPanels: Panel[],
  options: { frameRole?: 'panel' | 'supply'; backupFeedActive?: boolean } = {}
): number {
  const project: PanelDiagramProject = {
    disciplines: {
      electrical: { installation, panels: rootPanels, devices: [], oneWire: {} },
    },
    project: { locale: 'nl-BE' },
  }
  const translate = ((key, opts) => {
    if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
      return String((opts as { defaultValue?: string }).defaultValue ?? key)
    }
    return key
  }) as TFunction
  const lineCount =
    options.frameRole === 'supply'
      ? buildSupplyDiagramHeaderLines(project, panel, translate, {
          advancedLabelsEnabled: true,
          backupFeedActive: options.backupFeedActive,
        }).length
      : buildPanelDiagramHeaderLines(project, panel, translate, {
          advancedLabelsEnabled: true,
          panelCodeById: buildPanelCodeById(rootPanels, installation),
          parentPanel: findParentPanel(rootPanels, panel.id),
          backupFeedActive: options.backupFeedActive,
        }).length
  const netLabelsActive = installationShowsNetTypeLabels(installation)

  const required =
    PANEL_FRAME_HEADER_TOP_INSET +
    lineCount * PANEL_DIAGRAM_HEADER_LINE_HEIGHT +
    PANEL_FRAME_HEADER_BOTTOM_CLEARANCE

  if (!netLabelsActive && lineCount <= 2) {
    return PANEL_FRAME_TITLE_PADDING_BASE
  }
  return Math.max(PANEL_FRAME_TITLE_PADDING_BASE, required)
}

export function buildPanelDiagramHeaderLines(
  project: PanelDiagramProject,
  panel: Panel,
  t: TFunction,
  options: PanelDiagramHeaderOptions
): PanelDiagramHeaderLine[] {
  const displayName = getPanelDisplayName(panel, project)
  const installation = getProjectElectricalInstallation(project)
  if (!installation) {
    return [{ text: displayName, variant: 'title' }]
  }
  const rootPanels = getProjectElectricalPanels(project)
  const numberingActive =
    !options.suppressNumbering && isPanelNumberingActive(installation, options.advancedLabelsEnabled)
  const netLabelsActive = isPanelNetLabelsActive(installation, options.advancedLabelsEnabled)

  const panelCodeById = options.panelCodeById ?? buildPanelCodeById(rootPanels, installation)
  const panelCode = numberingActive ? panelCodeById.get(panel.id) ?? null : null

  if (!numberingActive && !netLabelsActive) {
    const lines: PanelDiagramHeaderLine[] = [{ text: displayName, variant: 'title' }]
    if (panel.location?.trim()) {
      lines.push({ text: panel.location.trim(), variant: 'muted' })
    }
    return lines
  }

  const lines: PanelDiagramHeaderLine[] = []
  if (panelCode) {
    lines.push({
      text: t('panels.diagramTitleNumbered', {
        code: panelCode,
        name: displayName,
        defaultValue: `${panelCode} – ${displayName}`,
      }),
      variant: 'title',
    })
  } else {
    lines.push({ text: displayName, variant: 'title' })
  }

  if (!netLabelsActive) {
    return lines
  }

  const earthing = resolveEffectiveEarthingSystem(panel, rootPanels)
  const backupEarthing =
    options.backupFeedActive !== false ? panel.backupEarthingSystem : undefined
  if (!earthing && !backupEarthing) {
    return lines
  }

  const parent = options.parentPanel ?? findParentPanel(rootPanels, panel.id)
  const isSubPanel = parent != null

  if (isSubPanel && parent) {
    const parentCode =
      (numberingActive ? panelCodeById.get(parent.id) : undefined) ??
      getPanelDisplayName(parent, project)
    lines.push({
      text: t('panels.diagramFedFrom', {
        source: parentCode,
        defaultValue: `Fed from ${parentCode}`,
      }),
      variant: 'body',
    })
  }

  const netBase = formatNetVoltagePart(installationForPanel(installation, rootPanels, panel.id))
  if (isSubPanel && earthing) {
    lines.push({
      text: t('panels.diagramNetSecondary', {
        net: netBase,
        frequency: DEFAULT_GRID_FREQUENCY_HZ,
        earthing: formatEarthingLabel(earthing, t),
        defaultValue: `Net: ${netBase} – ${DEFAULT_GRID_FREQUENCY_HZ} Hz – ${earthing}`,
      }),
      variant: 'body',
    })
  } else {
    lines.push({
      text: t('panels.diagramNetMain', {
        net: netBase,
        frequency: DEFAULT_GRID_FREQUENCY_HZ,
        defaultValue: `Net: ${netBase} – ${DEFAULT_GRID_FREQUENCY_HZ} Hz`,
      }),
      variant: 'body',
    })
  }

  if (earthing && !isSubPanel) {
    lines.push({
      text: t(backupEarthing ? 'panels.diagramEarthingSystemGrid' : 'panels.diagramEarthingSystem', {
        earthing: formatEarthingLabel(earthing, t),
        defaultValue: backupEarthing
          ? `Earthing system (grid): ${earthing}`
          : `Earthing system: ${earthing}`,
      }),
      variant: 'body',
    })
  }
  if (backupEarthing) {
    lines.push({
      text: t('panels.diagramEarthingSystemBackup', {
        earthing: formatEarthingLabel(backupEarthing, t),
        defaultValue: `Earthing system (backup): ${backupEarthing}`,
      }),
      variant: 'body',
    })
  }
  if (panel.expectedShortCircuitKa != null && panel.expectedShortCircuitKa > 0) {
    const ka = formatShortCircuitKa(panel.expectedShortCircuitKa)
    lines.push({
      text: t('panels.diagramShortCircuit', {
        ka,
        defaultValue: `Ik max: ${ka} kA`,
      }),
      variant: 'body',
    })
  }

  return lines
}

function formatShortCircuitKa(ka: number): string {
  return String(Math.round(ka * 100) / 100)
}

/** Header for a detached supply-assembly frame: network labels, never panel numbering. */
export function buildSupplyDiagramHeaderLines(
  project: PanelDiagramProject,
  panel: Panel,
  t: TFunction,
  options: Pick<PanelDiagramHeaderOptions, 'advancedLabelsEnabled' | 'backupFeedActive'>
): PanelDiagramHeaderLine[] {
  const installation = getProjectElectricalInstallation(project)
  const lines: PanelDiagramHeaderLine[] = [
    { text: t('canvas.supplyFrame.title', 'Supply'), variant: 'title' },
  ]
  if (!installation || !isPanelNetLabelsActive(installation, options.advancedLabelsEnabled)) {
    return lines
  }

  const primaryEarthing = resolveEffectiveEarthingSystem(
    panel,
    getProjectElectricalPanels(project)
  )
  const backupEarthing =
    options.backupFeedActive !== false ? panel.backupEarthingSystem : undefined
  if (!primaryEarthing && !backupEarthing) return lines

  const netBase = formatNetVoltagePart(
    installationForPanel(installation, getProjectElectricalPanels(project), panel.id)
  )
  lines.push({
    text: t('panels.diagramNetMain', {
      net: netBase,
      frequency: DEFAULT_GRID_FREQUENCY_HZ,
      defaultValue: `Net: ${netBase} – ${DEFAULT_GRID_FREQUENCY_HZ} Hz`,
    }),
    variant: 'body',
  })
  if (primaryEarthing) {
    lines.push({
      text: t(backupEarthing ? 'panels.diagramEarthingSystemGrid' : 'panels.diagramEarthingSystem', {
        earthing: formatEarthingLabel(primaryEarthing, t),
        defaultValue: backupEarthing
          ? `Earthing system (grid): ${primaryEarthing}`
          : `Earthing system: ${primaryEarthing}`,
      }),
      variant: 'body',
    })
  }
  if (backupEarthing) {
    lines.push({
      text: t('panels.diagramEarthingSystemBackup', {
        earthing: formatEarthingLabel(backupEarthing, t),
        defaultValue: `Earthing system (backup): ${backupEarthing}`,
      }),
      variant: 'body',
    })
  }
  return lines
}

export function getPanelSymbolLabel(
  project: PanelDiagramProject,
  panel: Panel,
  advancedLabelsEnabled: boolean
): string {
  const displayName = getPanelDisplayName(panel, project)
  const installation = getProjectElectricalInstallation(project)
  if (!installation || !isPanelNumberingActive(installation, advancedLabelsEnabled)) {
    return displayName
  }
  const code = buildPanelCodeById(getProjectElectricalPanels(project), installation).get(panel.id)
  if (code == null) return displayName
  return `${code}  ${displayName}`
}

export function getPanelDiagramTitleLine(
  project: PanelDiagramProject,
  panel: Panel,
  t: TFunction,
  advancedLabelsEnabled: boolean
): string {
  const lines = buildPanelDiagramHeaderLines(project, panel, t, { advancedLabelsEnabled })
  return lines[0]?.text ?? getPanelDisplayName(panel, project)
}
