import type { Circuit, Installation, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import {
  applyAutomaticEndpointBranchLabelsToPanel,
  endpointBranchLabelsWouldChange,
  forEachCircuitOnPanel,
} from '@/lib/eendraad/automaticEndpointBranchNaming'
import { getPanelSupplyTrunkDevices } from '@/lib/feedTopology'
import { excelColumnLabelFromZeroBasedIndex } from '@/utils/project'
import { installationHideFeederLetters } from '@/lib/eendraad/eendraadNamingInstall'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { renameCircuitCodeKeepingEndpoints } from '@/lib/eendraad/circuitEndpointLabels'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

const MAX_MANUAL_EXCEL_LABEL_ATTEMPTS = 2000

/** Row has no endpoint symbols at all; panel_distribution endpoints are label-worthy panel loads. */
export function circuitIsFeederRow(circuit: Circuit): boolean {
  return circuit.endpoints.length === 0
}

/** Protection or circuit row feeds a linked sub-panel (not a “hide letter” feeder parent). */
export function rowFeedsLinkedSubPanel(
  circuit: Circuit,
  protection?: ProtectionDevice | null,
): boolean {
  if (protection?.subPanelId) return true
  return circuit.endpoints.some(
    (endpoint) => endpoint.symbol === 'panel_distribution' && !!endpoint.panelId,
  )
}

/**
 * True when this circuit only feeds nested sub-circuits (no own consumers) and lists at least one.
 * Rows that feed a sub-panel are excluded — they need a visible/manual label on secondary buses too.
 */
export function circuitIsFeederParentWithSubCircuits(
  circuit: Circuit,
  options?: { protection?: ProtectionDevice | null },
): boolean {
  if ((circuit.subCircuitIds?.length ?? 0) === 0) return false
  if (!circuitIsFeederRow(circuit)) return false
  if (rowFeedsLinkedSubPanel(circuit, options?.protection)) return false
  return true
}

/** Feeder-only parents when hide-feeder option is on: no auto letter, manual label in properties. */
export function circuitExcludedFromEendraadAutoNamingLock(
  circuit: Circuit | null | undefined,
  hideFeederLetters: boolean,
  protection?: ProtectionDevice | null,
): boolean {
  if (!circuit) return false
  if (circuit.eendraadManualCodeLock) return true
  if (protectionOmittedFromAutomaticNamingLetter(protection, circuit)) return true
  if (!hideFeederLetters) return false
  return circuitIsFeederParentWithSubCircuits(circuit, { protection })
}

/**
 * Rotating switches are diagram-only on the bus: they do not consume A/B/C slots unless they
 * feed a linked sub-panel (same exception as panel-feeder rows). RCD/RCBO grouping rows keep
 * the existing hide-feeder-parent behaviour via {@link circuitIsFeederParentWithSubCircuits}.
 */
export function protectionOmittedFromAutomaticNamingLetter(
  protection: ProtectionDevice | null | undefined,
  primaryCircuit: Circuit,
): boolean {
  if (primaryCircuit.supplySource?.kind === 'converter-backup') return true
  if (!protection || protection.type !== 'ROTATING_SWITCH') return false
  return !rowFeedsLinkedSubPanel(primaryCircuit, protection)
}

function letterShownOnOneWire(circuit: Circuit): boolean {
  return circuit.eendraadLetterVisible !== false
}

function expectedLetterShownOnOneWire(
  circuit: Circuit,
  hideFeederLetters: boolean,
  protection?: ProtectionDevice,
): boolean {
  if (!hideFeederLetters) return true
  return !circuitIsFeederParentWithSubCircuits(circuit, { protection })
}

function setCircuitsLetterShownOnOneWire(circuits: Circuit[], shown: boolean): void {
  for (const c of circuits) {
    if (shown) {
      delete c.eendraadLetterVisible
    } else {
      c.eendraadLetterVisible = false
    }
  }
}

function renameProtectionLabelAndCircuits(protection: ProtectionDevice, newLabel: string): void {
  const next = newLabel.trim()
  protection.label = next
  for (const circuit of protection.circuits ?? []) {
    renameCircuitCodeKeepingEndpoints(circuit, next)
  }
}

function clearFeederParentNaming(protection: ProtectionDevice, _primary: Circuit): void {
  protection.label = ''
  for (const circuit of protection.circuits ?? []) {
    renameCircuitCodeKeepingEndpoints(circuit, '')
    delete circuit.eendraadLetterVisible
  }
}

function clearDirectFeederParentNaming(circuit: Circuit): void {
  renameCircuitCodeKeepingEndpoints(circuit, '')
  delete circuit.eendraadLetterVisible
}

function circuitHasManualCodeLock(circuit: Circuit | null | undefined): boolean {
  return circuit?.eendraadManualCodeLock === true
}

function protectionHasManualCodeLock(protection: ProtectionDevice | null | undefined): boolean {
  return protection?.circuits?.some(circuitHasManualCodeLock) === true
}

function setLockedProtectionLabelFromPrimary(protection: ProtectionDevice, primary: Circuit): void {
  const lockedCode =
    (protection.circuits?.find(circuitHasManualCodeLock)?.code ?? primary.code ?? '').trim()
  if (lockedCode) protection.label = lockedCode
  setCircuitsLetterShownOnOneWire(protection.circuits ?? [], true)
}

/** Protection on `panel` whose `circuits` includes `circuitId` (single-panel scope). */
function findProtectionOwningCircuit(panel: Panel, circuitId: string): ProtectionDevice | undefined {
  return panel.protections.find((p) => p.circuits?.some((c) => c.id === circuitId))
}

function normalizeProtectionLabelForUniqueness(label: string): string {
  return label.trim().toLocaleLowerCase()
}

/** Automatic circuit names use Excel-style uppercase letters: A..Z, AA, AB, ... */
export function isRegularAutomaticCircuitLabel(label: string): boolean {
  return /^[A-Z]+$/.test(label.trim())
}

export interface ManualCircuitLabelWarnings {
  nonStandard: boolean
  duplicate: boolean
}

export function projectHasManualEendraadLabelOverrides(
  project: ProjectWithOptionalV2Electrical,
): boolean {
  const visit = (panels: Panel[]): boolean => {
    for (const panel of panels) {
      let found = false
      forEachCircuitOnPanel(panel, (circuit) => {
        if (circuit.eendraadManualCodeLock === true) found = true
      })
      if (found || visit(panel.subPanels ?? [])) return true
    }
    return false
  }
  return visit(getProjectElectricalPanels(project))
}

/** Clear every per-row label override and immediately restore automatic naming. */
export function resetAllManualEendraadLabelOverrides(
  project: ProjectWithOptionalV2Electrical,
): boolean {
  let changed = false
  const visit = (panels: Panel[]) => {
    for (const panel of panels) {
      forEachCircuitOnPanel(panel, (circuit) => {
        if (circuit.eendraadManualCodeLock !== true) return
        delete circuit.eendraadManualCodeLock
        changed = true
      })
      visit(panel.subPanels ?? [])
    }
  }
  visit(getProjectElectricalPanels(project))
  if (!changed) return false

  const installation = getProjectElectricalInstallation(project)
  if (!installation?.eendraadAutomaticNaming) return true
  const opts = resolveAutomaticNamingOptsFromInstallation(installation)
  const rename = (panels: Panel[]) => {
    for (const panel of panels) {
      applyAutomaticMainBusNamingToPanel(panel, opts, project)
      rename(panel.subPanels ?? [])
    }
  }
  rename(getProjectElectricalPanels(project))
  return true
}

/**
 * Describe non-blocking warnings for a manually named one-wire row.
 * Duplicate checks use the same panel-local namespace as automatic naming: protection rows,
 * unprotected/direct circuit rows, and protection devices on the panel supply path.
 */
export function getManualCircuitLabelWarnings(
  panel: Panel | undefined,
  circuitId: string,
  project: ProjectWithOptionalV2Electrical,
  labelOverride?: string,
): ManualCircuitLabelWarnings {
  const empty = { nonStandard: false, duplicate: false }
  if (!panel) return empty

  const owningProtection = findProtectionOwningCircuit(panel, circuitId)
  const circuit = owningProtection?.circuits?.find((candidate) => candidate.id === circuitId)
    ?? panel.circuits.find((candidate) => candidate.id === circuitId)
  if (!circuit) return empty

  const label = (labelOverride ?? owningProtection?.label ?? circuit.code ?? '').trim()
  if (!label) return { nonStandard: true, duplicate: false }

  const targetKey = normalizeProtectionLabelForUniqueness(label)
  const targetRowKey = owningProtection ? `protection:${owningProtection.id}` : `circuit:${circuit.id}`
  const labels: Array<{ rowKey: string; label: string }> = []

  for (const protection of panel.protections ?? []) {
    labels.push({ rowKey: `protection:${protection.id}`, label: protection.label ?? '' })
  }

  const protectedCircuitIds = new Set(
    (panel.protections ?? []).flatMap((protection) =>
      (protection.circuits ?? []).map((candidate) => candidate.id),
    ),
  )
  for (const directCircuit of panel.circuits ?? []) {
    if (directCircuit.code === 'PANEL' || protectedCircuitIds.has(directCircuit.id)) continue
    labels.push({ rowKey: `circuit:${directCircuit.id}`, label: directCircuit.code ?? '' })
  }

  for (const device of collectFeedPathProtectionDevicesOnPanel(panel, project)) {
    labels.push({ rowKey: `supply:${device.id}`, label: device.label ?? '' })
  }

  return {
    nonStandard: !isRegularAutomaticCircuitLabel(label),
    duplicate: labels.some(
      (candidate) =>
        candidate.rowKey !== targetRowKey &&
        normalizeProtectionLabelForUniqueness(candidate.label) === targetKey,
    ),
  }
}

function excelColumnLabelToZeroBasedIndex(label: string): number {
  let n = 0
  for (const char of label) {
    n = n * 26 + (char.charCodeAt(0) - 64)
  }
  return n - 1
}

function isManualExcelStyleLabel(label: string): boolean {
  return /^[A-Z]{1,3}$/.test(label)
}

function addAlphabeticLabelToReservedSet(reserved: Set<string>, label: string | undefined | null): void {
  const code = String(label ?? '').trim().toUpperCase()
  if (code && /^[A-Z]+$/.test(code)) {
    reserved.add(code)
  }
}

function addProtectionLabelKeyToUsedSet(usedLabels: Set<string>, label: string | undefined | null): void {
  const trimmed = String(label ?? '').trim()
  if (trimmed) {
    usedLabels.add(normalizeProtectionLabelForUniqueness(trimmed))
  }
}

function collectFeedPathProtectionDevicesOnPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical
): TrunkDevice[] {
  const devices: TrunkDevice[] = []
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  for (const device of installation ? getPanelSupplyTrunkDevices(installation, panels, panel) : []) {
    if (device.type === 'protection') devices.push(device)
  }
  const panelSupplyCircuit = panel.circuits.find((c) => c.code === 'PANEL')
  for (const device of panelSupplyCircuit?.trunkDevices ?? []) {
    if (device.type === 'protection') devices.push(device)
  }
  return devices
}

function resolveLabelAgainstUsedSet(requestedLabel: string, usedLabels: Set<string>): string {
  const requested = requestedLabel.trim()
  if (!requested) return requested
  if (!usedLabels.has(normalizeProtectionLabelForUniqueness(requested))) {
    return requested
  }

  if (isManualExcelStyleLabel(requested)) {
    let index = excelColumnLabelToZeroBasedIndex(requested)
    for (let attempt = 0; attempt < MAX_MANUAL_EXCEL_LABEL_ATTEMPTS; attempt += 1) {
      const candidate = excelColumnLabelFromZeroBasedIndex(index)
      if (!usedLabels.has(normalizeProtectionLabelForUniqueness(candidate))) {
        return candidate
      }
      index += 1
    }
  }

  return nextUniqueSuffixedLabel(requested, usedLabels)
}

/**
 * Excel-style letters manually assigned on this panel's supply path (shared/root feed
 * protections and sub-panel incoming PANEL-circuit protections). Auto main-bus naming must
 * skip these so supply and bus labels stay unique per panel.
 */
export function collectReservedAlphabeticLabelsOnPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical
): Set<string> {
  const reserved = new Set<string>()
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  for (const device of installation ? getPanelSupplyTrunkDevices(installation, panels, panel) : []) {
    if (device.type === 'protection') {
      addAlphabeticLabelToReservedSet(reserved, device.label)
    }
  }
  const panelSupplyCircuit = panel.circuits.find((c) => c.code === 'PANEL')
  for (const device of panelSupplyCircuit?.trunkDevices ?? []) {
    if (device.type === 'protection') {
      addAlphabeticLabelToReservedSet(reserved, device.label)
    }
  }
  return reserved
}

function collectManualLockedAlphabeticLabelsOnPanel(panel: Panel): Set<string> {
  const reserved = new Set<string>()
  for (const circuit of panel.circuits ?? []) {
    if (circuit.code === 'PANEL') continue
    if (circuitHasManualCodeLock(circuit)) addAlphabeticLabelToReservedSet(reserved, circuit.code)
  }
  for (const protection of panel.protections ?? []) {
    if (!protectionHasManualCodeLock(protection)) continue
    addAlphabeticLabelToReservedSet(reserved, protection.label)
    for (const circuit of protection.circuits ?? []) {
      if (circuitHasManualCodeLock(circuit)) addAlphabeticLabelToReservedSet(reserved, circuit.code)
    }
  }
  return reserved
}

function splitNumericSuffix(label: string): { base: string; suffix: number | null } {
  const match = /^(.*?)(?:_(\d+))?$/.exec(label)
  if (!match) return { base: label, suffix: null }
  return {
    base: match[1] || label,
    suffix: match[2] ? Number.parseInt(match[2], 10) : null,
  }
}

function nextUniqueSuffixedLabel(requested: string, usedLabels: Set<string>): string {
  const { base } = splitNumericSuffix(requested)
  let highestSuffix = usedLabels.has(normalizeProtectionLabelForUniqueness(base)) ? 0 : -1

  for (const used of usedLabels) {
    const { base: usedBase, suffix } = splitNumericSuffix(used)
    if (normalizeProtectionLabelForUniqueness(usedBase) !== normalizeProtectionLabelForUniqueness(base)) {
      continue
    }
    if (suffix !== null) {
      highestSuffix = Math.max(highestSuffix, suffix)
    }
  }

  let nextSuffix = highestSuffix + 1
  while (nextSuffix < Number.MAX_SAFE_INTEGER) {
    const candidate = `${base}_${nextSuffix}`
    if (!usedLabels.has(normalizeProtectionLabelForUniqueness(candidate))) {
      return candidate
    }
    nextSuffix += 1
  }
  return `${base}_${Date.now()}`
}

/**
 * Resolve a protection label for flows that require panel-local uniqueness, such as automatic
 * naming and creating a new protection. Existing protection edits bypass this helper when
 * automatic naming is disabled, so manual labels remain fully user-controlled.
 */
export function resolveUniqueProtectionLabelOnPanel(
  panel: Panel,
  protectionId: string,
  requestedLabel: string,
  project?: ProjectWithOptionalV2Electrical,
): string {
  const requested = requestedLabel.trim()
  if (!requested) return requested

  const currentLabel =
    panel.protections.find((protection) => protection.id === protectionId)?.label?.trim() ?? ''
  const currentLabelKey = normalizeProtectionLabelForUniqueness(currentLabel)
  const usedLabels = new Set<string>()
  for (const protection of panel.protections ?? []) {
    if (protection.id === protectionId) continue
    addProtectionLabelKeyToUsedSet(usedLabels, protection.label)
  }
  if (project) {
    for (const device of collectFeedPathProtectionDevicesOnPanel(panel, project)) {
      addProtectionLabelKeyToUsedSet(usedLabels, device.label)
    }
  }

  if (!usedLabels.has(normalizeProtectionLabelForUniqueness(requested))) {
    return requested
  }

  if (currentLabelKey) {
    usedLabels.add(currentLabelKey)
  }

  return resolveLabelAgainstUsedSet(requested, usedLabels)
}

export interface PanelProtectionLabelEntry {
  kind: 'protection' | 'supply'
  id: string
  label: string
}

/** Duplicate protection labels on one panel (main bus, secondary bus, supply, incoming). */
export function findDuplicateProtectionLabelGroupsOnPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
): Array<{ displayLabel: string; entries: PanelProtectionLabelEntry[] }> {
  const byKey = new Map<string, PanelProtectionLabelEntry[]>()

  const push = (entry: PanelProtectionLabelEntry) => {
    const key = normalizeProtectionLabelForUniqueness(entry.label)
    if (!key) return
    const group = byKey.get(key)
    if (group) group.push(entry)
    else byKey.set(key, [entry])
  }

  for (const protection of panel.protections ?? []) {
    const label = (protection.label ?? '').trim()
    if (!label) continue
    push({ kind: 'protection', id: protection.id, label })
  }
  for (const device of collectFeedPathProtectionDevicesOnPanel(panel, project)) {
    const label = (device.label ?? '').trim()
    if (!label) continue
    push({ kind: 'supply', id: device.id, label })
  }

  const duplicates: Array<{ displayLabel: string; entries: PanelProtectionLabelEntry[] }> = []
  for (const entries of byKey.values()) {
    if (entries.length < 2) continue
    duplicates.push({
      displayLabel: entries[0]!.label,
      entries,
    })
  }
  return duplicates
}

export function resolveUniqueSupplyProtectionLabelOnPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  requestedLabel: string,
): string {
  const requested = requestedLabel.trim()
  if (!requested) return requested

  const usedLabels = new Set<string>()
  for (const protection of panel.protections ?? []) {
    addProtectionLabelKeyToUsedSet(usedLabels, protection.label)
  }
  for (const device of collectFeedPathProtectionDevicesOnPanel(panel, project)) {
    if (device.id === deviceId) continue
    addProtectionLabelKeyToUsedSet(usedLabels, device.label)
  }

  if (!usedLabels.has(normalizeProtectionLabelForUniqueness(requested))) {
    return requested
  }

  const currentDevice = collectFeedPathProtectionDevicesOnPanel(panel, project).find(
    (device) => device.id === deviceId,
  )
  addProtectionLabelKeyToUsedSet(usedLabels, currentDevice?.label)

  return resolveLabelAgainstUsedSet(requested, usedLabels)
}

/** When automatic naming is on, move feed-path protection labels off bus letters. */
export function reconcileSupplyProtectionLabelsOnPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical
): boolean {
  let changed = false
  const usedLabels = new Set<string>()
  for (const protection of panel.protections ?? []) {
    addProtectionLabelKeyToUsedSet(usedLabels, protection.label)
  }

  for (const device of collectFeedPathProtectionDevicesOnPanel(panel, project)) {
    const label = (device.label ?? '').trim()
    if (!label) continue
    const key = normalizeProtectionLabelForUniqueness(label)
    if (!usedLabels.has(key)) {
      usedLabels.add(key)
      continue
    }
    const resolved = resolveLabelAgainstUsedSet(label, usedLabels)
    if (resolved !== label) {
      device.label = resolved
      changed = true
    }
    addProtectionLabelKeyToUsedSet(usedLabels, device.label)
  }

  return changed
}

export interface AutomaticMainBusNamingOpts {
  hideFeederLetters: boolean
}

type NamingTarget =
  | { kind: 'protection'; protection: ProtectionDevice }
  | { kind: 'directCircuit'; circuit: Circuit }

interface NamingVisitor {
  onProtection: (protection: ProtectionDevice, code: string, primary: Circuit, showLetter: boolean) => void
  onDirectCircuit: (circuit: Circuit, code: string, showLetter: boolean) => void
  onManualProtection?: (protection: ProtectionDevice, primary: Circuit) => void
  onManualDirectCircuit?: (circuit: Circuit) => void
  onDirectDcBusBranchOmitted?: (protection: ProtectionDevice, primary: Circuit) => void
  onFeederParentOmitted?: (protection: ProtectionDevice, primary: Circuit) => void
  onDirectFeederParentOmitted?: (circuit: Circuit) => void
}

/**
 * Collect panels rows in **depth-first** order for letter assignment:
 * - Under each main-bus row, nested protections (secondary bus) are numbered **before** continuing
 *   along the main bus — so the first actual circuits under the leftmost feeder become A, B, … and
 *   the next main-bus breaker becomes C, … (matches “full automatic” hierarchical numbering).
 * - Feeder-only parents when `hideFeederLetters` **defer** and are cleared (no letter, manual name).
 */
function collectNamingTargets(panel: Panel, opts: AutomaticMainBusNamingOpts): {
  primarySequence: NamingTarget[]
  deferredFeeders: NamingTarget[]
} {
  const primarySequence: NamingTarget[] = []
  const deferredFeeders: NamingTarget[] = []
  // A preserved nested panel feeder can temporarily be listed both as a child of
  // its parent circuit and as an additional circuit on the parent protection.
  // Treat repeated ownership as one naming subtree so legacy/transition states
  // cannot recurse forever.
  const visitedProtectionIds = new Set<string>()
  const visitedCircuitIds = new Set<string>()

  const shouldTakePrimarySlot = (
    primaryCircuit: Circuit,
    protection?: ProtectionDevice,
  ): boolean => {
    if (protection?.directDcBusFeeder === true) return false
    if (!opts.hideFeederLetters) return true
    return !circuitIsFeederParentWithSubCircuits(primaryCircuit, { protection })
  }

  const pushRow = (
    target: NamingTarget,
    primaryCircuit: Circuit,
    protection?: ProtectionDevice,
  ) => {
    if (shouldTakePrimarySlot(primaryCircuit, protection)) primarySequence.push(target)
    else deferredFeeders.push(target)
  }

  /**
   * Follow `subCircuitIds` in order: nested protections, else direct panel circuits
   * (secondary-bus nesting without an intervening protection row).
   */
  function appendSubCircuitRows(subIds: string[] | undefined) {
    const childIds = subIds ?? []
    for (const subId of childIds) {
      const childProtection = findProtectionOwningCircuit(panel, subId)
      if (childProtection?.circuits?.length) {
        appendProtectionSubtree(childProtection)
      } else {
        const direct = panel.circuits.find((c) => c.id === subId)
        if (direct && direct.code !== 'PANEL') {
          appendDirectCircuitSubtree(direct)
        }
      }
    }
  }

  /**
   * Nested protections:
   * - hideFeederLetters=true keeps depth-first children-first ordering so omitted feeder rows do not
   *   consume early letters.
   * - hideFeederLetters=false applies bottom-up bus ordering (row first, then descendants) so a
   *   feeder protection that is shown keeps the first letter for its branch.
   */
  function appendProtectionSubtree(protection: ProtectionDevice) {
    if (visitedProtectionIds.has(protection.id)) return
    visitedProtectionIds.add(protection.id)

    const primary = protection.circuits![0]!
    if (opts.hideFeederLetters) {
      appendSubCircuitRows(primary.subCircuitIds)
      pushRow({ kind: 'protection', protection }, primary, protection)
      return
    }
    pushRow({ kind: 'protection', protection }, primary, protection)
    appendSubCircuitRows(primary.subCircuitIds)
  }

  function appendDirectCircuitSubtree(circuit: Circuit) {
    if (visitedCircuitIds.has(circuit.id)) return
    visitedCircuitIds.add(circuit.id)

    const owner = findProtectionOwningCircuit(panel, circuit.id)
    if (opts.hideFeederLetters) {
      appendSubCircuitRows(circuit.subCircuitIds)
      pushRow({ kind: 'directCircuit', circuit }, circuit, owner)
      return
    }
    pushRow({ kind: 'directCircuit', circuit }, circuit, owner)
    appendSubCircuitRows(circuit.subCircuitIds)
  }

  for (const item of getMainBusOrder(panel)) {
    if (item.type === 'circuit') {
      const circuit = panel.circuits.find((c) => c.id === item.id)
      if (!circuit || circuit.code === 'PANEL') continue
      appendDirectCircuitSubtree(circuit)
    } else {
      const protection = panel.protections.find((p) => p.id === item.id)
      if (!protection?.circuits?.length) continue
      const primary = protection.circuits[0]!
      if (opts.hideFeederLetters) {
        appendSubCircuitRows(primary.subCircuitIds)
        pushRow({ kind: 'protection', protection }, primary, protection)
      } else {
        pushRow({ kind: 'protection', protection }, primary, protection)
        appendSubCircuitRows(primary.subCircuitIds)
      }
    }
  }

  return { primarySequence, deferredFeeders }
}

function applyTargetsWithVisitor(
  panel: Panel,
  targets: NamingTarget[],
  visitor: NamingVisitor,
  nextCode: () => string,
  opts: AutomaticMainBusNamingOpts,
) {
  for (const t of targets) {
    if (t.kind === 'protection') {
      const protection = t.protection
      const primary = protection.circuits?.[0]
      if (!primary) continue
      if (protectionHasManualCodeLock(protection)) {
        visitor.onManualProtection?.(protection, primary)
        continue
      }
      if (protection.directDcBusFeeder === true) {
        visitor.onDirectDcBusBranchOmitted?.(protection, primary)
        continue
      }
      if (protectionOmittedFromAutomaticNamingLetter(protection, primary)) {
        visitor.onFeederParentOmitted?.(protection, primary)
        continue
      }
      if (
        opts.hideFeederLetters &&
        circuitIsFeederParentWithSubCircuits(primary, { protection }) &&
        visitor.onFeederParentOmitted
      ) {
        visitor.onFeederParentOmitted(protection, primary)
        continue
      }
      const code = nextCode()
      const showLetter = expectedLetterShownOnOneWire(primary, opts.hideFeederLetters, protection)
      visitor.onProtection(protection, code, primary, showLetter)
    } else {
      const circuit = t.circuit
      const owner = findProtectionOwningCircuit(panel, circuit.id)
      if (circuitHasManualCodeLock(circuit)) {
        visitor.onManualDirectCircuit?.(circuit)
        continue
      }
      if (
        opts.hideFeederLetters &&
        circuitIsFeederParentWithSubCircuits(circuit, { protection: owner }) &&
        visitor.onDirectFeederParentOmitted
      ) {
        visitor.onDirectFeederParentOmitted(circuit)
        continue
      }
      const code = nextCode()
      const showLetter = expectedLetterShownOnOneWire(circuit, opts.hideFeederLetters, owner)
      visitor.onDirectCircuit(circuit, code, showLetter)
    }
  }
}

function walkAutomaticNamingTargets(
  panel: Panel,
  opts: AutomaticMainBusNamingOpts,
  visitor: NamingVisitor,
  project: ProjectWithOptionalV2Electrical,
): void {
  const { primarySequence, deferredFeeders } = collectNamingTargets(panel, opts)
  const reserved = collectReservedAlphabeticLabelsOnPanel(panel, project)
  for (const lockedLabel of collectManualLockedAlphabeticLabelsOnPanel(panel)) {
    reserved.add(lockedLabel)
  }
  let slot = 0
  const nextCode = () => {
    for (let attempt = 0; attempt < MAX_MANUAL_EXCEL_LABEL_ATTEMPTS; attempt += 1) {
      const candidate = excelColumnLabelFromZeroBasedIndex(slot++)
      if (!reserved.has(candidate)) {
        return candidate
      }
    }
    return excelColumnLabelFromZeroBasedIndex(slot++)
  }
  applyTargetsWithVisitor(panel, primarySequence, visitor, nextCode, opts)
  applyTargetsWithVisitor(panel, deferredFeeders, visitor, nextCode, opts)
}

/** Whether applying automatic naming would change codes or letter visibility on the main bus and nested buses. */
export function automaticMainBusNamingWouldChangePanel(
  panel: Panel,
  opts: AutomaticMainBusNamingOpts,
  project: ProjectWithOptionalV2Electrical,
): boolean {
  const assignedCodes = new Map<string, string>()
  let wouldChange = false
  walkAutomaticNamingTargets(panel, opts, {
    onProtection(protection, code, primary, showLetter) {
      void primary
      for (const c of protection.circuits ?? []) {
        assignedCodes.set(c.id, code)
      }
      if ((protection.label ?? '').trim() !== code) wouldChange = true
      for (const c of protection.circuits ?? []) {
        if ((c.code ?? '').trim() !== code) wouldChange = true
        if (letterShownOnOneWire(c) !== showLetter) wouldChange = true
      }
    },
    onDirectCircuit(circuit, code, showLetter) {
      assignedCodes.set(circuit.id, code)
      if ((circuit.code ?? '').trim() !== code) wouldChange = true
      if (letterShownOnOneWire(circuit) !== showLetter) wouldChange = true
    },
    onManualProtection(protection, primary) {
      void primary
      const locked = protection.circuits?.find(circuitHasManualCodeLock)
      const lockedCode = (locked?.code ?? '').trim()
      if (lockedCode && (protection.label ?? '').trim() !== lockedCode) wouldChange = true
      for (const c of protection.circuits ?? []) {
        assignedCodes.set(c.id, (c.code ?? '').trim())
      }
    },
    onManualDirectCircuit(circuit) {
      assignedCodes.set(circuit.id, (circuit.code ?? '').trim())
    },
    onDirectDcBusBranchOmitted(protection, primary) {
      if ((protection.label ?? '').trim() !== '') wouldChange = true
      for (const c of protection.circuits ?? []) {
        assignedCodes.set(c.id, (c.code ?? '').trim())
        if (letterShownOnOneWire(c)) wouldChange = true
      }
      void primary
    },
    onFeederParentOmitted(protection, primary) {
      if (protectionOmittedFromAutomaticNamingLetter(protection, primary)) {
        if ((protection.label ?? '').trim() !== '') wouldChange = true
        for (const c of protection.circuits ?? []) {
          if ((c.code ?? '').trim() !== '') wouldChange = true
        }
        void primary
        return
      }
      if ((protection.label ?? '').trim() !== '') wouldChange = true
      for (const c of protection.circuits ?? []) {
        if ((c.code ?? '').trim() !== '') wouldChange = true
        if (!letterShownOnOneWire(c)) wouldChange = true
      }
      void primary
    },
    onDirectFeederParentOmitted(circuit) {
      if ((circuit.code ?? '').trim() !== '') wouldChange = true
      if (!letterShownOnOneWire(circuit)) wouldChange = true
    },
  }, project)
  forEachCircuitOnPanel(panel, (c) => {
    const code = assignedCodes.get(c.id) ?? (c.code ?? '').trim()
    if (endpointBranchLabelsWouldChange(c, code, panel)) wouldChange = true
  })
  return wouldChange
}

export function automaticMainBusNamingWouldChangeProject(
  project: ProjectWithOptionalV2Electrical,
  opts: AutomaticMainBusNamingOpts,
): boolean {
  const walk = (panels: Panel[]): boolean => {
    for (const p of panels) {
      if (automaticMainBusNamingWouldChangePanel(p, opts, project)) {
        return true
      }
      if (p.subPanels?.length && walk(p.subPanels)) {
        return true
      }
    }
    return false
  }
  return walk(getProjectElectricalPanels(project))
}

export function resolveAutomaticNamingOptsFromInstallation(
  installation: Installation | undefined,
): AutomaticMainBusNamingOpts {
  return {
    hideFeederLetters: installationHideFeederLetters(installation),
  }
}

/**
 * Hierarchical A/B/C… naming on one panel: nested rows under a main-bus feeder are numbered before
 * the next main-bus row; feeder-only rows with hidden letters are coded last. Mutates in place.
 */
export function applyAutomaticMainBusNamingToPanel(
  panel: Panel,
  opts: AutomaticMainBusNamingOpts,
  project: ProjectWithOptionalV2Electrical,
): void {
  walkAutomaticNamingTargets(panel, opts, {
    onProtection(protection, code, primary, showLetter) {
      void primary
      renameProtectionLabelAndCircuits(protection, code)
      setCircuitsLetterShownOnOneWire(protection.circuits ?? [], showLetter)
    },
    onDirectCircuit(circuit, code, showLetter) {
      renameCircuitCodeKeepingEndpoints(circuit, code)
      setCircuitsLetterShownOnOneWire([circuit], showLetter)
    },
    onManualProtection: setLockedProtectionLabelFromPrimary,
    onManualDirectCircuit(circuit) {
      delete circuit.eendraadLetterVisible
    },
    onDirectDcBusBranchOmitted(protection) {
      protection.label = ''
      setCircuitsLetterShownOnOneWire(protection.circuits ?? [], false)
    },
    onFeederParentOmitted: clearFeederParentNaming,
    onDirectFeederParentOmitted: clearDirectFeederParentNaming,
  }, project)
  reconcileSupplyProtectionLabelsOnPanel(panel, project)
  applyAutomaticEndpointBranchLabelsToPanel(panel)
}
