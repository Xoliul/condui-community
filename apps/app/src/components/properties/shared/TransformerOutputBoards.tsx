import { useTranslation } from 'react-i18next'
import { Crosshair } from 'lucide-react'
import { normalizeNominalVoltageSystem, voltageLocaleKey } from '@/constants/nominalVoltage'
import { focusBoardVoltage } from '@/handlers/properties/focusBoardVoltage'
import type { Installation } from '@/types/schema'

type OutputBoard = { panel: { id: string; name: string }; nominalVoltage: Installation['nominalVoltage'] }

/** The voltage of each board behind the site transformer; a row opens that board's busbar to change it. */
export function TransformerOutputBoards({ boards }: { boards: OutputBoard[] }) {
  const { t } = useTranslation()
  return (
    <ul className="space-y-1.5">
      {boards.map(({ panel, nominalVoltage }) => {
        const system = normalizeNominalVoltageSystem(nominalVoltage.system)
        return (
          <li key={panel.id}>
            <button
              type="button"
              onClick={() => focusBoardVoltage(panel.id)}
              className="flex w-full items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-left text-sm text-gray-800 hover:border-sky-400 dark:border-gray-600 dark:text-gray-200"
            >
              <span className="min-w-0 flex-1 truncate">{panel.name}</span>
              <span className="font-semibold">{system}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{t(voltageLocaleKey(system))}</span>
              <Crosshair aria-hidden className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
