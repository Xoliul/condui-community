import { memo, type ComponentType, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, LayoutGrid, Star } from 'lucide-react'
import {
  LIBRARY_RAIL_GROUPS,
  type LibraryRailEntry,
  type LibraryRailGroupKey,
  type LibraryRailSelection,
} from '@/lib/library/libraryRailGroups'
import { libraryRailHotkeyLabel } from '@/lib/library/libraryRailHotkeys'
import { useSettingsStore } from '@/stores/settingsStore'

interface RailButtonProps {
  label: string
  title: string
  selected: boolean
  current?: boolean
  hotkey?: string | null
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  children: (selected: boolean) => ReactNode
}

function RailButton({ label, title, selected, current = false, hotkey, onClick, children }: RailButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title.split('\n')[0]}
      aria-keyshortcuts={hotkey ?? undefined}
      aria-pressed={selected}
      aria-current={current ? 'location' : undefined}
      onClick={onClick}
      className={`flex w-full flex-shrink-0 flex-col items-center gap-0.5 rounded-md py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500 ${
        selected
          ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
          : current
            ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
            : 'text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700'
      }`}
    >
      {children(selected)}
      <span className="w-full truncate px-0.5 text-center text-[10px] leading-tight">{label}</span>
    </button>
  )
}

const ENTRY_ICONS: Record<LibraryRailEntry, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  all: LayoutGrid,
  recent: Clock,
  favorites: Star,
}

interface LibraryCategoryRailProps {
  /** Groups that have symbols in the current view, in display order. */
  groupKeys: readonly LibraryRailGroupKey[]
  selection: LibraryRailSelection
  /** True while a search is active: no entry shows as selected. */
  searching: boolean
  /** Group whose section is at the top of the list while browsing All. */
  currentGroup: LibraryRailGroupKey | null
  onSelectEntry: (entry: LibraryRailEntry) => void
  onSelectGroup: (key: LibraryRailGroupKey, additive: boolean) => void
}

function LibraryCategoryRail({
  groupKeys,
  selection,
  searching,
  currentGroup,
  onSelectEntry,
  onSelectGroup,
}: LibraryCategoryRailProps) {
  const { t } = useTranslation()
  const entries: ReadonlyArray<{ entry: LibraryRailEntry; label: string; title: string }> = [
    { entry: 'all', label: t('symbols.rail.all'), title: t('symbols.rail.all') },
    { entry: 'recent', label: t('symbols.rail.recent'), title: t('symbols.recent') },
    { entry: 'favorites', label: t('symbols.rail.favorites'), title: t('symbols.favorites') },
  ]
  const hint = t('symbols.rail.multiHint')
  const keyboardLayout = useSettingsStore((state) => state.keyboardLayout)

  return (
    <nav
      data-library-rail="true"
      className="flex w-14 flex-shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-r border-gray-200 bg-gray-50 px-1 py-1.5 dark:border-gray-700 dark:bg-gray-900/50"
    >
      {entries.map(({ entry, label, title }) => {
        const Icon = ENTRY_ICONS[entry]
        return (
          <RailButton
            key={entry}
            label={label}
            title={title}
            selected={!searching && selection.kind === entry}
            onClick={() => onSelectEntry(entry)}
          >
            {() => (
              <span className="flex h-7 w-7 items-center justify-center">
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
            )}
          </RailButton>
        )
      })}
      <div className="mx-2 my-1 flex-shrink-0 border-t border-gray-200 dark:border-gray-700" />
      {LIBRARY_RAIL_GROUPS.filter((group) => groupKeys.includes(group.key)).map((group) => {
        const title = group.key === 'other' ? t('symbols.rail.other') : t(`symbols.categories.${group.key}`)
        const hotkey = libraryRailHotkeyLabel(group.key, keyboardLayout)
        return (
          <RailButton
            key={group.key}
            label={t(`symbols.rail.short.${group.key}`)}
            title={`${hotkey ? `${title} (${hotkey})` : title}\n${hint}`}
            hotkey={hotkey}
            selected={!searching && selection.kind === 'groups' && selection.groups.has(group.key)}
            current={!searching && selection.kind === 'all' && currentGroup === group.key}
            onClick={(event) => onSelectGroup(group.key, event.ctrlKey || event.metaKey || event.shiftKey)}
          >
            {(selected) => (
              <img
                src={group.iconPath}
                alt=""
                draggable={false}
                className={`pointer-events-none h-7 w-7 object-contain ${selected ? 'invert dark:invert-0' : 'dark:invert'}`}
              />
            )}
          </RailButton>
        )
      })}
    </nav>
  )
}

export default memo(LibraryCategoryRail)
