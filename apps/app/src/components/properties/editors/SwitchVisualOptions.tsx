import { useTranslation } from 'react-i18next'
import type { SwitchDeviceProps } from '@/types/schema'
import { SWITCH_SYMBOLS_WITH_VERKLIKKERLAMP } from '@/lib/symbols'

export function SwitchVisualOptions({ symbol, value = {}, onChange }: {
  symbol: string
  value?: SwitchDeviceProps
  onChange: (value: SwitchDeviceProps) => void
}) {
  const { t } = useTranslation()
  const options: { key: 'verklikkerlamp' | 'protected'; label: string }[] = []
  if ((SWITCH_SYMBOLS_WITH_VERKLIKKERLAMP as readonly string[]).includes(symbol)) {
    options.push({ key: 'verklikkerlamp', label: t('endpoints.verklikkerlamp', 'Indicator light') })
  }
  if (symbol === 'switch_impulse') {
    options.push({ key: 'protected', label: t('endpoints.protectedPushbutton', 'Protected') })
  }
  return <>{options.map(({ key, label }) => (
    <label key={key} className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={value[key] ?? false}
        onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
        className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
      />
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
    </label>
  ))}</>
}
