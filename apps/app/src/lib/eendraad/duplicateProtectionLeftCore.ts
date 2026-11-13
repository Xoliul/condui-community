import {
  getPanelGridTotalColumns,
  panelGridModuleFitsFields,
  type PanelGridFieldSource,
} from '@/lib/panel/panelGridFields'
import { getModuleWidthInCols } from '@/lib/panel/panelGridLayout'
import {
  cloneCircuitContent,
  findCircuitOnPanel,
  wireClonedSubCircuitIds,
  type CircuitCloneIdMaps,
} from '@/lib/eendraad/cloneCircuitContent'
import {
  applyAutomaticMainBusNamingToPanel,
  resolveAutomaticNamingOptsFromInstallation,
  resolveUniqueProtectionLabelOnPanel,
} from '@/lib/eendraad/automaticMainBusNaming'
import {
  collectCircuitClosureDownstreamFromProtection,
  collectProtectionsOrderedForSubtreeMove,
  getMainBusOrder,
  moveProtectionToMainBusInsertIndex,
  placeMainBusProtectionGridSlotAtIndex,
} from '@/lib/eendraad/mainBusOrder'
import type {
  Circuit,
  Panel,
  PanelGridModuleRef,
  PanelGridSlot,
  ProtectionDevice,
} from '@/types/schema'
import { generateId } from '@/utils'
import { createCircuitCodeSequence, getNextAvailableCircuitCode } from '@/utils/project'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { cloneCircuitWireRuns } from '@/lib/wires/cloneCircuitWireRuns'
import { remapClonedEndpointDependencies } from '@/lib/eendraad/cloneCircuitContent'

function findPanelDirectlyContainingProtection(panels: Panel[], protectionId: string): Panel | undefined {
  for (const panel of panels) {
    if (panel.protections.some((p) => p.id === protectionId)) return panel
    const found = findPanelDirectlyContainingProtection(panel.subPanels ?? [], protectionId)
    if (found) return found
  }
  return undefined
}

function buildPanelCircuitMap(panel: Panel): Map<string, Circuit> {
  const map = new Map<string, Circuit>()
  for (const c of panel.circuits) map.set(c.id, c)
  for (const p of panel.protections) {
    for (const c of p.circuits ?? []) {
      if (!map.has(c.id)) map.set(c.id, c)
    }
  }
  return map
}

function findParentCircuitListingChildInPanel(panel: Panel, childCircuitId: string): Circuit | undefined {
  for (const c of buildPanelCircuitMap(panel).values()) {
    if (c.subCircuitIds?.includes(childCircuitId)) return c
  }
  return undefined
}

function findSecondaryBusOrderingCircuitId(panel: Panel, prot: ProtectionDevice): string | undefined {
  for (const c of prot.circuits ?? []) {
    if (findParentCircuitListingChildInPanel(panel, c.id)) return c.id
  }
  return undefined
}

function ensureDuplicateCircuitRightOfSourceOnSecondaryBus(
  parent: Circuit,
  newCircuitId: string,
  sourceOrderingId: string,
): void {
  const without = (parent.subCircuitIds ?? []).filter((id) => id !== newCircuitId)
  const iSrc = without.indexOf(sourceOrderingId)
  if (iSrc < 0) return
  parent.subCircuitIds = [...without.slice(0, iSrc + 1), newCircuitId, ...without.slice(iSrc + 1)]
}

export function addDuplicateProtectionSlotRightMutation(
  panel: Panel,
  sourceProtectionId: string,
  newProtectionId: string,
  project: ProjectWithOptionalV2Electrical,
): void {
  const gv = panel.gridView
  if (!gv) return
  const newRef: PanelGridModuleRef = { kind: 'protection', id: newProtectionId }
  const sourceRef: PanelGridModuleRef = { kind: 'protection', id: sourceProtectionId }

  const tryPatch = (
    slots: PanelGridSlot[] | undefined,
    rows: number,
    columns: number,
    fieldGrid?: PanelGridFieldSource,
  ): boolean => {
    if (!slots?.length) return false
    const idx = slots.findIndex(
      (s) => s.module.kind === 'protection' && s.module.id === sourceProtectionId,
    )
    if (idx < 0) return false
    const sourceSlot = slots[idx]!
    const sourceSpanCols = sourceSlot.moduleWidth ?? getModuleWidthInCols(sourceRef, project)
    const duplicateWidth = Math.max(1, sourceSpanCols)
    const occupied = new Set<string>()
    for (const slot of slots) {
      const width = Math.max(
        1,
        slot.moduleWidth ?? getModuleWidthInCols(slot.module, project),
      )
      for (let offset = 0; offset < width; offset++) {
        occupied.add(`${slot.row},${slot.col + offset}`)
      }
    }
    const isFree = (row: number, col: number): boolean => {
      if (row < 0 || row >= rows || col < 0 || col + duplicateWidth > columns) return false
      if (!panelGridModuleFitsFields(fieldGrid, col, duplicateWidth)) return false
      for (let offset = 0; offset < duplicateWidth; offset++) {
        if (occupied.has(`${row},${col + offset}`)) return false
      }
      return true
    }
    const freeColumnsOnRow = (row: number): number[] => {
      const result: number[] = []
      for (let col = 0; col <= columns - duplicateWidth; col++) {
        if (isFree(row, col)) result.push(col)
      }
      return result
    }

    const rightCol = sourceSlot.col + sourceSpanCols
    const leftCol = sourceSlot.col - duplicateWidth
    let target: { row: number; col: number } | null = null
    if (isFree(sourceSlot.row, rightCol)) {
      target = { row: sourceSlot.row, col: rightCol }
    } else if (isFree(sourceSlot.row, leftCol)) {
      target = { row: sourceSlot.row, col: leftCol }
    } else {
      const sameRowColumns = freeColumnsOnRow(sourceSlot.row).sort((a, b) => {
        const distance = Math.abs(a - sourceSlot.col) - Math.abs(b - sourceSlot.col)
        return distance !== 0 ? distance : a - b
      })
      if (sameRowColumns[0] != null) {
        target = { row: sourceSlot.row, col: sameRowColumns[0] }
      }
    }

    if (!target) {
      const otherRows = Array.from({ length: rows }, (_, row) => row)
        .filter((row) => row !== sourceSlot.row)
        .sort((a, b) => Math.abs(a - sourceSlot.row) - Math.abs(b - sourceSlot.row))
      for (const row of otherRows) {
        const col = freeColumnsOnRow(row)[0]
        if (col != null) {
          target = { row, col }
          break
        }
      }
    }

    slots.push({
      row: target?.row ?? sourceSlot.row,
      col: target?.col ?? rightCol,
      moduleWidth: sourceSlot.moduleWidth,
      moduleWidthManual: sourceSlot.moduleWidthManual,
      module: newRef,
    })
    return true
  }

  if (!tryPatch(gv.slots, gv.rows, getPanelGridTotalColumns(gv), gv)) {
    tryPatch(
      gv.supplyPanelSlots,
      gv.supplyPanelRows ?? gv.rows,
      gv.supplyPanelColumns ?? gv.columns,
    )
  }
}

function cloneProtectionDeviceShell(
  source: ProtectionDevice,
  newId: string,
  newLabel: string,
): ProtectionDevice {
  const clone: ProtectionDevice = {
    ...JSON.parse(JSON.stringify(source)),
    id: newId,
    label: newLabel,
    notes: undefined,
    circuits: [],
    subPanelId: undefined,
  }
  return clone
}

function sortCircuitIdsForClone(panel: Panel, circuitIds: Set<string>): string[] {
  const idToCircuit = buildPanelCircuitMap(panel)
  const remaining = new Set(circuitIds)
  const ordered: string[] = []
  while (remaining.size > 0) {
    let picked: string | undefined
    for (const id of remaining) {
      const c = idToCircuit.get(id)
      const parents = (c?.subCircuitIds ?? []).filter((sub) => circuitIds.has(sub))
      const allParentsCloned = parents.every((sub) => !remaining.has(sub))
      if (allParentsCloned) {
        picked = id
        break
      }
    }
    if (!picked) {
      ordered.push(...remaining)
      break
    }
    ordered.push(picked)
    remaining.delete(picked)
  }
  return ordered
}

/** Insert duplicated main-bus row at this index (0 = before first bus item). */
export interface DuplicateProtectionMainBusPlacement {
  panelId: string
  mainBusInsertIndex: number
}

/** Panel Alt-drag creates only the protection module and an empty circuit behind it. */
export interface DuplicateProtectionOptions {
  copyCircuitContents?: boolean
}

interface DuplicateProtectionDraftState {
  currentProject?: ProjectWithOptionalV2Electrical | null
  isDirty?: boolean
}

function cloneCircuitShell(source: Circuit, newCircuitId: string, newCode: string): Circuit {
  const clone: Circuit = {
    ...JSON.parse(JSON.stringify(source)),
    id: newCircuitId,
    code: newCode,
    endpoints: [],
  }
  delete clone.branches
  delete clone.trunkDevices
  delete clone.subCircuitIds
  delete clone.sectionWireOverrides
  delete clone.dcBusSource
  return clone
}

export interface DuplicateProtectionLeftBridge {
  getProject: () => ProjectWithOptionalV2Electrical | null
  withSingleUndoEntry: (
    fn: () => boolean,
    options?: { sessionLabel?: string },
  ) => boolean
  insertProtectionAfter: (
    panelId: string,
    protection: ProtectionDevice,
    afterProtectionId: string,
  ) => void
  addCircuit: (panelId: string, circuit: Circuit, protectionId?: string) => void
  setDraft: (recipe: (state: DuplicateProtectionDraftState) => void) => void
  ensureSitplanForEndpoints?: (endpointIds: string[]) => void
}

export function runDuplicateProtectionLeft(
  protectionId: string,
  bridge: DuplicateProtectionLeftBridge,
  mainBusPlacement?: DuplicateProtectionMainBusPlacement,
  options?: DuplicateProtectionOptions,
  newId: () => string = generateId,
): string | null {
  let createdRootId: string | null = null

  const projectForLabel = bridge.getProject()
  const panelForLabel = projectForLabel
    ? findPanelDirectlyContainingProtection(
        getProjectElectricalPanels(projectForLabel),
        protectionId
      )
    : undefined
  const protForLabel = panelForLabel?.protections.find((p) => p.id === protectionId)
  const sourceName = protForLabel?.label?.trim()
  const sessionLabel = sourceName
    ? `duplicate circuit (from "${sourceName}")`
    : 'duplicate circuit'

  const applied = bridge.withSingleUndoEntry(() => {
    const project = bridge.getProject()
    if (!project) return false
    const panel = findPanelDirectlyContainingProtection(
      getProjectElectricalPanels(project),
      protectionId
    )
    if (!panel) return false
    const rootProt = panel.protections.find((p) => p.id === protectionId)
    if (!rootProt) return false
    const sourceCircuitId = rootProt.circuits?.[0]?.id
    if (!sourceCircuitId) return false

    const copyCircuitContents = options?.copyCircuitContents !== false
    const secondaryOrderCircuitId = findSecondaryBusOrderingCircuitId(panel, rootProt)
    const circuitClosure = copyCircuitContents
      ? collectCircuitClosureDownstreamFromProtection(panel, rootProt)
      : new Set([sourceCircuitId])
    const protectionsOrdered = copyCircuitContents
      ? collectProtectionsOrderedForSubtreeMove(panel, circuitClosure, rootProt)
      : [rootProt]
    const orderedCircuitIds = sortCircuitIdsForClone(panel, circuitClosure)
    const maps: CircuitCloneIdMaps = {
      endpoint: new Map(),
      trunkDevice: new Map(),
      circuit: new Map(),
    }
    const sourceCircuitSnapshots = new Map<string, Circuit>()
    for (const oldCircuitId of orderedCircuitIds) {
      const sourceCircuit = findCircuitOnPanel(panel, oldCircuitId)
      if (sourceCircuit) sourceCircuitSnapshots.set(oldCircuitId, sourceCircuit)
    }

    const clonedCircuits = new Map<string, Circuit>()
    const reservedAlphabetic = new Set<string>()
    let scanIndex = 0
    const codeAt = createCircuitCodeSequence(project, panel.id)
    const firstFreeCode = getNextAvailableCircuitCode(project, panel.id)
    while (codeAt(scanIndex) !== firstFreeCode && scanIndex < 2000) {
      scanIndex++
    }
    const takeNextAlphabeticCode = (): string => {
      while (scanIndex < 2000 && reservedAlphabetic.has(codeAt(scanIndex))) {
        scanIndex++
      }
      const code = codeAt(scanIndex++)
      reservedAlphabetic.add(code)
      return code
    }

    for (const oldCircuitId of orderedCircuitIds) {
      const sourceCircuit = sourceCircuitSnapshots.get(oldCircuitId)
      if (!sourceCircuit) continue
      const newCircuitId = newId()
      const newCode = takeNextAlphabeticCode()
      const newCircuit = copyCircuitContents
        ? cloneCircuitContent(sourceCircuit, maps, newCircuitId, newCode, newId, true)
        : cloneCircuitShell(sourceCircuit, newCircuitId, newCode)
      if (copyCircuitContents) {
        wireClonedSubCircuitIds(sourceCircuit, newCircuit, maps)
      }
      clonedCircuits.set(oldCircuitId, newCircuit)
    }

    if (copyCircuitContents) {
      remapClonedEndpointDependencies(
        Array.from(clonedCircuits.values()).flatMap((circuit) => circuit.endpoints),
        maps,
      )
    }

    const newProtectionByOldId = new Map<string, ProtectionDevice>()
    for (const sourceProt of protectionsOrdered) {
      const newProtId = newId()
      const primarySourceCircuit =
        sourceProt.circuits?.find((c) => circuitClosure.has(c.id)) ?? sourceProt.circuits?.[0]
      const clonedPrimary = primarySourceCircuit
        ? clonedCircuits.get(primarySourceCircuit.id)
        : undefined
      const newLabel = resolveUniqueProtectionLabelOnPanel(
        panel,
        newProtId,
        sourceProt.label?.trim() || clonedPrimary?.code || firstFreeCode,
        project,
      )
      const newProt = cloneProtectionDeviceShell(sourceProt, newProtId, newLabel)
      newProtectionByOldId.set(sourceProt.id, newProt)
    }

    const rootNewProt = newProtectionByOldId.get(protectionId)
    if (!rootNewProt) return false

    const newRootCircuitId = maps.circuit.get(sourceCircuitId)
    const newProtectionsInOrder = protectionsOrdered.map((sp) => newProtectionByOldId.get(sp.id)!)

    bridge.setDraft((state) => {
      if (!state.currentProject) return
      const panelAfter = findPanelById(
        getProjectElectricalPanels(state.currentProject),
        panel.id
      )
      if (!panelAfter) return

      const rootIdx = panelAfter.protections.findIndex((p) => p.id === protectionId)
      if (rootIdx < 0) return

      const useMainBusPlacement =
        mainBusPlacement?.panelId === panel.id &&
        typeof mainBusPlacement.mainBusInsertIndex === 'number'

      panelAfter.protections.splice(rootIdx + 1, 0, ...newProtectionsInOrder)

      for (const sourceProt of protectionsOrdered) {
        const newProt = panelAfter.protections.find(
          (p) => p.id === newProtectionByOldId.get(sourceProt.id)?.id,
        )
        if (!newProt) continue
        if (!newProt.circuits) newProt.circuits = []
        for (const sourceCircuit of sourceProt.circuits ?? []) {
          if (!circuitClosure.has(sourceCircuit.id)) continue
          const cloned = clonedCircuits.get(sourceCircuit.id)
          if (cloned) newProt.circuits.push(cloned)
        }
      }

      if (useMainBusPlacement) {
        const orderBefore = getMainBusOrder(panelAfter)
        const withoutNew = orderBefore.filter(
          (item) => !(item.type === 'protection' && item.id === rootNewProt.id),
        )
        const insertAt = Math.max(
          0,
          Math.min(mainBusPlacement.mainBusInsertIndex, withoutNew.length),
        )
        moveProtectionToMainBusInsertIndex(panelAfter, rootNewProt.id, insertAt)
        placeMainBusProtectionGridSlotAtIndex(
          panelAfter,
          rootNewProt.id,
          insertAt,
          state.currentProject,
          protectionId,
        )
      } else {
        addDuplicateProtectionSlotRightMutation(
          panelAfter,
          protectionId,
          rootNewProt.id,
          state.currentProject,
        )
      }
      const protSrc = panelAfter.protections.find((p) => p.id === protectionId)
      const orderId = protSrc
        ? findSecondaryBusOrderingCircuitId(panelAfter, protSrc)
        : secondaryOrderCircuitId
      if (orderId && newRootCircuitId) {
        const parentNested = findParentCircuitListingChildInPanel(panelAfter, orderId)
        if (parentNested) {
          ensureDuplicateCircuitRightOfSourceOnSecondaryBus(
            parentNested,
            newRootCircuitId,
            orderId,
          )
        }
      }
      cloneCircuitWireRuns(state.currentProject, panel.id, {
        ...maps,
        protection: new Map(Array.from(newProtectionByOldId, ([id, protection]) => [id, protection.id])),
      }, newId)
      const installationAfter = getProjectElectricalInstallation(state.currentProject)
      if (installationAfter?.eendraadAutomaticNaming) {
        applyAutomaticMainBusNamingToPanel(
          panelAfter,
          resolveAutomaticNamingOptsFromInstallation(installationAfter),
          state.currentProject,
        )
      }
      state.isDirty = true
    })

    if (bridge.ensureSitplanForEndpoints) {
      bridge.ensureSitplanForEndpoints(Array.from(maps.endpoint.values()))
    }

    createdRootId = rootNewProt.id
    return true
  }, { sessionLabel })

  return applied ? createdRootId : null
}
