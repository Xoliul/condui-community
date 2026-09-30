import { isLayoutPresetAvailable, useUIStore } from '@/stores/uiStore'
import type { LayoutPreset } from '@/types/ui'

interface PresetDef {
  preset: LayoutPreset
  title: string
  icon: React.JSX.Element
}

function LayoutIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
      {children}
    </svg>
  )
}

const PRESETS: PresetDef[] = [
  {
    preset: 'single',
    title: 'Single',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'sideBySide',
    title: 'Side by side',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
        <line x1="10" y1="1" x2="10" y2="19" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'stacked',
    title: 'Stacked',
    icon: (
      <LayoutIcon>
        <rect x="1" y="1" width="18" height="18" rx="1.5" />
        <line x1="1" y1="10" x2="19" y2="10" />
      </LayoutIcon>
    ),
  },
  {
    preset: 'topPairBottomWide',
    title: 'Two top, one bottom',
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
    title: 'One top, two bottom',
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
    title: 'Two by two',
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
  const currentPreset = useUIStore((s) => s.viewportLayout.preset)
  const setLayoutPreset = useUIStore((s) => s.setLayoutPreset)
  const presets = compact
    ? PRESETS.filter(({ preset }) =>
        compactOrientation === 'portrait'
          ? preset === 'single' || preset === 'stacked'
          : preset === 'single' || preset === 'sideBySide'
      )
    : PRESETS.filter(({ preset }) => isLayoutPresetAvailable(preset))

  return (
    <div className="flex items-center gap-0.5">
      {presets.map(({ preset, title, icon }) => (
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
          title={title}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
