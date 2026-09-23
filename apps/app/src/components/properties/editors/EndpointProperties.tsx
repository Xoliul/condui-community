import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { DebouncedTextInput, DebouncedTextarea } from '@/components/forms'
import CustomDropdown, { type CustomDropdownOption } from '@/components/common/CustomDropdown'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type {
  Circuit,
  Endpoint,
  HvacEnergySource,
  HvacFunction,
  HvacType,
  SymbolKey,
  TransformerSafetyType,
} from '@/types/schema'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  TRANSFORMER_OVERLAY_PATHS,
  SWITCH_SYMBOLS_WITH_VERKLIKKERLAMP,
  HVAC_ENERGY_SOURCE_PATHS,
  HVAC_TYPE_OVERLAY_PATHS,
  isHvacDeviceSymbol,
} from '@/lib/symbols'
import {
  findMatchingSynergridEntry,
  formatSynergridPower,
  formatSynergridModel,
  loadSynergridCatalog,
  parseSynergridPowerToW,
  synergridCertificationFromEntry,
  synergridPowerKw,
  type SynergridCatalogEntry,
} from '@/lib/synergridCatalog'
import { getInstallDateTargetInheritedYear } from '@/lib/installDatePropagation'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { allowedSocketCountsForEndpoint, isModularSocket } from '@/lib/socket/modularSocket'
import { collectCircuits, deduplicateCircuitsById } from '@/utils/eendraad/panelHelpers'
import { isInBetweenEndpoint } from '@/utils/symbolMapping'
import {
  createSyncEndpointMultiplierDeps,
  syncEndpointMultiplierCount,
} from '@/lib/eendraad/syncEndpointMultiplierCount'
import AddCircuitDialog from '../AddCircuitDialog'
import { InstallDateField } from '../shared/propertiesShared'
import { JunctionIdentityField } from '../shared/JunctionIdentityField'
import {
  collectJunctionIdentities,
  getJunctionIdentity,
  isJunctionIdentityVisibleByDefault,
  isSharedJunctionSymbol,
} from '@/lib/junctionIdentity'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import {
  getSynergridFocusForCircuit,
  labelClass,
  panelStringT,
  selectClass,
  visibilityToggleClass,
} from '../shared/propertiesSharedUtils'
import { EndpointCertificationSection } from './EndpointControls'
import { AutomaticNamingLockedField } from '../shared/AutomaticNamingLockedField'
import { assignTerminalStripPin } from '@/handlers/terminalStripAssignments'
import { getTerminalStripPin } from '@/lib/terminalStrip/labels'
import {
  ApplianceTypeDropdown,
  DomoticaEndpointFields,
  EnergyMeterEndpointFields,
  LightPointOptionsGrid,
  LightSpotBeamTypeGrid,
  type LightSpotBeamType,
  LightTypeDropdown,
  FluorescentPreviewIcon,
  RelayEndpointFields,
  SmokeDetectorEndpointFields,
  MotionDetectorEndpointFields,
  OptionToggleGrid,
  SocketTypeGrid,
  SwitchPolesGrid,
  SwitchTypeDropdown,
  TwoWayPolesGrid,
} from './EndpointControls'
import {
  HVAC_TYPE_SYMBOLS,
  normalizeSocketSymbol,
  normalizeSwitchSymbol,
} from './endpointControlsUtils'

const SYNERGRID_AUTO_MATCH_DEBOUNCE_MS = 450
type Project = NonNullable<ProjectState['currentProject']>

export function EndpointProperties({
  endpointId,
  endpoint,
  project,
  onUpdate,
}: {
  endpointId: string
  endpoint: Endpoint | undefined
  project: Project | null
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
}) {
  const { t } = useTranslation()
  const openDialog = useDialogStore((state) => state.openDialog)
  const closeDialog = useDialogStore((state) => state.closeDialog)
  const eendraadAutomaticNaming = useProjectStore(
    (state: ProjectState) =>
      !!(state.currentProject
        ? getProjectElectricalInstallation(state.currentProject)?.eendraadAutomaticNaming
        : false)
  )
  const findCircuitForEndpoint = useProjectStore(
    (state: ProjectState) => state.findCircuitForEndpoint
  )
  const getCircuitIdentifier = useProjectStore((state: ProjectState) => state.getCircuitIdentifier)
  const getProtectionForCircuit = useProjectStore(
    (state: ProjectState) => state.getProtectionForCircuit
  )
  const [synergridPickerOpen, setSynergridPickerOpen] = useState(false)
  const { synergridCatalog: showSynergridCatalog } = useEditionFeatureAvailability(
    project?.project.id
  )
  const endpointSymbol = endpoint?.symbol
  const applySynergridEntryToEndpoint = useCallback(
    (entry: SynergridCatalogEntry) => {
      if (!endpoint) return
      const synergrid = synergridCertificationFromEntry(entry)
      const brand = entry.brandName ?? undefined
      const model = formatSynergridModel(entry.productSeries, entry.modelReference)

      if (endpointSymbol === 'solar_panel') {
        onUpdate(endpointId, {
          solarPanelProps: {
            ...(endpoint.solarPanelProps ?? {}),
            brand,
            model,
            wattageW: entry.ratedActivePowerW ?? endpoint.solarPanelProps?.wattageW,
            synergrid,
          },
        })
        return
      }

      if (endpointSymbol === 'battery') {
        onUpdate(endpointId, {
          batteryProps: {
            ...(endpoint.batteryProps ?? {}),
            brand,
            model,
            powerKw: synergridPowerKw(entry.ratedActivePowerW) ?? endpoint.batteryProps?.powerKw,
            synergrid,
          },
        })
        return
      }

      if (endpointSymbol === 'rectifier' || endpointSymbol === 'inverter') {
        onUpdate(endpointId, {
          energyConversionProps: {
            ...(endpoint.energyConversionProps ?? {}),
            brand,
            model,
            power: formatSynergridPower(entry.ratedActivePowerW),
            synergrid,
          },
        })
      }
    },
    [endpoint, endpointId, endpointSymbol, onUpdate]
  )
  const synergridPlugAndPlayOnly =
    (endpointSymbol === 'solar_panel' && endpoint?.solarPanelProps?.plugIn === true) ||
    (endpointSymbol === 'battery' && endpoint?.batteryProps?.plugIn === true)
  const isSynergridListEligible = Boolean(
    endpointSymbol === 'rectifier' ||
    endpointSymbol === 'inverter' ||
    ((endpointSymbol === 'solar_panel' || endpointSymbol === 'battery') && synergridPlugAndPlayOnly)
  )
  const canUseSynergridList = showSynergridCatalog && isSynergridListEligible
  const circuitInfo = endpoint ? findCircuitForEndpoint(endpointId) : undefined
  const currentCircuit = circuitInfo?.circuit
  const synergridCatalogFocus = getSynergridFocusForCircuit(currentCircuit, endpointSymbol)

  useEffect(() => {
    if (!endpoint) return

    const currentSynergrid =
      endpointSymbol === 'solar_panel'
        ? endpoint.solarPanelProps?.synergrid
        : endpointSymbol === 'battery'
          ? endpoint.batteryProps?.synergrid
          : endpoint.energyConversionProps?.synergrid
    if (!isSynergridListEligible) {
      if (endpointSymbol === 'solar_panel' && currentSynergrid) {
        onUpdate(endpointId, {
          solarPanelProps: {
            ...(endpoint.solarPanelProps ?? {}),
            synergrid: undefined,
          },
        })
      } else if (endpointSymbol === 'battery' && currentSynergrid) {
        onUpdate(endpointId, {
          batteryProps: {
            ...(endpoint.batteryProps ?? {}),
            synergrid: undefined,
          },
        })
      }
      return
    }
    if (!showSynergridCatalog) return

    const matchInput =
      endpointSymbol === 'solar_panel'
        ? {
            brand: endpoint.solarPanelProps?.brand,
            model: endpoint.solarPanelProps?.model,
            powerW: endpoint.solarPanelProps?.wattageW,
          }
        : endpointSymbol === 'battery'
          ? {
              brand: endpoint.batteryProps?.brand,
              model: endpoint.batteryProps?.model,
              powerW:
                endpoint.batteryProps?.powerKw != null
                  ? endpoint.batteryProps.powerKw * 1000
                  : undefined,
            }
          : {
              brand: endpoint.energyConversionProps?.brand,
              model: endpoint.energyConversionProps?.model,
              powerW: parseSynergridPowerToW(endpoint.energyConversionProps?.power),
            }

    const timer = window.setTimeout(() => {
      void loadSynergridCatalog({
        plugAndPlayOnly: synergridPlugAndPlayOnly,
        focus: synergridCatalogFocus,
      })
        .then((entries) => {
          const match = findMatchingSynergridEntry(entries, matchInput)
          const nextSynergrid = match ? synergridCertificationFromEntry(match) : undefined
          if (currentSynergrid?.sourceKey === nextSynergrid?.sourceKey) return

          if (endpointSymbol === 'solar_panel') {
            onUpdate(endpointId, {
              solarPanelProps: {
                ...(endpoint.solarPanelProps ?? {}),
                synergrid: nextSynergrid,
              },
            })
          } else if (endpointSymbol === 'battery') {
            onUpdate(endpointId, {
              batteryProps: {
                ...(endpoint.batteryProps ?? {}),
                synergrid: nextSynergrid,
              },
            })
          } else if (endpointSymbol === 'rectifier' || endpointSymbol === 'inverter') {
            onUpdate(endpointId, {
              energyConversionProps: {
                ...(endpoint.energyConversionProps ?? {}),
                synergrid: nextSynergrid,
              },
            })
          }
        })
        .catch(() => {
          // Keep manual editing silent; the explicit picker shows load failures.
        })
    }, SYNERGRID_AUTO_MATCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [
    isSynergridListEligible,
    endpoint,
    endpoint?.batteryProps?.brand,
    endpoint?.batteryProps?.model,
    endpoint?.batteryProps?.powerKw,
    endpoint?.batteryProps?.synergrid,
    endpoint?.energyConversionProps?.brand,
    endpoint?.energyConversionProps?.model,
    endpoint?.energyConversionProps?.power,
    endpoint?.energyConversionProps?.synergrid,
    endpoint?.solarPanelProps?.brand,
    endpoint?.solarPanelProps?.model,
    endpoint?.solarPanelProps?.synergrid,
    endpoint?.solarPanelProps?.wattageW,
    endpointId,
    endpointSymbol,
    onUpdate,
    synergridCatalogFocus,
    synergridPlugAndPlayOnly,
    showSynergridCatalog,
  ])

  if (!endpoint) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('endpoints.notFound', 'Endpoint not found')}
      </div>
    )
  }

  // Get all circuits for the dropdown (deduplicated by id to avoid React duplicate-key warnings)
  const circuits: Circuit[] = project
    ? deduplicateCircuitsById(
        getProjectElectricalPanels(project).flatMap((panel) => collectCircuits(panel))
      )
    : []
  const selectableCircuits = circuits.filter((circuit) => circuit.code !== 'PANEL')
  const endpointBranchLabelLocked =
    eendraadAutomaticNaming &&
    endpoint.symbol !== 'panel_distribution' &&
    !!currentCircuit?.branches?.some((b: { endpointIds: string[] }) =>
      b.endpointIds.includes(endpointId)
    )
  const symbol = endpoint.symbol
  const isSwitch = endpoint.type === 'switch' && symbol !== 'relay'
  const isLight = endpoint.type === 'light_point'
  const isSocket = endpoint.type === 'socket'
  const circuitPickerOptions: CustomDropdownOption[] = (() => {
    const opts: CustomDropdownOption[] = []
    if (selectableCircuits.length === 0) {
      opts.push({
        value: '',
        label: t('circuits.noCircuits', 'No circuits available'),
      })
    } else {
      if (currentCircuit?.code === 'PANEL') {
        opts.push({
          value: currentCircuit.id,
          label: `${getCircuitIdentifier(currentCircuit.id)} (${t('validation.orphanDetection.endpointOnPanelCircuit', 'Invalid: endpoint on PANEL pseudo-circuit')})`,
        })
      }
      for (const c of selectableCircuits) {
        const kind = getDerivedCircuitKind(c, getProtectionForCircuit(c.id))
        opts.push({
          value: c.id,
          label: `${getCircuitIdentifier(c.id)} (${t(`circuits.${kind}`, kind)})`,
        })
      }
    }
    opts.push({ value: '__add_new__', label: t('circuits.addNew', 'Add new...') })
    return opts
  })()

  return (
    <div className="space-y-4">
      <InstallDateField
        entity={endpoint}
        project={project}
        inheritedYear={
          project
            ? getInstallDateTargetInheritedYear(project, { id: endpointId, type: 'endpoint' })
            : undefined
        }
        onUpdate={(updates) =>
          useProjectStore.getState().withSingleUndoEntry(() => {
            onUpdate(endpointId, updates)
            return true
          })
        }
      />
      <div>
        <label className={labelClass}>{t('endpoints.label', 'Label')}</label>
        {isSharedJunctionSymbol(endpoint.symbol) ? (
          <JunctionIdentityField
            value={getJunctionIdentity(endpoint)}
            options={project ? collectJunctionIdentities(project, endpoint.symbol!) : []}
            visible={isSymbolLabelVisible(
              endpoint.symbolLabelDisplay,
              'junctionIdentityLabel',
              isJunctionIdentityVisibleByDefault(endpoint.symbol)
            )}
            fixedPrefix={endpoint.symbol === 'terminal_strip' ? 'X' : undefined}
            onCommit={(junctionIdentity) => {
              if (endpoint.symbol === 'terminal_strip') {
                const currentPin = getTerminalStripPin(endpoint) ?? 1
                assignTerminalStripPin(
                  useProjectStore.getState(),
                  endpointId,
                  junctionIdentity,
                  currentPin,
                  getJunctionIdentity(endpoint).toUpperCase() === junctionIdentity.toUpperCase()
                    ? currentPin
                    : undefined
                )
              } else {
                onUpdate(endpointId, { junctionIdentity })
              }
            }}
            onToggleVisible={() =>
              onUpdate(endpointId, {
                symbolLabelDisplay: {
                  ...(endpoint.symbolLabelDisplay ?? {}),
                  visibility: {
                    ...(endpoint.symbolLabelDisplay?.visibility ?? {}),
                    junctionIdentityLabel: !isSymbolLabelVisible(
                      endpoint.symbolLabelDisplay,
                      'junctionIdentityLabel',
                      isJunctionIdentityVisibleByDefault(endpoint.symbol)
                    ),
                  },
                },
              })
            }
            label={t('junctionIdentity.label', 'Junction identity')}
            pickTitle={t('junctionIdentity.pickExisting', 'Reuse an existing identity')}
            toggleTitle={t('junctionIdentity.toggleVisibility', 'Show or hide identity on diagram')}
            emptyText={t('junctionIdentity.noExisting', 'No existing identities')}
          />
        ) : (
          <AutomaticNamingLockedField locked={endpointBranchLabelLocked}>
            <DebouncedTextInput
              type="text"
              value={endpoint.label}
              resetKey={endpointId}
              onCommit={(v) => onUpdate(endpointId, { label: v })}
              className={selectClass}
              disabled={endpointBranchLabelLocked}
            />
          </AutomaticNamingLockedField>
        )}
        {endpoint.symbol === 'terminal_strip' && (
          <div className="mt-3">
            <label className={labelClass}>{t('terminalStrip.pin', 'Pin')}</label>
            <DebouncedTextInput
              type="number"
              min={1}
              step={1}
              value={String(getTerminalStripPin(endpoint) ?? 1)}
              onCommit={(value) => {
                const nextPin = Math.max(1, Math.round(Number(value) || 1))
                assignTerminalStripPin(
                  useProjectStore.getState(),
                  endpointId,
                  getJunctionIdentity(endpoint) || '1',
                  nextPin,
                  getTerminalStripPin(endpoint)
                )
              }}
              className={selectClass}
            />
          </div>
        )}
      </div>

      <div>
        <label className={labelClass}>{t('circuit.code', 'Circuit')}</label>
        <CustomDropdown
          value={currentCircuit?.id || ''}
          onChange={(newCircuitId) => {
            if (newCircuitId === '__add_new__') {
              const panelId =
                (project ? getProjectElectricalPanels(project) : []).find((p) => p.isMain)?.id ??
                circuitInfo?.panel?.id ??
                (project ? getProjectElectricalPanels(project) : [])[0]?.id
              if (panelId) {
                openDialog({
                  type: 'custom',
                  title: t('circuits.addNewDialogTitle', 'Add new circuit'),
                  content: (
                    <AddCircuitDialog
                      panelId={panelId}
                      endpointId={endpointId}
                      onCreated={() => closeDialog()}
                      onCancel={() => closeDialog()}
                    />
                  ),
                })
              }
              return
            }
            if (newCircuitId) onUpdate(endpointId, { circuitId: newCircuitId } as Partial<Endpoint>)
          }}
          options={circuitPickerOptions}
          className={selectClass}
        />
        {currentCircuit && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('circuits.kind', 'Type')}:{' '}
            {t(
              `circuits.${getDerivedCircuitKind(currentCircuit, circuitInfo?.protection)}`,
              getDerivedCircuitKind(currentCircuit, circuitInfo?.protection)
            )}
          </p>
        )}
      </div>

      {symbol === 'relay' && (
        <RelayEndpointFields
          endpointId={endpointId}
          endpoint={endpoint}
          onUpdate={onUpdate}
          t={panelStringT(t)}
        />
      )}
      {symbol === 'smoke_detector' && (
        <SmokeDetectorEndpointFields
          endpointId={endpointId}
          endpoint={endpoint}
          onUpdate={onUpdate}
          t={panelStringT(t)}
        />
      )}
      {symbol === 'motion_detector' && (
        <MotionDetectorEndpointFields
          endpointId={endpointId}
          endpoint={endpoint}
          onUpdate={onUpdate}
          t={panelStringT(t)}
        />
      )}
      {symbol === 'energy_meter' && (
        <EnergyMeterEndpointFields
          endpointId={endpointId}
          endpoint={endpoint}
          onUpdate={onUpdate}
          t={panelStringT(t)}
        />
      )}
      {symbol === 'domotica' && (
        <DomoticaEndpointFields
          endpointId={endpointId}
          endpoint={endpoint}
          onUpdate={onUpdate}
          t={panelStringT(t)}
        />
      )}

      {/* Energy conversion devices: transformer, rectifier, inverter, DC‑DC converter */}
      {(symbol === 'transformer' ||
        symbol === 'rectifier' ||
        symbol === 'inverter' ||
        symbol === 'dc_dc_converter') && (
        <>
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
              {t(
                'endpoints.energyConversion.groupTitle',
                t('endpoints.energyConversion.groupTitle', 'Energy conversion')
              )}
            </p>

            {/* Transformer-specific overlays */}
            {symbol === 'transformer' && (
              <div className="space-y-2">
                <div>
                  <label className={labelClass}>{t('endpoints.transformer.safetyType')}</label>
                  <div className="flex gap-2">
                    {[
                      {
                        key: 'none',
                        label: t('endpoints.transformer.safety_none'),
                        icon: null as string | null,
                      },
                      {
                        key: 'safety_closed',
                        label: t('endpoints.transformer.safety_closed_short'),
                        icon: TRANSFORMER_OVERLAY_PATHS.safetyClosed,
                      },
                      {
                        key: 'safety_open',
                        label: t('endpoints.transformer.safety_open_short'),
                        icon: TRANSFORMER_OVERLAY_PATHS.safetyOpen,
                      },
                    ].map((opt) => {
                      const isActive =
                        (endpoint.energyConversionProps?.transformerSafetyType ?? 'none') ===
                        opt.key
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() =>
                            onUpdate(endpointId, {
                              energyConversionProps: {
                                ...endpoint.energyConversionProps,
                                transformerSafetyType: opt.key as TransformerSafetyType,
                              },
                            })
                          }
                          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                            isActive
                              ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
                          }`}
                        >
                          {opt.icon && (
                            <img
                              src={opt.icon}
                              alt=""
                              className="w-8 h-8 mb-1 opacity-90 dark:invert"
                              aria-hidden="true"
                            />
                          )}
                          <span className="leading-tight">{opt.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {t('endpoints.transformerOptions.options')}
                  </p>
                  <div className="flex gap-2">
                    {[
                      {
                        key: 'short',
                        active:
                          endpoint.energyConversionProps?.transformerShortCircuitProtected ?? false,
                        label: t('endpoints.transformer.shortCircuitProtected'),
                        toggle: () =>
                          onUpdate(endpointId, {
                            energyConversionProps: {
                              ...endpoint.energyConversionProps,
                              transformerShortCircuitProtected: !(
                                endpoint.energyConversionProps?.transformerShortCircuitProtected ??
                                false
                              ),
                            },
                          }),
                        icon: TRANSFORMER_OVERLAY_PATHS.shortcircuit,
                      },
                      {
                        key: 'protective',
                        active: endpoint.energyConversionProps?.transformerProtected ?? false,
                        label: t('endpoints.transformer.protective'),
                        toggle: () =>
                          onUpdate(endpointId, {
                            energyConversionProps: {
                              ...endpoint.energyConversionProps,
                              transformerProtected: !(
                                endpoint.energyConversionProps?.transformerProtected ?? false
                              ),
                            },
                          }),
                        icon: TRANSFORMER_OVERLAY_PATHS.protection,
                      },
                    ].map((opt) => {
                      const isActive = opt.active
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={opt.toggle}
                          className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                            isActive
                              ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
                          }`}
                        >
                          <span className="relative w-10 h-10 mb-1">
                            <img
                              src="/symbols/energy-conversion/transformer.svg"
                              alt=""
                              className="absolute inset-0 w-full h-full opacity-80 dark:invert"
                              aria-hidden="true"
                            />
                            <img
                              src={opt.icon}
                              alt=""
                              className="absolute inset-0 w-full h-full opacity-90 dark:invert"
                              aria-hidden="true"
                            />
                          </span>
                          <span className="leading-tight">{opt.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className={labelClass + ' mb-0'}>
                      {t('endpoints.transformer.overlayLabel', 'Transformer label (overlay)')}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdate(endpointId, {
                          symbolLabelDisplay: {
                            ...(endpoint.symbolLabelDisplay ?? {}),
                            visibility: {
                              ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<
                                string,
                                boolean
                              >),
                              conversionTransformerLabel: !(
                                endpoint.symbolLabelDisplay?.visibility
                                  ?.conversionTransformerLabel ?? true
                              ),
                            },
                          },
                        })
                      }
                      className={visibilityToggleClass(
                        endpoint.symbolLabelDisplay?.visibility?.conversionTransformerLabel ?? true
                      )}
                      title={
                        (endpoint.symbolLabelDisplay?.visibility?.conversionTransformerLabel ??
                        true)
                          ? t('common.hide', 'Hide')
                          : t('common.show', 'Show')
                      }
                    >
                      {(endpoint.symbolLabelDisplay?.visibility?.conversionTransformerLabel ??
                      true) ? (
                        <Eye className="w-4 h-4" />
                      ) : (
                        <EyeOff className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <DebouncedTextInput
                    type="text"
                    value={endpoint.energyConversionProps?.transformerOverlayLabel ?? ''}
                    onCommit={(v) =>
                      onUpdate(endpointId, {
                        energyConversionProps: {
                          ...endpoint.energyConversionProps,
                          transformerOverlayLabel: v,
                        },
                      })
                    }
                    className={selectClass}
                    placeholder={t(
                      'endpoints.transformer.overlayLabelPlaceholder',
                      'Short label drawn on the symbol'
                    )}
                  />
                </div>
              </div>
            )}

            {/* Pmax values for all energy conversion devices */}
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className={labelClass + ' mb-0'}>
                    {t('endpoints.conversion.pMaxPrimary')}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(endpointId, {
                        symbolLabelDisplay: {
                          ...(endpoint.symbolLabelDisplay ?? {}),
                          visibility: {
                            ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<
                              string,
                              boolean
                            >),
                            conversionPmaxPrimary: !(
                              endpoint.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true
                            ),
                          },
                        },
                      })
                    }
                    className={visibilityToggleClass(
                      endpoint.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true
                    )}
                    title={
                      (endpoint.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true)
                        ? t('common.hide', 'Hide')
                        : t('common.show', 'Show')
                    }
                  >
                    {(endpoint.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true) ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <DebouncedTextInput
                  type="text"
                  value={endpoint.energyConversionProps?.pMaxPrimaryW ?? ''}
                  onCommit={(v) =>
                    onUpdate(endpointId, {
                      energyConversionProps: {
                        ...endpoint.energyConversionProps,
                        pMaxPrimaryW: v,
                      },
                    })
                  }
                  className={selectClass}
                  placeholder="e.g. 250 VA"
                />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className={labelClass + ' mb-0'}>
                    {t('endpoints.conversion.pMaxSecondary')}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(endpointId, {
                        symbolLabelDisplay: {
                          ...(endpoint.symbolLabelDisplay ?? {}),
                          visibility: {
                            ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<
                              string,
                              boolean
                            >),
                            conversionPmaxSecondary: !(
                              endpoint.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ??
                              true
                            ),
                          },
                        },
                      })
                    }
                    className={visibilityToggleClass(
                      endpoint.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ?? true
                    )}
                    title={
                      (endpoint.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ?? true)
                        ? t('common.hide', 'Hide')
                        : t('common.show', 'Show')
                    }
                  >
                    {(endpoint.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ?? true) ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <DebouncedTextInput
                  type="text"
                  value={endpoint.energyConversionProps?.pMaxSecondaryW ?? ''}
                  onCommit={(v) =>
                    onUpdate(endpointId, {
                      energyConversionProps: {
                        ...endpoint.energyConversionProps,
                        pMaxSecondaryW: v,
                      },
                    })
                  }
                  className={selectClass}
                  placeholder="e.g. 250 VA"
                />
              </div>
            </div>

            {/* Optional DC voltage hints used by validation heuristics */}
            <div className="mt-3">
              {(symbol === 'rectifier' || symbol === 'dc_dc_converter') && (
                <div>
                  <label className={labelClass + ' mb-1'}>
                    {t('endpoints.conversion.dcOutputVoltage', 'DC output voltage (V)')}
                  </label>
                  <DebouncedTextInput
                    type="text"
                    value={endpoint.energyConversionProps?.dcOutputVoltageV ?? ''}
                    onCommit={(v) =>
                      onUpdate(endpointId, {
                        energyConversionProps: {
                          ...endpoint.energyConversionProps,
                          dcOutputVoltageV: v,
                        },
                      })
                    }
                    className={selectClass}
                    placeholder="e.g. 48"
                  />
                </div>
              )}
              {symbol === 'inverter' && (
                <div>
                  <label className={labelClass + ' mb-1'}>
                    {t('endpoints.conversion.dcInputMinVoltage', 'DC input minimum voltage (V)')}
                  </label>
                  <DebouncedTextInput
                    type="text"
                    value={endpoint.energyConversionProps?.dcInputMinVoltageV ?? ''}
                    onCommit={(v) =>
                      onUpdate(endpointId, {
                        energyConversionProps: {
                          ...endpoint.energyConversionProps,
                          dcInputMinVoltageV: v,
                        },
                      })
                    }
                    className={selectClass}
                    placeholder="e.g. 24"
                  />
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Switch type selector - allows mutating between switch subtypes */}
      {isSwitch && (
        <>
          <div>
            <SwitchTypeDropdown
              value={normalizeSwitchSymbol(endpoint.symbol)}
              onChangeSymbol={(sym) => onUpdate(endpointId, { symbol: sym })}
            />
          </div>
          {endpoint.symbol === 'switch' && (
            <SwitchPolesGrid
              value={(endpoint.switchProps?.poles ?? 1) as 1 | 2 | 3 | 4}
              onChange={(poles) =>
                onUpdate(endpointId, {
                  switchProps: { ...endpoint.switchProps, poles },
                })
              }
            />
          )}
          {(endpoint.symbol === 'switch_1p_twoway' || endpoint.symbol === 'switch_2p_twoway') && (
            <TwoWayPolesGrid
              value={endpoint.symbol === 'switch_2p_twoway' ? 2 : 1}
              onChange={(next) =>
                onUpdate(endpointId, {
                  symbol: (next === 2 ? 'switch_2p_twoway' : 'switch_1p_twoway') as SymbolKey,
                  switchProps: { ...endpoint.switchProps, twoPole: next === 2 },
                })
              }
            />
          )}
          {(SWITCH_SYMBOLS_WITH_VERKLIKKERLAMP as readonly string[]).includes(
            normalizeSwitchSymbol(endpoint.symbol)
          ) && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={endpoint.switchProps?.verklikkerlamp ?? false}
                onChange={(e) =>
                  onUpdate(endpointId, {
                    switchProps: { ...endpoint.switchProps, verklikkerlamp: e.target.checked },
                  })
                }
                className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('endpoints.verklikkerlamp', 'Indicator light')}
              </span>
            </label>
          )}
        </>
      )}

      {/* Light type selector - allows mutating between light subtypes */}
      {isLight && (
        <>
          <div>
            <LightTypeDropdown
              value={(endpoint.symbol || 'light_point') as SymbolKey}
              onChangeSymbol={(sym) => onUpdate(endpointId, { symbol: sym })}
            />
          </div>
          <div>
            <label className={labelClass}>{t('endpoints.lightCount', 'Number of lights')}</label>
            <input
              key={`light-count-${endpointId}-${getEndpointMultiplier(endpoint)}`}
              type="number"
              min={1}
              defaultValue={getEndpointMultiplier(endpoint)}
              onBlur={(e) => {
                const target = Math.floor(Number(e.target.value || 1))
                if (!Number.isFinite(target) || target < 1) return
                if (target === getEndpointMultiplier(endpoint)) return
                syncEndpointMultiplierCount(createSyncEndpointMultiplierDeps(), endpointId, target)
              }}
              className={selectClass}
            />
          </div>
          {/* Light point overlays: safety, switch 1p, on wall (grid buttons) */}
          {isLight && symbol === 'light_point' && (
            <>
              <LightPointOptionsGrid
                safety={endpoint.lightPointProps?.safety ?? false}
                decentral={endpoint.lightPointProps?.decentral ?? false}
                switch1p={endpoint.lightPointProps?.switch1p ?? false}
                onWall={endpoint.lightPointProps?.onWall ?? false}
                onChange={(updated) =>
                  onUpdate(endpointId, {
                    lightPointProps: updated,
                  })
                }
              />
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={endpoint.lightPointProps?.waterproof ?? false}
                  onChange={(e) =>
                    onUpdate(endpointId, {
                      lightPointProps: {
                        ...endpoint.lightPointProps,
                        waterproof: e.target.checked,
                      },
                    })
                  }
                  className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t('endpoints.socketWaterproof', 'Waterproof')}
                </span>
              </label>
            </>
          )}
          {/* Light spot: beam type */}
          {isLight && symbol === 'light_spot' && (
            <LightSpotBeamTypeGrid
              value={(endpoint.lightSpotProps?.beamType ?? 'none') as LightSpotBeamType}
              onChange={(beamType) =>
                onUpdate(endpointId, {
                  lightSpotProps: { beamType },
                })
              }
            />
          )}
          {/* Light fluorescent: number of tubes (grid buttons) */}
          {isLight && symbol === 'light_fluorescent' && (
            <div>
              <label className={labelClass}>
                {t('endpoints.lightFluorescentTubes', 'Number of tubes')}
              </label>
              <div className="mt-1 flex gap-2">
                {[1, 2, 3].map((count) => {
                  const active = (endpoint.lightFluorescentProps?.tubeCount ?? 1) === count
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() =>
                        onUpdate(endpointId, {
                          lightFluorescentProps: { tubeCount: count as 1 | 2 | 3 },
                        })
                      }
                      className={`flex-1 min-w-0 px-2 py-1.5 text-xs font-medium rounded-md border flex flex-col items-center justify-center gap-0.5 ${
                        active
                          ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
                      }`}
                    >
                      <div className="w-8 h-8 mb-1 flex-shrink-0 flex items-center justify-center">
                        <FluorescentPreviewIcon tubeCount={count as 1 | 2 | 3} />
                      </div>
                      <span className="leading-tight text-center text-[11px]">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Socket type selector and overlay options */}
      {isSocket && (
        <>
          <SocketTypeGrid
            currentSymbol={normalizeSocketSymbol(endpoint.symbol)}
            onChangeSymbol={(sym) => onUpdate(endpointId, { symbol: sym })}
          />
          {/* Socket count (1-4, or 1-2 for modular DIN sockets) */}
          <div>
            <label className={labelClass}>{t('endpoints.socketCount', 'Number of sockets')}</label>
            <CustomDropdown
              value={String(endpoint.socketProps?.socketCount || 1)}
              onChange={(nextValue) => {
                const count = Number(nextValue)
                onUpdate(endpointId, {
                  socketProps: {
                    ...endpoint.socketProps,
                    socketCount: count <= 1 ? undefined : count,
                  },
                })
              }}
              options={allowedSocketCountsForEndpoint(endpoint).map((count) => ({
                value: String(count),
                label: String(count),
              }))}
              className={selectClass}
            />
          </div>
          {!isModularSocket(endpoint) && (
            <div className="space-y-2">
              <label className={labelClass}>{t('endpoints.socketOptions', 'Socket options')}</label>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  {t('endpoints.socketSwitchOption', 'Switch')}
                </label>
                <CustomDropdown
                  value={
                    endpoint.socketProps?.switchOverlayLock
                      ? 'switch_lock'
                      : endpoint.socketProps?.switchOverlay
                        ? 'switch'
                        : 'none'
                  }
                  onChange={(nextValue) => {
                    const v = nextValue as 'none' | 'switch' | 'switch_lock'
                    onUpdate(endpointId, {
                      socketProps: {
                        ...endpoint.socketProps,
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
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={endpoint.socketProps?.waterproof ?? false}
                  onChange={(e) =>
                    onUpdate(endpointId, {
                      socketProps: { ...endpoint.socketProps, waterproof: e.target.checked },
                    })
                  }
                  className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t('endpoints.socketWaterproof', 'Waterproof')}
                </span>
              </label>
            </div>
          )}
        </>
      )}

      {/* Appliance type: mirror library list (fixed_appliance only, exclude energy conversion devices) */}
      {endpoint.type === 'fixed_appliance' &&
        !isInBetweenEndpoint(endpoint) &&
        symbol !== 'junction_box' &&
        symbol !== 'junction_panel' &&
        symbol !== 'terminal_strip' &&
        symbol !== 'domotica' &&
        symbol !== 'energy_meter' &&
        symbol !== 'solar_panel' &&
        symbol !== 'battery' &&
        symbol !== 'transformer' &&
        symbol !== 'rectifier' &&
        symbol !== 'inverter' &&
        symbol !== 'dc_dc_converter' && (
          <>
            <div>
              <ApplianceTypeDropdown
                value={endpoint.symbol ?? 'oven'}
                onChangeSymbol={(sym) => onUpdate(endpointId, { symbol: sym })}
                // A unit chained after an HVAC source can only become another HVAC type; other
                // appliances cannot be multiplied and would orphan the extra placements.
                symbols={
                  isHvacDeviceSymbol(symbol) && endpointSupportsMultiplier(endpoint)
                    ? HVAC_TYPE_SYMBOLS
                    : undefined
                }
              />
            </div>
            {/* HVAC options for furnace: energy source, type, function */}
            {symbol === 'furnace' && (
              <div className="space-y-2">
                <OptionToggleGrid<HvacEnergySource>
                  label={t('endpoints.hvac.energySource', 'Energy source')}
                  value={endpoint.hvacProps?.energySource ?? 'none'}
                  onChange={(nextValue) =>
                    onUpdate(endpointId, {
                      hvacProps: {
                        ...(endpoint.hvacProps ?? {}),
                        energySource: nextValue,
                      },
                    })
                  }
                  options={[
                    {
                      value: 'none',
                      label: t('endpoints.hvac.energy_none', 'None'),
                      shortLabel: t('endpoints.hvac.energy_none_short', 'None'),
                    },
                    {
                      value: 'electricity',
                      label: t('endpoints.hvac.energy_electricity', 'Electricity'),
                      shortLabel: t('endpoints.hvac.energy_electricity_short', 'Elec.'),
                      icon: HVAC_ENERGY_SOURCE_PATHS.electricity,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                    {
                      value: 'gas_fan',
                      label: t('endpoints.hvac.energy_gas_fan', 'Gas (fan flue)'),
                      shortLabel: t('endpoints.hvac.energy_gas_fan_short', 'Gas (fan)'),
                      icon: HVAC_ENERGY_SOURCE_PATHS.gas_fan,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                    {
                      value: 'gas_atmospheric',
                      label: t('endpoints.hvac.energy_gas_atmospheric', 'Gas (atmospheric)'),
                      shortLabel: t('endpoints.hvac.energy_gas_atmospheric_short', 'Gas (atm)'),
                      icon: HVAC_ENERGY_SOURCE_PATHS.gas_atmospheric,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                    {
                      value: 'liquid',
                      label: t('endpoints.hvac.energy_liquid', 'Liquid fuel'),
                      shortLabel: t('endpoints.hvac.energy_liquid_short', 'Liquid'),
                      icon: HVAC_ENERGY_SOURCE_PATHS.liquid,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                    {
                      value: 'solid',
                      label: t('endpoints.hvac.energy_solid', 'Solid fuel'),
                      shortLabel: t('endpoints.hvac.energy_solid_short', 'Solid'),
                      icon: HVAC_ENERGY_SOURCE_PATHS.solid,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                  ]}
                />
                <OptionToggleGrid<HvacType>
                  label={t('endpoints.hvac.type', 'Type')}
                  value={endpoint.hvacProps?.hvacType ?? 'none'}
                  onChange={(nextValue) =>
                    onUpdate(endpointId, {
                      hvacProps: {
                        ...(endpoint.hvacProps ?? {}),
                        hvacType: nextValue,
                      },
                    })
                  }
                  options={[
                    {
                      value: 'none',
                      label: t('endpoints.hvac.type_none', 'None'),
                      shortLabel: t('endpoints.hvac.type_none_short', 'None'),
                    },
                    {
                      value: 'heat_exchange',
                      label: t('endpoints.hvac.type_heat_exchange', 'Heat exchange'),
                      shortLabel: t('endpoints.hvac.type_heat_exchange_short', 'Exch.'),
                      icon: HVAC_TYPE_OVERLAY_PATHS.heat_exchange,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                    {
                      value: 'cogeneration',
                      label: t('endpoints.hvac.type_cogeneration', 'Cogeneration'),
                      shortLabel: t('endpoints.hvac.type_cogeneration_short', 'Cogen'),
                      icon: HVAC_TYPE_OVERLAY_PATHS.cogeneration,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                    {
                      value: 'tap_spiral',
                      label: t('endpoints.hvac.type_tap_spiral', 'Tap spiral'),
                      shortLabel: t('endpoints.hvac.type_tap_spiral_short', 'Spiral'),
                      icon: HVAC_TYPE_OVERLAY_PATHS.tap_spiral,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                    {
                      value: 'boiler',
                      label: t('endpoints.hvac.type_boiler', 'Boiler'),
                      shortLabel: t('endpoints.hvac.type_boiler_short', 'Boiler'),
                      icon: HVAC_TYPE_OVERLAY_PATHS.boiler,
                      baseIcon: '/symbols/hvac/furnace_base.svg',
                    },
                  ]}
                />
                <OptionToggleGrid<HvacFunction>
                  label={t('endpoints.hvac.function', 'Function')}
                  value={endpoint.hvacProps?.hvacFunction ?? 'none'}
                  onChange={(nextValue) =>
                    onUpdate(endpointId, {
                      hvacProps: {
                        ...(endpoint.hvacProps ?? {}),
                        hvacFunction: nextValue,
                      },
                    })
                  }
                  options={[
                    {
                      value: 'none',
                      label: t('endpoints.hvac.function_none', 'None'),
                      shortLabel: t('endpoints.hvac.function_none_short', 'None'),
                    },
                    {
                      value: 'heat_cool',
                      label: t('endpoints.hvac.function_heat_cool', 'Heat / Cool'),
                      shortLabel: t('endpoints.hvac.function_heat_cool_short', 'Heat/Cool'),
                      glyph: '+/-',
                    },
                    {
                      value: 'heat',
                      label: t('endpoints.hvac.function_heat', 'Heat'),
                      shortLabel: t('endpoints.hvac.function_heat_short', 'Heat'),
                      glyph: '+',
                    },
                    {
                      value: 'cool',
                      label: t('endpoints.hvac.function_cool', 'Cool'),
                      shortLabel: t('endpoints.hvac.function_cool_short', 'Cool'),
                      glyph: '-',
                    },
                  ]}
                />
              </div>
            )}
            {/* HVAC "add more": available for any HVAC device chained after an HVAC source (furnace/heat pump) */}
            {isHvacDeviceSymbol(symbol) && endpointSupportsMultiplier(endpoint) && (
              <div>
                <label className={labelClass}>
                  {symbol === 'ventilation'
                    ? t('endpoints.ventilationCount', 'Number of ventilators')
                    : t('endpoints.hvacDeviceCount', 'Number of units')}
                </label>
                <input
                  key={`hvac-count-${endpointId}-${getEndpointMultiplier(endpoint)}`}
                  type="number"
                  min={1}
                  defaultValue={getEndpointMultiplier(endpoint)}
                  onBlur={(e) => {
                    const target = Math.floor(Number(e.target.value || 1))
                    if (!Number.isFinite(target) || target < 1) return
                    if (target === getEndpointMultiplier(endpoint)) return
                    syncEndpointMultiplierCount(createSyncEndpointMultiplierDeps(), endpointId, target)
                  }}
                  className={selectClass}
                />
              </div>
            )}
            {/* Boiler option: accumulating variant (under type) */}
            {symbol === 'boiler' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={endpoint.fixedApplianceProps?.accumulating ?? false}
                  onChange={(e) =>
                    onUpdate(endpointId, {
                      fixedApplianceProps: {
                        ...endpoint.fixedApplianceProps,
                        accumulating: e.target.checked,
                      },
                    })
                  }
                  className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t('endpoints.accumulatingBoiler', 'Accumulating boiler')}
                </span>
              </label>
            )}
            {/* Heating options: accumulation heating, then with fan */}
            {symbol === 'heating' && (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={endpoint.fixedApplianceProps?.accumulationHeating ?? false}
                    onChange={(e) =>
                      onUpdate(endpointId, {
                        fixedApplianceProps: {
                          ...endpoint.fixedApplianceProps,
                          accumulationHeating: e.target.checked,
                          ...(e.target.checked ? {} : { withFan: false }),
                        },
                      })
                    }
                    className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('endpoints.accumulationHeating', 'Accumulation heating')}
                  </span>
                </label>
                {endpoint.fixedApplianceProps?.accumulationHeating && (
                  <label className="flex items-center gap-2 cursor-pointer ml-4">
                    <input
                      type="checkbox"
                      checked={endpoint.fixedApplianceProps?.withFan ?? false}
                      onChange={(e) =>
                        onUpdate(endpointId, {
                          fixedApplianceProps: {
                            ...endpoint.fixedApplianceProps,
                            withFan: e.target.checked,
                          },
                        })
                      }
                      className="w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {t('endpoints.heatingWithFan', 'With fan')}
                    </span>
                  </label>
                )}
              </>
            )}
          </>
        )}

      {/* Solar panel specific properties */}
      {symbol === 'solar_panel' && (
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelClass + ' mb-0'}>
                {t('endpoints.solarPanel.wattage', 'Wattage (Wp)')}
              </label>
              <button
                type="button"
                onClick={() =>
                  onUpdate(endpointId, {
                    symbolLabelDisplay: {
                      ...(endpoint.symbolLabelDisplay ?? {}),
                      visibility: {
                        ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<
                          string,
                          boolean
                        >),
                        solarPower: !(endpoint.symbolLabelDisplay?.visibility?.solarPower ?? true),
                      },
                    },
                  })
                }
                className={visibilityToggleClass(
                  endpoint.symbolLabelDisplay?.visibility?.solarPower ?? true
                )}
                title={
                  (endpoint.symbolLabelDisplay?.visibility?.solarPower ?? true)
                    ? t('common.hide', 'Hide')
                    : t('common.show', 'Show')
                }
              >
                {(endpoint.symbolLabelDisplay?.visibility?.solarPower ?? true) ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>
            </div>
            <input
              type="number"
              min={0}
              value={
                endpoint.solarPanelProps?.wattageW !== undefined
                  ? endpoint.solarPanelProps.wattageW
                  : 1000
              }
              onChange={(e) => {
                const wattage = e.target.value === '' ? undefined : Number(e.target.value)
                onUpdate(endpointId, {
                  solarPanelProps: {
                    ...(endpoint.solarPanelProps ?? {}),
                    wattageW: Number.isFinite(wattage as number) ? wattage : undefined,
                  },
                })
              }}
              className={selectClass}
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelClass + ' mb-0'}>
                {t('endpoints.solarPanel.voltage', 'Voltage (V)')}
              </label>
              <button
                type="button"
                onClick={() =>
                  onUpdate(endpointId, {
                    symbolLabelDisplay: {
                      ...(endpoint.symbolLabelDisplay ?? {}),
                      visibility: {
                        ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<
                          string,
                          boolean
                        >),
                        solarVoltage: !(
                          endpoint.symbolLabelDisplay?.visibility?.solarVoltage ?? true
                        ),
                      },
                    },
                  })
                }
                className={visibilityToggleClass(
                  endpoint.symbolLabelDisplay?.visibility?.solarVoltage ?? true
                )}
                title={
                  (endpoint.symbolLabelDisplay?.visibility?.solarVoltage ?? true)
                    ? t('common.hide', 'Hide')
                    : t('common.show', 'Show')
                }
              >
                {(endpoint.symbolLabelDisplay?.visibility?.solarVoltage ?? true) ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>
            </div>
            <input
              type="number"
              min={0}
              value={
                endpoint.solarPanelProps?.voltageV !== undefined
                  ? endpoint.solarPanelProps.voltageV
                  : ''
              }
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value)
                onUpdate(endpointId, {
                  solarPanelProps: {
                    ...(endpoint.solarPanelProps ?? {}),
                    voltageV: Number.isFinite(v as number) ? v : undefined,
                  },
                })
              }}
              className={selectClass}
            />
          </div>
        </div>
      )}

      {/* Battery specific properties */}
      {symbol === 'battery' && (
        <div className="space-y-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelClass + ' mb-0'}>
                {t('endpoints.battery.voltage', 'Voltage (V)')}
              </label>
              <button
                type="button"
                onClick={() =>
                  onUpdate(endpointId, {
                    symbolLabelDisplay: {
                      ...(endpoint.symbolLabelDisplay ?? {}),
                      visibility: {
                        ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<
                          string,
                          boolean
                        >),
                        batteryVoltage: !(
                          endpoint.symbolLabelDisplay?.visibility?.batteryVoltage ?? true
                        ),
                      },
                    },
                  })
                }
                className={visibilityToggleClass(
                  endpoint.symbolLabelDisplay?.visibility?.batteryVoltage ?? true
                )}
                title={
                  (endpoint.symbolLabelDisplay?.visibility?.batteryVoltage ?? true)
                    ? t('common.hide', 'Hide')
                    : t('common.show', 'Show')
                }
              >
                {(endpoint.symbolLabelDisplay?.visibility?.batteryVoltage ?? true) ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>
            </div>
            <input
              type="number"
              min={0}
              value={
                endpoint.batteryProps?.voltageV !== undefined ? endpoint.batteryProps.voltageV : 48
              }
              onChange={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value)
                onUpdate(endpointId, {
                  batteryProps: {
                    ...(endpoint.batteryProps ?? {}),
                    voltageV: Number.isFinite(v as number) ? v : undefined,
                  },
                })
              }}
              className={selectClass}
            />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelClass + ' mb-0'}>
                {t('endpoints.battery.capacity', 'Capacity (kWh)')}
              </label>
              <button
                type="button"
                onClick={() =>
                  onUpdate(endpointId, {
                    symbolLabelDisplay: {
                      ...(endpoint.symbolLabelDisplay ?? {}),
                      visibility: {
                        ...((endpoint.symbolLabelDisplay?.visibility ?? {}) as Record<
                          string,
                          boolean
                        >),
                        batteryCapacity: !(
                          endpoint.symbolLabelDisplay?.visibility?.batteryCapacity ?? true
                        ),
                      },
                    },
                  })
                }
                className={visibilityToggleClass(
                  endpoint.symbolLabelDisplay?.visibility?.batteryCapacity ?? true
                )}
                title={
                  (endpoint.symbolLabelDisplay?.visibility?.batteryCapacity ?? true)
                    ? t('common.hide', 'Hide')
                    : t('common.show', 'Show')
                }
              >
                {(endpoint.symbolLabelDisplay?.visibility?.batteryCapacity ?? true) ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>
            </div>
            <input
              type="number"
              min={0}
              step="0.1"
              value={
                endpoint.batteryProps?.capacityKWh !== undefined
                  ? endpoint.batteryProps.capacityKWh
                  : 5
              }
              onChange={(e) => {
                const c = e.target.value === '' ? undefined : Number(e.target.value)
                onUpdate(endpointId, {
                  batteryProps: {
                    ...(endpoint.batteryProps ?? {}),
                    capacityKWh: Number.isFinite(c as number) ? c : undefined,
                  },
                })
              }}
              className={selectClass}
            />
          </div>
        </div>
      )}
      <EndpointCertificationSection
        endpoint={endpoint}
        endpointId={endpointId}
        symbol={symbol}
        canUseSynergridList={canUseSynergridList}
        synergridPlugAndPlayOnly={synergridPlugAndPlayOnly}
        synergridCatalogFocus={synergridCatalogFocus}
        synergridPickerOpen={synergridPickerOpen}
        setSynergridPickerOpen={setSynergridPickerOpen}
        applySynergridEntryToEndpoint={applySynergridEntryToEndpoint}
        onUpdate={onUpdate}
        t={t}
      />
      {/* Notes at bottom of endpoint props */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className={labelClass + ' mb-0'}>{t('endpoints.notes', 'Notes')}</label>
          {!endpoint.domoticaChildProps && (
            <button
              type="button"
              onClick={() =>
                onUpdate(endpointId, {
                  notesVisible: endpoint.notesVisible !== false ? false : true,
                })
              }
              className={visibilityToggleClass(endpoint.notesVisible !== false)}
              title={
                endpoint.notesVisible !== false
                  ? t('circuits.notesHide', 'Hide on diagram')
                  : t('circuits.notesShow', 'Show on diagram')
              }
            >
              {endpoint.notesVisible !== false ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
        <DebouncedTextarea
          value={endpoint.notes ?? ''}
          onCommit={(v) => onUpdate(endpointId, { notes: v })}
          delayMs={500}
          rows={3}
          className={`${selectClass} resize-none`}
          placeholder={t('endpoints.notesPlaceholder', 'Optional notes for this endpoint')}
        />
      </div>
    </div>
  )
}
