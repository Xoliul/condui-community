import { useTranslation } from 'react-i18next'
import { isLayoutPresetAvailable, useUIStore } from '@/stores/uiStore'
import type { LayoutPreset } from '@/types/ui'

interface PresetDef {
  preset: LayoutPreset
  icon: React.JSX.Element
}

function LayoutIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
      {children}
    </svg>
  )
}

/** Layout presets in picker order, with their icons. */
export const LAYOUT_PRESET_DEFS: PresetDef[] = [
  {
    preset: 'single',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'sideBySide',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
        <line x1="10" y1="1" x2="10" y2="19" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'stacked',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
        <line x1="1" y1="10" x2="19" y2="10" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'topPairBottomWide',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
        <line x1="1" y1="10" x2="19" y2="10" />
        <line x1="10" y1="1" x2="10" y2="10" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'topWideBottomPair',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
        <line x1="1" y1="10" x2="19" y2="10" />
        <line x1="10" y1="10" x2="10" y2="19" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'grid',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
        <line x1="1" y1="10" x2="19" y2="10" />
        <line x1="10" y1="1" x2="10" y2="19" />
      </LayoutIcon>
    ),
  },
]

export function LayoutSelector({
  compact = false,
  compactOrientation = 'portrait',
  sourcePanelIndex,
  onAfterPresetChange,
}: {
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
  /** Viewport panel that opened the layout picker (used when switching to single layout). */
  sourcePanelIndex?: number
  /** Called after a preset is applied (e.g. close the canvas switcher menu). */
  onAfterPresetChange?: () => void
}) {
  const { t } = useTranslation()
  const currentPreset = useUIStore((s) => s.viewportLayout.preset)
  const setLayoutPreset = useUIStore((s) => s.setLayoutPreset)
  const presets = compact
    ? LAYOUT_PRESET_DEFS.filter(({ preset }) =>
        compactOrientation === 'portrait'
          ? preset === 'single' || preset === 'stacked'
          : preset === 'single' || preset === 'sideBySide'
      )
    : LAYOUT_PRESET_DEFS.filter(({ preset }) => isLayoutPresetAvailable(preset))

  return (
    <div className="flex items-center gap-0.5">
      {presets.map(({ preset, icon }) => (
        <button
          key={preset}
          type="button"
          data-testid={`layout-preset-${preset}`}
          onClick={() => {
            setLayoutPreset(preset, { sourcePanelIndex })
            onAfterPresetChange?.()
          }}
          className={`p-1 rounded transition-colors ${
            currentPreset === preset
              ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
          title={t(`layout.presets.${preset}`)}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
