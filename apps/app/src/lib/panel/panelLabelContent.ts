import type {
  Circuit,
  Endpoint,
  Panel,
  PanelGridModuleRef,
  PanelLabelCellSource,
  PanelLabelConfig,
  ProtectionDevice,
} from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findTrunkDeviceInProject } from '@/utils/project'
import { getProtectionOneWireLabelLines } from '@/lib/protectionLabels'
import { getProtectionFeeds } from '@/lib/panel/panelLabelFeeds'

export type PanelLabelCellSide = 'top' | 'bottom'

export interface PanelLabelValues {
  label: string
  notes: string
  labelNotes: string
  technical: string
  technicalParts?: Array<{ text: string; framed?: boolean }>
  /** Downstream circuits, one per line; empty when the module feeds a single circuit. */
  feeds: string
  /** The same circuits as ranges, used next to the label. */
  feedsCompact: string
  config?: PanelLabelConfig
}

export interface PanelLabelDisplayInput {
  label: string
  specLines: string[]
  technical?: string
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function findProtection(panels: Panel[], id: string): ProtectionDevice | undefined {
  for (const panel of panels) {
    const protection = panel.protections.find((candidate) => candidate.id === id)
    if (protection) return protection
    const nested = findProtection(panel.subPanels ?? [], id)
    if (nested) return nested
  }
  return undefined
}

function findEndpoint(
  panels: Panel[],
  id: string
): { endpoint: Endpoint; circuit: Circuit } | undefined {
  for (const panel of panels) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      const endpoint = circuit.endpoints.find((candidate) => candidate.id === id)
      if (endpoint) return { endpoint, circuit }
    }
    const nested = findEndpoint(panel.subPanels ?? [], id)
    if (nested) return nested
  }
  return undefined
}

function technicalText(parts: Array<string | undefined>, display: PanelLabelDisplayInput): string {
  if (display.technical) return cleanText(display.technical)
  const values = parts.map(cleanText).filter(Boolean)
  const specs = display.specLines.map(cleanText).filter(Boolean)
  return [...values, ...specs].join(' · ')
}

/** Resolve editable label fields for a module without materializing legacy aliases. */
export function getPanelLabelValues(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical,
  display: PanelLabelDisplayInput
): PanelLabelValues {
  const fallback = {
    label: cleanText(display.label),
    notes: '',
    labelNotes: '',
    technical: technicalText([ref.kind], display),
    feeds: '',
    feedsCompact: '',
  }
  const panels = getProjectElectricalPanels(project)

  if (ref.kind === 'protection') {
    const protection = findProtection(panels, ref.id)
    if (!protection) return fallback
    const technicalParts = getProtectionOneWireLabelLines(protection, {
      splitResidualLine: true,
    }).map((line) => ({
      text: line.text,
      framed: line.frame,
    }))
    const feeds = getProtectionFeeds(protection, project)
    return {
      label: cleanText(protection.label) || cleanText(display.label),
      // Protection properties edit the first circuit's notes when a circuit exists.
      // Resolve the same canonical field here so panel labels and exports agree.
      notes: cleanText(protection.circuits?.[0]?.notes) || cleanText(protection.notes),
      labelNotes: cleanText(protection.labelNotes),
      technical: technicalParts.map((part) => part.text).join('\n'),
      technicalParts,
      feeds: feeds?.list ?? '',
      feedsCompact: feeds?.compact ?? '',
      config: protection.panelLabel,
    }
  }

  if (ref.kind === 'domotica') {
    const found = findEndpoint(panels, ref.endpointId)
    if (!found) return fallback
    return {
      label: cleanText(found.endpoint.label) || cleanText(display.label),
      notes: cleanText(found.endpoint.notes),
      labelNotes: cleanText(found.endpoint.labelNotes),
      technical: technicalText([found.endpoint.type, found.endpoint.symbol], display),
      feeds: '',
      feedsCompact: '',
      config: found.endpoint.panelLabel,
    }
  }

  const device = findTrunkDeviceInProject(project, ref.id)
  if (!device) return fallback
  const technicalParts = device.protectionType
    ? getProtectionOneWireLabelLines(device, { splitResidualLine: true }).map((line) => ({
        text: line.text,
        framed: line.frame,
      }))
    : undefined
  return {
    label: cleanText(device.label) || cleanText(display.label),
    notes: cleanText(device.notes),
    labelNotes: cleanText(device.labelNotes),
    technical:
      technicalParts?.map((part) => part.text).join('\n') ??
      technicalText([device.type, device.symbol], display),
    technicalParts,
    feeds: '',
    feedsCompact: '',
    config: device.panelLabel,
  }
}

export function defaultPanelLabelSource(
  side: PanelLabelCellSide,
  _values?: PanelLabelValues
): PanelLabelCellSource {
  return side === 'top' ? 'labelNotes' : 'label'
}

/** Only the label text decides a default; the other values never change which cells print what. */
export type PanelLabelDefaultValues = Pick<PanelLabelValues, 'labelNotes'>

/**
 * A filled label text prints in the top cell and keeps the (often long) notes off the cabinet
 * label; without one the bottom cell keeps showing the notes beside the code.
 */
export function defaultPanelLabelSources(
  side: PanelLabelCellSide,
  values?: PanelLabelDefaultValues
): PanelLabelCellSource[] {
  if (side === 'top') return ['labelNotes']
  return values?.labelNotes ? ['label'] : ['label', 'notes']
}

export function getPanelLabelSources(
  config: PanelLabelConfig | undefined,
  side: PanelLabelCellSide,
  values?: PanelLabelDefaultValues
): PanelLabelCellSource[] {
  const cell = config?.[side]
  if (cell?.sources?.length) return [...new Set(cell.sources)]
  if (cell?.source) return [cell.source]
  return defaultPanelLabelSources(side, values)
}

export function getPanelLabelSource(
  config: PanelLabelConfig | undefined,
  side: PanelLabelCellSide,
  values: PanelLabelValues
): PanelLabelCellSource {
  return config?.[side]?.source ?? defaultPanelLabelSource(side, values)
}

/** Text a source contributes to a cell; downstream circuits shrink to ranges beside the label. */
export function getPanelLabelSourceText(
  source: PanelLabelCellSource,
  sources: readonly PanelLabelCellSource[],
  values: PanelLabelValues
): string {
  if (source === 'feeds' && sources.includes('label')) return values.feedsCompact
  return values[source]
}

export function getPanelLabelText(
  config: PanelLabelConfig | undefined,
  side: PanelLabelCellSide,
  values: PanelLabelValues
): string {
  const sources = getPanelLabelSources(config, side, values)
  return sources
    .map((source) => getPanelLabelSourceText(source, sources, values))
    .filter(Boolean)
    .join('\n')
}

export function setPanelLabelSource(
  config: PanelLabelConfig | undefined,
  side: PanelLabelCellSide,
  source: PanelLabelCellSource
): PanelLabelConfig {
  return {
    ...config,
    [side]: { ...config?.[side], source, sources: [source] },
  }
}

export function setPanelLabelSources(
  config: PanelLabelConfig | undefined,
  side: PanelLabelCellSide,
  sources: PanelLabelCellSource[],
  values?: PanelLabelDefaultValues
): PanelLabelConfig {
  const uniqueSources = [...new Set(sources)]
  const fallback = defaultPanelLabelSources(side, values)
  const normalized = uniqueSources.length > 0 ? uniqueSources : fallback
  return {
    ...config,
    [side]: {
      ...config?.[side],
      source: normalized[0]!,
      sources: normalized,
    },
  }
}

export function setPanelLabelAlignment(
  config: PanelLabelConfig | undefined,
  side: PanelLabelCellSide,
  alignment: NonNullable<PanelLabelConfig[PanelLabelCellSide]>['alignment'],
  values?: PanelLabelDefaultValues
): PanelLabelConfig {
  const sources = getPanelLabelSources(config, side, values)
  return {
    ...config,
    [side]: {
      source: config?.[side]?.source ?? sources[0]!,
      sources: config?.[side]?.sources ?? sources,
      alignment,
    },
  }
}

export function swapPanelLabelSources(
  config: PanelLabelConfig | undefined,
  values?: PanelLabelDefaultValues
): PanelLabelConfig {
  const topSources = getPanelLabelSources(config, 'top', values)
  const bottomSources = getPanelLabelSources(config, 'bottom', values)
  return {
    ...config,
    top: { ...config?.bottom, source: bottomSources[0]!, sources: bottomSources },
    bottom: { ...config?.top, source: topSources[0]!, sources: topSources },
  }
}
