/**
 * Apply export theme to a Konva node tree so scenes render in the target theme
 * without changing the global UI theme. Used when preparing export clones so that
 * the resulting SVG already has the correct colors (no SVG post-processing needed).
 */

import type Konva from 'konva'
import {
  PLAN_GRAPHIC_LABEL_FILL_DARK,
  PLAN_GRAPHIC_LABEL_FILL_LIGHT,
  PLAN_GRAPHIC_PREVIEW_FILL_DARK,
  PLAN_GRAPHIC_PREVIEW_FILL_LIGHT,
  PLAN_GRAPHIC_PREVIEW_STROKE_DARK,
  PLAN_GRAPHIC_PREVIEW_STROKE_LIGHT,
  PLAN_GRAPHIC_STROKE_DARK,
  PLAN_GRAPHIC_STROKE_LIGHT,
} from '@/lib/plan/planGraphicColors'
import { getThemeColors } from '@/lib/theme/colors'
import type { ThemeColors } from '@/lib/theme/types'

type ThemeMode = 'light' | 'dark'

const LIGHT_PDF_SCHEMATIC_COLOR = '#000000'

const PLAN_GRAPHIC_DARK_TO_LIGHT: Array<[string, string]> = [
  [PLAN_GRAPHIC_STROKE_DARK, PLAN_GRAPHIC_STROKE_LIGHT],
  [PLAN_GRAPHIC_LABEL_FILL_DARK, PLAN_GRAPHIC_LABEL_FILL_LIGHT],
  [PLAN_GRAPHIC_PREVIEW_FILL_DARK, PLAN_GRAPHIC_PREVIEW_FILL_LIGHT],
  [PLAN_GRAPHIC_PREVIEW_STROKE_DARK, PLAN_GRAPHIC_PREVIEW_STROKE_LIGHT],
]

const PLAN_GRAPHIC_LIGHT_TO_DARK: Array<[string, string]> = PLAN_GRAPHIC_DARK_TO_LIGHT.map(
  ([from, to]) => [to, from] as [string, string]
)

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${r},${g},${b})`
}

function addColorPairsToMap(map: Map<string, string>, pairs: Array<[string, string]>): void {
  pairs.forEach(([src, tgt]) => {
    map.set(src, tgt)
    map.set(src.toLowerCase(), tgt)
    if (!src.startsWith('#')) {
      return
    }
    map.set(hexToRgb(src), hexToRgb(tgt))
    map.set(hexToRgb(src).toLowerCase(), hexToRgb(tgt))
    for (const alpha of [1, 0.6, 0.5, 0.4, 0.35, 0.3, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01]) {
      map.set(hexToRgba(src, alpha), hexToRgba(tgt, alpha))
    }
  })
}

function buildReplacementMap(
  sourceColors: ThemeColors,
  targetColors: ThemeColors,
  sourceTheme: ThemeMode,
  targetTheme: ThemeMode
): Map<string, string> {
  const pairs: Array<[string, string]> = [
    [sourceColors.symbolColor, targetColors.symbolColor],
    [sourceColors.textColor, targetColors.textColor],
    [sourceColors.busColor, targetColors.busColor],
    [sourceColors.secondaryText, targetColors.secondaryText],
    [sourceColors.frameColor, targetColors.frameColor],
    [sourceColors.background, targetColors.background],
    [sourceColors.grid, targetColors.grid],
    [sourceColors.wireColor, targetColors.wireColor],
    [sourceColors.wallColor, targetColors.wallColor],
    [sourceColors.doorColor, targetColors.doorColor],
    [sourceColors.windowColor, targetColors.windowColor],
    [sourceColors.moduleBg, targetColors.moduleBg],
    [sourceColors.moduleBorder, targetColors.moduleBorder],
    [sourceColors.moduleBorderSelected, targetColors.moduleBorderSelected],
    [sourceColors.moduleText, targetColors.moduleText],
    [sourceColors.moduleSecondary, targetColors.moduleSecondary],
    [sourceColors.panelFrameStroke, targetColors.panelFrameStroke],
    [sourceColors.panelFrameFill, targetColors.panelFrameFill],
    [sourceColors.panelSupplyStroke, targetColors.panelSupplyStroke],
    [sourceColors.supplyWire, targetColors.supplyWire],
    [sourceColors.gray200, targetColors.gray200],
    [sourceColors.gray300, targetColors.gray300],
    [sourceColors.gray400, targetColors.gray400],
    [sourceColors.gray500, targetColors.gray500],
    [sourceColors.gray600, targetColors.gray600],
    [sourceColors.gray700, targetColors.gray700],
    [sourceColors.gray800, targetColors.gray800],
    [sourceColors.gray900, targetColors.gray900],
  ]

  if (sourceTheme === 'dark' && targetTheme === 'light') {
    pairs.push(...PLAN_GRAPHIC_DARK_TO_LIGHT)
  } else if (sourceTheme === 'light' && targetTheme === 'dark') {
    pairs.push(...PLAN_GRAPHIC_LIGHT_TO_DARK)
  }

  const map = new Map<string, string>()
  addColorPairsToMap(map, pairs)
  return map
}

function replaceColor(value: string, map: Map<string, string>): string | null {
  if (!value || value === 'none' || value === 'transparent' || value === 'currentColor') {
    return null
  }
  const trimmed = value.trim()
  const replaced = map.get(trimmed) ?? map.get(trimmed.toLowerCase())
  return replaced ?? null
}

/**
 * Recursively apply theme color replacement to a Konva node and its descendants.
 * Replaces fill, stroke, and other color attributes so the clone renders in the
 * export theme without changing the global UI theme.
 */
function applyThemeToNode(node: Konva.Node, map: Map<string, string>): void {
  const attrs = node.getAttrs?.() ?? {}
  const colorAttrs = ['fill', 'stroke', 'shadowColor'] as const
  for (const key of colorAttrs) {
    const value = attrs[key]
    if (typeof value === 'string') {
      const newValue = replaceColor(value, map)
      if (newValue != null) {
        node.setAttr(key, newValue)
      }
    }
  }
  const children = (node as Konva.Container).getChildren?.()
  if (children?.length) {
    children.forEach((child: Konva.Node) => applyThemeToNode(child, map))
  }
}

/**
 * Make schematic conductors black in light one-wire PDF exports.
 *
 * The nodes are explicitly marked by the one-wire renderer, so this does not
 * affect symbol artwork, frames, labels, or the live editor canvas. The pass
 * runs only on the already-cloned export scene.
 */
export function applyLightEendraadWireExportColors(rootNode: Konva.Node): void {
  const applyColor = (node: Konva.Node): void => {
    if (node.name() === 'eendraad-schematic-conductor') {
      node.setAttr('stroke', LIGHT_PDF_SCHEMATIC_COLOR)
    } else if (node.name() === 'eendraad-schematic-junction') {
      node.setAttr('fill', LIGHT_PDF_SCHEMATIC_COLOR)
    }

    const children = (node as Konva.Container).getChildren?.()
    children?.forEach((child: Konva.Node) => applyColor(child))
  }

  applyColor(rootNode)
}

/**
 * Apply export theme to a cloned Konva tree so that when it is rendered to SVG,
 * the SVG already has the target theme colors. Call this after cloning the scene
 * from the live canvas (which is in the UI theme). No global theme switch is
 * performed; the clone is modified in place.
 *
 * @param rootNode Root of the cloned Konva tree (e.g. eendraad panel group)
 * @param sourceTheme Theme the clone was taken from (current UI theme)
 * @param targetTheme Theme we want in the export (options.theme)
 */
export function applyExportThemeToKonvaNodes(
  rootNode: Konva.Node,
  sourceTheme: ThemeMode,
  targetTheme: ThemeMode
): void {
  if (sourceTheme === targetTheme) {
    return
  }
  const sourceColors = getThemeColors(sourceTheme)
  const targetColors = getThemeColors(targetTheme)
  const map = buildReplacementMap(sourceColors, targetColors, sourceTheme, targetTheme)
  applyThemeToNode(rootNode, map)
}
