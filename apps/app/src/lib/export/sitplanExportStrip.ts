/**
 * Strip interactive-only nodes and fix sitplan symbols for PDF/SVG export.
 */

import Konva from 'konva'
import { WALL_POINT_HANDLE_KONVA_NAME } from '@/constants/planConstants'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import type { ExportTheme } from './types'

export { WALL_POINT_HANDLE_KONVA_NAME }

const EARTHING_SYMBOL_SVG_PATH = '/symbols/grid/earthing.svg'

function isSitplanSymbolImageNode(node: Konva.Node): boolean {
  let current: Konva.Node | null = node
  while (current) {
    const name = current.name()
    if (name?.startsWith('endpoint-') || name?.startsWith('earthing-')) {
      return true
    }
    current = current.getParent()
  }
  return false
}

export function isSitplanSymbolImageForExport(node: Konva.Image): boolean {
  return isSitplanSymbolImageNode(node)
}

/** Remove wall edit-mode vertex handles from the export clone. */
export function stripWallPointHandlesForExport(root: Konva.Group): void {
  const handles = root.find((node: Konva.Node) => node.name() === WALL_POINT_HANDLE_KONVA_NAME)
  handles.forEach((node) => node.destroy())
}

/** Remove plan wire edit UI (waypoint handles, insert preview, drag preview). */
export function stripPlanWireEditOverlayForExport(root: Konva.Group): void {
  root.findOne((node: Konva.Node) => node.name() === 'plan-wire-drag-preview')?.destroy()
  root.find('.collab-remote-selections').forEach((node: Konva.Node) => node.destroy())

  const wiresLayer = root.findOne((node: Konva.Node) => node.name() === 'plan-wires-layer') as Konva.Group | undefined
  if (!wiresLayer) return
  wiresLayer.find('Circle').forEach((circle: Konva.Node) => circle.destroy())
}

/** Reload earthing from SVG with export theme (invert looks wrong on this symbol). */
export async function rethemeEarthingSymbolsForExport(
  root: Konva.Group,
  exportTheme: ExportTheme
): Promise<void> {
  const isDark = exportTheme === 'dark'
  const groups = root.find((node: Konva.Node) => {
    const name = node.name()
    return typeof name === 'string' && name.startsWith('earthing-')
  })

  await Promise.all(
    groups.map(async (group) => {
      const image = (group as Konva.Group).findOne('Image') as Konva.Image | undefined
      if (!image) return
      try {
        const themed = await loadProcessedSymbol(EARTHING_SYMBOL_SVG_PATH, isDark)
        image.image(themed)
      } catch {
        // Keep existing image if fetch fails
      }
    })
  )
}
