import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import CustomDropdown from '@/components/common/CustomDropdown'
import type {
  DomoticaControlKey,
  DomoticaOutputWireProps,
  Endpoint,
  LightPointDeviceProps,
  MotionDetectorType,
  PolesConfig,
  RelayControlMode,
  RelayDeviceProps,
  SmokeDetectorType,
  SymbolKey,
} from '@/types/schema'
import { DebouncedTextarea } from '@/components/forms'
import { applyLightPointOptionToggle } from '@/lib/lightPointProps'
import {
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  getFixedApplianceSymbolPath,
  getSwitchSymbolPaths,
  getSwitchDisplaySvgPath,
  LIGHT_POINT_OVERLAY_PATHS,
  LIGHT_SPOT_OVERLAY_PATHS,
  MOTION_DETECTOR_SVG_PATHS,
  RELAY_OVERLAY_PATHS,
  SMOKE_DETECTOR_OVERLAY_PATHS,
  getSymbolsByCategory,
  symbols,
} from '@/lib/symbols'
import {
  POLE_CONFIG_OPTIONS,
  configFromPoles,
  polesConfigToDisplay,
  polesFromConfig,
} from '@/constants/poleConfig'
import { useProjectStore } from '@/stores/projectStore'
import { labelClass, selectClass, visibilityToggleClass } from '../shared/propertiesSharedUtils'
import type { TFunction } from 'i18next'
import { CERTIFICATION_LISTING_VISIBILITY_KEY } from '@/lib/certificationLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import type { SynergridCatalogEntry, SynergridCatalogFocus } from '@/lib/synergridCatalog'
import { CertificationListingFields } from '../CertificationListingFields'
import { SynergridListPicker } from '../SynergridListPicker'
import {
  APPLIANCE_SYMBOLS,
  normalizeSocketSymbol,
  normalizeSwitchSymbol,
} from './endpointControlsUtils'
export const DOMOTICA_MAIN_TYPES = ['none', 'socket', 'switch'] as const
export const DOMOTICA_CONTROL_KEYS: DomoticaControlKey[] = [
  'programmed_control',
  'wireless_control',
  'detection_control',
  'button_control',
] as const

// Relay-specific properties (symbol === 'relay')
export function RelayEndpointFields({
  endpointId,
  endpoint,
  onUpdate,
  t,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
  t: (key: string, defaultValue?: string) => string
}) {
  return <RelayDeviceFields relay={endpoint.relayProps} onChange={(relayProps) => onUpdate(endpointId, { relayProps })} t={t} />
}

/** The same electrical relay controls serve circuit endpoints and supply trunk devices. */
export function RelayDeviceFields({ relay = {}, onChange, t }: {
  relay?: RelayDeviceProps
  onChange: (relayProps: RelayDeviceProps) => void
  t: (key: string, defaultValue?: string) => string
}) {
  const relayControlOptions: RelayControlMode[] = [
    'standard',
    'timer',
    'clock',
    'impulse',
    'thermostat',
    'dimmer',
  ]

  return (
    <>
      <div>
        <label className={labelClass}>{t('endpoints.relay.control', 'Control')}</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {relayControlOptions.map((mode) => {
            const isActive = (relay.control ?? 'standard') === mode
            const overlayPath = RELAY_OVERLAY_PATHS[mode as keyof typeof RELAY_OVERLAY_PATHS]
            return (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (isActive) return
                  onChange({ ...relay, control: mode })
                }}
                className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
                }`}
                aria-pressed={isActive}
              >
                {overlayPath ? (
                  <div className="w-12 h-12 overflow-hidden flex items-center justify-center">
                    <img
                      src={overlayPath}
                      alt=""
                      aria-hidden="true"
                      className="w-12 h-12 opacity-90 dark:invert"
                      style={{ clipPath: 'inset(20% 0 20% 0)' }}
                    />
                  </div>
                ) : null}
                <span className="text-[11px] leading-tight text-center">
                  {t(`endpoints.relay.control_${mode}`)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <label className={labelClass}>{t('endpoints.relay.poles', 'Poles')}</label>
        <input
          type="number"
          value={relay.poles ?? 1}
          onChange={(e) =>
            onChange({ ...relay, poles: e.target.value ? Number(e.target.value) : 1 })
          }
          min={1}
          max={4}
          className={selectClass}
        />
      </div>
      <div>
        <label className={labelClass}>{t('endpoints.relay.maxCurrentRating', 'Max Current Rating')} (A)</label>
        <input
          type="number"
          value={relay.maxCurrentRatingA ?? ''}
          onChange={(e) => onChange({ ...relay, maxCurrentRatingA: e.target.value ? Number(e.target.value) : undefined })}
          min={0}
          step="any"
          className={selectClass}
        />
      </div>
    </>
  )
}

// Smoke / fire detector overlay type (symbol === 'smoke_detector')
export function SmokeDetectorEndpointFields({
  endpointId,
  endpoint,
  onUpdate,
  t,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
  t: (key: string, defaultValue?: string) => string
}) {
  const detector = endpoint.smokeDetectorProps || {}
  const typeOptions: SmokeDetectorType[] = ['smoke', 'gas', 'manual', 'beam', 'flame', 'heat']

  return (
    <div>
      <label className={labelClass}>{t('endpoints.smokeDetector.type', 'Detector type')}</label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {typeOptions.map((type) => {
          const isActive = (detector.type ?? 'smoke') === type
          const overlayPath = SMOKE_DETECTOR_OVERLAY_PATHS[type]
          return (
            <button
              key={type}
              type="button"
              onClick={() => {
                if (isActive) return
                onUpdate(endpointId, {
                  smokeDetectorProps: { ...detector, type },
                })
              }}
              className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
              aria-pressed={isActive}
            >
              {overlayPath ? (
                <div className="w-12 h-12 overflow-hidden flex items-center justify-center relative">
                  <img
                    src="/symbols/switches/smoke_detector_base.svg"
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-12 h-12 opacity-90 dark:invert"
                  />
                  <img
                    src={overlayPath}
                    alt=""
                    aria-hidden="true"
                    className="relative w-12 h-12 opacity-90 dark:invert"
                  />
                </div>
              ) : null}
              <span className="text-[11px] leading-tight text-center">
                {t(`endpoints.smokeDetector.type_${type}`)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Motion detector artwork type (symbol === 'motion_detector')
export function MotionDetectorEndpointFields({
  endpointId,
  endpoint,
  onUpdate,
  t,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
  t: (key: string, defaultValue?: string) => string
}) {
  const detector = endpoint.motionDetectorProps || {}
  const typeOptions: MotionDetectorType[] = ['spread', 'generic']

  return (
    <div>
      <label className={labelClass}>{t('endpoints.motionDetector.type', 'Detector type')}</label>
      <div className="grid grid-cols-2 gap-2">
        {typeOptions.map((type) => {
          const isActive = (detector.type ?? 'spread') === type
          const iconPath = MOTION_DETECTOR_SVG_PATHS[type]
          return (
            <button
              key={type}
              type="button"
              onClick={() => {
                if (isActive) return
                onUpdate(endpointId, {
                  motionDetectorProps: { ...detector, type },
                })
              }}
              className={`flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
              aria-pressed={isActive}
            >
              <div className="w-12 h-12 overflow-hidden flex items-center justify-center">
                <img
                  src={iconPath}
                  alt=""
                  aria-hidden="true"
                  className="w-12 h-12 opacity-90 dark:invert"
                />
              </div>
              <span className="text-[11px] leading-tight text-center">
                {t(`endpoints.motionDetector.type_${type}`)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Energy meter-specific properties (symbol === 'energy_meter')
export function EnergyMeterEndpointFields({
  endpointId,
  endpoint,
  onUpdate,
  t,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
  t: (key: string, defaultValue?: string) => string
}) {
  const em = endpoint.energyMeterProps || {}
  const polesConfigValue = polesConfigToDisplay(em.polesConfig) || configFromPoles(em.poles) || ''
  return (
    <>
      <div>
        <label className={labelClass}>{t('protections.polesConfig', 'Pole configuration')}</label>
        <CustomDropdown
          value={polesConfigValue}
          onChange={(nextValue) => {
            const config = nextValue as PolesConfig | ''
            onUpdate(endpointId, {
              energyMeterProps: {
                ...em,
                polesConfig: config || undefined,
                poles: config ? polesFromConfig(config) : undefined,
              },
            })
          }}
          options={[
            { value: '', label: '-' },
            ...POLE_CONFIG_OPTIONS.map((opt) => ({ value: opt, label: opt })),
          ]}
          className={selectClass}
        />
      </div>
      <div>
        <label className={labelClass}>{t('endpoints.notes', 'Notes')}</label>
        <DebouncedTextarea
          value={endpoint.notes ?? ''}
          onCommit={(v) => onUpdate(endpointId, { notes: v })}
          delayMs={500}
          rows={3}
          className={`${selectClass} resize-none`}
        />
      </div>
    </>
  )
}

// Domotica-specific properties (symbol === 'domotica')
export function DomoticaEndpointFields({
  endpointId,
  endpoint,
  onUpdate,
  t,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
  t: (key: string, defaultValue?: string) => string
}) {
  const deleteEndpoints = useProjectStore((state) => state.deleteEndpoints)
  const getEndpointById = useProjectStore((state) => state.getEndpointById)
  const findCircuitForEndpoint = useProjectStore((state) => state.findCircuitForEndpoint)
  const dom = endpoint.domoticaProps || {}
  const endpointCount = Math.max(1, Math.min(20, Math.trunc(dom.endpointCount ?? 1)))
  const mainDeviceType = dom.mainDeviceType ?? 'none'
  const mainSwitchSymbol = (dom.mainSwitchSymbol as SymbolKey | undefined) ?? 'switch'
  const mainSocketSymbol = (dom.mainSocketSymbol as SymbolKey | undefined) ?? 'socket_gnd_child'
  const mainSwitchProps = dom.mainSwitchProps ?? {}
  const mainSocketProps = dom.mainSocketProps ?? {}
  const controlSet = new Set<DomoticaControlKey>(dom.control ?? [])

  const syncChildCounts = (next: {
    endpointCount?: number
    endpointChildEndpointIds?: string[]
    control?: DomoticaControlKey[]
  }) => {
    const info = findCircuitForEndpoint(endpointId)
    if (!info) return

    const nextEndpointCount = Math.max(
      1,
      Math.min(20, Math.trunc(next.endpointCount ?? endpointCount))
    )

    const existingEndpointChildIds = (
      next.endpointChildEndpointIds ??
      dom.endpointChildEndpointIds ??
      []
    ).filter((id) => !!getEndpointById(id))

    // Keep only existing children; do not auto-create endpoints when increasing count.
    // Output wires stay empty until the user drops something onto them.
    const endpointChildIds = [...existingEndpointChildIds]

    if (endpointChildIds.length > nextEndpointCount) {
      const removed = endpointChildIds.splice(nextEndpointCount)
      if (removed.length > 0) deleteEndpoints(removed)
    }

    // Ensure per-output wire arrays exist and match the new counts so domotica
    // outputs get independent wire properties rather than reusing the trunk.
    const baseCable = info.circuit.cable
    const baseRoute = info.circuit.wireRoute ?? (info.circuit.inWall ? 'wall' : undefined)
    const baseInWall = info.circuit.inWall ?? false
    const baseHide = info.circuit.hideWireLabel

    const ensureWireArray = (
      arr: DomoticaOutputWireProps[] | undefined,
      desiredCount: number
    ): DomoticaOutputWireProps[] => {
      const nextArr = [...(arr ?? [])]
      while (nextArr.length < desiredCount) {
        nextArr.push({
          cable: { ...baseCable },
          inTube: info.circuit.inTube,
          wireRoute: baseRoute,
          inWall: baseInWall,
          hideWireLabel: baseHide,
        })
      }
      return nextArr.slice(0, desiredCount)
    }

    const nextEndpointOutputWires = ensureWireArray(dom.endpointOutputWires, nextEndpointCount)

    onUpdate(endpointId, {
      domoticaProps: {
        ...dom,
        ...next,
        endpointCount: nextEndpointCount,
        endpointChildEndpointIds: endpointChildIds,
        endpointOutputWires: nextEndpointOutputWires,
      },
    })
  }

  const toggleControl = (key: DomoticaControlKey) => {
    const next = new Set(controlSet)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    syncChildCounts({ control: Array.from(next) })
  }

  const updateMainType = (type: 'none' | 'socket' | 'switch') => {
    onUpdate(endpointId, {
      domoticaProps: {
        ...dom,
        mainDeviceType: type,
        mainSocketSymbol:
          type === 'socket'
            ? ((dom.mainSocketSymbol as SymbolKey | undefined) ?? 'socket_gnd_child')
            : dom.mainSocketSymbol,
        mainSwitchSymbol:
          type === 'switch'
            ? ((dom.mainSwitchSymbol as SymbolKey | undefined) ?? 'switch')
            : dom.mainSwitchSymbol,
      },
    })
  }

  const updateMainSocket = (updates: {
    symbol?: SymbolKey
    socketProps?: Endpoint['socketProps']
  }) => {
    onUpdate(endpointId, {
      domoticaProps: {
        ...dom,
        mainDeviceType: 'socket',
        mainSocketSymbol: updates.symbol ?? mainSocketSymbol,
        mainSocketProps: updates.socketProps ?? mainSocketProps,
      },
    })
  }

  const updateMainSwitch = (updates: {
    symbol?: SymbolKey
    switchProps?: Endpoint['switchProps']
  }) => {
    onUpdate(endpointId, {
      domoticaProps: {
        ...dom,
        mainDeviceType: 'switch',
        mainSwitchSymbol: updates.symbol ?? mainSwitchSymbol,
        mainSwitchProps: updates.switchProps ?? mainSwitchProps,
      },
    })
  }
  return (
    <>
      {/* Control capabilities (top band of domotica frame) */}
      <div>
        <label className={labelClass}>{t('endpoints.domotica.controlArea', 'Control')}</label>
        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            DOMOTICA_CONTROL_KEYS.filter((key) =>
              [
                'programmed_control',
                'wireless_control',
                'detection_control',
                'button_control',
              ].includes(key)
            ) as Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS>
          ).map((key) => {
            const active = controlSet.has(key)
            const labelKey =
              key === 'programmed_control'
                ? 'control_programmed'
                : key === 'wireless_control'
                  ? 'control_wireless'
                  : key === 'detection_control'
                    ? 'control_detection'
                    : 'control_button'
            const iconPath = DOMOTICA_CONTROL_OVERLAY_PATHS[key]
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleControl(key)}
                className={`flex flex-col items-center justify-center px-2 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                  active
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-sky-300'
                }`}
              >
                <div className="h-10 flex items-center justify-center">
                  <img src={iconPath} alt="" className="w-10 h-10 dark:invert" />
                </div>
                <div className="mt-0.5 text-[10px] leading-tight text-center">
                  {t(`endpoints.domotica.${labelKey}`, labelKey)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main device type inside domotica frame */}
      <div>
        <label className={labelClass}>{t('endpoints.domotica.mainType', 'Main device')}</label>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {DOMOTICA_MAIN_TYPES.map((type) => {
            const selected = mainDeviceType === type
            const labelKey =
              type === 'none'
                ? 'mainType_none'
                : type === 'socket'
                  ? 'mainType_socket'
                  : 'mainType_switch'
            return (
              <button
                key={type}
                type="button"
                onClick={() => updateMainType(type)}
                className={`flex flex-col items-center justify-center px-2 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                    : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-sky-300'
                }`}
              >
                <div className="h-8 flex items-center justify-center">
                  {type === 'socket' ? (
                    <img
                      src="/symbols/outlets/socket_gnd_child.svg"
                      alt="Socket"
                      className="w-7 h-7 dark:invert"
                    />
                  ) : type === 'switch' ? (
                    <img
                      src="/symbols/switches/switch_1p.svg"
                      alt="Switch"
                      className="w-7 h-7 dark:invert"
                    />
                  ) : (
                    <span
                      className="text-gray-400 dark:text-gray-500 text-lg font-light"
                      aria-hidden
                    >
                      —
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] leading-tight text-center">
                  {t(`endpoints.domotica.${labelKey}`, labelKey)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main device-specific options (reusing switch / socket concepts) */}
      {mainDeviceType === 'switch' && (
        <>
          <div>
            <SwitchTypeDropdown
              value={normalizeSwitchSymbol(mainSwitchSymbol)}
              onChangeSymbol={(sym) =>
                updateMainSwitch({
                  symbol: sym,
                })
              }
              options={[...SWITCH_TYPE_SYMBOLS, 'relay' as SymbolKey]}
            />
          </div>
          {mainSwitchSymbol === 'switch' && (
            <SwitchPolesGrid
              value={(mainSwitchProps.poles ?? 1) as 1 | 2 | 3}
              onChange={(poles) =>
                updateMainSwitch({
                  switchProps: { ...mainSwitchProps, poles },
                })
              }
            />
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!mainSwitchProps.verklikkerlamp}
              onChange={(e) =>
                updateMainSwitch({
                  switchProps: { ...mainSwitchProps, verklikkerlamp: e.target.checked },
                })
              }
              className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('endpoints.switchVerklikkerlamp', 'Indicator light')}
            </span>
          </label>
        </>
      )}

      {mainDeviceType === 'socket' && (
        <>
          <SocketTypeGrid
            currentSymbol={normalizeSocketSymbol(mainSocketSymbol)}
            onChangeSymbol={(sym) =>
              updateMainSocket({
                symbol: sym,
              })
            }
          />
          <div className="space-y-2">
            <label className={labelClass}>{t('endpoints.socketOptions', 'Socket options')}</label>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('endpoints.socketSwitchOption', 'Switch')}
              </label>
              <CustomDropdown
                value={
                  mainSocketProps.switchOverlayLock
                    ? 'switch_lock'
                    : mainSocketProps.switchOverlay
                      ? 'switch'
                      : 'none'
                }
                onChange={(nextValue) => {
                  const v = nextValue as 'none' | 'switch' | 'switch_lock'
                  updateMainSocket({
                    socketProps: {
                      ...mainSocketProps,
                      switchOverlay: v === 'switch',
                      switchOverlayLock: v === 'switch_lock',
                    },
                  })
                }}
                options={[
                  { value: 'none', label: t('endpoints.socketSwitchNone', 'None') },
                  {
                    value: 'switch',
                    label: t('endpoints.socketSwitchOverlay', 'Socket with two-pole switch'),
                  },
                  {
                    value: 'switch_lock',
                    label: t(
                      'endpoints.socketSwitchOverlayLock',
                      'Socket with two-pole lockable switch'
                    ),
                  },
                ]}
                className={selectClass}
              />
            </div>
          </div>
        </>
      )}

      <div>
        <label className={labelClass}>
          {t('endpoints.domotica.endpointCount', 'Endpoint outputs')}
        </label>
        <input
          type="number"
          min={1}
          max={20}
          value={endpointCount}
          onChange={(e) => syncChildCounts({ endpointCount: Number(e.target.value || 1) })}
          className={selectClass}
        />
      </div>
    </>
  )
}

// Dynamically derive switch type symbol keys from the symbols catalog (excludes relay)
export const SWITCH_TYPE_SYMBOLS: SymbolKey[] = symbols
  .filter(
    (s) =>
      s.category === 'switches' &&
      s.id !== 'relay' &&
      (s.id === 'switch' ||
        s.id.startsWith('switch_') ||
        s.id === 'contact' ||
        s.id === 'motion_detector' ||
        s.id === 'smoke_detector')
  )
  .map((s) => s.id as SymbolKey)

// Dynamically derive light type symbol keys from the symbols catalog
// Dynamically derive socket type symbol keys from the symbols catalog (order preserved: socket_gnd_child first)
export const SOCKET_TYPE_SYMBOLS: SymbolKey[] = symbols
  .filter((s) => s.category === 'outlets' && !s.libraryPreset)
  .map((s) => s.id as SymbolKey)

export type SocketTypeGridProps = {
  currentSymbol: SymbolKey
  onChangeSymbol: (symbol: SymbolKey) => void
  mixed?: boolean
}

export function SocketTypeGrid({
  currentSymbol,
  onChangeSymbol,
  mixed = false,
}: SocketTypeGridProps) {
  const { t } = useTranslation()

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className={labelClass}>{t('endpoints.socketType', 'Socket Type')}</label>
        {mixed && (
          <span className="text-xs italic text-gray-500 dark:text-gray-400">
            {t('properties.mixedValue', 'Mixed')}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SOCKET_TYPE_SYMBOLS.map((sym) => {
          const isActive = !mixed && currentSymbol === sym
          const fullLabel = t(`symbols.${sym}`, sym)
          const shortLabel = t(`endpoints.socketType_${sym}_short`)

          return (
            <button
              key={sym}
              type="button"
              title={fullLabel}
              onClick={() => {
                if (!isActive) onChangeSymbol(sym)
              }}
              className={`flex flex-col items-center justify-center px-3 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
            >
              <img
                src={`/symbols/outlets/${sym}.svg`}
                alt=""
                aria-hidden="true"
                className="w-12 h-12 mb-1 opacity-90 dark:invert"
              />
              <span className="text-[11px] leading-tight text-center">{shortLabel}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type SwitchPolesGridProps = {
  value: 1 | 2 | 3 | 4
  onChange: (value: 1 | 2 | 3 | 4) => void
}

export function SwitchPolesGrid({ value, onChange }: SwitchPolesGridProps) {
  const { t } = useTranslation()

  const options: Array<{ value: 1 | 2 | 3 | 4; label: string; icon: string }> = [1, 2, 3, 4].map(
    (p) => ({
      value: p as 1 | 2 | 3 | 4,
      label:
        p === 1
          ? t('endpoints.switchPoles1', '1 pole')
          : p === 2
            ? t('endpoints.switchPoles2', '2 poles')
            : p === 3
              ? t('endpoints.switchPoles3', '3 poles')
              : t('endpoints.switchPoles4', '4 poles'),
      icon: getSwitchSymbolPaths('switch', { poles: p as 1 | 2 | 3 | 4 }).basePath,
    })
  )

  return (
    <div>
      <label className={labelClass}>{t('endpoints.switchPoles', 'Poles')}</label>
      <div className="mt-1 flex gap-2">
        {options.map((opt) => {
          const isActive = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (!isActive) onChange(opt.value)
              }}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
            >
              <img
                src={opt.icon}
                alt=""
                className="w-8 h-8 mb-1 opacity-90 dark:invert"
                aria-hidden="true"
              />
              <span className="leading-tight">{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type OptionToggleGridOption<T extends string> = {
  value: T
  /** Full, human-readable label; used for the tooltip. */
  label: string
  /** Compact label shown under the icon so neighbours never overlap. Defaults to `label`. */
  shortLabel?: string
  /** Public SVG url (e.g. an overlay symbol) shown as the button's primary glyph. */
  icon?: string
  /** Optional base symbol drawn behind `icon` (e.g. the furnace body under an HVAC overlay). */
  baseIcon?: string
  /** Text glyph used when there is no SVG (e.g. HVAC function +/-). */
  glyph?: string
}

export type OptionToggleGridProps<T extends string> = {
  label: string
  value: T
  options: Array<OptionToggleGridOption<T>>
  onChange: (value: T) => void
  columns?: number
}

export function OptionToggleGrid<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
}: OptionToggleGridProps<T>) {
  const gridColsClass =
    columns === 2
      ? 'grid-cols-2'
      : columns === 4
        ? 'grid-cols-4'
        : 'grid-cols-3'
  // Only reserve icon space when at least one option carries a symbol/glyph.
  const showIcons = options.some((opt) => opt.icon || opt.glyph)

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className={`grid ${gridColsClass} gap-2 mt-1`}>
        {options.map((opt) => {
          const isActive = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              onClick={() => {
                if (!isActive) onChange(opt.value)
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-1.5 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
            >
              {showIcons && (
                <span className="relative flex h-9 w-9 items-center justify-center">
                  {opt.icon ? (
                    <>
                      {opt.baseIcon && (
                        <img
                          src={opt.baseIcon}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 h-9 w-9 opacity-90 dark:invert"
                        />
                      )}
                      <img
                        src={opt.icon}
                        alt=""
                        aria-hidden="true"
                        className="relative h-9 w-9 opacity-90 dark:invert"
                      />
                    </>
                  ) : opt.glyph ? (
                    <span className="text-lg font-semibold leading-none">{opt.glyph}</span>
                  ) : (
                    <span className="text-lg leading-none text-gray-300 dark:text-gray-600">–</span>
                  )}
                </span>
              )}
              <span className="w-full truncate text-center text-[11px] leading-tight">
                {opt.shortLabel ?? opt.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type TwoWayPolesGridProps = {
  value: 1 | 2
  onChange: (value: 1 | 2) => void
}

export function TwoWayPolesGrid({ value, onChange }: TwoWayPolesGridProps) {
  const { t } = useTranslation()

  const options: Array<{ value: 1 | 2; label: string; icon: string }> = [
    {
      value: 1,
      label: t('endpoints.switchPoles1', '1 pole'),
      icon: getSwitchSymbolPaths('switch_1p_twoway', { twoPole: false }).basePath,
    },
    {
      value: 2,
      label: t('endpoints.switchPoles2', '2 poles'),
      icon: getSwitchSymbolPaths('switch_1p_twoway', { twoPole: true }).basePath,
    },
  ]

  return (
    <div>
      <label className={labelClass}>{t('endpoints.twoWayPoles', 'Two-way poles')}</label>
      <div className="mt-1 flex gap-2">
        {options.map((opt) => {
          const isActive = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (!isActive) onChange(opt.value)
              }}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
            >
              <img
                src={opt.icon}
                alt=""
                className="w-8 h-8 mb-1 opacity-90 dark:invert"
                aria-hidden="true"
              />
              <span className="leading-tight">{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type LightSpotBeamType = 'none' | 'straight' | 'diverging'

export type LightSpotBeamTypeGridProps = {
  value: LightSpotBeamType
  onChange: (value: LightSpotBeamType) => void
}

export function LightSpotBeamTypeGrid({ value, onChange }: LightSpotBeamTypeGridProps) {
  const { t } = useTranslation()

  const lightSpotBasePath =
    symbols.find((s) => s.id === 'light_spot')?.svgPath ?? '/symbols/lighting/light_spot.svg'

  const options: Array<{
    key: LightSpotBeamType
    label: string
    overlay?: string
  }> = [
    {
      key: 'none',
      label: t('endpoints.lightSpotBeamNone', 'None'),
    },
    {
      key: 'straight',
      label: t('endpoints.lightSpotBeamStraight', 'Straight beam'),
      overlay: LIGHT_SPOT_OVERLAY_PATHS.straight,
    },
    {
      key: 'diverging',
      label: t('endpoints.lightSpotBeamDiverging', 'Diverging beam'),
      overlay: LIGHT_SPOT_OVERLAY_PATHS.diverging,
    },
  ]

  return (
    <div>
      <label className={labelClass}>{t('endpoints.lightSpotBeamType', 'Beam type')}</label>
      <div className="mt-1 flex gap-2">
        {options.map((opt) => {
          const isActive = opt.key === value
          const hasIcon = opt.key !== 'none' && opt.overlay

          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                if (!isActive) onChange(opt.key)
              }}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
            >
              {hasIcon && (
                <div className="relative w-8 h-8 mb-1">
                  <img
                    src={lightSpotBasePath}
                    alt=""
                    className="w-8 h-8 opacity-90 dark:invert"
                    aria-hidden="true"
                  />
                  <img
                    src={opt.overlay}
                    alt=""
                    className="w-8 h-8 opacity-90 dark:invert absolute inset-0"
                    aria-hidden="true"
                  />
                </div>
              )}
              <span className="leading-tight">{opt.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type LightPointOptionsGridProps = {
  safety: boolean
  decentral: boolean
  switch1p: boolean
  onWall: boolean
  onChange: (next: LightPointDeviceProps) => void
  mixed?: Partial<Record<'safety' | 'decentral' | 'switch1p' | 'onWall', boolean>>
  onToggle?: (key: 'safety' | 'decentral' | 'switch1p' | 'onWall') => void
}

export function LightPointOptionsGrid({
  safety,
  decentral,
  switch1p,
  onWall,
  onChange,
  mixed,
  onToggle,
}: LightPointOptionsGridProps) {
  const { t } = useTranslation()

  const basePath =
    symbols.find((s) => s.id === 'light_point')?.svgPath ?? '/symbols/lighting/light_point.svg'

  const options: Array<{
    key: 'safety' | 'decentral' | 'switch1p' | 'onWall'
    active: boolean
    label: string
    overlays?: string[]
    showOnWallLine?: boolean
  }> = [
    {
      key: 'switch1p',
      active: switch1p,
      label: t('endpoints.lightPointSwitch1pShort', 'Switch'),
      overlays: [LIGHT_POINT_OVERLAY_PATHS.switch1p],
    },
    {
      key: 'onWall',
      active: onWall,
      label: t('endpoints.lightPointOnWallShort', 'On wall'),
      showOnWallLine: true,
    },
    {
      key: 'safety',
      active: safety && !decentral,
      label: t('endpoints.lightPointSafetyShort', 'Emergency'),
      overlays: [LIGHT_POINT_OVERLAY_PATHS.safety],
    },
    {
      key: 'decentral',
      active: decentral,
      label: t('endpoints.lightPointDecentralShort', 'Decentral'),
      overlays: [LIGHT_POINT_OVERLAY_PATHS.safety, LIGHT_POINT_OVERLAY_PATHS.decentral],
    },
  ]

  return (
    <div className="space-y-2">
      <label className={labelClass}>
        {t('endpoints.lightPointOptions', 'Light point options')}
      </label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() =>
              onToggle
                ? onToggle(opt.key)
                : onChange(
                    applyLightPointOptionToggle({ safety, decentral, switch1p, onWall }, opt.key)
                  )
            }
            className={`min-w-0 px-2 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
              mixed?.[opt.key]
                ? 'border-dashed border-gray-400 bg-gray-50 text-gray-500 dark:border-gray-500 dark:bg-gray-700/40 dark:text-gray-400'
                : opt.active
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
            }`}
          >
            <div className="relative w-8 h-8 mb-1 flex-shrink-0">
              <img
                src={basePath}
                alt=""
                className="w-8 h-8 opacity-90 dark:invert"
                aria-hidden="true"
              />
              {opt.overlays?.map((overlay) => (
                <img
                  key={overlay}
                  src={overlay}
                  alt=""
                  className="w-8 h-8 opacity-90 dark:invert absolute inset-0"
                  aria-hidden="true"
                />
              ))}
              {opt.showOnWallLine && (
                <svg
                  className="absolute inset-0 w-8 h-8 pointer-events-none text-gray-800 dark:text-gray-200"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <line x1={20} y1={1} x2={20} y2={19} stroke="currentColor" strokeWidth={1} />
                </svg>
              )}
            </div>
            <span className="leading-tight text-center text-[11px] break-words">{opt.label}</span>
            {mixed?.[opt.key] && (
              <span className="text-[10px] italic opacity-80">
                {t('properties.mixedValue', 'Mixed')}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export type SymbolDropdownOption = {
  value: SymbolKey
  label: string
  iconSrc?: string
  iconNode?: React.ReactNode
}

export type SymbolDropdownProps = {
  label: string
  value: SymbolKey
  onChange: (value: SymbolKey) => void
  options: SymbolDropdownOption[]
}

export function SymbolDropdown({ label, value, onChange, options }: SymbolDropdownProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [isOpen])

  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <div className="relative" ref={containerRef}>
      <label className={labelClass}>{label}</label>
      <button
        type="button"
        data-symbol-dropdown-control="true"
        onClick={() => setIsOpen((open) => !open)}
        className={`mt-1 ${selectClass} relative flex items-center gap-2 pr-8 text-left`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {current &&
            (current.iconNode ? (
              <span className="h-5 w-5 flex-shrink-0 opacity-90 flex items-center justify-center">
                {current.iconNode}
              </span>
            ) : (
              current.iconSrc && (
                <img
                  src={current.iconSrc}
                  alt={current.label}
                  className="h-5 w-5 flex-shrink-0 opacity-90 dark:invert"
                />
              )
            ))}
          <span className="truncate text-left">
            {current ? current.label : t('common.select', 'Select')}
          </span>
        </span>
        <ChevronDown
          data-symbol-dropdown-chevron="true"
          className="pointer-events-none absolute right-1 top-1/2 h-5 w-3.5 -translate-y-1/2 text-gray-700 dark:text-gray-100"
          strokeWidth={2.5}
        />
      </button>
      {isOpen && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {options.map((option) => {
            const isActive = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  if (!isActive) onChange(option.value)
                  setIsOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200'
                    : 'text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60'
                }`}
              >
                {option.iconNode ? (
                  <span className="h-5 w-5 flex-shrink-0 opacity-90 flex items-center justify-center">
                    {option.iconNode}
                  </span>
                ) : (
                  option.iconSrc && (
                    <img
                      src={option.iconSrc}
                      alt={option.label}
                      className="h-5 w-5 flex-shrink-0 opacity-90 dark:invert"
                    />
                  )
                )}
                <span className="truncate">{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type SwitchTypeDropdownProps = {
  value: SymbolKey
  onChangeSymbol: (symbol: SymbolKey) => void
  options?: SymbolKey[]
}

export function SwitchTypeDropdown({ value, onChangeSymbol, options }: SwitchTypeDropdownProps) {
  const { t } = useTranslation()

  const symbolKeys = (options && options.length > 0 ? options : SWITCH_TYPE_SYMBOLS) as SymbolKey[]

  const dropdownOptions: SymbolDropdownOption[] = symbolKeys.map((sym) => ({
    value: sym,
    label: t(`symbols.${sym}`, sym),
    iconSrc: getSwitchDisplaySvgPath(sym, null),
  }))

  return (
    <SymbolDropdown
      label={t('endpoints.switchType', 'Switch Type')}
      value={value}
      onChange={onChangeSymbol}
      options={dropdownOptions}
    />
  )
}

export type ApplianceTypeDropdownProps = {
  value: SymbolKey
  onChangeSymbol: (symbol: SymbolKey) => void
  /**
   * Restrict the selectable symbols. Defaults to the full appliance/HVAC/sound list; pass a
   * narrower set (e.g. HVAC-only for a unit chained after an HVAC source) so converting to a
   * type that cannot be multiplied — and would orphan the extra placements — is not offered.
   */
  symbols?: SymbolKey[]
}

export function ApplianceTypeDropdown({ value, onChangeSymbol, symbols }: ApplianceTypeDropdownProps) {
  const { t } = useTranslation()

  const symbolMetas =
    symbols && symbols.length > 0
      ? symbols
          .map((id) => APPLIANCE_SYMBOLS.find((sym) => sym.id === id))
          .filter((sym): sym is (typeof APPLIANCE_SYMBOLS)[number] => sym != null)
      : APPLIANCE_SYMBOLS
  const options: SymbolDropdownOption[] = symbolMetas.map((sym) => ({
    value: sym.id as SymbolKey,
    label: t(`symbols.${sym.id}`, sym.name),
    iconSrc: getFixedApplianceSymbolPath(sym.id, null) ?? sym.svgPath,
  }))

  return (
    <SymbolDropdown
      label={t('endpoints.applianceType', 'Appliance type')}
      value={value}
      onChange={onChangeSymbol}
      options={options}
    />
  )
}

export type LightTypeDropdownProps = {
  value: SymbolKey
  onChangeSymbol: (symbol: SymbolKey) => void
}

export function FluorescentPreviewIcon({ tubeCount = 2 }: { tubeCount?: 1 | 2 | 3 }) {
  const viewBox = '0 0 48 48'
  const strokeWidth = 2
  const capX = 1.4
  const capX2 = 46.5
  const capY1 = 12.5
  const capY2 = 35.5

  let tubeYs: number[]
  if (tubeCount === 1) {
    tubeYs = [24]
  } else if (tubeCount === 2) {
    const bandHeight = 48 * 0.25
    tubeYs = [24 - bandHeight / 2, 24 + bandHeight / 2]
  } else {
    const step = 48 / 8
    tubeYs = [24 - step, 24, 24 + step]
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      className="w-full h-full"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1={capX} y1={capY1} x2={capX} y2={capY2} />
      <line x1={capX2} y1={capY1} x2={capX2} y2={capY2} />
      {tubeYs.map((y) => (
        <line key={y} x1={capX} y1={y} x2={capX2} y2={y} />
      ))}
    </svg>
  )
}

export function LightTypeDropdown({ value, onChangeSymbol }: LightTypeDropdownProps) {
  const { t } = useTranslation()

  const lightingSymbols = getSymbolsByCategory('lighting')

  const options: SymbolDropdownOption[] = lightingSymbols.map((sym) =>
    sym.id === 'light_fluorescent'
      ? {
          value: sym.id as SymbolKey,
          label: t(`symbols.${sym.id}`, sym.name),
          iconNode: <FluorescentPreviewIcon />,
        }
      : {
          value: sym.id as SymbolKey,
          label: t(`symbols.${sym.id}`, sym.name),
          iconSrc: sym.svgPath,
        }
  )

  return (
    <SymbolDropdown
      label={t('endpoints.lightType', 'Light Type')}
      value={value}
      onChange={onChangeSymbol}
      options={options}
    />
  )
}

// Endpoint Properties Component

export function EndpointCertificationSection({
  endpoint,
  endpointId,
  symbol,
  canUseSynergridList,
  synergridPlugAndPlayOnly,
  synergridCatalogFocus,
  synergridPickerOpen,
  setSynergridPickerOpen,
  applySynergridEntryToEndpoint,
  onUpdate,
  t,
}: {
  endpoint: Endpoint
  endpointId: string
  symbol: SymbolKey | undefined
  canUseSynergridList: boolean
  synergridPlugAndPlayOnly: boolean
  synergridCatalogFocus: SynergridCatalogFocus
  synergridPickerOpen: boolean
  setSynergridPickerOpen: (open: boolean) => void
  applySynergridEntryToEndpoint: (entry: SynergridCatalogEntry) => void
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
  t: TFunction
}) {
  if (
    symbol !== 'inverter' &&
    symbol !== 'rectifier' &&
    symbol !== 'ev' &&
    symbol !== 'battery' &&
    symbol !== 'solar_panel'
  ) {
    return null
  }

  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <CertificationListingFields
        fields={
          symbol === 'ev'
            ? ['brand', 'model', 'serialNumber']
            : symbol === 'solar_panel'
              ? ['brand', 'model']
              : symbol === 'battery'
                ? ['brand', 'model', 'serialNumber']
                : ['brand', 'model', 'serialNumber', 'power']
        }
        values={
          symbol === 'ev'
            ? {
                brand: endpoint.evChargerProps?.brand,
                model: endpoint.evChargerProps?.model,
                serialNumber: endpoint.evChargerProps?.serialNumber,
              }
            : symbol === 'solar_panel'
              ? {
                  brand: endpoint.solarPanelProps?.brand,
                  model: endpoint.solarPanelProps?.model,
                  serialNumber: endpoint.solarPanelProps?.serialNumber,
                }
              : symbol === 'battery'
                ? {
                    brand: endpoint.batteryProps?.brand,
                    model: endpoint.batteryProps?.model,
                    serialNumber: endpoint.batteryProps?.serialNumber,
                  }
                : {
                    brand: endpoint.energyConversionProps?.brand,
                    model: endpoint.energyConversionProps?.model,
                    serialNumber: endpoint.energyConversionProps?.serialNumber,
                    power: endpoint.energyConversionProps?.power,
                  }
        }
        onCommit={(patch) => {
          if (symbol === 'ev') {
            onUpdate(endpointId, {
              evChargerProps: { ...endpoint.evChargerProps, ...patch },
            })
          } else if (symbol === 'solar_panel') {
            onUpdate(endpointId, {
              solarPanelProps: {
                ...(endpoint.solarPanelProps ?? {}),
                ...patch,
                synergrid: undefined,
              },
            })
          } else if (symbol === 'battery') {
            onUpdate(endpointId, {
              batteryProps: {
                ...(endpoint.batteryProps ?? {}),
                ...patch,
                synergrid: undefined,
              },
            })
          } else {
            onUpdate(endpointId, {
              energyConversionProps: {
                ...endpoint.energyConversionProps,
                ...patch,
                synergrid: undefined,
              },
            })
          }
        }}
        numberFields={
          symbol === 'battery'
            ? [
                {
                  key: 'powerKw',
                  labelKey: 'endpoints.battery.powerKw',
                  defaultLabel: 'Power (kW)',
                  value: endpoint.batteryProps?.powerKw,
                  step: 0.1,
                },
              ]
            : undefined
        }
        onNumberCommit={
          symbol === 'battery'
            ? (_, value) =>
                onUpdate(endpointId, {
                  batteryProps: {
                    ...(endpoint.batteryProps ?? {}),
                    powerKw: value,
                    synergrid: undefined,
                  },
                })
            : undefined
        }
        labelClass={labelClass}
        selectClass={selectClass}
        t={t}
        title={t(
          symbol === 'solar_panel'
            ? 'endpoints.solarPanel.groupTitle'
            : symbol === 'ev'
              ? 'endpoints.evCharger.groupTitle'
              : 'endpoints.certification.groupTitle',
          symbol === 'solar_panel'
            ? 'Brand and model'
            : symbol === 'ev'
              ? 'EV charger details'
              : 'Device identification (certification)'
        )}
        synergrid={
          !canUseSynergridList
            ? undefined
            : symbol === 'solar_panel'
              ? endpoint.solarPanelProps?.synergrid
              : symbol === 'battery'
                ? endpoint.batteryProps?.synergrid
                : symbol === 'rectifier' || symbol === 'inverter'
                  ? endpoint.energyConversionProps?.synergrid
                  : undefined
        }
        onOpenSynergridPicker={canUseSynergridList ? () => setSynergridPickerOpen(true) : undefined}
        diagramVisible={isSymbolLabelVisible(
          endpoint.symbolLabelDisplay,
          CERTIFICATION_LISTING_VISIBILITY_KEY,
          true
        )}
        onToggleDiagramVisible={() =>
          onUpdate(endpointId, {
            symbolLabelDisplay: {
              ...(endpoint.symbolLabelDisplay ?? {}),
              visibility: {
                ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<string, boolean>),
                [CERTIFICATION_LISTING_VISIBILITY_KEY]: !isSymbolLabelVisible(
                  endpoint.symbolLabelDisplay,
                  CERTIFICATION_LISTING_VISIBILITY_KEY,
                  true
                ),
              },
            },
          })
        }
        visibilityToggleClass={visibilityToggleClass}
      />
      {symbol === 'ev' ? (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={endpoint.evChargerProps?.integratedDcResidualProtection ?? false}
            onChange={(event) =>
              onUpdate(endpointId, {
                evChargerProps: {
                  ...(endpoint.evChargerProps ?? {}),
                  integratedDcResidualProtection: event.target.checked,
                },
              })
            }
            className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700"
          />
          {t(
            'endpoints.evCharger.integratedDcResidualProtection',
            'Built-in DC residual-current detection (6 mA)',
          )}
        </label>
      ) : null}
      {canUseSynergridList ? (
        <SynergridListPicker
          open={synergridPickerOpen}
          plugAndPlayOnly={synergridPlugAndPlayOnly}
          focus={synergridCatalogFocus}
          onClose={() => setSynergridPickerOpen(false)}
          onFill={applySynergridEntryToEndpoint}
        />
      ) : null}
    </div>
  )
}
