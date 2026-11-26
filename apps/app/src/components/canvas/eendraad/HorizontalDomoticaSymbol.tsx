import { useState } from 'react'
import { Group, Rect, Text } from 'react-konva'
import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import { applyTouchHitPadding } from '@/lib/canvas/touchHitZones'
import {
  getPaddedRectHoverOutlineProps,
  getPaddedRectPreviewOutlineProps,
  getPaddedRectSelectionOutlineProps,
  getSecondaryTextColor,
  getSymbolColor,
} from '@/components/canvas/eendraad/canvasSymbols'
import {
  DOMOTICA_HORIZONTAL_BODY_HEIGHT,
  DOMOTICA_HORIZONTAL_COLUMN_WIDTH,
  DOMOTICA_HORIZONTAL_FEED_LEAD,
  getHorizontalDomoticaBodyWidth,
  getHorizontalDomoticaNoteOffset,
} from '@/lib/layout/domoticaHorizontalGeometry'
import { fitHorizontalDomoticaBodyText } from '@/lib/layout/horizontalDomoticaBodyText'
import { DOMOTICA_NOTE_FONT_SIZE, DOMOTICA_NOTE_LINE_HEIGHT } from '@/lib/eendraad/domoticaNotes'
import {
  clampDomoticaEndpointCount,
  resizeDomoticaEndpointCount,
} from '@/lib/eendraad/resizeDomoticaEndpointCount'

const HIT_FILL = 'rgba(0, 0, 0, 0.01)'
const RESIZE_OUTLINE_PADDING = 4
const RESIZE_HANDLE_WIDTH = 6
const RESIZE_HANDLE_HIT_WIDTH = 14

interface HorizontalDomoticaSymbolProps {
  endpointId: string
  /** Centre of the body, like every domotica layout node. */
  position: { x: number; y: number }
  count: number
  /** Text inside the body: the entered extra label, else the default word for the module. */
  label: string
  /** Module note, already wrapped; drawn below the body beside the feed wire. */
  noteText?: string
  isDark: boolean
  fontFamily: string
  draggable: boolean
  isSelected: boolean
  isPreviewSelected: boolean
  isHoveredAny: boolean
  canResize: boolean
  canvasZoom: number
  touchPrimary: boolean
  onClick: (event: unknown) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  /** Returns true when the gesture was taken over (for example an Alt-drag duplicate). */
  onGestureStart?: (altKey: boolean, nativeEvent: MouseEvent) => boolean
  onGestureEnd: (dropPoint: { x: number; y: number }) => boolean | void
  shouldSuppressDragEnd?: () => boolean
  getCanvasPositionFromEvent?: (event: unknown) => { x: number; y: number } | null
}

/**
 * Horizontal domotica body: a plain outline with one large label. No control header, divider or
 * icons. The left edge is the fixed anchor, so a resize only moves the right edge.
 */
export function HorizontalDomoticaSymbol(props: HorizontalDomoticaSymbolProps) {
  const { count, position } = props
  // The preview belongs to the count it started from; once the committed count changes it is stale.
  const [preview, setPreview] = useState<{ base: number; count: number } | null>(null)
  const previewCount = preview?.base === count ? preview.count : null
  const setPreviewCount = (next: number | null) =>
    setPreview(next == null ? null : { base: count, count: next })

  const strokeColor = getSymbolColor(props.isDark)
  const bodyText = fitHorizontalDomoticaBodyText(
    props.label,
    getHorizontalDomoticaBodyWidth(count),
    props.fontFamily
  )
  const noteOffset = getHorizontalDomoticaNoteOffset()
  const width = getHorizontalDomoticaBodyWidth(count)
  const height = DOMOTICA_HORIZONTAL_BODY_HEIGHT
  const previewWidth = getHorizontalDomoticaBodyWidth(previewCount ?? count)
  const outlinePad = 2
  const hitRect = applyTouchHitPadding(
    { x: 0, y: -height / 2 - 2, width, height: height + 4 },
    props.canvasZoom,
    props.isSelected,
    props.touchPrimary
  )
  const outline = (factory: typeof getPaddedRectSelectionOutlineProps) =>
    factory(props.canvasZoom, 0, -height / 2, width, height, outlinePad)
  const origin = { x: position.x - width / 2, y: position.y }
  const resetToLayout = (target: { position: (point: { x: number; y: number }) => unknown }) =>
    target.position(origin)

  return (
    <Group
      name={`endpoint-${props.endpointId}`}
      x={origin.x}
      y={origin.y}
      draggable={props.draggable}
      onDragStart={
        props.draggable && props.onGestureStart
          ? (e) => {
              const evt = e.evt as MouseEvent
              if (props.onGestureStart?.(!!evt.altKey, evt)) {
                e.target.stopDrag()
                resetToLayout(e.target)
              }
            }
          : undefined
      }
      onDragEnd={
        props.draggable
          ? (e) => {
              if (props.shouldSuppressDragEnd?.()) {
                resetToLayout(e.target)
                return
              }
              const dropPoint = props.getCanvasPositionFromEvent?.(e) ?? {
                x: e.target.x(),
                y: e.target.y(),
              }
              // react-konva only reapplies x/y when the prop changes, so return to the layout
              // position before the drop re-renders.
              resetToLayout(e.target)
              props.onGestureEnd(dropPoint)
            }
          : undefined
      }
      onClick={props.onClick}
      onTap={props.onClick}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      <Rect {...hitRect} name={INTERACTIVE_OVERLAY_EXPORT_NAME} fill={HIT_FILL} listening />
      <Rect
        x={0}
        y={-height / 2}
        width={width}
        height={height}
        fill="transparent"
        stroke={strokeColor}
        strokeWidth={1}
        listening={false}
      />
      {props.label && (
        <Text
          x={0}
          y={-height / 2}
          width={width}
          height={height}
          text={bodyText.text}
          align="center"
          verticalAlign="middle"
          wrap="none"
          fontSize={bodyText.fontSize}
          fontFamily={props.fontFamily}
          fill={getSecondaryTextColor(props.isDark)}
          listening={false}
        />
      )}
      {props.noteText && (
        <Text
          // The anchor (feed wire) sits half a column from the body's left edge.
          x={DOMOTICA_HORIZONTAL_COLUMN_WIDTH / 2 + noteOffset.x}
          y={height / 2 + DOMOTICA_HORIZONTAL_FEED_LEAD + noteOffset.y}
          text={props.noteText}
          wrap="none"
          fontSize={DOMOTICA_NOTE_FONT_SIZE}
          lineHeight={DOMOTICA_NOTE_LINE_HEIGHT / DOMOTICA_NOTE_FONT_SIZE}
          fontFamily={props.fontFamily}
          fill={getSecondaryTextColor(props.isDark)}
          listening={false}
        />
      )}
      {props.isPreviewSelected && !props.isSelected && (
        <Rect {...outline(getPaddedRectPreviewOutlineProps)} />
      )}
      {props.isHoveredAny && !props.isSelected && !props.isPreviewSelected && (
        <Rect {...outline(getPaddedRectHoverOutlineProps)} />
      )}
      {props.isSelected && <Rect {...outline(getPaddedRectSelectionOutlineProps)} />}
      {props.isSelected && props.canResize && (
        <>
          {previewCount != null && previewCount !== count && (
            <Rect
              x={0}
              y={-height / 2}
              width={previewWidth}
              height={height}
              stroke="#0284c7"
              strokeWidth={1}
              dash={[3, 2]}
              listening={false}
            />
          )}
          <Rect
            x={width + RESIZE_OUTLINE_PADDING - RESIZE_HANDLE_HIT_WIDTH / 2}
            y={-height / 2}
            width={RESIZE_HANDLE_HIT_WIDTH}
            height={height}
            fill="transparent"
            draggable
            onMouseDown={(event) => {
              event.cancelBubble = true
            }}
            onClick={(event) => {
              event.cancelBubble = true
            }}
            onTap={(event) => {
              event.cancelBubble = true
            }}
            onDragStart={(event) => {
              event.cancelBubble = true
              setPreviewCount(count)
            }}
            onDragMove={(event) => {
              event.cancelBubble = true
              const handleCenter = event.target.x() + RESIZE_HANDLE_HIT_WIDTH / 2
              const requestedWidth = handleCenter - RESIZE_OUTLINE_PADDING
              const next = clampDomoticaEndpointCount(
                requestedWidth / DOMOTICA_HORIZONTAL_COLUMN_WIDTH
              )
              setPreviewCount(next)
              const snapped = getHorizontalDomoticaBodyWidth(next)
              event.target.x(snapped + RESIZE_OUTLINE_PADDING - RESIZE_HANDLE_HIT_WIDTH / 2)
              event.target.y(-height / 2)
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true
              const next = previewCount ?? count
              if (next === count || !resizeDomoticaEndpointCount(props.endpointId, next)) {
                setPreviewCount(null)
                event.target.x(width + RESIZE_OUTLINE_PADDING - RESIZE_HANDLE_HIT_WIDTH / 2)
              }
            }}
            onMouseEnter={(event) => {
              const stage = event.target.getStage()
              if (stage) stage.container().style.cursor = 'ew-resize'
            }}
            onMouseLeave={(event) => {
              const stage = event.target.getStage()
              if (stage) stage.container().style.cursor = ''
            }}
          />
          <Rect
            x={width + RESIZE_OUTLINE_PADDING - RESIZE_HANDLE_WIDTH / 2}
            y={-height / 2}
            width={RESIZE_HANDLE_WIDTH}
            height={height}
            fill="#0284c7"
            opacity={0.9}
            cornerRadius={2}
            listening={false}
          />
        </>
      )}
    </Group>
  )
}
