import { useCallback, useDeferredValue, useMemo } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Rect, Text } from 'react-konva'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import {
  useClearHover,
  useHoverIncludes,
  useIsTypeAndIdSelected,
  useSetHover,
  useSetSelection,
} from '@/editions/community/communityHooks'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { getEendraadRenderProjectRevision } from '@/lib/layout/eendraadDerivedLayout'
import { useEffectiveInstallerProfile } from '@/hooks/useEffectiveInstallerProfile'
import { useCanvasFontFamily, useEffectiveCanvasZoom } from '@/editions/community/communityHooks'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { getTextColor, getSecondaryTextColor, getFrameColor } from './canvasSymbols'
import {
  canvasSizeWithScreenMinimum,
  screenPxToCanvasUnits,
  getFrameBorderHitThicknessCanvas,
  SELECTION_OUTLINE_STROKE_PX,
  SELECTION_OUTLINE_STROKE_PX_MIN,
  SELECTION_OUTLINE_STROKE_PX_MAX,
  HOVER_OUTLINE_DASH_PX,
  HOVER_OUTLINE_DASH_PX_MIN,
  HOVER_OUTLINE_DASH_PX_MAX,
  HOVER_OUTLINE_STROKE_PX,
  HOVER_OUTLINE_STROKE_PX_MIN,
  HOVER_OUTLINE_STROKE_PX_MAX,
} from '@/constants/canvasConstants'
import { InfoBlock, INFO_BLOCK_HEIGHT } from './InfoBlock'
import { getDecodedInfoBlockLogo } from '@/lib/infoBlockLogoImage'
import {
  getInfoBlockColumns,
  getInfoBlockTotalWidth,
  INFO_BLOCK_FRAME_MARGIN,
} from '@/lib/infoBlockLayout'
import {
  buildPanelDiagramHeaderLines,
  buildPanelNumberIndexById,
  buildSupplyDiagramHeaderLines,
  findParentPanel,
  PANEL_DIAGRAM_HEADER_LINE_HEIGHT,
  PANEL_FRAME_HEADER_TOP_INSET,
} from '@/lib/panel/panelDiagramLabels'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { panelHasBackupOutput } from '@/lib/panel/panelFeedOrganization'
import { findPanelById } from '@/lib/panel/panelTree'

const HEADER_LINE_HEIGHT = PANEL_DIAGRAM_HEADER_LINE_HEIGHT
const TITLE_FONT_SIZE = 14
const BODY_FONT_SIZE = 11

interface PanelFrameProps {
  panelLayout: BottomUpPanelLayout
  children: React.ReactNode
}

export function PanelFrame({ panelLayout, children }: PanelFrameProps) {
  const { t } = useTranslation()
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const setSelection = useSetSelection()
  const setHover = useSetHover()
  const clearHover = useClearHover()
  const isVirtualSupplyFrame = panelLayout.frameRole === 'supply'
  const panelIsSelected = useIsTypeAndIdSelected('panel', panelLayout.panel.id)
  const panelIsHovered = useHoverIncludes('panel', panelLayout.panel.id)
  const supplyIsSelected = useUIStore(
    (state) =>
      state.selection.type === 'supply' && state.selection.supplyPanelId === panelLayout.panel.id
  )
  const isSelected = isVirtualSupplyFrame ? supplyIsSelected : panelIsSelected
  const isHovered = !isVirtualSupplyFrame && panelIsHovered
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const liveProject = useProjectStore((s: ProjectState) =>
    s.currentProject ? getEendraadRenderProjectRevision(s.currentProject) : null
  )
  const currentProject = useDeferredValue(liveProject)
  const { advancedPanelLabels } = useEditionFeatureAvailability(currentProject?.project.id)
  const { profile } = useEffectiveInstallerProfile(currentProject ?? null)
  const isDark = theme.mode === 'dark'
  const frameColor = getFrameColor(isDark)
  const frameStrokeWidth = 4

  const headerLines = useMemo(() => {
    const rootPanels = currentProject ? getProjectElectricalPanels(currentProject) : []
    const ownerPanel =
      (currentProject &&
        findPanelById(rootPanels, panelLayout.ownerPanelId ?? panelLayout.panel.id)) ||
      panelLayout.panel
    const backupFeedActive =
      currentProject != null && panelHasBackupOutput(currentProject, ownerPanel.id)
    if (isVirtualSupplyFrame) {
      if (!currentProject) {
        return [{ text: t('canvas.supplyFrame.title', 'Supply'), variant: 'title' as const }]
      }
      return buildSupplyDiagramHeaderLines(currentProject, ownerPanel, t, {
        advancedLabelsEnabled: advancedPanelLabels,
        backupFeedActive,
      })
    }
    if (!currentProject) {
      return [{ text: panelLayout.panel.name, variant: 'title' as const }]
    }
    const numberIndexById = buildPanelNumberIndexById(rootPanels)
    const parentPanel = findParentPanel(rootPanels, panelLayout.panel.id)
    return buildPanelDiagramHeaderLines(currentProject, panelLayout.panel, t, {
      advancedLabelsEnabled: advancedPanelLabels,
      parentPanel,
      numberIndexById,
      backupFeedActive,
    })
  }, [
    advancedPanelLabels,
    currentProject,
    isVirtualSupplyFrame,
    panelLayout.ownerPanelId,
    panelLayout.panel,
    t,
  ])

  const { x: fx, y: fy, width: fw, height: fh } = panelLayout.frame
  const borderHitCanvas = getFrameBorderHitThicknessCanvas(canvasZoom)
  const selectionPad = screenPxToCanvasUnits(canvasZoom, 2, 1, 4)
  const selectionOutlineW = canvasSizeWithScreenMinimum(canvasZoom, fw + selectionPad * 2)
  const selectionOutlineH = canvasSizeWithScreenMinimum(canvasZoom, fh + selectionPad * 2)
  const selectionOutlineX = fx + fw / 2 - selectionOutlineW / 2
  const selectionOutlineY = fy + fh / 2 - selectionOutlineH / 2
  const selectionStrokeCanvas = screenPxToCanvasUnits(
    canvasZoom,
    SELECTION_OUTLINE_STROKE_PX,
    SELECTION_OUTLINE_STROKE_PX_MIN,
    SELECTION_OUTLINE_STROKE_PX_MAX
  )
  const hoverStrokeCanvas = screenPxToCanvasUnits(
    canvasZoom,
    HOVER_OUTLINE_STROKE_PX,
    HOVER_OUTLINE_STROKE_PX_MIN,
    HOVER_OUTLINE_STROKE_PX_MAX
  )
  const hoverDashCanvas = screenPxToCanvasUnits(
    canvasZoom,
    HOVER_OUTLINE_DASH_PX,
    HOVER_OUTLINE_DASH_PX_MIN,
    HOVER_OUTLINE_DASH_PX_MAX
  )
  const explicitInfoBlock = panelLayout.layoutBlocks?.find((block) => block.kind === 'info-block')
  const infoBlockWidth =
    explicitInfoBlock?.width ??
    getInfoBlockTotalWidth(
      getInfoBlockColumns(currentProject, { hasLogo: getDecodedInfoBlockLogo(profile?.logoDataUrl) != null })
    )
  const infoBlockX = explicitInfoBlock?.x ?? fx + fw - infoBlockWidth - INFO_BLOCK_FRAME_MARGIN
  const infoBlockY = explicitInfoBlock?.y ?? fy + fh - INFO_BLOCK_HEIGHT - INFO_BLOCK_FRAME_MARGIN

  const bottomHitWidth = Math.max(0, infoBlockX - fx)
  const rightHitHeight = Math.max(0, infoBlockY - fy)

  const handleFrameMouseEnter = useCallback(() => {
    if (isVirtualSupplyFrame) return
    setHover({ type: 'panel', ids: [panelLayout.panel.id] })
  }, [isVirtualSupplyFrame, panelLayout.panel.id, setHover])

  const handleFrameMouseLeave = useCallback(() => {
    if (isVirtualSupplyFrame) return
    clearHover()
  }, [clearHover, isVirtualSupplyFrame])

  const handleTitleClick = useCallback(
    (e: {
      cancelBubble: boolean
      evt: {
        button?: number
        shiftKey?: boolean
        altKey?: boolean
        ctrlKey?: boolean
        metaKey?: boolean
      }
    }) => {
      e.cancelBubble = true
      if (e.evt.button != null && e.evt.button !== 0) return

      if (isVirtualSupplyFrame) {
        setSelection({
          type: 'supply',
          ids: ['supply'],
          supplyPanelId: panelLayout.panel.id,
        })
        return
      }

      if (e.evt.shiftKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === 'panel' && !selection.ids.includes(panelLayout.panel.id)) {
          setSelection({ type: 'panel', ids: [...selection.ids, panelLayout.panel.id] })
        } else if (selection.type !== 'panel') {
          setSelection({ type: 'panel', ids: [panelLayout.panel.id] })
        }
      } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === 'panel' && selection.ids.includes(panelLayout.panel.id)) {
          const newIds = selection.ids.filter((id) => id !== panelLayout.panel.id)
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'panel', ids: newIds })
          }
        }
      } else {
        setSelection({ type: 'panel', ids: [panelLayout.panel.id] })
      }
    },
    [isVirtualSupplyFrame, panelLayout.panel.id, setSelection]
  )

  const titleX = panelLayout.frame.x + PANEL_FRAME_HEADER_TOP_INSET
  const titleY = panelLayout.frame.y + PANEL_FRAME_HEADER_TOP_INSET
  const titleWidth = Math.max(220, fw * 0.45)
  const titleHeight = Math.max(24, headerLines.length * HEADER_LINE_HEIGHT + 8)

  return (
    <Group name={`panel-${panelLayout.panel.id}`}>
      <Group
        name="export-strip-frame"
        onMouseEnter={handleFrameMouseEnter}
        onMouseLeave={handleFrameMouseLeave}
        onClick={handleTitleClick}
        onTap={handleTitleClick}
        listening={true}
      >
        <Rect
          x={fx}
          y={fy}
          width={fw}
          height={borderHitCanvas}
          fill="transparent"
          listening={true}
        />
        {bottomHitWidth > 0 && (
          <Rect
            x={fx}
            y={fy + fh - borderHitCanvas}
            width={bottomHitWidth}
            height={borderHitCanvas}
            fill="transparent"
            listening={true}
          />
        )}
        <Rect
          x={fx}
          y={fy}
          width={borderHitCanvas}
          height={fh}
          fill="transparent"
          listening={true}
        />
        {rightHitHeight > 0 && (
          <Rect
            x={fx + fw - borderHitCanvas}
            y={fy}
            width={borderHitCanvas}
            height={rightHitHeight}
            fill="transparent"
            listening={true}
          />
        )}
      </Group>
      <Rect
        name="export-strip-frame"
        x={fx}
        y={fy}
        width={fw}
        height={fh}
        fill="transparent"
        stroke={frameColor}
        strokeWidth={frameStrokeWidth}
        listening={false}
      />

      {isHovered && !isSelected && (
        <Rect
          name="export-strip-frame"
          x={selectionOutlineX}
          y={selectionOutlineY}
          width={selectionOutlineW}
          height={selectionOutlineH}
          fill="transparent"
          stroke="#fbbf24"
          strokeWidth={hoverStrokeCanvas}
          dash={[hoverDashCanvas, hoverDashCanvas]}
          listening={false}
        />
      )}
      {isSelected && (
        <Rect
          name="export-strip-frame"
          x={selectionOutlineX}
          y={selectionOutlineY}
          width={selectionOutlineW}
          height={selectionOutlineH}
          fill="transparent"
          stroke="#fbbf24"
          strokeWidth={selectionStrokeCanvas}
          listening={false}
        />
      )}

      <Rect
        name="export-strip-frame"
        x={titleX - 5}
        y={titleY - 5}
        width={titleWidth}
        height={titleHeight}
        fill="transparent"
        stroke="transparent"
        onClick={handleTitleClick}
        onTap={handleTitleClick}
        onMouseEnter={handleFrameMouseEnter}
        onMouseLeave={handleFrameMouseLeave}
        listening={true}
      />

      {headerLines.map((line, index) => (
        <Text
          key={`panel-header-${index}`}
          name="export-strip-frame"
          x={titleX}
          y={titleY + index * HEADER_LINE_HEIGHT}
          text={line.text}
          fontSize={line.variant === 'title' ? TITLE_FONT_SIZE : BODY_FONT_SIZE}
          fontFamily={fontFamily}
          fontStyle={line.variant === 'title' ? 'bold' : 'normal'}
          fill={line.variant === 'muted' ? getSecondaryTextColor(isDark) : getTextColor(isDark)}
          listening={false}
        />
      ))}

      {children}

      <InfoBlock
        x={infoBlockX}
        y={infoBlockY}
        viewTitle={t('infoBlock.viewTitle.oneWire', 'One-wire diagram')}
        project={currentProject ?? null}
        profile={profile}
        interactive={true}
      />
    </Group>
  )
}
