import { packSlotsInFields } from '@/lib/panel/fieldAutoArrange'
import { getPanelGridFieldLayout, getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import { getPanelFeedProjection } from '@/lib/feedTopology'
import { getSubPanelMainBusFeedDevice } from '@/lib/panel/subPanelFeed'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Panel, PanelGridModuleRef, PanelGridSlot, ProtectionDevice } from '@/types/schema'
import {
  type AutoArrangeGroup,
  findFirstFreeMainOrOverflowSlot,
  packAnchoredSegmentsIntoRows,
  packAutoArrangeMainGroupSlots,
  packAutoArrangeMainSlots,
  packAutoArrangeSupplySlots,
  packGroupsIntoLocalRows,
} from '@/lib/panel/autoArrangeLayout'
import {
  CELL_H,
  CELL_W,
  ROW_GAP,
  getSupplyPanelColumns,
  getSupplyPanelRows,
  panelGridModuleRefKey,
  resolveModuleWidthCols,
} from '@/lib/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { MIN_PANEL_GRID_MODULE_WIDTH, panelModulesToGridUnits } from '@/lib/panel/panelGridUnits'

export type PanelSupplySlotProject = ProjectWithOptionalV2Electrical

export type PanelGridModuleItem = {
  ref: PanelGridModuleRef
  inSupplyPanel?: boolean
  slot?: {
    row: number
    col: number
    moduleWidth?: number
    moduleWidthManual?: boolean
    terminalStripRail?: 'top' | 'bottom'
  }
}

export type GetPanelGridModulesFn = (panelId: string) => PanelGridModuleItem[]

export type PanelFeedSideDirection = 'left' | 'right'

export function getManualWidthProps(slot?: PanelGridSlot) {
  return slot?.moduleWidthManual === true && slot.moduleWidth != null
    ? { moduleWidth: slot.moduleWidth, moduleWidthManual: true as const }
    : {}
}

/** Persist a computed module placement when it has no slot yet, or move its existing slot. */
export function upsertPanelGridSlotPosition(
  slots: PanelGridSlot[],
  module: PanelGridModuleRef,
  row: number,
  col: number,
  terminalStripRail?: 'top' | 'bottom'
): PanelGridSlot[] {
  const key = panelGridModuleRefKey(module)
  let found = false
  const nextSlots = slots.map((slot) => {
    if (panelGridModuleRefKey(slot.module) !== key) return slot
    found = true
    const { terminalStripRail: _previousRail, ...rest } = slot
    return { ...rest, row, col, ...(terminalStripRail ? { terminalStripRail } : {}) }
  })
  return found
    ? nextSlots
    : [...nextSlots, { row, col, module, ...(terminalStripRail ? { terminalStripRail } : {}) }]
}

export function arePanelGridSlotArraysEqual(a: PanelGridSlot[], b: PanelGridSlot[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const left = a[i]
    const right = b[i]
    if (!left || !right) return false
    if (left.row !== right.row || left.col !== right.col) return false
    if (left.moduleWidth !== right.moduleWidth) return false
    if (left.moduleWidthManual !== right.moduleWidthManual) return false
    if (left.terminalStripRail !== right.terminalStripRail) return false
    if (panelGridModuleRefKey(left.module) !== panelGridModuleRefKey(right.module)) return false
  }
  return true
}

export function canPlaceSupplyModuleAt(
  existingSlots: PanelGridSlot[],
  moduleKey: string,
  preferredRow: number,
  preferredCol: number,
  width: number,
  rows: number,
  cols: number,
  project: PanelSupplySlotProject
): boolean {
  if (preferredRow < 0 || preferredRow >= rows) return false
  if (preferredCol < 0 || preferredCol + width > cols) return false
  const end = preferredCol + width
  return existingSlots
    .filter((slot) => panelGridModuleRefKey(slot.module) !== moduleKey)
    .every((slot) => {
      if (slot.row !== preferredRow) return true
      const existingWidth = Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        resolveModuleWidthCols(slot.module, project, slot)
      )
      const existingStart = slot.col
      const existingEnd = slot.col + existingWidth
      return !(preferredCol < existingEnd && existingStart < end)
    })
}

export function getSupplyPanelLayout(panel: Panel | null | undefined) {
  const rows = getSupplyPanelRows(panel)
  const cols = getSupplyPanelColumns(panel)
  const contentWidth = cols * CELL_W
  const contentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
  return {
    rows,
    cols,
    contentWidth,
    contentHeight,
  }
}

export function rebalanceSupplyOverflowIntoMain(
  targetPanel: Panel,
  targetProject: PanelSupplySlotProject
): { mainSlots: PanelGridSlot[]; supplySlots: PanelGridSlot[] } {
  const { rows: supplyRows, cols: supplyCols } = getSupplyPanelLayout(targetPanel)
  const cols = getPanelGridTotalColumns(targetPanel.gridView)
  const rows = targetPanel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
  const feedFromTop = targetPanel.gridView?.feedFromTop ?? false
  const existingMainSlots = targetPanel.gridView?.slots ?? []
  const existingSupplySlots = targetPanel.gridView?.supplyPanelSlots ?? []
  const explicitMainSupplyKeys = new Set(
    existingMainSlots
      .filter((slot) => slot.module.kind === 'trunkDevice' && slot.module.scope === 'supply')
      .map((slot) => panelGridModuleRefKey(slot.module))
  )
  const prevMainByKey = new Map(
    existingMainSlots.map((slot) => [panelGridModuleRefKey(slot.module), slot])
  )
  const prevSupplyByKey = new Map(
    existingSupplySlots.map((slot) => [panelGridModuleRefKey(slot.module), slot])
  )

  const orderedSupplyRefs = getSharedSupplyRefsForPanel(targetProject, targetPanel).filter(
    (ref) => !explicitMainSupplyKeys.has(panelGridModuleRefKey(ref))
  )

  const packedSupply = packAutoArrangeSupplySlots(
    orderedSupplyRefs,
    supplyRows,
    supplyCols,
    (ref) =>
      resolveModuleWidthCols(
        ref,
        targetProject,
        prevSupplyByKey.get(panelGridModuleRefKey(ref)) ??
          prevMainByKey.get(panelGridModuleRefKey(ref))
      )
  )

  const supplySlots = packedSupply.placed.map(({ item: ref, row, col }) => {
    const key = panelGridModuleRefKey(ref)
    const prev = prevSupplyByKey.get(key) ?? prevMainByKey.get(key)
    return { row, col, module: ref, ...getManualWidthProps(prev) }
  })
  const supplyKeys = new Set(supplySlots.map((slot) => panelGridModuleRefKey(slot.module)))
  const mainSlots = existingMainSlots
    .filter((slot) => !supplyKeys.has(panelGridModuleRefKey(slot.module)))
    .map((slot) => ({ ...slot }))
  const occupied = mainSlots.map((slot) => ({
    row: slot.row,
    col: slot.col,
    width: Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      resolveModuleWidthCols(slot.module, targetProject, slot)
    ),
  }))

  for (const ref of packedSupply.overflow) {
    const key = panelGridModuleRefKey(ref)
    const existing = mainSlots.find((slot) => panelGridModuleRefKey(slot.module) === key)
    if (existing) continue
    const prev = prevMainByKey.get(key) ?? prevSupplyByKey.get(key)
    const width = Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      resolveModuleWidthCols(ref, targetProject, prev)
    )
    const spot = findFirstFreeMainOrOverflowSlot(
      occupied,
      width,
      rows,
      cols,
      feedFromTop,
      getPanelGridFieldLayout(targetPanel.gridView)
    )
    const nextSlot = {
      row: spot.row,
      col: spot.col,
      module: ref,
      ...getManualWidthProps(prev),
    }
    mainSlots.push(nextSlot)
    occupied.push({ row: spot.row, col: spot.col, width })
  }
  return { mainSlots, supplySlots }
}

export function placeSupplyModuleAfterInsert(
  targetPanel: Panel,
  targetProject: PanelSupplySlotProject,
  moduleRef: PanelGridModuleRef,
  preferredRow?: number,
  preferredCol?: number
): { mainSlots: PanelGridSlot[]; supplySlots: PanelGridSlot[] } {
  const { rows, cols } = getSupplyPanelLayout(targetPanel)
  const existingMainSlots = targetPanel.gridView?.slots ?? []
  const existingSupplySlots = targetPanel.gridView?.supplyPanelSlots ?? []
  const key = panelGridModuleRefKey(moduleRef)
  const existingSupplySlot = existingSupplySlots.find(
    (slot) => panelGridModuleRefKey(slot.module) === key
  )
  const existingMainSlot = existingMainSlots.find(
    (slot) => panelGridModuleRefKey(slot.module) === key
  )
  const width = Math.max(
    MIN_PANEL_GRID_MODULE_WIDTH,
    resolveModuleWidthCols(moduleRef, targetProject, existingSupplySlot ?? existingMainSlot)
  )

  if (
    preferredRow != null &&
    preferredCol != null &&
    canPlaceSupplyModuleAt(
      existingSupplySlots,
      key,
      preferredRow,
      preferredCol,
      width,
      rows,
      cols,
      targetProject
    )
  ) {
    const nextSupplySlots = [
      ...existingSupplySlots.filter((slot) => panelGridModuleRefKey(slot.module) !== key),
      {
        row: preferredRow,
        col: preferredCol,
        module: moduleRef,
        ...getManualWidthProps(existingSupplySlot),
      },
    ]
    const nextMainSlots = existingMainSlots.filter(
      (slot) => panelGridModuleRefKey(slot.module) !== key
    )
    return { mainSlots: nextMainSlots, supplySlots: nextSupplySlots }
  }

  return rebalanceSupplyOverflowIntoMain(targetPanel, targetProject)
}

export function buildPanelAutoArrangeSlots({
  feedSideDirection,
  getPanelGridModules,
  targetPanel,
  targetProject,
}: {
  feedSideDirection: PanelFeedSideDirection
  getPanelGridModules: GetPanelGridModulesFn
  targetPanel: Panel
  targetProject: PanelSupplySlotProject
}): { mainSlots: PanelGridSlot[]; supplySlots: PanelGridSlot[] } {
  const cols = getPanelGridTotalColumns(targetPanel.gridView)
  const feedFromTop = targetPanel.gridView?.feedFromTop ?? false
  const panelRows = targetPanel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
  const existingMainSlots = targetPanel.gridView?.slots ?? []
  const existingSupplySlots = targetPanel.gridView?.supplyPanelSlots ?? []
  const prevMainByKey = new Map(
    existingMainSlots.map((slot) => [panelGridModuleRefKey(slot.module), slot])
  )
  const prevSupplyByKey = new Map(
    existingSupplySlots.map((slot) => [panelGridModuleRefKey(slot.module), slot])
  )
  const explicitMainSupplyKeys = new Set(
    existingMainSlots
      .filter((slot) => slot.module.kind === 'trunkDevice' && slot.module.scope === 'supply')
      .map((slot) => panelGridModuleRefKey(slot.module))
  )

  const supplyRefs = getSharedSupplyRefsForPanel(targetProject, targetPanel).filter(
    (ref) => !explicitMainSupplyKeys.has(panelGridModuleRefKey(ref))
  )
  const { rows: supplyRows, cols: supplyCols } = getSupplyPanelLayout(targetPanel)
  const packedSupply = packAutoArrangeSupplySlots(supplyRefs, supplyRows, supplyCols, (ref) =>
    resolveModuleWidthCols(
      ref,
      targetProject,
      prevSupplyByKey.get(panelGridModuleRefKey(ref)) ??
        prevMainByKey.get(panelGridModuleRefKey(ref))
    )
  )
  const supplySlots = packedSupply.placed.map(({ item: ref, row, col }) => {
    const key = panelGridModuleRefKey(ref)
    const prev = prevSupplyByKey.get(key) ?? prevMainByKey.get(key)
    return { row, col, module: ref, ...getManualWidthProps(prev) }
  })
  const overflowSupplyKeys = new Set(packedSupply.overflow.map((ref) => panelGridModuleRefKey(ref)))

  const allModules = getPanelGridModules(targetPanel.id).filter(
    (module) => !(module.ref.kind === 'trunkDevice' && module.ref.scope === 'ground')
  )
  const mainModules = allModules.filter((module) => {
    const key = panelGridModuleRefKey(module.ref)
    return module.inSupplyPanel !== true || overflowSupplyKeys.has(key)
  })
  const moduleMap = new Map(mainModules.map((m) => [panelGridModuleRefKey(m.ref), m]))
  const moduleOrder = mainModules.map((m) => m.ref)

  const protectionById = new Map<string, ProtectionDevice>(
    targetPanel.protections.map((protection) => [protection.id, protection])
  )
  const circuitToProtectionId = new Map<string, string>()
  for (const protection of targetPanel.protections) {
    for (const circuit of protection.circuits ?? [])
      circuitToProtectionId.set(circuit.id, protection.id)
  }
  const childProtectionIds = new Set<string>()
  for (const protection of targetPanel.protections) {
    for (const circuit of protection.circuits ?? []) {
      for (const subId of circuit.subCircuitIds ?? []) {
        const childId = circuitToProtectionId.get(subId)
        if (childId) childProtectionIds.add(childId)
      }
    }
  }
  const rootProtections = targetPanel.protections.filter(
    (protection) => !childProtectionIds.has(protection.id)
  )

  const widthFor = (ref: PanelGridModuleRef) =>
    Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      resolveModuleWidthCols(
        ref,
        targetProject,
        prevMainByKey.get(panelGridModuleRefKey(ref)) ??
          prevSupplyByKey.get(panelGridModuleRefKey(ref))
      )
    )
  const orientRow = (row: PanelGridModuleRef[]): PanelGridModuleRef[] =>
    feedSideDirection === 'right' ? [...row].reverse() : row

  const arrangedGroups: AutoArrangeGroup<PanelGridModuleRef>[] = []
  const seenKeys = new Set<string>()
  const consumeRef = (ref: PanelGridModuleRef): PanelGridModuleRef | null => {
    const key = panelGridModuleRefKey(ref)
    if (!moduleMap.has(key) || seenKeys.has(key)) return null
    seenKeys.add(key)
    return ref
  }
  const addLeafGroup = (refs: PanelGridModuleRef[]) => {
    const row = refs
      .map((ref) => consumeRef(ref))
      .filter((ref): ref is PanelGridModuleRef => ref != null)
    if (row.length > 0) arrangedGroups.push({ rows: [row] })
  }

  const buildProtectionGroup = (
    protectionId: string,
    seen = new Set<string>()
  ): { group: AutoArrangeGroup<PanelGridModuleRef>; hasDescendants: boolean } | null => {
    if (seen.has(protectionId)) return null
    seen.add(protectionId)
    const protection = protectionById.get(protectionId)
    if (!protection) return null

    const ownRow: PanelGridModuleRef[] = []
    const selfRef = consumeRef({ kind: 'protection', id: protection.id })
    if (selfRef) ownRow.push(selfRef)

    const childGroups: AutoArrangeGroup<PanelGridModuleRef>[] = []
    const leafChildRefs: PanelGridModuleRef[] = []
    for (const circuit of protection.circuits ?? []) {
      for (const trunkDevice of circuit.trunkDevices ?? []) {
        const trunkRef = consumeRef({
          kind: 'trunkDevice',
          id: trunkDevice.id,
          scope: 'circuit',
          circuitId: circuit.id,
        })
        if (trunkRef) ownRow.push(trunkRef)
      }
      for (const endpoint of circuit.endpoints ?? []) {
        if (endpoint.symbol !== 'domotica') continue
        const domoticaRef = consumeRef({
          kind: 'domotica',
          endpointId: endpoint.id,
          circuitId: circuit.id,
        })
        if (domoticaRef) ownRow.push(domoticaRef)
      }
      for (const subId of circuit.subCircuitIds ?? []) {
        const childProtectionId = circuitToProtectionId.get(subId)
        if (!childProtectionId) continue
        const childGroup = buildProtectionGroup(childProtectionId, seen)
        if (!childGroup) continue
        const childIsLeaf = childGroup.hasDescendants !== true
        if (childIsLeaf) {
          leafChildRefs.push(...(childGroup.group.rows[0] ?? []))
        } else {
          childGroups.push(childGroup.group)
        }
      }
    }

    const ownRowWidth =
      ownRow.reduce((sum, ref) => sum + widthFor(ref), 0) +
      leafChildRefs.reduce((sum, ref) => sum + widthFor(ref), 0)

    const rows: PanelGridModuleRef[][] = []
    if (ownRow.length > 0 || leafChildRefs.length > 0) {
      rows.push(orientRow(ownRowWidth <= cols ? [...ownRow, ...leafChildRefs] : ownRow))
    }
    if (ownRowWidth > cols && leafChildRefs.length > 0) rows.push(orientRow(leafChildRefs))
    if (childGroups.length > 0) {
      rows.push(...packGroupsIntoLocalRows(childGroups, cols, widthFor, feedSideDirection))
    }
    const hasDescendants = leafChildRefs.length > 0 || childGroups.length > 0
    return rows.length > 0
      ? {
          group: {
            rows,
            standalone: hasDescendants,
            align: hasDescendants ? feedSideDirection : undefined,
          },
          hasDescendants,
        }
      : null
  }

  const panelFeedPrefixRefs: PanelGridModuleRef[] = []
  const panelFeedSuffixRefs: PanelGridModuleRef[] = []
  let panelFeedAnchorRef: PanelGridModuleRef | null = null
  const installation = getProjectElectricalInstallation(targetProject)
  const panels = getProjectElectricalPanels(targetProject)
  if (targetPanel.isMain && installation) {
    const projection = getPanelFeedProjection(installation, panels, targetPanel)
    if (projection) {
      const refs: PanelGridModuleRef[] = []
      for (const device of projection.devices) {
        const ref = consumeRef({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
        if (ref) refs.push(ref)
      }
      if (refs.length > 0) {
        panelFeedAnchorRef = refs[refs.length - 1] ?? null
        panelFeedPrefixRefs.push(...refs.slice(0, -1))
      }
    }
  } else {
    const panelFeed = getSubPanelMainBusFeedDevice(targetPanel)
    if (panelFeed) {
      const refs: PanelGridModuleRef[] = []
      for (const device of panelFeed.orderedDevices) {
        const ref = consumeRef({
          kind: 'trunkDevice',
          id: device.id,
          scope: 'circuit',
          circuitId: panelFeed.circuit.id,
        })
        if (ref) refs.push(ref)
      }
      if (refs.length > 0) {
        const anchorKey = panelGridModuleRefKey({
          kind: 'trunkDevice',
          id: panelFeed.device.id,
          scope: 'circuit',
          circuitId: panelFeed.circuit.id,
        })
        const anchorIndex = refs.findIndex((ref) => panelGridModuleRefKey(ref) === anchorKey)
        if (anchorIndex >= 0) {
          panelFeedAnchorRef = refs[anchorIndex] ?? null
          panelFeedPrefixRefs.push(...refs.slice(0, anchorIndex))
          panelFeedSuffixRefs.push(...refs.slice(anchorIndex + 1))
        }
      }
    }
  }

  const rootLeafSegments: PanelGridModuleRef[][] = []
  const rootBranchGroups: AutoArrangeGroup<PanelGridModuleRef>[] = []
  for (const root of rootProtections) {
    const built = buildProtectionGroup(root.id)
    if (!built) continue
    if (panelFeedAnchorRef && built.hasDescendants !== true) {
      const row = built.group.rows[0] ?? []
      if (row.length > 0) rootLeafSegments.push(row)
      continue
    }
    if (built.group) {
      if (panelFeedAnchorRef && built.hasDescendants) {
        rootBranchGroups.push(built.group)
      } else {
        arrangedGroups.push(built.group)
      }
    }
  }

  if (panelFeedPrefixRefs.length > 0) addLeafGroup(orientRow(panelFeedPrefixRefs))

  if (panelFeedAnchorRef) {
    const feedRowRefs = orientRow([panelFeedAnchorRef])
    const anchoredRows = packAnchoredSegmentsIntoRows(
      feedRowRefs,
      rootLeafSegments,
      cols,
      widthFor,
      feedSideDirection
    )
    if (anchoredRows.length > 0) {
      arrangedGroups.push({
        rows: anchoredRows,
        standalone: true,
        align: feedSideDirection,
      })
    }
    arrangedGroups.push(
      ...rootBranchGroups.map((group) => ({
        ...group,
        align: feedSideDirection,
      }))
    )
  }

  if (panelFeedSuffixRefs.length > 0) addLeafGroup(orientRow(panelFeedSuffixRefs))

  for (const ref of moduleOrder) addLeafGroup([ref])

  const inFields = (pack: (rows: number, columns: number) => PanelGridSlot[]) =>
    packSlotsInFields(targetPanel.gridView, panelRows, feedFromTop, widthFor, pack)
  const packed = inFields((rows, columns) =>
    arrangedGroups.length > 0
      ? packAutoArrangeMainGroupSlots(
          arrangedGroups,
          rows,
          columns,
          feedFromTop,
          widthFor,
          feedSideDirection
        )
      : packAutoArrangeMainSlots([], rows, columns, feedFromTop, widthFor, feedSideDirection)
  )
  // Hierarchy groups normally get dedicated row blocks so parent/child
  // relationships remain legible. If that policy creates overflow, retry with
  // a compact linear pack and keep whichever plan fits more physical modules.
  // This matters when the panel is genuinely too small: a large hierarchy
  // group must not eject its siblings as a single all-or-nothing block.
  const panelColUnits = panelModulesToGridUnits(cols)
  const fitsInPanel = (slot: PanelGridSlot) =>
    slot.row >= 0 &&
    slot.row < panelRows &&
    panelModulesToGridUnits(slot.col) + panelModulesToGridUnits(widthFor(slot.module)) <=
      panelColUnits
  const inGridCount = (slots: PanelGridSlot[]) => slots.filter(fitsInPanel).length
  const compactPacked = packed.some((slot) => !fitsInPanel(slot))
    ? inFields((rows, columns) =>
        packAutoArrangeMainSlots(moduleOrder, rows, columns, feedFromTop, widthFor, feedSideDirection)
      )
    : packed
  const effectivePacked = inGridCount(compactPacked) > inGridCount(packed) ? compactPacked : packed
  const mainSlots = effectivePacked.map((slot) => {
    const prev =
      prevMainByKey.get(panelGridModuleRefKey(slot.module)) ??
      prevSupplyByKey.get(panelGridModuleRefKey(slot.module))
    return { ...slot, ...getManualWidthProps(prev) }
  })

  return { mainSlots, supplySlots }
}

function getSharedSupplyRefsForPanel(
  project: PanelSupplySlotProject,
  panel: Panel | null
): PanelGridModuleRef[] {
  if (!panel?.isMain) return []
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const projection = getPanelFeedProjection(
    installation,
    getProjectElectricalPanels(project),
    panel
  )
  return (projection?.sharedFeed.trunkDevices ?? []).map(
    (device) => ({ kind: 'trunkDevice', id: device.id, scope: 'supply' }) as PanelGridModuleRef
  )
}
