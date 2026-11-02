import { useEffect, useState } from 'react'
import { PLAN_GRAPHIC_ELEMENT_ASSETS } from '@/lib/plan/graphicElements'
import { useUIStore } from '@/stores/uiStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'

export type OpeningSelectionArmedTool = 'insertDoor' | 'insertWindow' | null
export type PlanFloatingMenu = 'grid' | 'floor' | 'visibility' | null

export function usePlanCanvasToolState({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const activeTool = useUIStore((state) => state.activePlanTool)
  const setActiveTool = useUIStore((state) => state.setActivePlanTool)
  const [openingSelectionArmedTool, setOpeningSelectionArmedTool] =
    useState<OpeningSelectionArmedTool>(null)
  const [, setSelectedPlanImageId] = useState<string | null>(null)
  const [isFloorPlanMode, setIsFloorPlanMode] = useState(false)
  const [selectedGraphicAssetId, setSelectedGraphicAssetId] = useState(
    PLAN_GRAPHIC_ELEMENT_ASSETS[0]?.id ?? ''
  )
  const [isViewportPanning, setIsViewportPanning] = useState(false)
  const [openMenu, setOpenMenu] = useState<PlanFloatingMenu>(null)

  const [openingSource, setOpeningSource] = useState({ activeTool, openingSelectionArmedTool })
  if (openingSource.activeTool !== activeTool || openingSource.openingSelectionArmedTool !== openingSelectionArmedTool) {
    setOpeningSource({ activeTool, openingSelectionArmedTool })
    if (openingSelectionArmedTool !== activeTool) setOpeningSelectionArmedTool(null)
  }
  const isWallDrawingTool = isFloorPlanMode && (activeTool === 'drawWall' || activeTool === 'drawWallRect')
  const [panningSource, setPanningSource] = useState({ isWallDrawingTool, isViewportPanning })
  if (panningSource.isWallDrawingTool !== isWallDrawingTool || panningSource.isViewportPanning !== isViewportPanning) {
    setPanningSource({ isWallDrawingTool, isViewportPanning })
    if (!isWallDrawingTool && isViewportPanning) setIsViewportPanning(false)
  }

  useEffect(() => () => setActiveTool('none'), [setActiveTool])

  const [floorPlanToolSource, setFloorPlanToolSource] = useState(activeTool)
  if (floorPlanToolSource !== activeTool) {
    setFloorPlanToolSource(activeTool)
    if (activeTool === 'wiring') setIsFloorPlanMode(false)
  }

  // Wire-mode controls start enabled without changing ordinary situation-plan visibility.
  useEffect(() => {
    if (activeTool !== 'wiring' || readOnly || !isCableRoutesEnabled()) return
    runProjectCommand('plan.setWiringVisibility', {
      wireToolWiresVisible: true,
      wireToolCategoriesVisible: {},
    })
  }, [activeTool, readOnly])

  return {
    isImportDialogOpen,
    setIsImportDialogOpen,
    activeTool,
    setActiveTool,
    openingSelectionArmedTool,
    setOpeningSelectionArmedTool,
    setSelectedPlanImageId,
    isFloorPlanMode,
    setIsFloorPlanMode,
    selectedGraphicAssetId,
    setSelectedGraphicAssetId,
    isViewportPanning,
    setIsViewportPanning,
    openMenu,
    setOpenMenu,
  }
}
