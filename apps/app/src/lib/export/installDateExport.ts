/**
 * Install-date frames for eendraad PDF export.
 *
 * The canvas overlay is a sibling of the panel groups and is only mounted while date
 * labels are shown, so the export rebuilds the frames for each panel instead of
 * cloning the live overlay.
 */

import Konva from 'konva'
import i18n from '@/i18n'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import type { WireSegment } from '@/types/schema'
import {
  buildDateFramesForPanel,
  resolveInstallDateFrameDrawing,
  type InstallDateOverlayProject,
} from '@/components/canvas/eendraad/InstallDateOverlay'

export const INSTALL_DATE_EXPORT_NODE_NAME = 'install-date-export'

export function createInstallDateExportNode(
  project: InstallDateOverlayProject,
  panelLayout: BottomUpPanelLayout,
  monochrome: boolean,
  wireSegments: readonly WireSegment[] = []
): Konva.Group | null {
  const frames = buildDateFramesForPanel(
    project,
    panelLayout,
    monochrome,
    i18n.t,
    undefined,
    wireSegments
  )
  if (frames.length === 0) return null

  const root = new Konva.Group({ name: INSTALL_DATE_EXPORT_NODE_NAME, listening: false })
  for (const frame of frames) {
    const { drawsBorder, relationLine, labelX, labelY, textWidth, fontSize } =
      resolveInstallDateFrameDrawing(frame)
    if (drawsBorder) {
      root.add(
        new Konva.Rect({
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          stroke: frame.color,
          strokeWidth: 1.5,
          dash: [7, 5],
          opacity: 0.55,
          cornerRadius: 4,
        })
      )
    }
    if (relationLine) {
      root.add(
        new Konva.Line({
          points: relationLine,
          stroke: frame.color,
          strokeWidth: 1,
          dash: [4, 3],
          opacity: 0.75,
        })
      )
    }
    root.add(
      new Konva.Text({
        x: labelX,
        y: labelY,
        text: frame.label,
        fill: frame.color,
        fontSize,
        width: textWidth,
        align: 'right',
        fontStyle: '600',
        opacity: 0.72,
      })
    )
  }
  return root
}
