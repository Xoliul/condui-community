import { memo, useCallback, useDeferredValue, useMemo } from 'react'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Text, Line } from 'react-konva'
import { useSettingsStore } from '@/stores/settingsStore'
import { useCanvasFontFamily, useEffectiveCanvasZoom } from '@/editions/community/communityHooks'
import { useUIStore } from '@/stores/uiStore'
import { useIsTypeAndIdSelected, useSetSelection } from '@/editions/community/communityHooks'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { getEendraadRenderProjectRevision } from '@/lib/layout/eendraadDerivedLayout'
import {
  getFrameColor,
  getTextColor,
  SELECTION_COLOR,
  getSelectionOutlineStrokeStyle,
} from './canvasSymbols'
import type { Frame } from '@/types/schema'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import {
  getFrameBorderHitThicknessCanvas,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import { resolveFrameContentItems } from '@/lib/eendraad/frameContent'
import { computeOneWireFrameBounds, getOneWireFrameTitleY } from '@/lib/eendraad/frameBounds'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: { button?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

interface FrameComponentProps {
  frame: Frame
  panelLayout: BottomUpPanelLayout
}

/**
 * FrameComponent renders a simple sharp-cornered box around grouped items
 * on the eendraad canvas.
 */
export const FrameComponent = memo(function FrameComponent({ frame, panelLayout }: FrameComponentProps) {
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const setSelection = useSetSelection()
  const isSelected = useIsTypeAndIdSelected('frame', frame.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const liveProject = useProjectStore((s: ProjectState) =>
    s.currentProject ? getEendraadRenderProjectRevision(s.currentProject) : null
  )
  const currentProject = useDeferredValue(liveProject)
  const isDark = theme.mode === 'dark'
  const frameColor = getFrameColor(isDark)
  const textColor = getTextColor(isDark)
  const titlePosition = frame.titlePosition || 'inside'
  
  const bounds = useMemo(() => {
    const resolved = resolveFrameContentItems(frame, currentProject ?? undefined)
    return computeOneWireFrameBounds(frame, resolved, panelLayout, getEndpointById)
  }, [
    frame,
    panelLayout,
    getEndpointById,
    currentProject,
  ])
  
  const handleClick = useCallback((event: unknown) => {
    const e = event as EendraadPointerEvent
    const eendraWindow = window as WindowWithEendraTapSuppression
    if (eendraWindow.__eendraSuppressNextElementTap) {
      eendraWindow.__eendraSuppressNextElementTap = false
      return
    }
    e.cancelBubble = true
    if (e.evt.button != null && e.evt.button !== 0) return
    
    if (e.evt.shiftKey) {
      const { selection } = useUIStore.getState()
      if (selection.type === 'frame' && !selection.ids.includes(frame.id)) {
        setSelection({ type: 'frame', ids: [...selection.ids, frame.id] })
      } else if (selection.type !== 'frame') {
        setSelection({ type: 'frame', ids: [frame.id] })
      }
    } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
      const { selection } = useUIStore.getState()
      if (selection.type === 'frame' && selection.ids.includes(frame.id)) {
        const newIds = selection.ids.filter(id => id !== frame.id)
        if (newIds.length > 0) {
          setSelection({ type: 'frame', ids: newIds })
        } else {
          useUIStore.getState().clearSelection()
        }
      }
    } else {
      setSelection({ type: 'frame', ids: [frame.id] })
    }
  }, [setSelection, frame.id])
  
  if (!bounds) return null
  
  const { x, y, width, height } = bounds
  const strokeColor = isSelected ? SELECTION_COLOR : frameColor
  const selectionStroke = getSelectionOutlineStrokeStyle(canvasZoom).strokeWidth
  const frameStroke = screenPxToCanvasUnits(canvasZoom, 2, 1, 3)
  const strokeW = isSelected ? selectionStroke : frameStroke
  const hitStrokeExtra = getFrameBorderHitThicknessCanvas(canvasZoom)

  // Sharp-cornered rectangle as a closed polyline
  const rectPoints = [
    x, y,
    x + width, y,
    x + width, y + height,
    x, y + height,
  ]
  
  // Title positioning
  const titleX = titlePosition === 'outside' ? x : x + 6
  const titleY = getOneWireFrameTitleY(frame, bounds)
  
  return (
    <Group name={`frame-${frame.id}`}>
      {/* Invisible wider hit area so clicking near the edge works */}
      <Line
        points={rectPoints}
        closed
        stroke="transparent"
        strokeWidth={strokeW + hitStrokeExtra * 2}
        lineJoin="round"
        listening={true}
        onClick={handleClick}
        onTap={handleClick}
      />
      
      {/* Visible frame border — sharp corners, no fill */}
      <Line
        points={rectPoints}
        closed
        stroke={strokeColor}
        strokeWidth={strokeW}
        listening={false}
      />
      
      {/* Title text — uses main text color for better visibility */}
      {frame.title && (
        <Text
          x={titleX}
          y={titleY}
          text={frame.title}
          fontSize={frame.fontSize}
          fontFamily={fontFamily}
          fontStyle="bold"
          fill={isSelected ? SELECTION_COLOR : textColor}
          listening={true}
          onClick={handleClick}
          onTap={handleClick}
        />
      )}
    </Group>
  )
})
