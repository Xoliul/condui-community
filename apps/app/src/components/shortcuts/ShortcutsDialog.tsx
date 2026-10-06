import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { TouchPanIcon, TouchZoomIcon } from '@/components/icons/TouchGestureIcons'

type ShortcutEntry = {
  id: string
  keys: ShortcutKeyId[]
  note?: boolean
}

type ShortcutKeyId =
  | 'ctrlCmdZ'
  | 'ctrlCmdShiftZ'
  | 'ctrlCmdY'
  | 'ctrlCmdL'
  | 'ctrlCmdP'
  | 'ctrlCmdD'
  | 'tab'
  | 'esc'
  | 'space'
  | 'f'
  | 'plus'
  | 'equals'
  | 'minus'
  | 'leftClick'
  | 'rightClick'
  | 'middleDrag'
  | 'rightDrag'
  | 'leftDragEmptyCanvas'
  | 'shiftClick'
  | 'shiftDragSelect'
  | 'ctrlCmdAltClick'
  | 'altDragSelect'
  | 'mouseWheel'
  | 'twoFingerScroll'
  | 'pinch'
  | 'ctrlWheel'
  | 'oneFingerDrag'
  | 'twoFingerDragPinch'
  | 'doubleTap'
  | 'longPress'
  | 'threeFingerSwipeUpDown'
  | 'threeFingerSwipeLeftRight'
  | 'digit1To9'
  | 'delete'
  | 'backspace'
  | 'digits'
  | 'period'
  | 'comma'
  | 'shiftAZ'
  | 'q'
  | 'w'
  | 'd'
  | 'r'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'arrowKeys'

type ShortcutSection = {
  id: string
  entries: ShortcutEntry[]
}

type ShortcutGroup = {
  id: string
  sections: ShortcutSection[]
}

const BASE_SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    id: 'general',
    sections: [
      {
        id: 'projectPanels',
        entries: [
          { id: 'undo', keys: ['ctrlCmdZ'] },
          { id: 'redo', keys: ['ctrlCmdShiftZ', 'ctrlCmdY'] },
          { id: 'toggleLibrary', keys: ['ctrlCmdL'] },
          { id: 'toggleProperties', keys: ['ctrlCmdP'] },
          { id: 'toggleDockPanels', keys: ['tab'] },
          { id: 'closeFloatingWindows', keys: ['esc'] },
          { id: 'duplicate', keys: ['ctrlCmdD'] },
        ],
      },
      {
        id: 'editing',
        entries: [{ id: 'deleteSelection', keys: ['delete'] }],
      },
    ],
  },
  {
    id: 'viewport',
    sections: [
      {
        id: 'keyboardNavigation',
        entries: [
          { id: 'focusViewport', keys: ['space'] },
          { id: 'fitView', keys: ['f'] },
          { id: 'zoomIn', keys: ['plus', 'equals'] },
          { id: 'zoomOut', keys: ['minus'] },
          { id: 'switchToEendraadCanvas', keys: ['f1'], note: true },
          { id: 'switchToPlanCanvas', keys: ['f2'], note: true },
          { id: 'switchToPanelCanvas', keys: ['f3'], note: true },
        ],
      },
      {
        id: 'mouseSelection',
        entries: [
          { id: 'selectItem', keys: ['leftClick'] },
          { id: 'contextMenu', keys: ['rightClick'] },
          { id: 'panCanvas', keys: ['middleDrag', 'rightDrag'] },
          { id: 'rectangleSelect', keys: ['leftDragEmptyCanvas'] },
          { id: 'addToSelection', keys: ['shiftClick', 'shiftDragSelect'] },
          { id: 'removeFromSelection', keys: ['ctrlCmdAltClick', 'altDragSelect'] },
          { id: 'mouseWheelZoom', keys: ['mouseWheel', 'ctrlWheel'] },
        ],
      },
      {
        id: 'trackpadTouch',
        entries: [
          { id: 'trackpadPan', keys: ['twoFingerScroll'] },
          { id: 'trackpadPinchZoom', keys: ['pinch'] },
          { id: 'touchPan', keys: ['oneFingerDrag'] },
          { id: 'touchPanZoom', keys: ['twoFingerDragPinch'] },
          { id: 'touchContextMenu', keys: ['doubleTap'] },
          { id: 'touchMultiSelect', keys: ['longPress'] },
          { id: 'touchFocusViewport', keys: ['threeFingerSwipeUpDown'] },
          { id: 'touchSidePanels', keys: ['threeFingerSwipeLeftRight'] },
        ],
      },
    ],
  },
  {
    id: 'sitplan',
    sections: [
      {
        id: 'floors',
        entries: [{ id: 'switchFloor', keys: ['digit1To9'] }],
      },
      {
        id: 'keyboardNavigation',
        entries: [
          { id: 'toggleQuickPlacer', keys: ['q'], note: true },
          { id: 'toggleWiring', keys: ['w'], note: true },
          { id: 'toggleDrawMode', keys: ['d'], note: true },
        ],
      },
      {
        id: 'editing',
        entries: [
          { id: 'rotateSymbols', keys: ['r'], note: true },
          { id: 'nudgeSymbols', keys: ['arrowKeys'], note: true },
          { id: 'openingWidthType', keys: ['digits', 'period', 'comma', 'backspace'] },
        ],
      },
    ],
  },
  {
    id: 'quickPlacer',
    sections: [
      {
        id: 'fastPlacement',
        entries: [
          { id: 'quickPlacerEscape', keys: ['esc'] },
          { id: 'quickPlacerFloor', keys: ['digit1To9'] },
          { id: 'quickPlacerPlace', keys: ['leftClick'] },
          { id: 'quickPlacerSkip', keys: ['rightClick'] },
        ],
      },
    ],
  },
  {
    id: 'oneWire',
    sections: [
      {
        id: 'navigation',
        entries: [{ id: 'focusCircuitLetter', keys: ['shiftAZ'] }],
      },
    ],
  },
]

function ShortcutKeys({
  keys,
  translateKey,
}: {
  keys: ShortcutKeyId[]
  translateKey: (key: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-1.5 sm:justify-end">
      {keys.map((key) => {
        const TouchIcon =
          key === 'oneFingerDrag'
            ? TouchPanIcon
            : key === 'pinch' || key === 'twoFingerDragPinch'
              ? TouchZoomIcon
              : null
        return (
          <kbd
            key={key}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-[0.72rem] font-semibold leading-none text-gray-700 shadow-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
          >
            {TouchIcon ? <TouchIcon className="h-4 w-4 text-sky-700 dark:text-sky-300" /> : null}
            {translateKey(`shortcuts.keys.${key}`)}
          </kbd>
        )
      })}
    </div>
  )
}

export function ShortcutsDialog() {
  const { t } = useTranslation()
  const leftDragPansCanvas = useSettingsStore((state) => state.leftDragPansCanvas)
  const wheelBehavior = useSettingsStore((state) => state.wheelBehavior)

  const shortcutGroups = useMemo(() => {
    const adjustEntry = (entry: ShortcutEntry): ShortcutEntry | null => {
      if (leftDragPansCanvas && entry.id === 'panCanvas') {
        return { ...entry, keys: ['leftDragEmptyCanvas', 'middleDrag', 'rightDrag'] }
      }
      if (leftDragPansCanvas && entry.id === 'rectangleSelect') {
        return { ...entry, keys: ['shiftDragSelect'] }
      }
      if (wheelBehavior === 'pan' && entry.id === 'mouseWheelZoom') {
        return { ...entry, keys: ['ctrlWheel'] }
      }
      // In zoom mode two-finger scroll zooms like a wheel, so it is not a pan gesture.
      if (wheelBehavior === 'zoom' && entry.id === 'trackpadPan') return null
      return entry
    }

    return BASE_SHORTCUT_GROUPS.map((group) => {
      if (group.id !== 'viewport') return group
      return {
        ...group,
        sections: group.sections.map((section) => ({
          ...section,
          entries: section.entries
            .map(adjustEntry)
            .filter((entry): entry is ShortcutEntry => entry !== null),
        })),
      }
    })
  }, [leftDragPansCanvas, wheelBehavior])

  return (
    <div className="space-y-4 text-sm text-gray-700 dark:text-gray-200 sm:space-y-5">
      <p className="text-sm text-gray-600 dark:text-gray-400">{t('shortcuts.intro')}</p>
      <div className="space-y-4 sm:space-y-5">
        {shortcutGroups.map((group) => (
          <section
            key={group.id}
            className="rounded-md border border-gray-200 bg-white/70 p-3 dark:border-gray-700 dark:bg-gray-800/40 sm:p-4"
          >
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {t(`shortcuts.groups.${group.id}`)}
            </h3>
            <div className="mt-3 space-y-4">
              {group.sections.map((section) => (
                <div key={section.id}>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t(`shortcuts.sections.${section.id}`)}
                  </h4>
                  <div className="mt-2 divide-y divide-gray-200 rounded-md border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                    {section.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-gray-800 dark:text-gray-100">
                            {t(`shortcuts.entries.${entry.id}.description`)}
                          </div>
                          {entry.note && (
                            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {t(`shortcuts.entries.${entry.id}.note`)}
                            </div>
                          )}
                        </div>
                        <ShortcutKeys keys={entry.keys} translateKey={t} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
