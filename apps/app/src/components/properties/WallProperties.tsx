import { useTranslation } from 'react-i18next'
import { DebouncedNumberInput } from '@/components/forms'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { getThemeColor } from '@/lib/theme/colors'
import type { Wall } from '@/types/schema'

interface WallPropertiesProps {
  wall?: Wall
  masterWallThickness: number
  drawingThickness?: number
  onDrawingThicknessCommit?: (value: number) => void
}

export function WallProperties({
  wall,
  masterWallThickness,
  drawingThickness,
  onDrawingThicknessCommit,
}: WallPropertiesProps) {
  const { t } = useTranslation()
  const updateWall = useProjectStore((state) => state.updateWall)
  const deleteWall = useProjectStore((state) => state.deleteWall)
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)

  // Calculate wall length
  const wallLength = (() => {
    let total = 0
    if (!wall) return 0
    for (let i = 0; i < wall.points.length - 1; i++) {
      const p1 = wall.points[i]!
      const p2 = wall.points[i + 1]!
      total += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
    }
    return total
  })()

  const handleThicknessCommit = (value: number) => {
    if (wall) {
      updateWall(wall.id, { thickness: value })
    } else {
      onDrawingThicknessCommit?.(value)
    }
  }

  const handleDelete = () => {
    if (!wall) return
    if (confirm(t('wallProperties.confirmDelete') || 'Delete this wall?')) {
      deleteWall(wall.id)
    }
  }

  const ensureWallColors = () => {
    if (theme.wallColors) return theme.wallColors
    return {
      light: {
        fill: getThemeColor('light', 'wallColor'),
        stroke: getThemeColor('light', 'gray200'),
      },
      dark: {
        fill: getThemeColor('dark', 'wallColor'),
        stroke: getThemeColor('dark', 'grid'),
      },
    }
  }

  const wallColors = ensureWallColors()
  const thickness = wall
    ? (wall.thickness ?? masterWallThickness)
    : (drawingThickness ?? masterWallThickness)

  const updateWallColor = (mode: 'light' | 'dark', kind: 'fill' | 'stroke', value: string) => {
    const current = ensureWallColors()
    setTheme({
      ...theme,
      wallColors: {
        ...current,
        [mode]: {
          ...current[mode],
          [kind]: value,
        },
      },
    })
  }

  const invertHex = (hex: string): string => {
    const clean = hex.replace('#', '')
    if (clean.length !== 6) return hex
    const r = 255 - parseInt(clean.slice(0, 2), 16)
    const g = 255 - parseInt(clean.slice(2, 4), 16)
    const b = 255 - parseInt(clean.slice(4, 6), 16)
    const toHex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }

  const renderColorControls = (mode: 'light' | 'dark') => {
    const label =
      mode === 'light'
        ? t('wallProperties.modeLight', 'Light mode')
        : t('wallProperties.modeDark', 'Dark mode')
    const colorsForMode = wallColors[mode]
    const basePalette =
      mode === 'light'
        ? [
            getThemeColor('light', 'wallColor'),
            getThemeColor('light', 'gray400'),
            getThemeColor('light', 'gray200'),
            '#000000',
            '#ffffff',
          ]
        : [
            getThemeColor('dark', 'wallColor'),
            getThemeColor('dark', 'gray500'),
            getThemeColor('dark', 'grid'),
            '#000000',
            '#ffffff',
          ]

    const invertFill = invertHex(colorsForMode.fill)
    const invertStroke = invertHex(colorsForMode.stroke)

    const uniquePalette = Array.from(new Set([...basePalette, invertFill, invertStroke]))

    return (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{label}</h4>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              {t('wallProperties.fillColor', 'Wall fill')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colorsForMode.fill}
                onChange={(e) => updateWallColor(mode, 'fill', e.target.value)}
                className="h-8 w-10 rounded border border-gray-300 dark:border-gray-600 bg-transparent cursor-pointer"
              />
              <span className="text-xs text-gray-600 dark:text-gray-300 font-mono">
                {colorsForMode.fill.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              {t('wallProperties.strokeColor', 'Wall outline')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colorsForMode.stroke}
                onChange={(e) => updateWallColor(mode, 'stroke', e.target.value)}
                className="h-8 w-10 rounded border border-gray-300 dark:border-gray-600 bg-transparent cursor-pointer"
              />
              <span className="text-xs text-gray-600 dark:text-gray-300 font-mono">
                {colorsForMode.stroke.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('wallProperties.paletteLabel', 'Quick palette')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {uniquePalette.map((c) => (
              <button
                key={`${mode}-${c}`}
                type="button"
                className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 flex-shrink-0"
                style={{ backgroundColor: c }}
                onClick={() => {
                  // Apply to fill by default; ctrl/cmd-click applies to stroke.
                  if (window.event && (window.event as MouseEvent).metaKey) {
                    updateWallColor(mode, 'stroke', c)
                  } else {
                    updateWallColor(mode, 'fill', c)
                  }
                }}
                aria-label={t('wallProperties.paletteColor', 'Apply palette color')}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
          {t('wallProperties.thickness', 'Thickness (cm)')}
        </label>
        <DebouncedNumberInput
          type="number"
          min="1"
          step="1"
          value={thickness}
          minValue={1}
          fallbackValue={thickness}
          onCommit={handleThicknessCommit}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
        />
        {wall && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('wallProperties.thicknessHint', 'Leave empty to use master thickness')}
          </p>
        )}
      </div>

      {wall && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            {t('wallProperties.length', 'Length')}
          </label>
          <p className="text-sm text-gray-700 dark:text-gray-300">{wallLength.toFixed(2)} px</p>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('wallProperties.appearanceTitle', 'Wall appearance')}
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(
            'wallProperties.appearanceHint',
            'Global colours for all walls on the situation plan. Separate sets for light and dark mode.'
          )}
        </p>

        <div className="space-y-4">{renderColorControls(theme.mode)}</div>
      </div>

      {wall && (
        <button
          onClick={handleDelete}
          className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
        >
          {t('wallProperties.delete', 'Delete wall')}
        </button>
      )}
    </div>
  )
}
