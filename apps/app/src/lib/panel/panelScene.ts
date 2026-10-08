import { getAllCircuits, isTerminalStripDevice } from '@/lib/eendraad/projectElectricalDomain'
/**
 * Pure construction of the panel hierarchy scene (surfaces + connectors).
 * Used by PanelCanvas / HierarchyPanelCanvas for both full-tree and filtered views.
 */
import { getAllSupplyTrunkDevices, getPanelFeedProjection } from '@/lib/feedTopology'
import { getPanelDisplayName } from '@/utils/panelNames'
import type { Panel, PanelGridModuleRef, PanelGridSlot } from '@/types/schema'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  getAuxiliaryEnclosureSupplyDeviceIds,
  MIN_AUXILIARY_COLUMNS,
  resolveSupplyDeviceMounting,
} from '@/lib/panel/auxiliarySupplyEnclosures'
import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'
import { assemblyOwnsPanelInput, buildSupplyElectricalTopology, type SupplyPhysicalTarget } from '@/lib/supplyAssembly/electricalTopology'
import { selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { getPanelBusSections } from '@/lib/panel/panelBusSections'
import { isSupplyDeviceVisibleInPanel } from '@/lib/panel/supplyPanelVisibility'
import { getSharedSupplyFrameDevices, SHARED_SUPPLY_FRAME_ID } from './sharedSupplyFrame'
import {
  CELL_H,
  CELL_W,
  ROW_GAP,
  TERMINAL_STRIP_RAIL_H,
  getPanelGridPlacements,
  getTerminalStripBottomExtent,
  getTerminalStripTopOffset,
  getSupplyPanelColumns,
  getSupplyPanelRows,
  getSupplyPanelPlacements,
  panelGridModuleRefKey,
  type ModulePlacement,
} from '@/components/canvas/panel/panelGridLayout'
import {
  collectJunctionPanelOccurrences,
  getJunctionPanelGridView,
  getJunctionPanelIdentity,
  getJunctionPanelTerminal,
} from '@/lib/junctionPanel/grid'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import {
  findConverterBackupPanelFeed,
  findConverterBackupPanelFeedsFromSource,
  type ConverterBackupPanelFeed,
} from '@/lib/panel/converterBackupPanelFeed'

export const PANEL_SCENE_FRAME_MARGIN = 40
/** Vertical gap between main and supply regions on one panel surface (matches legacy PanelCanvas). */
export const PANEL_SCENE_SUPPLY_GAP = 20
export const PANEL_SCENE_SHARED_SUPPLY_ID = SHARED_SUPPLY_FRAME_ID

export type PanelScenePanelOption = {
  id: string
  panel: Panel
  isRoot: boolean
}

export type PanelSceneSurfaceKind = 'shared_supply' | 'auxiliary' | 'junction_panel' | 'panel'

export interface PanelSceneSurface {
  id: string
  panel: Panel | null
  enclosure?: AuxiliaryElectricalEnclosure
  /** Panels containing occurrences of this shared junction-panel identity. */
  junctionPanelOwnerIds?: string[]
  junctionPanelGridView?: Panel['gridView']
  kind: PanelSceneSurfaceKind
  x: number
  y: number
  width: number
  height: number
  mainPanelY: number
  supplyPanelY: number
  panelFrameHeight: number
  supplyFrameHeight: number
  contentWidth: number
  supplyContentWidth: number
  supplyRows: number
  supplyCols: number
  rows: number
  cols: number
  feedFromTop: boolean
  placements: Array<ModulePlacement & { inSupplyPanel?: boolean }>
  supplyPanelVisible: boolean
  label: string
  converterBackupFeed?: ConverterBackupPanelFeed | null
  converterBackupSourceFeed?: ConverterBackupPanelFeed | null
}

/**
 * Sub-panel id -> junction panel identity its feeder passes through.
 * With several junction panels on one feeder, the one nearest the sub-panel wins.
 */
function collectJunctionPanelFedPanels(project: ProjectWithOptionalV2Electrical): Map<string, string> {
  const fedThrough = new Map<string, string>()
  const visitPanel = (panel: Panel) => {
    for (const protection of panel.protections ?? []) {
      if (!protection.subPanelId) continue
      let nearest: { identity: string; position: number } | null = null
      for (const circuit of protection.circuits ?? []) {
        for (const device of circuit.trunkDevices ?? []) {
          const identity = getJunctionPanelIdentity(device)
          if (!identity) continue
          const position = device.trunkPosition ?? 0
          if (!nearest || position >= nearest.position) nearest = { identity, position }
        }
      }
      if (nearest) fedThrough.set(protection.subPanelId, nearest.identity)
    }
    for (const child of panel.subPanels ?? []) visitPanel(child)
  }
  for (const panel of getProjectElectricalPanels(project)) visitPanel(panel)
  return fedThrough
}

export interface PanelSceneConnector {
  points: number[]
  sourceSurfaceId?: string
  targetSurfaceId?: string
}

export interface ConverterBackupFeedMarkerGeometry {
  sourceX: number
  sourceY: number
  symbolSize: number
  wirePaths: number[][]
}

export interface BuiltPanelScene {
  width: number
  height: number
  surfaces: PanelSceneSurface[]
  connectors: PanelSceneConnector[]
  moduleRefs: Set<string>
  sharedSupplyTrunkRefKeys: Set<string>
}

function getSupplyPanelLayout(panel: Panel | null | undefined) {
  const rows = getSupplyPanelRows(panel)
  const cols = getSupplyPanelColumns(panel)
  const contentWidth = cols * CELL_W
  const contentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
  return { rows, cols, contentWidth, contentHeight }
}

/** Virtual converter source below its physical board, feeding the real outgoing protection. */
export function getConverterBackupFeedMarkerGeometry(
  surface: PanelSceneSurface
): ConverterBackupFeedMarkerGeometry | null {
  if (!surface.converterBackupSourceFeed || !surface.panel) return null
  const targets = surface.placements.filter(
    (placement) =>
      placement.ref.kind === 'protection' &&
      placement.ref.id === surface.converterBackupSourceFeed?.protectionId
  )
  const sourceX =
    targets.length > 0
      ? targets.reduce((sum, target) => sum + target.x + target.width / 2, 0) / targets.length
      : surface.width / 2
  const frameBottom = surface.mainPanelY + surface.panelFrameHeight
  const sourceY = frameBottom + 48
  const symbolSize = 32
  const busY = frameBottom + 18
  const wirePaths =
    targets.length > 0
      ? targets.map((target) => {
          const targetX = target.x + target.width / 2
          const targetY = target.y + target.height
          return [sourceX, sourceY - symbolSize / 2, sourceX, busY, targetX, busY, targetX, targetY]
        })
      : [[sourceX, sourceY - symbolSize / 2, sourceX, frameBottom]]
  return { sourceX, sourceY, symbolSize, wirePaths }
}

export function routePanelSceneConnector(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  gapY: number
): number[] {
  if (Math.abs(fromX - toX) < 0.5) return [fromX, fromY, toX, toY]
  return [fromX, fromY, fromX, gapY, toX, gapY, toX, toY]
}

export function routePanelSceneSurfaceTransition(
  source: Pick<PanelSceneSurface, 'x' | 'y' | 'width' | 'height'> & Partial<Pick<PanelSceneSurface, 'kind'>>,
  target: Pick<PanelSceneSurface, 'x' | 'y' | 'width' | 'height'> & Partial<Pick<PanelSceneSurface, 'kind'>>
): number[] {
  const sourceCenterX = source.x + source.width / 2
  const sourceCenterY = source.y + source.height / 2
  const targetCenterX = target.x + target.width / 2
  const targetCenterY = target.y + target.height / 2
  const dx = targetCenterX - sourceCenterX
  const dy = targetCenterY - sourceCenterY
  // Separated rows use the hierarchy feed direction even when far apart horizontally.
  // A side portal would make the wire circle the enclosure to reach its incoming lane.
  if (source.kind !== 'panel' && target.kind !== 'panel' &&
    source.y < target.y + target.height && target.y < source.y + source.height) {
    const sourceX = dx >= 0 ? source.x + source.width : source.x
    const targetX = dx >= 0 ? target.x : target.x + target.width
    const corridorX = (sourceX + targetX) / 2
    return [
      sourceX,
      sourceCenterY,
      corridorX,
      sourceCenterY,
      corridorX,
      targetCenterY,
      targetX,
      targetCenterY,
    ]
  }
  const sourceY = dy >= 0 ? source.y + source.height : source.y
  const targetY = dy >= 0 ? target.y : target.y + target.height
  return routePanelSceneConnector(
    sourceCenterX,
    sourceY,
    targetCenterX,
    targetY,
    (sourceY + targetY) / 2
  )
}

/**
 * Visible frame-to-frame links for topology-only panel feeders.
 * These extend into both panel frames because there is intentionally no DIN module to terminate on.
 */
export function buildDirectPanelFeederConnectors(
  surfaces: PanelSceneSurface[],
  project: ProjectWithOptionalV2Electrical
): PanelSceneConnector[] {
  const surfaceByPanelId = new Map(
    surfaces
      .filter((surface): surface is PanelSceneSurface & { panel: Panel } => surface.panel != null)
      .map((surface) => [surface.panel.id, surface] as const)
  )
  const connectors: PanelSceneConnector[] = []
  const seenLinks = new Set<string>()

  const visit = (panel: Panel): void => {
    const sourceSurface = surfaceByPanelId.get(panel.id)
    if (sourceSurface) {
      for (const protection of panel.protections) {
        const targetPanelId = protection.directPanelFeeder ? protection.subPanelId : undefined
        if (!targetPanelId) continue
        const targetSurface = surfaceByPanelId.get(targetPanelId)
        const linkKey = `${panel.id}:${targetPanelId}`
        if (!targetSurface || seenLinks.has(linkKey)) continue
        seenLinks.add(linkKey)

        const sourceCenterY =
          sourceSurface.y + sourceSurface.mainPanelY + sourceSurface.panelFrameHeight / 2
        const targetCenterY =
          targetSurface.y + targetSurface.mainPanelY + targetSurface.panelFrameHeight / 2
        const targetIsAbove = targetCenterY < sourceCenterY
        const sourceX = sourceSurface.x + sourceSurface.width / 2
        const targetX = targetSurface.x + targetSurface.width / 2
        const sourceY = targetIsAbove
          ? sourceSurface.y + sourceSurface.mainPanelY + PANEL_SCENE_FRAME_MARGIN
          : sourceSurface.y +
            sourceSurface.mainPanelY +
            sourceSurface.panelFrameHeight -
            PANEL_SCENE_FRAME_MARGIN
        const targetY = targetIsAbove
          ? targetSurface.y +
            targetSurface.mainPanelY +
            targetSurface.panelFrameHeight -
            PANEL_SCENE_FRAME_MARGIN
          : targetSurface.y + targetSurface.mainPanelY + PANEL_SCENE_FRAME_MARGIN

        connectors.push({
          points: routePanelSceneConnector(
            sourceX,
            sourceY,
            targetX,
            targetY,
            (sourceY + targetY) / 2
          ),
        })
      }
    }
    for (const subPanel of panel.subPanels ?? []) visit(subPanel)
  }

  for (const panel of getProjectElectricalPanels(project)) visit(panel)
  return connectors
}

export type GetPanelGridModulesFn = (panelId: string) => Array<{
  ref: PanelGridModuleRef
  terminalStripMemberRefs?: PanelGridModuleRef[]
  inSupplyPanel?: boolean
  slot?: Pick<
    PanelGridSlot,
    'row' | 'col' | 'moduleWidth' | 'moduleWidthManual' | 'terminalStripRail'
  >
}>

export interface BuildPanelSceneParams {
  project: ProjectWithOptionalV2Electrical & {
    project?: {
      locale?: string
    }
  }
  panelOptions: PanelScenePanelOption[]
  getPanelGridModules: GetPanelGridModulesFn
  /** When true, layout includes sub-panels under each root. Full scene always uses true. */
  includeDescendants: boolean
  /** Shared supply strip feed direction (from first root). */
  hierarchyFeedFromTop: boolean
  sharedSupplyLabel: string
}

/**
 * Builds the same scene previously computed inside HierarchyPanelCanvas `useMemo`.
 */
export function buildFullPanelScene(params: BuildPanelSceneParams): BuiltPanelScene | null {
  const {
    project: currentProject,
    panelOptions,
    getPanelGridModules,
    includeDescendants,
    hierarchyFeedFromTop,
    sharedSupplyLabel,
  } = params

  const rootOptions = panelOptions.filter((option) => option.isRoot)
  if (rootOptions.length === 0) return null
  const firstRootOption = rootOptions[0]
  if (!firstRootOption) return null

  const hasConverterBackupRoot = rootOptions.some((option) =>
    findConverterBackupPanelFeed(currentProject, option.panel.id)
  )
  const rootGap = hasConverterBackupRoot ? 120 : 56
  const levelGap = 72
  const siblingGap = 48

  const installation = getProjectElectricalInstallation(currentProject)
  const rootPanels = getProjectElectricalPanels(currentProject)
  const sharedRefs: PanelGridModuleRef[] = getSharedSupplyFrameDevices(currentProject)
    .map((device) => ({ kind: 'trunkDevice' as const, id: device.id, scope: 'supply' as const }))
  const sharedRefKeys = new Set(sharedRefs.map((ref) => panelGridModuleRefKey(ref)))
  const baseRootCols = firstRootOption.panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
  const sharedSlotMap = new Map(
    (firstRootOption.panel.gridView?.supplyPanelSlots ?? [])
      .filter((slot) => sharedRefKeys.has(panelGridModuleRefKey(slot.module)))
      .map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
  )

  const sharedLayoutPanel: Panel = {
    ...firstRootOption.panel,
    gridView: {
      rows: 1,
      columns: baseRootCols,
      feedFromTop: hierarchyFeedFromTop,
      slots: [...sharedSlotMap.values()],
    },
  }
  const sharedPlacements = getPanelGridPlacements(
    sharedLayoutPanel,
    currentProject,
    sharedRefs.map((ref) => ({ ref, slot: sharedSlotMap.get(panelGridModuleRefKey(ref)) }))
  )
  const baseRootContentWidth = baseRootCols * CELL_W
  const sharedContentWidth = baseRootContentWidth
  const sharedWidth = sharedContentWidth + PANEL_SCENE_FRAME_MARGIN * 2
  const sharedVisible = sharedRefs.length > 0 ||
    rootPanels.find((panel) => panel.isMain)?.gridView?.supplyPanelVisible !== false
  const sharedHeight = sharedVisible ? CELL_H + PANEL_SCENE_FRAME_MARGIN * 2 : 0
  const sharedBandHeight = sharedVisible ? sharedHeight + rootGap : 0

  const M = PANEL_SCENE_FRAME_MARGIN
  const GAP = PANEL_SCENE_SUPPLY_GAP

  const buildSurfaceForPanel = (panel: Panel): Omit<PanelSceneSurface, 'x' | 'y'> => {
    const rows = panel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
    const cols = panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
    const supplyLayout = getSupplyPanelLayout(panel)
    const feedFromTop = panel.gridView?.feedFromTop ?? false
    const mainContentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
    const contentHeight =
      getTerminalStripTopOffset(panel) + mainContentHeight + getTerminalStripBottomExtent(panel)
    const contentWidth = cols * CELL_W
    const panelFrameHeight = contentHeight + M * 2
    const supplyFrameHeight = supplyLayout.contentHeight + M * 2
    const modules = getPanelGridModules(panel.id).filter(
      (module) => !(module.ref.kind === 'trunkDevice' && module.ref.scope === 'ground')
    )
    const mainModules = modules.filter((module) => module.inSupplyPanel !== true)
    const supplyModulesRaw = modules.filter((module) => module.inSupplyPanel === true)
    const supplyModules = panel.isMain ? [] : supplyModulesRaw
    const converterBackupFeed = findConverterBackupPanelFeed(currentProject, panel.id)
    const converterBackupSourceFeed =
      findConverterBackupPanelFeedsFromSource(currentProject, panel.id)[0] ?? null

    const mainPlacements = getPanelGridPlacements(panel, currentProject, mainModules).map(
      (placement) => ({
        ...placement,
        x: placement.x + M,
      })
    )
    const supplyPlacementsRaw = getSupplyPanelPlacements(panel, currentProject, supplyModules)
    const supplyPanelVisible = supplyPlacementsRaw.length > 0
    const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + GAP : 0
    const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + GAP : 0
    const mainPlacementsWithOffset = mainPlacements.map((placement) => ({
      ...placement,
      y: placement.y + mainPanelY + M,
    }))
    const supplyPlacements = supplyPlacementsRaw.map((placement) => ({
      ...placement,
      x: placement.x + M,
      y: placement.y + supplyPanelY + M,
      inSupplyPanel: true as const,
    }))

    return {
      id: panel.id,
      panel,
      kind: 'panel',
      width: Math.max(contentWidth, supplyLayout.contentWidth) + M * 2,
      height: panelFrameHeight + (supplyPanelVisible ? supplyFrameHeight + GAP : 0),
      mainPanelY,
      supplyPanelY,
      panelFrameHeight,
      supplyFrameHeight,
      contentWidth,
      supplyContentWidth: supplyLayout.contentWidth,
      supplyRows: supplyLayout.rows,
      supplyCols: supplyLayout.cols,
      rows,
      cols,
      feedFromTop,
      placements: [...mainPlacementsWithOffset, ...supplyPlacements],
      supplyPanelVisible,
      label: getPanelDisplayName(panel, currentProject),
      converterBackupFeed,
      converterBackupSourceFeed,
    }
  }

  const supplyDeviceIds = new Set(getAllSupplyTrunkDevices(currentProject).map(({ id }) => id))
  const buildSurfaceForEnclosure = (enclosure: AuxiliaryElectricalEnclosure): PanelSceneSurface => {
    const rows = Math.max(1, enclosure.gridView.rows)
    const cols = Math.max(MIN_AUXILIARY_COLUMNS, enclosure.gridView.columns)
    const contentWidth = cols * CELL_W
    const layoutPanel: Panel = {
      ...firstRootOption.panel,
      gridView: { ...enclosure.gridView, rows, columns: cols },
    }
    const contentHeight =
      getTerminalStripTopOffset(layoutPanel) +
      rows * CELL_H +
      Math.max(0, rows - 1) * ROW_GAP +
      getTerminalStripBottomExtent(layoutPanel)
    const slotByKey = new Map(
      enclosure.gridView.slots.map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
    )
    const auxiliaryRefs = getAuxiliaryEnclosureSupplyDeviceIds(currentProject, enclosure.id)
      .filter((deviceId) => supplyDeviceIds.has(deviceId))
      .filter((deviceId) => isSupplyDeviceVisibleInPanel(currentProject, deviceId))
      .map(
        (deviceId): PanelGridModuleRef => ({
          kind: 'trunkDevice',
          id: deviceId,
          scope: 'supply',
        })
      )
    const terminalRefs: PanelGridModuleRef[] = panelOptions.flatMap(({ panel }) =>
      getAllCircuits(panel).flatMap((circuit) => (circuit.trunkDevices ?? [])
        .filter((device) => isTerminalStripDevice(device) && device.panelMounting?.kind === 'auxiliary' && device.panelMounting.enclosureId === enclosure.id)
        .map((device): PanelGridModuleRef => ({ kind: 'trunkDevice', id: device.id, scope: 'circuit', circuitId: circuit.id }))))
    const placements = getPanelGridPlacements(
      layoutPanel,
      currentProject,
      [...auxiliaryRefs, ...terminalRefs].map((ref) => ({
        ref,
        slot: slotByKey.get(panelGridModuleRefKey(ref)),
      }))
    ).map((placement) => ({
      ...placement,
      x: placement.x + M,
      y: placement.y + M,
      inSupplyPanel: placement.ref.kind === 'trunkDevice' && placement.ref.scope === 'supply',
    }))
    return {
      id: enclosure.id,
      panel: null,
      enclosure,
      kind: 'auxiliary',
      x: enclosure.panelViewPosition?.x ?? 0,
      y: sharedBandHeight,
      width: contentWidth + M * 2,
      height: contentHeight + M * 2,
      mainPanelY: 0,
      supplyPanelY: 0,
      panelFrameHeight: contentHeight + M * 2,
      supplyFrameHeight: contentHeight + M * 2,
      contentWidth,
      supplyContentWidth: contentWidth,
      supplyRows: rows,
      supplyCols: cols,
      rows,
      cols,
      feedFromTop: enclosure.gridView.feedFromTop,
      placements,
      supplyPanelVisible: true,
      label: enclosure.name,
      converterBackupFeed: null,
      converterBackupSourceFeed: null,
    }
  }

  type TreeNode = {
    /** Null for a junction panel node. */
    panel: Panel | null
    surface: Omit<PanelSceneSurface, 'x' | 'y'>
    children: TreeNode[]
    subtreeWidth: number
    x: number
    y: number
  }
  type PanelTreeNode = TreeNode & { panel: Panel }

  const auxiliaryEnclosures = selectProjectAuxiliaryElectricalEnclosures(currentProject).filter(
    (enclosure) => enclosure.hidden !== true
  )
  const auxiliarySurfaces = auxiliaryEnclosures
    .map(buildSurfaceForEnclosure)
    .sort((left, right) => {
      const leftX = left.enclosure?.panelViewPosition?.x ?? 0
      const rightX = right.enclosure?.panelViewPosition?.x ?? 0
      return leftX - rightX || left.id.localeCompare(right.id)
    })
  const auxiliaryGap = 56
  const junctionPanelSurfaces: PanelSceneSurface[] = [
    ...collectJunctionPanelOccurrences(currentProject).entries(),
  ].map(([identity, occurrences]) => {
    const configuredOccurrence =
      occurrences.find((occurrence) => occurrence.device.junctionPanelGridView) ?? occurrences[0]!
    const gridView = {
      ...getJunctionPanelGridView(configuredOccurrence.device),
      feedFromTop: hierarchyFeedFromTop,
    }
    const cols = Math.max(1, gridView.columns)
    const rows = Math.max(1, gridView.rows)
    const layoutPanel = { ...firstRootOption.panel, gridView }
    const contentWidth = cols * CELL_W
    const mainContentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
    const contentHeight =
      getTerminalStripTopOffset(layoutPanel) +
      mainContentHeight +
      getTerminalStripBottomExtent(layoutPanel)
    const terminalWidth = CELL_W / 3
    const preferredRail = gridView.terminalStripTopRail
      ? ('top' as const)
      : gridView.terminalStripBottomRail
        ? ('bottom' as const)
        : undefined
    const terminalY =
      preferredRail === 'top'
        ? M
        : preferredRail === 'bottom'
          ? M + getTerminalStripTopOffset(layoutPanel) + mainContentHeight + ROW_GAP
          : M + getTerminalStripTopOffset(layoutPanel)
    const placements: PanelSceneSurface['placements'] = occurrences.map((occurrence, index) => {
      const terminal = getJunctionPanelTerminal(occurrence.device, index)
      return {
        ref: occurrence.ref,
        junctionPanelTerminal: {
          panelId: identity,
          terminalId: terminal.id,
          label: terminal.label,
          pinCount: terminal.pinCount,
          feedFromTop: hierarchyFeedFromTop,
        },
        x: M + index * terminalWidth,
        y: terminalY,
        width: terminalWidth,
        height: preferredRail ? TERMINAL_STRIP_RAIL_H : CELL_H,
        row: 0,
        col: index / 3,
        terminalStripRail: preferredRail,
      }
    })
    return {
      id: `junction-panel:${identity}`,
      panel: null,
      junctionPanelGridView: gridView,
      junctionPanelOwnerIds: [
        ...new Set(
          occurrences
            .map((occurrence) => occurrence.ownerPanelId)
            .filter((panelId): panelId is string => Boolean(panelId))
        ),
      ],
      kind: 'junction_panel',
      x: 0,
      y: 0,
      width: contentWidth + M * 2,
      height: contentHeight + M * 2,
      mainPanelY: 0,
      supplyPanelY: 0,
      panelFrameHeight: contentHeight + M * 2,
      supplyFrameHeight: contentHeight + M * 2,
      contentWidth,
      supplyContentWidth: contentWidth,
      supplyRows: rows,
      supplyCols: cols,
      rows,
      cols,
      feedFromTop: true,
      placements,
      supplyPanelVisible: false,
      label: identity,
      converterBackupFeed: null,
      converterBackupSourceFeed: null,
    }
  })
  // Junction panels join the tree layout: each hangs below the first board (in tree order)
  // with an occurrence of it, sharing that board's children row with its sub-panels.
  // A sub-panel whose feeder passes through a junction panel hangs below that junction panel.
  const treeOrder = new Map<string, number>()
  const indexTreeOrder = (panel: Panel) => {
    treeOrder.set(panel.id, treeOrder.size)
    if (includeDescendants) for (const child of panel.subPanels ?? []) indexTreeOrder(child)
  }
  for (const option of rootOptions) indexTreeOrder(option.panel)
  const rootPanelIds = new Set(rootOptions.map((option) => option.panel.id))
  const junctionSurfaceByIdentity = new Map(
    junctionPanelSurfaces.map((surface) => [surface.label, surface] as const)
  )
  const junctionOwnerByIdentity = new Map<string, string>()
  const junctionIdentitiesByOwner = new Map<string, string[]>()
  for (const surface of junctionPanelSurfaces) {
    const owner = (surface.junctionPanelOwnerIds ?? [])
      .filter((panelId) => treeOrder.has(panelId))
      .sort((left, right) => treeOrder.get(left)! - treeOrder.get(right)!)[0]
    if (!owner) continue
    junctionOwnerByIdentity.set(surface.label, owner)
    junctionIdentitiesByOwner.set(owner, [
      ...(junctionIdentitiesByOwner.get(owner) ?? []),
      surface.label,
    ])
  }
  const junctionFedPanelIds = new Map<string, string>()
  for (const [panelId, identity] of collectJunctionPanelFedPanels(currentProject)) {
    const owner = junctionOwnerByIdentity.get(identity)
    const panelOrder = treeOrder.get(panelId)
    if (!owner || panelOrder == null || rootPanelIds.has(panelId)) continue
    // The owner precedes the fed panel in tree order, so re-hanging never creates a cycle.
    if (treeOrder.get(owner)! >= panelOrder) continue
    junctionFedPanelIds.set(panelId, identity)
  }
  const panelsFedByJunction = new Map<string, Panel[]>()
  const collectFedPanels = (panel: Panel) => {
    const identity = junctionFedPanelIds.get(panel.id)
    if (identity) {
      panelsFedByJunction.set(identity, [...(panelsFedByJunction.get(identity) ?? []), panel])
    }
    for (const child of panel.subPanels ?? []) collectFedPanels(child)
  }
  if (includeDescendants) for (const option of rootOptions) collectFedPanels(option.panel)

  const getSubtreeWidth = (surface: { width: number }, children: TreeNode[]) => {
    const childrenWidth =
      children.length > 0
        ? children.reduce((sum, child) => sum + child.subtreeWidth, 0) +
          siblingGap * Math.max(0, children.length - 1)
        : 0
    return Math.max(surface.width, childrenWidth)
  }

  const measureJunctionNode = (identity: string): TreeNode => {
    const surface = junctionSurfaceByIdentity.get(identity)!
    const children = (panelsFedByJunction.get(identity) ?? []).map((panel) => measureNode(panel))
    return { panel: null, surface, children, subtreeWidth: getSubtreeWidth(surface, children), x: 0, y: 0 }
  }

  function measureNode(panel: Panel): PanelTreeNode {
    const subPanels = includeDescendants
      ? (panel.subPanels ?? []).filter((child) => !junctionFedPanelIds.has(child.id))
      : []
    const children: TreeNode[] = [
      ...subPanels.map((child) => measureNode(child)),
      ...(junctionIdentitiesByOwner.get(panel.id) ?? []).map(measureJunctionNode),
    ]
    const surface = buildSurfaceForPanel(panel)
    return { panel, surface, children, subtreeWidth: getSubtreeWidth(surface, children), x: 0, y: 0 }
  }

  const layoutNode = (node: TreeNode, x: number, y: number): void => {
    node.x = x + (node.subtreeWidth - node.surface.width) / 2
    node.y = y
    if (node.children.length === 0) return
    const childrenWidth =
      node.children.reduce((sum, child) => sum + child.subtreeWidth, 0) +
      siblingGap * Math.max(0, node.children.length - 1)
    let cursorX = x + (node.subtreeWidth - childrenWidth) / 2
    const childY = y + node.surface.height + levelGap
    for (const child of node.children) {
      layoutNode(child, cursorX, childY)
      cursorX += child.subtreeWidth + siblingGap
    }
  }

  const auxiliaryBandHeight = auxiliarySurfaces.reduce(
    (height, surface) => Math.max(height, surface.height),
    0
  )
  const minimumPreferredX =
    auxiliarySurfaces.length > 0
      ? Math.min(
          ...auxiliarySurfaces.map(
            (surface) => surface.enclosure?.panelViewPosition?.x ?? surface.x
          )
        )
      : 0
  let auxiliaryCursorX = 0
  for (const surface of auxiliarySurfaces) {
    const preferredX = (surface.enclosure?.panelViewPosition?.x ?? surface.x) - minimumPreferredX
    surface.x = Math.max(preferredX, auxiliaryCursorX)
    auxiliaryCursorX = surface.x + surface.width + auxiliaryGap
  }
  const auxiliaryWidth = Math.max(0, auxiliaryCursorX - auxiliaryGap)
  // Junction panels without a board in this scene (supply or installation ground occurrences
  // only) keep a row of their own below the tree.
  const unownedJunctionSurfaces = junctionPanelSurfaces.filter(
    (surface) => !junctionOwnerByIdentity.has(surface.label)
  )
  let junctionCursorX = 0
  for (const surface of unownedJunctionSurfaces) {
    surface.x = junctionCursorX
    junctionCursorX += surface.width + auxiliaryGap
  }
  const junctionWidth = Math.max(0, junctionCursorX - auxiliaryGap)
  const rootNodes = rootOptions.map((option) => measureNode(option.panel))
  const rootsWidth =
    rootNodes.reduce((sum, node) => sum + node.subtreeWidth, 0) +
    rootGap * Math.max(0, rootNodes.length - 1)
  const totalSceneWidth = Math.max(sharedWidth, rootsWidth, auxiliaryWidth, junctionWidth)
  const sharedX = (totalSceneWidth - sharedWidth) / 2
  const auxiliaryOffsetX = (totalSceneWidth - auxiliaryWidth) / 2
  for (const surface of auxiliarySurfaces) surface.x += auxiliaryOffsetX
  let rootCursorX = (totalSceneWidth - rootsWidth) / 2
  const rootY =
    sharedBandHeight + (auxiliaryBandHeight > 0 ? auxiliaryBandHeight + rootGap : 0)
  for (const node of rootNodes) {
    layoutNode(node, rootCursorX, rootY)
    rootCursorX += node.subtreeWidth + rootGap
  }
  const deepestRootBottom = (node: TreeNode): number =>
    Math.max(node.y + node.surface.height, ...node.children.map(deepestRootBottom))
  const rootBottom = Math.max(...rootNodes.map(deepestRootBottom))
  const junctionOffsetX = (totalSceneWidth - junctionWidth) / 2
  for (const surface of unownedJunctionSurfaces) {
    surface.x += junctionOffsetX
    surface.y = rootBottom + rootGap
  }

  const surfaces: PanelSceneSurface[] = [
    {
      id: PANEL_SCENE_SHARED_SUPPLY_ID,
      panel: null,
      kind: 'shared_supply',
      x: sharedX,
      y: 0,
      width: sharedWidth,
      height: sharedHeight,
      mainPanelY: 0,
      supplyPanelY: 0,
      panelFrameHeight: sharedHeight,
      supplyFrameHeight: sharedHeight,
      contentWidth: sharedContentWidth,
      supplyContentWidth: sharedContentWidth,
      supplyRows: 1,
      supplyCols: baseRootCols,
      rows: 1,
      cols: baseRootCols,
      feedFromTop: hierarchyFeedFromTop,
      placements: sharedPlacements.map((placement) => ({
        ...placement,
        x: placement.x + M,
        y: placement.y + M,
        inSupplyPanel: true as const,
      })),
      supplyPanelVisible: true,
      label: sharedSupplyLabel,
      converterBackupFeed: null,
      converterBackupSourceFeed: null,
    },
    ...auxiliarySurfaces,
    ...unownedJunctionSurfaces,
  ]
  const connectors: PanelSceneConnector[] = []

  const supplyGraph = selectProjectSupplyAssemblies(currentProject).length
    ? buildSupplyElectricalTopology(currentProject) : undefined
  const ownsPanelInput = (panel: Panel) => getPanelBusSections(panel)
    .some((section) => assemblyOwnsPanelInput(currentProject, panel, section.id))
  const collect = (node: TreeNode, parent: TreeNode | null) => {
    surfaces.push({
      ...node.surface,
      x: node.x,
      y: node.y,
    })
    const targetCenterX = node.x + node.surface.width / 2
    const targetTopY = node.y
    if (parent != null && (!node.panel || !assemblyOwnsPanelInput(currentProject, node.panel))) {
      const busY = parent.y + parent.surface.height + levelGap / 2
      connectors.push({
        points: routePanelSceneConnector(
          parent.x + parent.surface.width / 2,
          parent.y + parent.surface.height,
          targetCenterX,
          targetTopY,
          busY
        ),
      })
    }
    for (const child of node.children) collect(child, node)
  }
  for (const node of rootNodes) collect(node, null)

  if (!sharedVisible) surfaces.splice(0, 1)
  const sharedSurface = surfaces.find((surface) => surface.kind === 'shared_supply')
  const surfaceForDevice = (deviceId: string): PanelSceneSurface | undefined => {
    const mounting = resolveSupplyDeviceMounting(currentProject, deviceId)
    if (!mounting || mounting.kind === 'grid') return sharedSurface
    if (mounting.kind === 'auxiliary') {
      return surfaces.find((surface) => surface.kind === 'auxiliary' && surface.id === mounting.enclosureId)
    }
    return surfaces.find((surface) => surface.kind === 'panel' && surface.panel?.id === mounting.panelId)
  }
  const surfaceForTarget = (target: SupplyPhysicalTarget): PanelSceneSurface | undefined => {
    if (target.kind === 'device') return surfaceForDevice(target.deviceId)
    if (target.kind === 'bus') {
      return surfaces.find((surface) => surface.kind === 'panel' && surface.panel?.id === target.panelId)
    }
    return surfaces.find((surface) => surface.kind === 'panel' &&
      (surface.panel?.circuits.some((circuit) => circuit.id === target.circuitId) ||
        surface.panel?.protections.some((protection) => protection.circuits?.some((circuit) => circuit.id === target.circuitId))))
  }
  const emittedTransitions = new Set<string>()
  const addSurfaceTransition = (from: PanelSceneSurface | undefined, to: PanelSceneSurface | undefined) => {
    if (!from || !to || from.id === to.id) return
    const key = JSON.stringify([from.id, to.id])
    if (emittedTransitions.has(key)) return
    emittedTransitions.add(key)
    connectors.push({
      points: routePanelSceneSurfaceTransition(from, to),
      sourceSurfaceId: from.id, targetSurfaceId: to.id,
    })
  }
  // A junction panel used by several boards hangs below the first; the others get a connector.
  for (const [identity, owner] of junctionOwnerByIdentity) {
    const junctionSurface = surfaces.find(
      (surface) => surface.kind === 'junction_panel' && surface.label === identity
    )
    const fedPanelIds = new Set((panelsFedByJunction.get(identity) ?? []).map((panel) => panel.id))
    for (const panelId of junctionSurface?.junctionPanelOwnerIds ?? []) {
      if (panelId === owner || fedPanelIds.has(panelId)) continue
      addSurfaceTransition(
        surfaces.find((surface) => surface.kind === 'panel' && surface.panel?.id === panelId),
        junctionSurface
      )
    }
  }
  if (supplyGraph) {
    for (const target of supplyGraph.gridChildren()) addSurfaceTransition(sharedSurface, surfaceForTarget(target))
    for (const deviceId of supplyGraph.handledDeviceIds()) {
      for (const target of supplyGraph.deviceAdjacent(deviceId, 'children')) {
        addSurfaceTransition(surfaceForDevice(deviceId), surfaceForTarget(target))
      }
    }
  }
  for (const rootNode of rootNodes) {
    if (rootNode.surface.converterBackupFeed) continue
    const rootSurface = surfaces.find(
      (surface) => surface.kind === 'panel' && surface.panel?.id === rootNode.panel.id
    )!
    const projection = installation ? getPanelFeedProjection(installation, rootPanels, rootNode.panel) : undefined
    if (supplyGraph && (ownsPanelInput(rootNode.panel) ||
      projection?.rootFeed?.trunkDevices?.some((device) => supplyGraph.handlesDevice(device.id)))) continue
    const rootSupplyDevices = projection?.devices ?? []
    const transitionChain = [
      sharedSurface,
      ...rootSupplyDevices.map((device) => surfaceForDevice(device.id)),
      rootSurface,
    ].filter((surface): surface is PanelSceneSurface => surface != null)
    const collapsedTransitionChain = transitionChain.filter(
      (surface, index) => index === 0 || transitionChain[index - 1]?.id !== surface.id
    )
    for (let index = 0; index < collapsedTransitionChain.length - 1; index++) {
      addSurfaceTransition(collapsedTransitionChain[index], collapsedTransitionChain[index + 1])
    }
  }

  const maxBottom = Math.max(...surfaces.map((surface) => surface.y + surface.height))
  if (!hierarchyFeedFromTop) {
    for (const surface of surfaces) {
      surface.y = maxBottom - surface.y - surface.height
    }
    for (const connector of connectors) {
      connector.points = connector.points.map((value, index) =>
        index % 2 === 1 ? maxBottom - value : value
      )
    }
  }

  const maxRight = Math.max(...surfaces.map((surface) => surface.x + surface.width))
  return {
    width: maxRight,
    height: maxBottom,
    surfaces,
    connectors,
    moduleRefs: new Set(
      surfaces.flatMap((surface) =>
        surface.placements.map((placement) => panelGridModuleRefKey(placement.ref))
      )
    ),
    sharedSupplyTrunkRefKeys: sharedRefKeys,
  }
}
