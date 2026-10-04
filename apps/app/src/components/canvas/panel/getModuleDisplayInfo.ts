import { polesConfigToDisplay } from '@/constants/poleConfig'
import type {
  Circuit,
  Endpoint,
  Installation,
  Panel,
  PanelGridModuleRef,
  ProtectionDevice,
} from '@/types/schema'
// This module is also used by background validation. Keep its translations on the
// worker-safe i18n instance so importing display metadata never pulls React/browser
// bootstrap code into the validation worker.
import i18n from '@/lib/i18n/domainI18n'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { getSymbolById, RELAY_OVERLAY_PATHS } from '@/lib/symbols'
import {
  getEffectiveCircuitPhaseState,
  getFullInstallationPhaseAssignment,
  getInheritedCircuitPhaseState,
  getPhaseAssignmentLabel,
  phaseAssignmentDiffersFromInstallation,
} from '@/lib/wires/phaseAssignment'
import {
  collectTerminalStripOccurrences,
  getEffectiveTerminalStripOutgoingPin,
  getTerminalStripId,
  getTerminalStripPin,
} from '@/lib/terminalStrip/labels'

function findProtectionRecursive(panels: Panel[], id: string): ProtectionDevice | null {
  for (const p of panels) {
    const pr = p.protections.find((x) => x.id === id)
    if (pr) return pr
    const inSub = findProtectionRecursive(p.subPanels ?? [], id)
    if (inSub) return inSub
  }
  return null
}

interface EndpointContext {
  endpoint: Endpoint
  circuit: Circuit
}

function findEndpointContextRecursive(panels: Panel[], id: string): EndpointContext | null {
  for (const p of panels) {
    const circuits = [
      ...(p.circuits ?? []),
      ...(p.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    for (const c of circuits) {
      const ep = c.endpoints.find((e) => e.id === id)
      if (ep) return { endpoint: ep, circuit: c }
    }
    const inSub = findEndpointContextRecursive(p.subPanels ?? [], id)
    if (inSub) return inSub
  }
  return null
}

function findCircuitForTrunkDevice(panels: Panel[], deviceId: string): Circuit | null {
  for (const panel of walkPanels(panels)) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    const circuit = circuits.find((candidate) =>
      candidate.trunkDevices?.some((device) => device.id === deviceId)
    )
    if (circuit) return circuit
  }
  return null
}

function findProtectionForCircuit(panels: Panel[], circuitId: string): ProtectionDevice | null {
  for (const panel of walkPanels(panels)) {
    const protection = (panel.protections ?? []).find((candidate) =>
      candidate.circuits?.some((circuit) => circuit.id === circuitId)
    )
    if (protection) return protection
  }
  return null
}

function isMultiPoleDevice(device: { polesConfig?: string; poles?: number }): boolean {
  return (
    device.polesConfig === '3P' ||
    device.polesConfig === '3P+N' ||
    device.polesConfig === '4P' ||
    (device.poles ?? 0) >= 3
  )
}

type PhaseSystem = Parameters<typeof getPhaseAssignmentLabel>[1]

function getVisiblePhaseLabel(
  assignment: Parameters<typeof getPhaseAssignmentLabel>[0],
  showPhaseLabel: boolean | undefined,
  system: PhaseSystem,
  allowFullInstallation = false
): string | undefined {
  if (
    showPhaseLabel !== true ||
    (!allowFullInstallation && !phaseAssignmentDiffersFromInstallation(assignment, system))
  ) {
    return undefined
  }
  return getPhaseAssignmentLabel(assignment, system)
}

function getCircuitPhaseLabel(
  circuit: Circuit,
  panels: Panel[],
  system: PhaseSystem,
  installation: Installation | undefined,
  allowFullInstallation = false
): string | undefined {
  const inherited = getInheritedCircuitPhaseState(circuit, panels, system, installation)
  const effective = getEffectiveCircuitPhaseState(circuit, panels, system, installation)
  return getVisiblePhaseLabel(
    effective.assignment,
    circuit.showPhaseLabel ?? inherited.showPhaseLabel,
    system,
    allowFullInstallation
  )
}

function joinPhaseLabels(labels: Array<string | undefined>): string | undefined {
  const unique = [...new Set(labels.filter((label): label is string => Boolean(label)))]
  return unique.length > 0 ? unique.join(' / ') : undefined
}

function getProtectionModulePhaseLabel(
  protection: ProtectionDevice,
  panels: Panel[],
  system: PhaseSystem,
  installation: Installation | undefined
): string | undefined {
  return joinPhaseLabels(
    (protection.circuits ?? []).map((circuit) =>
      getCircuitPhaseLabel(circuit, panels, system, installation, isMultiPoleDevice(protection))
    )
  )
}

function getDomoticaModulePhaseLabel(
  context: EndpointContext,
  panels: Panel[],
  system: PhaseSystem,
  installation: Installation | undefined
): string | undefined {
  const { circuit, endpoint } = context
  const inherited = getInheritedCircuitPhaseState(circuit, panels, system, installation)
  const effective = getEffectiveCircuitPhaseState(circuit, panels, system, installation)
  const allowFullInstallation = isMultiPoleDevice(
    findProtectionForCircuit(panels, circuit.id) ?? {}
  )
  const labels: Array<string | undefined> = [
    getVisiblePhaseLabel(
      effective.assignment,
      circuit.showPhaseLabel ?? inherited.showPhaseLabel,
      system,
      allowFullInstallation
    ),
  ]

  const outputWires = [
    ...(endpoint.domoticaProps?.controlOutputWires ?? []),
    ...(endpoint.domoticaProps?.endpointOutputWires ?? []),
  ]
  for (const output of outputWires) {
    labels.push(
      getVisiblePhaseLabel(
        inherited.assignment ?? output.phaseAssignment ?? effective.assignment,
        output.showPhaseLabel ?? circuit.showPhaseLabel ?? inherited.showPhaseLabel,
        system,
        allowFullInstallation
      )
    )
  }

  return joinPhaseLabels(labels)
}

function findParentPanel(panels: Panel[], protectionId: string): Panel | null {
  for (const p of panels) {
    if (p.protections.some((pr) => pr.id === protectionId)) return p
    const inSub = findParentPanel(p.subPanels ?? [], protectionId)
    if (inSub) return inSub
  }
  return null
}

function countCircuitEndpoints(pr: ProtectionDevice): number {
  let count = 0
  for (const c of pr.circuits ?? []) {
    count += c.endpoints.length
  }
  return count
}

export interface ModuleDisplayInfo {
  label: string
  specLines: string[]
  /** Relay symbol details rendered in the center band of endpoint modules. */
  relay?: {
    symbolPath: string
    controlOverlayPath: string
    polesLabel: string
  }
  terminalStrip?: {
    stripId: string
    incomingPin: number
    outgoingPin: number
    maxPin: number
    connectedPins: number[]
  }
  /** Optional non-standard phase annotation shown in the module's bottom band. */
  phaseLabel?: string
  tooltipText: string
  kind: 'protection' | 'trunkDevice' | 'domotica'
}

function getLocalizedPanelDeviceName(symbolId: string | undefined): string | null {
  if (!symbolId) return null
  const symbol = getSymbolById(symbolId)
  if (
    symbol?.category !== 'energyConversion' &&
    symbol?.id !== 'rotating_switch' &&
    symbol?.id !== 'source_changeover'
  )
    return null
  return i18n.t(`symbols.${symbol.id}`, { defaultValue: symbol.name })
}

function buildProtectionTooltip(
  pr: ProtectionDevice,
  project: ProjectWithOptionalV2Electrical,
  refId: string
): string {
  const lines: string[] = [pr.label]

  // Full type & specs line
  const specParts: string[] = [pr.type]
  if (pr.curve) specParts.push(pr.curve)
  if (pr.ratingA != null) specParts.push(`${pr.ratingA}A`)
  if (pr.sensitivityMa != null) specParts.push(`IΔn ${pr.sensitivityMa}mA`)
  if (pr.residualCurrentType) specParts.push(`Type ${pr.residualCurrentType}`)
  if (pr.breakingCapacityKa != null) specParts.push(`${pr.breakingCapacityKa}kA`)
  if (pr.polesConfig) specParts.push(polesConfigToDisplay(pr.polesConfig) || pr.polesConfig)
  lines.push(specParts.join(' '))

  // Children
  const circuitCount = pr.circuits?.length ?? 0
  const endpointCount = countCircuitEndpoints(pr)
  if (circuitCount > 0) {
    const parts = [`${circuitCount} circuit${circuitCount !== 1 ? 's' : ''}`]
    if (endpointCount > 0) parts.push(`${endpointCount} endpoint${endpointCount !== 1 ? 's' : ''}`)
    lines.push(parts.join(', '))
  }

  // Sub-panel connection
  const panels = getProjectElectricalPanels(project)
  if (pr.subPanelId) {
    const subPanel = findPanelById(panels, pr.subPanelId)
    if (subPanel) lines.push(`→ ${subPanel.name}`)
  }

  // Parent panel
  const parent = findParentPanel(panels, refId)
  if (parent) lines.push(`Panel: ${parent.name}`)

  if (pr.notes) lines.push(pr.notes)

  return lines.join('\n')
}

export function getModuleDisplayInfo(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null
): ModuleDisplayInfo {
  const empty: ModuleDisplayInfo = { label: '', specLines: [], tooltipText: '', kind: ref.kind }
  if (!project) return empty

  const panels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  const system = installation?.nominalVoltage?.system

  if (ref.kind === 'protection') {
    const pr = findProtectionRecursive(panels, ref.id)
    if (!pr) return { ...empty, label: ref.id }

    const specLines: string[] = []

    switch (pr.type) {
      case 'MCB': {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        if (pr.curve) specLines.push(pr.curve)
        if (pr.breakingCapacityKa != null) specLines.push(`${pr.breakingCapacityKa}kA`)
        break
      }
      case 'RCD': {
        if (pr.sensitivityMa != null) specLines.push(`IΔn ${pr.sensitivityMa}mA`)
        if (pr.residualCurrentType) specLines.push(`Type ${pr.residualCurrentType}`)
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
      case 'RCBO': {
        if (pr.sensitivityMa != null) specLines.push(`IΔn ${pr.sensitivityMa}mA`)
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        if (pr.curve) specLines.push(pr.curve)
        if (pr.breakingCapacityKa != null) specLines.push(`${pr.breakingCapacityKa}kA`)
        break
      }
      case 'FUSE': {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
      case 'MAIN_SWITCH': {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
      case 'SPD': {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        if (pr.breakingCapacityKa != null) specLines.push(`${pr.breakingCapacityKa}kA`)
        break
      }
      case 'ROTATING_SWITCH': {
        break
      }
      default: {
        if (pr.ratingA != null) specLines.push(`${pr.ratingA}A`)
        break
      }
    }

    return {
      // A rotating switch needs a useful module title even without a custom label.
      // Other protection labels retain their existing circuit-driven behaviour.
      label:
        pr.type === 'ROTATING_SWITCH'
          ? pr.label.trim() || getLocalizedPanelDeviceName('rotating_switch') || pr.type
          : pr.label,
      specLines,
      phaseLabel: getProtectionModulePhaseLabel(pr, panels, system, installation),
      tooltipText: buildProtectionTooltip(pr, project, ref.id),
      kind: 'protection',
    }
  }

  if (ref.kind === 'trunkDevice') {
    const d = findTrunkDeviceInProject(project, ref.id)
    if (!d) return { ...empty, label: ref.id }

    const specLines: string[] = []
    const tooltipParts: string[] = []
    const localizedPanelDeviceName = getLocalizedPanelDeviceName(d.symbol)

    if (d.symbol === 'terminal_strip' || d.type === 'terminal_strip') {
      const stripId = getTerminalStripId(d) || '1'
      const pin = getTerminalStripPin(d) ?? 1
      const outgoingPin = getEffectiveTerminalStripOutgoingPin(project, d)
      const connectedPins = [
        ...new Set(
          collectTerminalStripOccurrences(project)
            .filter((occurrence) => occurrence.stripId.toUpperCase() === stripId.toUpperCase())
            .map((occurrence) => occurrence.pin)
        ),
      ].sort((left, right) => left - right)
      const maxPin = Math.max(2, ...connectedPins)
      return {
        label: `X${stripId}`,
        specLines: [],
        terminalStrip: { stripId, incomingPin: pin, outgoingPin, maxPin, connectedPins },
        tooltipText: `X${stripId}-${pin}/${outgoingPin}`,
        kind: 'trunkDevice',
      }
    }

    if (d.type === 'protection' && d.protectionType) {
      switch (d.protectionType) {
        case 'MCB': {
          if (d.ratingA != null) specLines.push(`${d.ratingA}A`)
          if (d.curve) specLines.push(d.curve)
          if (d.breakingCapacityKa != null) specLines.push(`${d.breakingCapacityKa}kA`)
          break
        }
        case 'RCD': {
          if (d.sensitivityMa != null) specLines.push(`IΔn ${d.sensitivityMa}mA`)
          if (d.residualCurrentType) specLines.push(`Type ${d.residualCurrentType}`)
          break
        }
        case 'RCBO': {
          if (d.sensitivityMa != null) specLines.push(`IΔn ${d.sensitivityMa}mA`)
          if (d.ratingA != null) specLines.push(`${d.ratingA}A`)
          if (d.curve) specLines.push(d.curve)
          break
        }
        case 'SPD': {
          if (d.ratingA != null) specLines.push(`${d.ratingA}A`)
          if (d.breakingCapacityKa != null) specLines.push(`${d.breakingCapacityKa}kA`)
          break
        }
        default: {
          if (d.ratingA != null) specLines.push(`${d.ratingA}A`)
          break
        }
      }
      const polesDisplay = d.polesConfig ? polesConfigToDisplay(d.polesConfig) : ''
      const typeLabel =
        localizedPanelDeviceName ??
        i18n.t(`protections.type_${d.protectionType}`, { defaultValue: d.protectionType })
      const specStr = [
        typeLabel,
        d.curve,
        d.ratingA != null ? `${d.ratingA}A` : '',
        d.sensitivityMa != null ? `IΔn ${d.sensitivityMa}mA` : '',
        d.breakingCapacityKa != null ? `${d.breakingCapacityKa}kA` : '',
        polesDisplay,
      ]
        .filter(Boolean)
        .join(' ')
      tooltipParts.push(specStr)
      if (d.label && d.label.trim().length > 0) {
        tooltipParts.unshift(d.label)
      } else {
        tooltipParts.unshift(typeLabel)
      }
    } else {
      const typeName = localizedPanelDeviceName ?? d.type.replace(/_/g, ' ')
      tooltipParts.push(typeName)
      if (d.polesConfig) tooltipParts.push(polesConfigToDisplay(d.polesConfig) || d.polesConfig)
    }

    if (d.notes) tooltipParts.push(d.notes)

    const rotatingSwitchLabel = d.symbol === 'rotating_switch' ? d.label.trim() : ''
    const visibleLabel =
      (rotatingSwitchLabel || localizedPanelDeviceName) ??
      ((d.label && d.label.trim().length > 0
        ? d.label
        : d.type === 'protection' && d.protectionType
          ? i18n.t(`protections.type_${d.protectionType}`, { defaultValue: d.protectionType })
          : d.type.replace(/_/g, ' ')) ||
        '')

    return {
      label: visibleLabel,
      specLines,
      phaseLabel: (() => {
        if (d.symbol === 'source_changeover') {
          return getPhaseAssignmentLabel(getFullInstallationPhaseAssignment(system), system)
        }
        const circuit = findCircuitForTrunkDevice(panels, ref.id)
        return circuit
          ? getCircuitPhaseLabel(circuit, panels, system, installation, isMultiPoleDevice(d))
          : undefined
      })(),
      tooltipText: tooltipParts.join('\n'),
      kind: 'trunkDevice',
    }
  }

  if (ref.kind === 'domotica') {
    const context = findEndpointContextRecursive(panels, ref.endpointId)
    if (!context) return { ...empty, label: ref.endpointId }
    const { endpoint: ep } = context

    if (ep.symbol === 'terminal_strip') {
      const stripId = getTerminalStripId(ep) || '1'
      const pin = getTerminalStripPin(ep) ?? 1
      const connectedPins = [
        ...new Set(
          collectTerminalStripOccurrences(project)
            .filter((occurrence) => occurrence.stripId.toUpperCase() === stripId.toUpperCase())
            .map((occurrence) => occurrence.pin)
        ),
      ].sort((left, right) => left - right)
      return {
        label: `X${stripId}`,
        specLines: [],
        // An endpoint strip has a single connection, so incoming and outgoing coincide.
        terminalStrip: {
          stripId,
          incomingPin: pin,
          outgoingPin: pin,
          maxPin: Math.max(2, ...connectedPins),
          connectedPins,
        },
        tooltipText: `X${stripId}-${pin}`,
        kind: 'domotica',
      }
    }

    const tooltipParts: string[] = [ep.label]
    const localizedPanelDeviceName = getLocalizedPanelDeviceName(ep.symbol)
    const typeName = localizedPanelDeviceName ?? ep.type.replace(/_/g, ' ')
    const relaySymbol = ep.symbol === 'relay' ? getSymbolById('relay') : null
    const relayControl = ep.relayProps?.control ?? 'standard'
    if (ep.symbol) {
      tooltipParts.push(`${typeName} (${ep.symbol.replace(/_/g, ' ')})`)
    } else {
      tooltipParts.push(typeName)
    }
    if (ep.notes) tooltipParts.push(ep.notes)

    return {
      label: ep.label.trim() || localizedPanelDeviceName || ep.label,
      specLines: [],
      relay: relaySymbol?.svgPath
        ? {
            symbolPath: relaySymbol.svgPath,
            controlOverlayPath: RELAY_OVERLAY_PATHS[relayControl],
            polesLabel: `${ep.relayProps?.poles ?? 1}P`,
          }
        : undefined,
      phaseLabel: getDomoticaModulePhaseLabel(context, panels, system, installation),
      tooltipText: tooltipParts.join('\n'),
      kind: 'domotica',
    }
  }

  return empty
}
