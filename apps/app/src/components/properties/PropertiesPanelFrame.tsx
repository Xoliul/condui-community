import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX } from '@/constants/layoutConstants'

function PropertiesPanelContent({
  readOnly,
  allowReadOnlyInteraction = false,
  showSensitiveInfoNotice = false,
  children,
}: {
  readOnly: boolean
  allowReadOnlyInteraction?: boolean
  showSensitiveInfoNotice?: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const blockReadOnlyEditorInteraction = useCallback(
    (event: React.SyntheticEvent) => {
      if (!readOnly || !allowReadOnlyInteraction) return
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-readonly-allow="true"]')) return
      if (target.closest('input, textarea, select, button, [role="button"]')) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [allowReadOnlyInteraction, readOnly]
  )

  return (
    <div
      className="flex-1 overflow-y-auto"
      data-library-scroll="true"
      style={{
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorY: 'contain',
        touchAction: 'pan-y',
      }}
    >
      {showSensitiveInfoNotice ? (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          {t(
            'viewer.propertiesReadOnly',
            'Read-only view. Sensitive contact and address fields are hidden.'
          )}
        </div>
      ) : null}
      <div
        className={`p-4 ${readOnly ? 'select-text opacity-95 [&_.one-wire-visibility-toggle]:hidden [&_[data-custom-dropdown-chevron="true"]]:hidden [&_[data-custom-dropdown-control="true"]]:pr-3 [&_[data-symbol-dropdown-chevron="true"]]:hidden [&_[data-symbol-dropdown-control="true"]]:pr-3 [&_select]:appearance-none' : ''} ${
          readOnly && !allowReadOnlyInteraction ? 'pointer-events-none' : ''
        }`}
        aria-readonly={readOnly}
        onClickCapture={blockReadOnlyEditorInteraction}
        onPointerDownCapture={blockReadOnlyEditorInteraction}
        onKeyDownCapture={blockReadOnlyEditorInteraction}
      >
        {children}
      </div>
    </div>
  )
}

export function PropertiesPanelFrame({
  title,
  titleAccessory,
  panelVisible,
  embedded,
  panelWidth,
  readOnly,
  allowReadOnlyInteraction,
  showSensitiveInfoNotice,
  onToggle,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  title: string
  /** Small status icons shown right after the title. */
  titleAccessory?: React.ReactNode
  panelVisible: boolean
  embedded: boolean
  panelWidth: number
  readOnly: boolean
  allowReadOnlyInteraction?: boolean
  showSensitiveInfoNotice?: boolean
  onToggle: () => void
  onMouseEnter: React.MouseEventHandler<HTMLElement>
  onMouseLeave: React.MouseEventHandler<HTMLElement>
  children: React.ReactNode
}) {
  if (!panelVisible && !embedded) {
    return (
      <div
        onClick={onToggle}
        className="flex items-center justify-center bg-gray-100 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        style={{ width: COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX }}
        title={title}
      >
        <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
      </div>
    )
  }

  return (
    <aside
      data-properties-panel
      style={embedded ? undefined : { width: panelWidth }}
      className={`flex flex-col bg-white dark:bg-gray-800 overflow-hidden ${
        embedded ? 'h-full min-h-0' : 'border-l border-gray-200 dark:border-gray-700'
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {!embedded && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={onToggle}
              className="p-1 shrink-0 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {title}
            </h3>
            {titleAccessory}
          </div>
        </div>
      )}

      <PropertiesPanelContent
        readOnly={readOnly}
        allowReadOnlyInteraction={allowReadOnlyInteraction}
        showSensitiveInfoNotice={showSensitiveInfoNotice}
      >
        {children}
      </PropertiesPanelContent>
    </aside>
  )
}
