/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { updateEndpointProperties } from '@/handlers/properties/editProperties'
import CustomDropdown from '@/components/common/CustomDropdown'
import { MULTI_SOCKET_OFFSET, SYMBOL_SIZE } from '@/components/canvas/eendraad/canvasSymbols'
import { getSymbolById, getSymbolIconPath } from '@/lib/symbols'
import { getEndpointMultiplier } from '@/utils/endpointMultipliers'
import {
  createSyncEndpointMultiplierDeps,
  syncEndpointMultiplierCount,
} from '@/lib/eendraad/syncEndpointMultiplierCount'
import type { Endpoint, TrunkDevice } from '@/types/schema'
import type { SymbolKey } from '@/types/schema'
import {
  createSyncSupplyInverterMultiplierDeps,
  getSupplyDeviceMultiplier,
  syncSupplyDeviceMultiplierCount,
} from '@/lib/eendraad/syncSupplyInverterMultiplier'
import { allowedSocketCountsForEndpoint } from '@/lib/socket/modularSocket'

const SOCKET_PREVIEW_SYMBOL_PX = 40
const SOCKET_PREVIEW_OFFSET_PX = (MULTI_SOCKET_OFFSET / SYMBOL_SIZE) * SOCKET_PREVIEW_SYMBOL_PX

const dropdownClassName =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500'

/** Normalize legacy socket symbol keys for preview (old projects may have socket_230v/socket_3phase) */
function normalizeSocketSymbol(symbol: SymbolKey | string | undefined): SymbolKey {
  if (symbol === 'socket_230v') return 'socket_gnd_child'
  if (symbol === 'socket_3phase') return 'socket'
  return (symbol as SymbolKey) ?? 'socket_gnd_child'
}

function getEndpointPreviewSrc(endpoint: Endpoint): string {
  if (endpoint.type === 'socket') {
    const sym = normalizeSocketSymbol(endpoint.symbol)
    return `/symbols/outlets/${sym}.svg`
  }
  const symbol = getSymbolById(endpoint.symbol ?? '')
  return symbol ? getSymbolIconPath(symbol) : '/symbols/lighting/light_point.svg'
}

function SocketCountPreview({ previewSrc, count }: { previewSrc: string; count: number }) {
  const clamped = Math.max(1, Math.min(4, Math.floor(count)))
  const width = SOCKET_PREVIEW_SYMBOL_PX + Math.max(0, clamped - 1) * SOCKET_PREVIEW_OFFSET_PX

  return (
    <div className="flex justify-center py-1">
      <div className="relative" style={{ width, height: SOCKET_PREVIEW_SYMBOL_PX }}>
        {Array.from({ length: clamped }, (_, i) => (
          <img
            key={i}
            src={previewSrc}
            alt=""
            aria-hidden="true"
            className="absolute top-0 opacity-90 dark:invert"
            style={{
              left: i * SOCKET_PREVIEW_OFFSET_PX,
              width: SOCKET_PREVIEW_SYMBOL_PX,
              height: SOCKET_PREVIEW_SYMBOL_PX,
            }}
          />
        ))}
      </div>
    </div>
  )
}

const MULTIPLIER_PREVIEW_SYMBOL_PX = 40

/** One symbol + optional Nx badge — matches one-wire multiplier rendering. */
function MultiplierSymbolPreview({ previewSrc, count }: { previewSrc: string; count: number }) {
  const clamped = Math.max(1, Math.floor(count))

  return (
    <div className="flex justify-center py-1">
      <div
        className="relative inline-block"
        style={{ width: MULTIPLIER_PREVIEW_SYMBOL_PX, height: MULTIPLIER_PREVIEW_SYMBOL_PX }}
      >
        <img
          src={previewSrc}
          alt=""
          aria-hidden="true"
          className="opacity-90 dark:invert"
          style={{
            width: MULTIPLIER_PREVIEW_SYMBOL_PX,
            height: MULTIPLIER_PREVIEW_SYMBOL_PX,
          }}
        />
        {clamped > 1 && (
          <span
            className="absolute bottom-full left-full -translate-x-1/2 text-xs font-bold leading-none text-gray-900 dark:text-gray-100"
            aria-hidden="true"
          >
            {clamped}x
          </span>
        )}
      </div>
    </div>
  )
}

type SocketAddMoreDialogBodyProps = {
  previewSrc: string
  message: string
  inputLabel: string
  currentValue: number
  allowedCounts?: readonly number[]
  onConfirm: (value: number) => void
  onCancel: () => void
}

function SocketAddMoreDialogBody({
  previewSrc,
  message,
  inputLabel,
  currentValue,
  allowedCounts = [1, 2, 3, 4],
  onConfirm,
  onCancel,
}: SocketAddMoreDialogBodyProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(String(currentValue))
  const [hoveredValue, setHoveredValue] = useState<string | null>(null)
  const count = Number(value) || 1
  const previewCount = Number(hoveredValue ?? value) || 1

  return (
    <div className="space-y-4">
      <SocketCountPreview previewSrc={previewSrc} count={previewCount} />
      <p className="text-gray-600 dark:text-gray-400">{message}</p>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {inputLabel}
        </label>
        <CustomDropdown
          value={value}
          onChange={setValue}
          onOptionHover={setHoveredValue}
          menuPlacement="bottom"
          menuPortal
          options={allowedCounts.map((n) => ({
            value: String(n),
            label: String(n),
          }))}
          className={dropdownClassName}
        />
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:justify-end sm:gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(count)}
          className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white transition-colors hover:bg-sky-700"
        >
          {t('common.confirm')}
        </button>
      </div>
    </div>
  )
}

type AddMoreCountDialogBodyProps = {
  previewSrc: string
  message: string
  inputLabel: string
  currentValue: number
  min: number
  max?: number
  allowedValues?: number[]
  onConfirm: (value: number) => void
  onCancel: () => void
}

function AddMoreCountDialogBody({
  previewSrc,
  message,
  inputLabel,
  currentValue,
  min,
  max,
  allowedValues,
  onConfirm,
  onCancel,
}: AddMoreCountDialogBodyProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(String(currentValue))
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const validate = (raw: string): string | null => {
    const n = Number(raw)
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return t('multiplier.invalidNumber', 'Enter a whole number')
    }
    if (n < min) {
      return t('multiplier.mustBeAtLeastOne', 'Number must be at least 1')
    }
    if (max != null && n > max) {
      return t('multiplier.maximumCount', 'Maximum is {{max}}', { max })
    }
    if (allowedValues && !allowedValues.includes(n)) {
      return t('multiplier.allowedInverterCounts', 'Use 1, 2, or 3')
    }
    return null
  }

  const handleConfirm = () => {
    const validationError = validate(value)
    if (validationError) {
      setError(validationError)
      return
    }
    onConfirm(Number(value))
  }

  const previewCount = (() => {
    const n = Number(value)
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return currentValue
    if (max != null && n > max) return max
    if (allowedValues && !allowedValues.includes(n)) return currentValue
    return n
  })()

  return (
    <div className="space-y-4">
      <MultiplierSymbolPreview previewSrc={previewSrc} count={previewCount} />
      <p className="text-gray-600 dark:text-gray-400">{message}</p>
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {inputLabel}
        </label>
        <input
          ref={inputRef}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(validate(e.target.value))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleConfirm()
            }
          }}
          onBlur={() => setError(validate(value))}
          className={`w-full rounded-md border bg-white px-4 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:bg-gray-700 dark:text-white ${
            error ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'
          }`}
        />
        {error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 dark:border-gray-700 sm:flex-row sm:justify-end sm:gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!!error || !value.trim()}
          className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {t('common.confirm')}
        </button>
      </div>
    </div>
  )
}

export function openLightAddMoreDialog(endpoint: Endpoint, t: TFunction) {
  const { openDialog, closeDialog } = useDialogStore.getState()
  const previewSrc = getEndpointPreviewSrc(endpoint)
  const currentValue = getEndpointMultiplier(endpoint)

  openDialog({
    type: 'custom',
    title: t('contextMenu.addMore', 'Add more...'),
    showCloseButton: true,
    content: (
      <AddMoreCountDialogBody
        previewSrc={previewSrc}
        message={t('multiplier.setTotalCount', 'Set total number of symbols in sitplan')}
        inputLabel={t('multiplier.totalCount', 'Total count')}
        currentValue={currentValue}
        min={1}
        onConfirm={(target) => {
          syncEndpointMultiplierCount(createSyncEndpointMultiplierDeps(), endpoint.id, target)
          closeDialog()
        }}
        onCancel={() => closeDialog()}
      />
    ),
  })
}

export function openSocketAddMoreDialog(endpoint: Endpoint, t: TFunction) {
  const { openDialog, closeDialog } = useDialogStore.getState()
  const previewSrc = getEndpointPreviewSrc(endpoint)
  const currentValue = endpoint.socketProps?.socketCount ?? 1

  openDialog({
    type: 'custom',
    title: t('contextMenu.addMore', 'Add more...'),
    showCloseButton: true,
    content: (
      <SocketAddMoreDialogBody
        previewSrc={previewSrc}
        message={t('endpoints.setSocketCount', 'Set number of sockets')}
        inputLabel={t('endpoints.socketCount', 'Number of sockets')}
        currentValue={currentValue}
        allowedCounts={allowedSocketCountsForEndpoint(endpoint)}
        onConfirm={(count) => {
          const st = useProjectStore.getState()
          const latest = st.getEndpointById(endpoint.id)
          if (!latest) return
          updateEndpointProperties(endpoint.id, {
            socketProps: {
              ...latest.socketProps,
              socketCount: count <= 1 ? undefined : count,
            },
          })
          closeDialog()
        }}
        onCancel={() => closeDialog()}
      />
    ),
  })
}

export function openSupplyInverterAddMoreDialog(device: TrunkDevice, t: TFunction) {
  openSupplyDeviceAddMoreDialog(device, t)
}

export function openSupplyDeviceAddMoreDialog(device: TrunkDevice, t: TFunction) {
  const { openDialog, closeDialog } = useDialogStore.getState()
  const deviceSymbol = getSymbolById(device.symbol)
  const previewSrc = deviceSymbol ? getSymbolIconPath(deviceSymbol) : '/symbols/energy/inverter.svg'
  const isInverter = device.symbol === 'inverter'

  openDialog({
    type: 'custom',
    title: t('contextMenu.addMore', 'Add more...'),
    showCloseButton: true,
    content: (
      <AddMoreCountDialogBody
        previewSrc={previewSrc}
        message={t('multiplier.setTotalCount', 'Set total number of symbols in sitplan')}
        inputLabel={t('multiplier.totalCount', 'Total count')}
        currentValue={getSupplyDeviceMultiplier(device)}
        min={1}
        max={isInverter ? 3 : 99}
        allowedValues={isInverter ? [1, 2, 3] : undefined}
        onConfirm={(target) => {
          syncSupplyDeviceMultiplierCount(
            createSyncSupplyInverterMultiplierDeps(),
            device.id,
            target
          )
          closeDialog()
        }}
        onCancel={() => closeDialog()}
      />
    ),
  })
}

export function openAddMoreDialogForEndpoint(endpoint: Endpoint, t: TFunction) {
  if (endpoint.type === 'socket') {
    openSocketAddMoreDialog(endpoint, t)
    return
  }
  openLightAddMoreDialog(endpoint, t)
}
