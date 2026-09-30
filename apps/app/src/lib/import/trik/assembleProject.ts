
import {
  createPlanGraphicElementFromTrikFigure,
  partitionTrikFiguresByFingerprint,
  partitionTrikVectorRects,
  scaleTrikFigurePlacement,
  TRIK_CABINET_RECTANGLE_MATCH,
} from '@/lib/import/trik/trikFigureFingerprints'
import type { PlanGraphicElement } from '@/types/schema'
import { generateId, validateProjectStructure } from '@/utils/project'
import { createLegacyEmptyProject } from '@/lib/import/createLegacyEmptyProject'
import { buildFigureAsset } from '@/lib/import/trik/planAssets'
import { buildFloorPlan } from '@/lib/import/trik/planGeometry'
import {
  collectGroundInfo,
  collectPlacedPlanPanels,
  collectSupplyInfo,
  collectTrikPanelBoards,
  mergePlanNodeMaps,
  parseFigures,
  parseTrikGrondplanPages,
  parseTrikMetadata,
  parseTrikSitplanNotes,
  parseVectorLines,
  parseVectorRects,
  resolveTrikGrondplanFloorName,
  type TrikPlanNodesByFloor,
} from '@/lib/import/trik/parse'
import {
  addTrikCircuits,
  applyGroundInfo,
  applyPlacedPanelMapping,
  applySupplyInfo,
  applyTrikSitplanNotes,
  computeDefaultPanelPlacementOrigin,
  computeFallbackPlacementOrigin,
  createImportedTrikPanelScaffold,
  ensureImportedTrikPanelCircuit,
  applyTrikPanelLocalSupplyDevices,
  promoteMainPanelLocalSupplyToRootFeed,
  syncTrikImportedMainPanelSupplyGrid,
  applyTrikImportedPhaseMarks,
  finalizePendingTrikEendraadNotes,
  finalizePendingTrikSatelliteMarkFrames,
  linkTrikPanelBoards,
  type TrikCircuitImportResult,
} from '@/lib/import/trik/mapEntities'
import type {
  PendingTrikEendraadNote,
  PendingTrikFrameMarkCorner,
  Project,
} from '@/lib/import/trik/shared'
import { sha256Hex, TRIK_TO_PLAN_SCALE, utf8ToBase64 } from '@/lib/import/trik/shared'
import { normalizeStoredProjectToV2 } from '@/lib/projectV2/migration'
import type { ProjectV2 } from '@/types/projectV2'



export async function importProjectFromTrikLocal(file: File): Promise<ProjectV2> {
  const text = await file.text()
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error('Invalid XML in .trik file')
  }

  const metadata = parseTrikMetadata(doc)
  const fallbackName = file.name.replace(/\.trik$/i, '').trim() || 'Imported TRiK project'
  const initialProjectName = metadata.customer?.name?.trim() || `${fallbackName} (TRiK Import)`
  const project = createLegacyEmptyProject(initialProjectName)

  const importedAt = new Date().toISOString()
  const base64 = utf8ToBase64(text)
  const sizeBytes = new TextEncoder().encode(text).byteLength
  const sha = await sha256Hex(text)
  project.project.importSources = {
    ...(project.project.importSources ?? {}),
    trik: {
      originalFilename: file.name,
      importedAt,
      sha256: sha,
      sizeBytes,
      mimeType: file.type || 'application/xml',
      dataUrl: `data:${file.type || 'application/xml'};base64,${base64}`,
    },
  }
  if (metadata.meterEanCode) project.project.meterEanCode = metadata.meterEanCode
  if (metadata.customer) project.project.customer = metadata.customer
  if (metadata.inspectionAgency) project.project.inspectionAgency = metadata.inspectionAgency
  if (metadata.installationAddress) {
    project.installation.address = {
      street: metadata.installationAddress.street,
      postalCode: metadata.installationAddress.postalCode,
      city: metadata.installationAddress.city,
      country: metadata.installationAddress.country || project.installation.address.country,
    }
  }
  if (metadata.installer) {
    project.project.installerOverride = {
      name: metadata.installer.name || project.project.installerOverride?.name || '',
      address: {
        street: metadata.installer.address?.street ?? '',
        postalCode: metadata.installer.address?.postalCode ?? '',
        city: metadata.installer.address?.city ?? '',
        country: metadata.installer.address?.country ?? '',
      },
      companyNumber: metadata.installer.companyNumber,
      email: metadata.installer.email,
      mobile: metadata.installer.mobile,
      phone: metadata.installer.phone,
      signatureDataUrl: project.project.installerOverride?.signatureDataUrl ?? null,
      logoDataUrl: metadata.installer.logoDataUrl ?? null,
    }
  }

  const panel = project.panels[0]
  const defaultFloorId = project.floors[0]?.id
  if (!panel || !defaultFloorId) {
    throw new Error('Failed to initialize target project')
  }

  panel.circuits = panel.circuits.filter((circuit) => circuit.code === 'PANEL')
  panel.protections = []

  project.installation.circuitNotesOrientation = 'vertical'

  const grondplanPages = parseTrikGrondplanPages(doc)
  const pendingTrikSitplanNotes = parseTrikSitplanNotes(doc)
  project.floors = grondplanPages.map((page, index) => ({
    id: index === 0 ? defaultFloorId : generateId(),
    name: resolveTrikGrondplanFloorName(page, index, pendingTrikSitplanNotes),
    sitplanSymbolSizeCm: 30,
  }))

  const planNodesByFloor: TrikPlanNodesByFloor = new Map(
    project.floors.map((floor, index) => [floor.id, grondplanPages[index]?.planNodes ?? new Map()]),
  )
  const mergedPlanNodes = mergePlanNodeMaps(planNodesByFloor)
  const primaryFloorId = project.floors[0]?.id ?? defaultFloorId

  const trikBoards = collectTrikPanelBoards(doc)
  const supplyInfo = collectSupplyInfo(doc)
  const placedPanels = collectPlacedPlanPanels(doc)
  const groundInfo = collectGroundInfo(doc)

  const mainBoard = trikBoards.find((board) => board.onSupplySpine) ?? trikBoards[0]
  if (mainBoard?.explicitName) {
    panel.name = mainBoard.explicitName
    panel.isMain = true
  } else if (mainBoard && trikBoards.length > 1) {
    panel.name = mainBoard.name
    panel.isMain = true
  }

  const existingPanelPlacement =
    panel.circuits
      .find((circuit) => circuit.code === 'PANEL')
      ?.endpoints.find((endpoint) => endpoint.symbol === 'panel_distribution')
      ?.placements[0]?.pos
  const panelPlacementOrigin = existingPanelPlacement ?? computeDefaultPanelPlacementOrigin(mergedPlanNodes)
  const fallbackPlacementOrigin = computeFallbackPlacementOrigin(mergedPlanNodes, panelPlacementOrigin)
  const pendingTrikEendraadNotes: PendingTrikEendraadNote[] = []
  const pendingTrikFrameMarkCorners: PendingTrikFrameMarkCorner[] = []
  const hiddenSitplanPlacementIdsByFloor = new Map<string, string[]>()

  const panelByBoardId = new Map<string, typeof panel>()
  const importsByBoardId = new Map<string, Map<string, TrikCircuitImportResult>>()

  if (trikBoards.length === 0) {
    ensureImportedTrikPanelCircuit(panel, primaryFloorId, panelPlacementOrigin)
    panelByBoardId.set('default', panel)
  } else {
    for (let boardIndex = 0; boardIndex < trikBoards.length; boardIndex += 1) {
      const board = trikBoards[boardIndex]!
      const isMainBoard = board === mainBoard
      const targetPanel = isMainBoard
        ? panel
        : createImportedTrikPanelScaffold(board.name, true)
      if (!isMainBoard) {
        project.panels.push(targetPanel)
      } else if (board.explicitName) {
        targetPanel.name = board.explicitName
      } else if (trikBoards.length > 1) {
        targetPanel.name = board.name
      }
      const preferredPos = {
        x: panelPlacementOrigin.x + boardIndex * 80,
        y: panelPlacementOrigin.y + boardIndex * 40,
      }
      ensureImportedTrikPanelCircuit(targetPanel, primaryFloorId, preferredPos)
      const imported = addTrikCircuits(
        targetPanel,
        primaryFloorId,
        board.circuits,
        planNodesByFloor,
        fallbackPlacementOrigin,
        pendingTrikEendraadNotes,
        pendingTrikFrameMarkCorners,
        hiddenSitplanPlacementIdsByFloor,
      )
      applyTrikPanelLocalSupplyDevices(targetPanel, board.localSupplyDevices)
      panelByBoardId.set(board.trikBoardId, targetPanel)
      importsByBoardId.set(board.trikBoardId, imported)
    }
    linkTrikPanelBoards(project, trikBoards, panelByBoardId, importsByBoardId)
  }

  applyPlacedPanelMapping(project, planNodesByFloor, placedPanels)
  for (const floor of project.floors) {
    const hidden = hiddenSitplanPlacementIdsByFloor.get(floor.id)
    if (!hidden?.length) continue
    floor.hiddenSitplanPlacementIds = [...(floor.hiddenSitplanPlacementIds ?? []), ...hidden]
  }
  applySupplyInfo(project, supplyInfo)
  applyTrikImportedPhaseMarks(project, importsByBoardId)
  const panelSupplyCircuit = panel.circuits.find((circuit) => circuit.code === 'PANEL')
  if (panelSupplyCircuit) {
    panelSupplyCircuit.cable = { ...project.installation.mainSupply.cable }
  }
  applyGroundInfo(project, groundInfo)

  for (let pageIndex = 0; pageIndex < grondplanPages.length; pageIndex += 1) {
    const floor = project.floors[pageIndex]
    const page = grondplanPages[pageIndex]
    if (!floor || !page) continue

    const floorPlan = buildFloorPlan(page.pageElement, floor.id)
    if (floorPlan) {
      floor.floorPlan = floorPlan
    }

    const figures = parseFigures(page.pageElement)
    const { recognized: recognizedFigures, unrecognized: unrecognizedFigures } =
      await partitionTrikFiguresByFingerprint(figures)

    const vectorLines = parseVectorLines(page.pageElement)
    const vectorRects = parseVectorRects(page.pageElement)
    const { graphic: graphicRects, decorative: decorativeRects } =
      partitionTrikVectorRects(vectorRects)

    const importedGraphicElements: PlanGraphicElement[] = [
      ...recognizedFigures.map(({ figure, match }) =>
        createPlanGraphicElementFromTrikFigure(
          floor.id,
          scaleTrikFigurePlacement(figure, TRIK_TO_PLAN_SCALE),
          match,
        ),
      ),
      ...graphicRects.map((rect) =>
        createPlanGraphicElementFromTrikFigure(
          floor.id,
          scaleTrikFigurePlacement(
            {
              width: rect.width,
              height: rect.height,
              center: rect.center,
              rotationDeg: rect.rotationDeg,
              imageAsBase64: '',
            },
            TRIK_TO_PLAN_SCALE,
          ),
          TRIK_CABINET_RECTANGLE_MATCH,
        ),
      ),
    ]
    if (importedGraphicElements.length > 0) {
      if (floorPlan) {
        floorPlan.graphicElements = [
          ...(floorPlan.graphicElements ?? []),
          ...importedGraphicElements,
        ]
      } else {
        floor.floorPlan = {
          walls: [],
          doors: [],
          windows: [],
          masterWallThickness: 20,
          graphicElements: importedGraphicElements,
        }
      }
    }

    const importedFigureAsset = await buildFigureAsset(
      unrecognizedFigures,
      vectorLines,
      decorativeRects,
    )
    if (importedFigureAsset) {
      floor.planImportAsset = {
        id: generateId(),
        kind: 'raster',
        sourceName: `${file.name} (TRiK Plan Composite)`,
        width: Math.max(1, importedFigureAsset.width),
        height: Math.max(1, importedFigureAsset.height),
        dataUrl: importedFigureAsset.dataUrl,
        processedDataUrl: importedFigureAsset.processedDataUrl,
        darkModeAware: importedFigureAsset.darkModeAware,
        hasWhiteBackground: importedFigureAsset.hasWhiteBackground,
      }
      floor.planAsset = floor.planImportAsset.dataUrl
      floor.planAssetProcessed = undefined
      floor.planAssetHasWhiteBackground = undefined
      floor.planImageOffset = importedFigureAsset.offset
    }

    applyTrikSitplanNotes(project, floor.id, page.planNodes, pendingTrikSitplanNotes)
  }
  // Rebuild topology from imported legacy supply fields so shared-feed cable/devices stay in sync.
  project.installation.feedTopology = undefined
  // Panel-side supply (post-Kast meter isolator + second meter) belongs on the root feed.
  promoteMainPanelLocalSupplyToRootFeed(project)
  syncTrikImportedMainPanelSupplyGrid(project)

  finalizePendingTrikEendraadNotes(project, pendingTrikEendraadNotes)
  finalizePendingTrikSatelliteMarkFrames(project, pendingTrikFrameMarkCorners)

  project.project.createdAt = importedAt
  project.project.updatedAt = importedAt

  const normalized = normalizeStoredProjectToV2(project)
  const electricalDevices = normalized.disciplines.electrical?.devices ?? []
  const panelsNeedingDevices: Array<{ id: string; name: string; pos: { x: number; y: number } }> = []
  const collectPanelsNeedingDevices = (
    panels: typeof project.panels,
    origin: { x: number; y: number },
    depth = 0,
  ) => {
    panels.forEach((candidate, index) => {
      const hasDevice = electricalDevices.some(
        (device) => device.symbol === 'panel_distribution' && device.panelId === candidate.id,
      )
      if (!hasDevice) {
        panelsNeedingDevices.push({
          id: candidate.id,
          name: candidate.name,
          pos: {
            x: origin.x + index * 80 + depth * 20,
            y: origin.y + index * 40 + depth * 20,
          },
        })
      }
      if (candidate.subPanels?.length) {
        collectPanelsNeedingDevices(candidate.subPanels, origin, depth + 1)
      }
    })
  }
  const deviceOrigin = placedPanels.length > 0 ? panelPlacementOrigin : fallbackPlacementOrigin
  collectPanelsNeedingDevices(normalized.disciplines.electrical?.panels ?? project.panels, deviceOrigin)
  for (const missing of panelsNeedingDevices) {
    const elementId = `elem_panel_${missing.id}`
    normalized.elements.push({
      id: elementId,
      kind: 'electrical.fixed_appliance',
      floorId: primaryFloorId,
      systemId: 'system_electrical',
      layerId: `layer_${primaryFloorId}_electrical`,
      geometry: {
        kind: 'point',
        position: missing.pos,
        rotationDeg: 0,
        scale: 1,
      },
      properties: { panelId: missing.id, symbol: 'panel_distribution' },
    })
    normalized.disciplines.electrical?.devices.push({
      id: `edev_panel_${missing.id}`,
      legacyEndpointId: `panel_${missing.id}`,
      elementIds: [elementId],
      panelId: missing.id,
      symbol: 'panel_distribution',
      type: 'fixed_appliance',
    })
  }
  const validation = validateProjectStructure(
    structuredClone(normalized) as unknown as Project,
  )
  if (!validation.valid) {
    throw new Error(`TRiK import produced invalid project: ${validation.errors.join('; ')}`)
  }
  return normalized
}
