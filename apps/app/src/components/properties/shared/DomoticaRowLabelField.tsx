import { Eye, EyeOff } from 'lucide-react'
import { DebouncedTextInput } from '@/components/forms'
import { AutomaticNamingOverrideControl } from './AutomaticNamingOverrideControl'
import { visibilityToggleClass } from './propertiesSharedUtils'

interface DomoticaRowLabelFieldProps {
  /** Module branch label plus separator (e.g. `A1.`); fixed while the row keeps following it. */
  prefix: string
  /** Editable text after the prefix (the whole label for a literal override). */
  value: string
  literal: boolean
  custom: boolean
  visible: boolean
  resetKey: unknown
  onCommit: (typedFullLabel: string) => void
  onToggleVisible: () => void
  onUseAutomatic: () => void
  label: string
  toggleTitle: string
  customLabel: string
  automaticLabel: string
  useAutomaticLabel: string
  setCustomLabel: string
}

export function DomoticaRowLabelField({
  prefix,
  value,
  literal,
  custom,
  visible,
  resetKey,
  onCommit,
  onToggleVisible,
  onUseAutomatic,
  label,
  toggleTitle,
  customLabel,
  automaticLabel,
  useAutomaticLabel,
  setCustomLabel,
}: DomoticaRowLabelFieldProps) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        {custom && (
          <AutomaticNamingOverrideControl
            custom
            automaticLabel={automaticLabel}
            customLabel={customLabel}
            setCustomLabel={setCustomLabel}
            useAutomaticLabel={useAutomaticLabel}
            onSetCustom={() => undefined}
            onUseAutomatic={onUseAutomatic}
          />
        )}
        <button
          type="button"
          onClick={onToggleVisible}
          className={visibilityToggleClass(visible)}
          title={toggleTitle}
        >
          {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {!literal && (
          <span className="text-sm font-medium text-gray-400 dark:text-gray-500">{prefix}</span>
        )}
        <DebouncedTextInput
          type="text"
          value={value}
          resetKey={resetKey}
          onCommit={(next) => onCommit(literal ? next : `${prefix}${next}`)}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>
    </div>
  )
}
