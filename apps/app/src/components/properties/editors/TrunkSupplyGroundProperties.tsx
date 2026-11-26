export { SupplyProperties } from './SupplyProperties'

import { useShallow } from 'zustand/react/shallow'

import {
  editProperties,
  updateTrunkProperties,
  updateInstallationProperties,
  updateJunctionPanelGridProperties,
} from '@/handlers/properties/editProperties'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Eye,
  EyeOff,
  Link as LinkIcon,
  List,
  SeparatorHorizontal,
  SeparatorVertical,
} from 'lucide-react'
import { DebouncedTextInput, DebouncedTextarea } from '@/components/forms'
import { PanelGridDimensionInput } from '../shared/PanelGridDimensionInput'
import CustomDropdown from '@/components/common/CustomDropdown'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type {
  Circuit,
  JunctionPanelPlacement,
  Panel,
  PanelGridConfig,
  PolesConfig,
  ProtectionDevice,
  TransformerSafetyType,
  TrunkDevice,
  DomoticaControlKey,
} from '@/types/schema'
import { CERTIFICATION_LISTING_VISIBILITY_KEY } from '@/lib/certificationLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'

import {
  POLE_CONFIG_OPTIONS,
  configFromPoles,
  polesConfigToDisplay,
  polesFromConfig,
} from '@/constants/poleConfig'
import { getVoltagePolesConfig } from '@/lib/protectionDefaults'
import {
  getProtectionTypeChangePatch,
  isProtectionLabelPartVisible,
  toggleProtectionLabelVisibility,
  type ProtectionLabelKey,
} from '@/lib/protectionLabels'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { DOMOTICA_CONTROL_OVERLAY_PATHS, TRANSFORMER_OVERLAY_PATHS } from '@/lib/symbols'
import { JunctionIdentityField } from '../shared/JunctionIdentityField'
import { JunctionEditorOpenButton } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import {
  getTerminalStripPin,
} from '@/lib/terminalStrip/labels'
import {
  collectJunctionIdentities,
  getJunctionIdentity,
  isJunctionIdentityVisibleByDefault,
} from '@/lib/junctionIdentity'
import {
  SwitchPolesGrid,
  SwitchTypeDropdown,
  TwoWayPolesGrid,
  RelayDeviceFields,
} from './EndpointControls'
import {
  DOMOTICA_CONTROL_KEYS,
  SWITCH_TYPE_SYMBOLS,
  normalizeSwitchSymbol,
} from './endpointControlsUtils'
import {
  findMatchingSynergridEntry,
  formatSynergridPower,
  formatSynergridModel,
  loadSynergridCatalog,
  parseSynergridPowerToW,
  synergridCertificationFromEntry,
  type SynergridCatalogEntry,
} from '@/lib/synergridCatalog'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { getJunctionPanelGridView } from '@/lib/junctionPanel/grid'
import { getInstallDateTargetInheritedYear } from '@/lib/installDatePropagation'
import { InstallDateField, OptionalNumberField } from '../shared/propertiesShared'
import {
  getSynergridFocusForCircuit,
  labelClass,
  panelStringT,
  selectClass,
  visibilityToggleClass,
} from '../shared/propertiesSharedUtils'
import { CertificationListingFields } from '../CertificationListingFields'

import { TransformerNameplateFields } from '../shared/TransformerNameplateFields'
import { getInstallationSupplyTransformer } from '@/lib/electrical/supplyTransformer'
import { resolveInstallationProfile } from '@/lib/installationProfile'
import {
  ProtectionDeviceElectricalFields,
  getProtectionTypeDropdownOptions,
  protectionTypeToSymbolKey,
} from '../ProtectionDeviceElectricalFields'
import { trunkProtectionType } from '@/lib/protectionKind'
import { supplyProtectionAsDevice } from '@/lib/shortCircuit/supplyProtection'
import { SynergridListPicker } from '../SynergridListPicker'
import { ChangeoverGridSourcePicker } from '../shared/ChangeoverGridSourcePicker'
import {
  getSupplyDeviceMultiplier,
  getSupplyDeviceSerialNumbers,
  getSupplyInverterMultiplier,
  getSupplyInverterSerialNumbers,
} from '@/lib/supplyAssembly/inverterMultipliers'
import {
  formatPhaseAssignment,
  getPhaseAssignmentForOptionValue,
  getPhaseAssignmentOptions,
  getPhaseAssignmentOptionValue,
  supportsExplicitPhaseSelection,
} from '@/lib/wires/phaseAssignment'
import { getDefaultSupplyConverterAcPhaseAssignment, getSupplyInverterUnitPhaseAssignments } from '@/lib/supplyAssembly/supplyConverterPhases'

import {
  CIRCUIT_CONVERTER_MAX_CONNECTIONS,
  getCircuitConverterDcConnectionCount,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'
import { resizeConverterDcConnections } from '@/handlers/eendraad/resizeConverterDcConnections'
import { isNumberedCircuitTrunkSwitch } from '@/lib/eendraad/circuitPointNumbering'
import { isSupplyDeviceInDetachedFrame } from '@/lib/layout/supplyFrameDetachment'
import { canConfigureSupplyInverterAcConnection, findSupplyInverterAssembly } from '@/lib/supplyAssembly/deviceReferences'

const SYNERGRID_AUTO_MATCH_DEBOUNCE_MS = 450
const CIRCUIT_TRUNK_SWITCH_RATINGS_A = [10, 16, 20, 25, 32]
export function TrunkDeviceProperties({
  deviceId,
  placementId,
  readOnly = false,
}: {
  deviceId: string
  placementId?: string
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const activeFloorId = useUIStore((state) => state.activeFloorId)
  const { synergridCatalog: showSynergridCatalog } = useEditionFeatureAvailability(
    currentProject?.project.id
  )
  const supplyProtectionTypeOptions = useMemo(
    () => getProtectionTypeDropdownOptions(panelStringT(t), 'supplyTrunk'),
    [t]
  )
  const result = useProjectStore(
    useShallow((state: ProjectState) => state.getTrunkDeviceById(deviceId))
  )
  const updateInstallation = updateInstallationProperties
  const updateJunctionPanelGrid = updateJunctionPanelGridProperties
  const getProtectionForCircuit = useProjectStore(
    (state: ProjectState) => state.getProtectionForCircuit
  )
  const getCircuitIdentifier = useProjectStore((state: ProjectState) => state.getCircuitIdentifier)
  const [junctionPanelPickerOpen, setJunctionPanelPickerOpen] = useState(false)
  const [synergridPickerOpen, setSynergridPickerOpen] = useState(false)
  const junctionPanelPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!junctionPanelPickerOpen) return
    const close = (e: MouseEvent) => {
      if (
        junctionPanelPickerRef.current &&
        !junctionPanelPickerRef.current.contains(e.target as Node)
      ) {
        setJunctionPanelPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [junctionPanelPickerOpen])
  const device = result?.device
  const circuit = result?.circuit
  const isSupplyDevice = result?.isSupplyDevice
  const isSharedSupplyDevice = isSupplyDevice && result?.supplyFeedScope === 'shared'
  const installation = currentProject ? getProjectElectricalInstallation(currentProject) : undefined
  const showTransformerNameplate = !!installation && !!isSharedSupplyDevice &&
    resolveInstallationProfile(installation) === 'non_household' &&
    getInstallationSupplyTransformer(installation)?.id === deviceId
  const isGroundDevice = result?.isGroundDevice
  const isDetachedSupplyAssemblyDevice =
    !!isSupplyDevice &&
    !!currentProject &&
    isSupplyDeviceInDetachedFrame(currentProject, deviceId, result?.supplyPanelId)
  const isConversionSymbol =
    device?.symbol === 'transformer' ||
    device?.symbol === 'rectifier' ||
    device?.symbol === 'inverter' ||
    device?.symbol === 'dc_dc_converter'
  const installationSystem = currentProject
    ? getProjectElectricalInstallation(currentProject)?.nominalVoltage.system
    : undefined
  const supplyTrunkNotesOrientation = currentProject
    ? (getProjectElectricalInstallation(currentProject)?.supplyTrunkNotesOrientation ??
      'horizontal')
    : 'horizontal'
  const isInlineSwitch = device
    ? SWITCH_TYPE_SYMBOLS.includes(normalizeSwitchSymbol(device.symbol))
    : false

  // Helper to update the device (circuit, supply, or ground trunk device)
  const handleUpdate = useCallback(
    (updates: Partial<TrunkDevice>) => updateTrunkProperties(deviceId, updates),
    [deviceId]
  )

  // Supply converters carry one explicit AC phase set shared by both AC ports.
  useEffect(() => {
    if (!isConversionSymbol || !device) return
    if (
      isSupplyDevice &&
      device.symbol !== 'dc_dc_converter' &&
      installationSystem &&
      !device.conversionProps?.acPhaseAssignment
    ) {
      handleUpdate({
        conversionProps: {
          acPhaseAssignment: getDefaultSupplyConverterAcPhaseAssignment(installationSystem),
        },
      })
    } else if (!device.conversionProps) {
      handleUpdate({ conversionProps: {} })
    }
  }, [device, handleUpdate, installationSystem, isConversionSymbol, isSupplyDevice])

  // Heal switches created by the early supply prototype, where ordinary switches
  // were stored as the pseudo protection type OTHER with an automatic OTHER label.
  useEffect(() => {
    if (!device || !isInlineSwitch || device.symbol === 'source_changeover') return
    const updates: Partial<TrunkDevice> = {}
    if (device.protectionType === 'OTHER') updates.protectionType = undefined
    if ((device.label ?? '').trim().toUpperCase() === 'OTHER') updates.label = ''
    if (Object.keys(updates).length > 0) handleUpdate(updates)
  }, [device, handleUpdate, isInlineSwitch])
  const canUseSynergridList =
    showSynergridCatalog && (device?.symbol === 'rectifier' || device?.symbol === 'inverter')
  const synergridCatalogFocus = getSynergridFocusForCircuit(circuit, device?.symbol)

  useEffect(() => {
    if (!device || !canUseSynergridList) return
    const convProps = device.conversionProps ?? {}
    const matchInput = {
      brand: convProps.brand,
      model: convProps.model,
      powerW: parseSynergridPowerToW(convProps.power),
    }
    const currentSynergrid = convProps.synergrid

    const timer = window.setTimeout(() => {
      void loadSynergridCatalog({ plugAndPlayOnly: false, focus: synergridCatalogFocus })
        .then((entries) => {
          const match = findMatchingSynergridEntry(entries, matchInput)
          const nextSynergrid = match ? synergridCertificationFromEntry(match) : undefined
          if (currentSynergrid?.sourceKey === nextSynergrid?.sourceKey) return
          handleUpdate({
            conversionProps: {
              ...convProps,
              synergrid: nextSynergrid,
            },
          })
        })
        .catch(() => {
          // Keep manual editing silent; the explicit picker shows load failures.
        })
    }, SYNERGRID_AUTO_MATCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [
    canUseSynergridList,
    device,
    device?.conversionProps?.brand,
    device?.conversionProps?.model,
    device?.conversionProps?.power,
    device?.conversionProps?.synergrid,
    handleUpdate,
    synergridCatalogFocus,
  ])

  if (!result || !device) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('endpoints.notFound', 'Device not found')}
      </div>
    )
  }

  const derivedCircuitKind = circuit
    ? getDerivedCircuitKind(circuit, getProtectionForCircuit(circuit.id))
    : 'other'
  const em = device.energyMeterProps || {}
  const conv = device.conversionProps || {}
  const inverterSupplyAssembly =
    isSupplyDevice && currentProject
      ? findSupplyInverterAssembly(currentProject, device)
      : undefined
  const hasExternalConverterChangeover = Boolean(
    inverterSupplyAssembly?.nodes.some((node) => node.kind === 'changeover-switch')
  )
  const circuitConverterDcConnectionCount = getCircuitConverterDcConnectionCount(device)
  const supplyDeviceMultiplier = getSupplyDeviceMultiplier(device)
  const supplyDeviceSerialNumbers = getSupplyDeviceSerialNumbers(device)
  const selectedSupplyUnitIndex = placementId
    ? (device.placements?.findIndex((placement) => placement.id === placementId) ?? -1)
    : -1
  const isGroupedSupplyDevice = supplyDeviceMultiplier > 1
  const isSelectedSupplyUnit = isGroupedSupplyDevice && selectedSupplyUnitIndex >= 0
  const inverterMultiplier = getSupplyInverterMultiplier(device)
  const converterPhaseOptions =
    isSupplyDevice &&
    device.symbol !== 'dc_dc_converter' &&
    installationSystem &&
    supportsExplicitPhaseSelection(installationSystem)
      ? getPhaseAssignmentOptions(installationSystem).filter((option) => {
          const kind = option.assignment?.kind
          return kind === 'single_phase' || kind === 'phase_to_phase' || kind === 'three_phase'
        })
      : []
  const inverterUnitPhaseOptions = converterPhaseOptions.filter((option) => {
    const kind = option.assignment?.kind
    return kind === 'single_phase' || kind === 'phase_to_phase'
  })
  const inverterUnitPhaseAssignments =
    device.symbol === 'inverter' && installationSystem
      ? getSupplyInverterUnitPhaseAssignments(device, installationSystem, inverterMultiplier)
      : []
  const inverterSerialNumbers = getSupplyInverterSerialNumbers(device)
  const selectedInverterUnitIndex =
    device.symbol === 'inverter' && placementId
      ? (device.placements?.findIndex((placement) => placement.id === placementId) ?? -1)
      : -1
  const isGroupedInverter = device.symbol === 'inverter' && inverterMultiplier > 1
  const isSelectedInverterUnit = isGroupedInverter && selectedInverterUnitIndex >= 0
  if (device.symbol === 'domotica') {
    const domotica = device.domoticaProps ?? {}
    const controlSet = new Set<DomoticaControlKey>(domotica.control ?? [])
    const controlKeys = DOMOTICA_CONTROL_KEYS.filter(
      (key): key is keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS =>
        key in DOMOTICA_CONTROL_OVERLAY_PATHS
    )
    const toggleControl = (key: DomoticaControlKey) => {
      const next = new Set(controlSet)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      handleUpdate({
        domoticaProps: { ...domotica, control: Array.from(next) },
      })
    }
    return (
      <div className="space-y-4">
        {!isSharedSupplyDevice && (
          <InstallDateField
            entity={device}
            project={currentProject}
            inheritedYear={
              currentProject
                ? getInstallDateTargetInheritedYear(currentProject, {
                    id: device.id,
                    type: 'trunkDevice',
                  })
                : undefined
            }
            onUpdate={(updates) => handleUpdate(updates)}
          />
        )}
        <div>
          <label className={labelClass}>{t('endpoints.label', 'Label')}</label>
          <DebouncedTextInput
            type="text"
            value={device.label ?? ''}
            onCommit={(label) => handleUpdate({ label })}
            className={selectClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t('endpoints.domotica.controlArea', 'Control')}</label>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {controlKeys.map((key) => {
              const active = controlSet.has(key)
              const labelKey =
                key === 'programmed_control'
                  ? 'control_programmed'
                  : key === 'wireless_control'
                    ? 'control_wireless'
                    : key === 'detection_control'
                      ? 'control_detection'
                      : 'control_button'
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleControl(key)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors ${
                    active
                      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  <div className="flex h-10 items-center justify-center">
                    <img
                      src={DOMOTICA_CONTROL_OVERLAY_PATHS[key]}
                      alt=""
                      className="h-10 w-10 dark:invert"
                    />
                  </div>
                  <div className="mt-0.5 text-center text-[10px] leading-tight">
                    {t(`endpoints.domotica.${labelKey}`, labelKey)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <label className={`${labelClass} mb-0`}>{t('properties.notes', 'Notes')}</label>
            <button
              type="button"
              onClick={() =>
                handleUpdate({
                  symbolLabelDisplay: {
                    ...(device.symbolLabelDisplay ?? {}),
                    visibility: {
                      ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<string, boolean>),
                      trunkDeviceNotes: !isSymbolLabelVisible(
                        device.symbolLabelDisplay,
                        'trunkDeviceNotes',
                        true
                      ),
                    },
                  },
                })
              }
              className={visibilityToggleClass(
                isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
              )}
              title={
                isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true) ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>
          </div>
          <DebouncedTextarea
            value={device.notes || ''}
            onCommit={(notes) => handleUpdate({ notes })}
            delayMs={500}
            rows={2}
            className={`${selectClass} resize-none`}
          />
        </div>
      </div>
    )
  }
  const updateInverterSerialNumber = (index: number, serialNumber: string) =>
    editProperties({
      actions: [{ kind: 'supplyUnit', deviceId: device.id, index, set: { serialNumber } }],
    })
  if (device.symbol === 'battery' || device.symbol === 'solar_panel') {
    const isBattery = device.symbol === 'battery'
    const battery = device.batteryProps ?? {}
    const solar = device.solarPanelProps ?? {}
    const certification = isBattery ? battery : solar
    const updateSupplyDeviceSerialNumber = (index: number, serialNumber: string) =>
      editProperties({
        actions: [{ kind: 'supplyUnit', deviceId: device.id, index, set: { serialNumber } }],
      })
    const updateNumber = (value: string, apply: (next: number | undefined) => void) => {
      const parsed = value === '' ? undefined : Number(value)
      apply(parsed === undefined || Number.isFinite(parsed) ? parsed : undefined)
    }
    const setDiagramVisibility = (key: string, visible: boolean) =>
      handleUpdate({
        symbolLabelDisplay: {
          ...(device.symbolLabelDisplay ?? {}),
          visibility: {
            ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<string, boolean>),
            [key]: visible,
          },
        },
      })
    const diagramFieldLabel = (text: string, key: string) => {
      const visible = isSymbolLabelVisible(device.symbolLabelDisplay, key, true)
      return (
        <div className="flex items-center gap-2 mb-1">
          <label className={labelClass + ' mb-0 min-w-0 whitespace-normal'}>{text}</label>
          <button
            type="button"
            onClick={() => setDiagramVisibility(key, !visible)}
            className={visibilityToggleClass(visible)}
            title={visible ? t('common.hide', 'Hide') : t('common.show', 'Show')}
          >
            {visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {!isSharedSupplyDevice && (
          <InstallDateField
            entity={device}
            project={currentProject}
            inheritedYear={
              currentProject
                ? getInstallDateTargetInheritedYear(currentProject, {
                    id: device.id,
                    type: 'trunkDevice',
                  })
                : undefined
            }
            onUpdate={(updates) => handleUpdate(updates)}
          />
        )}
        <div>
          <label className={labelClass}>{t('endpoints.label', 'Label')}</label>
          <DebouncedTextInput
            type="text"
            value={device.label ?? ''}
            onCommit={(label) => handleUpdate({ label })}
            className={selectClass}
          />
        </div>
        {isBattery ? (
          <div className="space-y-2">
            <div>
              {diagramFieldLabel(t('endpoints.battery.voltage', 'Voltage (V)'), 'batteryVoltage')}
              <input
                type="number"
                min={0}
                value={battery.voltageV ?? ''}
                onChange={(event) =>
                  updateNumber(event.target.value, (voltageV) =>
                    handleUpdate({ batteryProps: { voltageV } })
                  )
                }
                className={selectClass}
              />
            </div>
            <div>
              {diagramFieldLabel(
                t('endpoints.battery.capacity', 'Capacity (kWh)'),
                'batteryCapacity'
              )}
              <input
                type="number"
                min={0}
                step="0.1"
                value={battery.capacityKWh ?? ''}
                onChange={(event) =>
                  updateNumber(event.target.value, (capacityKWh) =>
                    handleUpdate({ batteryProps: { capacityKWh } })
                  )
                }
                className={selectClass}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              {diagramFieldLabel(t('endpoints.solarPanel.wattageProperty', 'Wattage (Pmax) (Wp)'), 'solarPower')}
              <input
                type="number"
                min={0}
                value={solar.wattageW ?? ''}
                onChange={(event) =>
                  updateNumber(event.target.value, (wattageW) =>
                    handleUpdate({ solarPanelProps: { wattageW } })
                  )
                }
                className={selectClass}
              />
            </div>
            <div>
              {diagramFieldLabel(t('endpoints.solarPanel.voltageProperty', 'Voltage (Umax) (V)'), 'solarVoltage')}
              <input
                type="number"
                min={0}
                value={solar.voltageV ?? ''}
                onChange={(event) =>
                  updateNumber(event.target.value, (voltageV) =>
                    handleUpdate({ solarPanelProps: { voltageV } })
                  )
                }
                className={selectClass}
              />
            </div>
          </div>
        )}
        <CertificationListingFields
          fields={
            isGroupedSupplyDevice && !isSelectedSupplyUnit
              ? ['brand', 'model']
              : ['brand', 'model', 'serialNumber']
          }
          values={{
            ...certification,
            serialNumber: isSelectedSupplyUnit
              ? supplyDeviceSerialNumbers[selectedSupplyUnitIndex]
              : certification.serialNumber,
          }}
          onCommit={(patch) => {
            if (isSelectedSupplyUnit && 'serialNumber' in patch) {
              updateSupplyDeviceSerialNumber(selectedSupplyUnitIndex, patch.serialNumber ?? '')
              return
            }
            if (isBattery) {
              handleUpdate({ batteryProps: { ...patch } })
            } else {
              handleUpdate({ solarPanelProps: { ...patch } })
            }
          }}
          numberFields={
            isBattery
              ? [
                  {
                    key: 'powerKw',
                    labelKey: 'endpoints.certification.powerKw',
                    defaultLabel: 'Power (kW)',
                    value: battery.powerKw,
                    step: 0.1,
                  },
                ]
              : undefined
          }
          onNumberCommit={(_, powerKw) => handleUpdate({ batteryProps: { powerKw } })}
          labelClass={labelClass}
          selectClass={selectClass}
          t={t}
          title={t('endpoints.certification.title', 'Device details')}
          diagramVisible={isSymbolLabelVisible(
            device.symbolLabelDisplay,
            CERTIFICATION_LISTING_VISIBILITY_KEY,
            true
          )}
          onToggleDiagramVisible={() =>
            setDiagramVisibility(
              CERTIFICATION_LISTING_VISIBILITY_KEY,
              !isSymbolLabelVisible(
                device.symbolLabelDisplay,
                CERTIFICATION_LISTING_VISIBILITY_KEY,
                true
              )
            )
          }
          visibilityToggleClass={visibilityToggleClass}
        />
        {isGroupedSupplyDevice && !isSelectedSupplyUnit && (
          <div className="space-y-2">
            {supplyDeviceSerialNumbers.map((serialNumber, index) => (
              <div key={index}>
                <label className={labelClass}>
                  {t('endpoints.certification.serialNumber', 'Serial number')} {index + 1}
                </label>
                <DebouncedTextInput
                  type="text"
                  value={serialNumber}
                  onCommit={(value) => updateSupplyDeviceSerialNumber(index, value)}
                  className={selectClass}
                />
              </div>
            ))}
          </div>
        )}
        <div>
          <label className={labelClass}>{t('endpoints.notes', 'Notes')}</label>
          <DebouncedTextarea
            value={device.notes ?? ''}
            onCommit={(notes) => handleUpdate({ notes })}
            delayMs={500}
            rows={3}
            className={`${selectClass} resize-none`}
          />
        </div>
      </div>
    )
  }
  const applySynergridEntryToTrunkDevice = (entry: SynergridCatalogEntry) => {
    const synergrid = synergridCertificationFromEntry(entry)
    handleUpdate({
      conversionProps: {
        brand: entry.brandName ?? undefined,
        model: formatSynergridModel(entry.productSeries, entry.modelReference),
        power: formatSynergridPower(entry.ratedActivePowerW),
        synergrid,
      },
    })
  }

  // Earthing separator has minimal properties (just label and notes)
  if (device.symbol === 'earthing_separator') {
    return (
      <div className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
          {t('ground.trunkDevice', 'Ground wire device')}
        </p>
        {!isSharedSupplyDevice && (
          <InstallDateField
            entity={device}
            project={currentProject}
            inheritedYear={
              currentProject
                ? getInstallDateTargetInheritedYear(currentProject, {
                    id: device.id,
                    type: 'trunkDevice',
                  })
                : undefined
            }
            onUpdate={(updates) => handleUpdate(updates)}
          />
        )}
        {/* Label */}
        <div>
          <label className={labelClass}>{t('endpoints.label', 'Label')}</label>
          <DebouncedTextInput
            type="text"
            value={device.label || ''}
            onCommit={(v) => handleUpdate({ label: v })}
            className={selectClass}
          />
        </div>

        {/* Notes */}
        <div>
          <label className={labelClass}>{t('properties.notes', 'Notes')}</label>
          <DebouncedTextarea
            value={device.notes || ''}
            onCommit={(v) => handleUpdate({ notes: v })}
            delayMs={500}
            className={selectClass + ' resize-none'}
            rows={2}
          />
        </div>
      </div>
    )
  }

  if (device.symbol === 'source_changeover') {
    const changeoverPanelId = isSupplyDevice ? result?.supplyPanelId : undefined
    const port1Visible = isSymbolLabelVisible(
      device.symbolLabelDisplay,
      'changeoverPort1Label',
      true
    )
    const port2Visible = isSymbolLabelVisible(
      device.symbolLabelDisplay,
      'changeoverPort2Label',
      true
    )
    const nameVisible = isSymbolLabelVisible(
      device.symbolLabelDisplay,
      'supplyProtectionNameLabel',
      true
    )
    const updatePortLabel = (key: 'port1Label' | 'port2Label', value: string) =>
      handleUpdate({ changeoverProps: { ...device.changeoverProps, [key]: value } })
    const togglePortLabel = (key: 'changeoverPort1Label' | 'changeoverPort2Label') =>
      handleUpdate({
        symbolLabelDisplay: {
          ...device.symbolLabelDisplay,
          visibility: {
            ...(device.symbolLabelDisplay?.visibility ?? {}),
            [key]: !isSymbolLabelVisible(device.symbolLabelDisplay, key, true),
          },
        },
      })

    return (
      <div className="space-y-4">
        {!isSharedSupplyDevice && (
          <InstallDateField
            entity={device}
            project={currentProject}
            inheritedYear={
              currentProject
                ? getInstallDateTargetInheritedYear(currentProject, {
                    id: device.id,
                    type: 'trunkDevice',
                  })
                : undefined
            }
            onUpdate={(updates) => handleUpdate(updates)}
          />
        )}
        {changeoverPanelId && (
          <ChangeoverGridSourcePicker panelId={changeoverPanelId} readOnly={readOnly} />
        )}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <label className={labelClass + ' mb-0'}>{t('endpoints.label', 'Label')}</label>
            <button
              type="button"
              onClick={() =>
                handleUpdate({
                  symbolLabelDisplay: {
                    ...device.symbolLabelDisplay,
                    visibility: {
                      ...(device.symbolLabelDisplay?.visibility ?? {}),
                      supplyProtectionNameLabel: !nameVisible,
                    },
                  },
                })
              }
              className={visibilityToggleClass(nameVisible)}
              title={nameVisible ? t('common.hide', 'Hide') : t('common.show', 'Show')}
            >
              {nameVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
          </div>
          <DebouncedTextInput
            type="text"
            value={device.label ?? ''}
            onCommit={(label) => handleUpdate({ label })}
            className={selectClass}
          />
        </div>
        {(
          [
            ['port1Label', 'changeoverPort1Label', port1Visible, t('supply.port1', 'Port 1')],
            ['port2Label', 'changeoverPort2Label', port2Visible, t('supply.port2', 'Port 2')],
          ] as const
        ).map(([valueKey, visibilityKey, visible, label]) => (
          <div key={valueKey}>
            <div className="mb-1 flex items-center gap-2">
              <label className={labelClass + ' mb-0'}>{label}</label>
              <button
                type="button"
                onClick={() => togglePortLabel(visibilityKey)}
                className={visibilityToggleClass(visible)}
                title={visible ? t('common.hide', 'Hide') : t('common.show', 'Show')}
              >
                {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </button>
            </div>
            <DebouncedTextInput
              type="text"
              value={device.changeoverProps?.[valueKey] ?? (valueKey === 'port1Label' ? '1' : '2')}
              onCommit={(value) => updatePortLabel(valueKey, value)}
              className={selectClass}
            />
          </div>
        ))}
        <div>
          <label className={labelClass}>{t('properties.notes', 'Notes')}</label>
          <DebouncedTextarea
            value={device.notes ?? ''}
            onCommit={(notes) => handleUpdate({ notes })}
            delayMs={500}
            rows={3}
            className={`${selectClass} resize-none`}
          />
        </div>
      </div>
    )
  }

  // Junction panel: label (matches multiple 1draad symbols to one sitplan placement) + pick existing
  if (device.symbol === 'junction_panel') {
    const junctionPanelGrid = getJunctionPanelGridView(device)
    const set = new Set<string>()
    const inst = currentProject ? getProjectElectricalInstallation(currentProject) : undefined
    const allJunctionDevices: {
      id: string
      label: string | undefined
      gridView?: PanelGridConfig
    }[] = []
    inst?.mainSupply?.supplyTrunkDevices?.forEach((d: TrunkDevice) => {
      if (d.type === 'junction_panel') {
        if (d.label) set.add(d.label)
        allJunctionDevices.push({ id: d.id, label: d.label, gridView: d.junctionPanelGridView })
      }
    })
    inst?.groundTrunkDevices?.forEach((d: TrunkDevice) => {
      if (d.type === 'junction_panel') {
        if (d.label) set.add(d.label)
        allJunctionDevices.push({ id: d.id, label: d.label, gridView: d.junctionPanelGridView })
      }
    })
    inst?.junctionPanelPlacements?.forEach((jp: JunctionPanelPlacement) => set.add(jp.label))
    ;(currentProject ? getProjectElectricalPanels(currentProject) : []).forEach((panel: Panel) => {
      const circuits = [
        ...(panel.circuits ?? []),
        ...(panel.protections?.flatMap((pr: ProtectionDevice) => pr.circuits ?? []) ?? []),
      ]
      circuits.forEach((c: Circuit) =>
        c.trunkDevices?.forEach((d: TrunkDevice) => {
          if (d.type === 'junction_panel') {
            if (d.label) set.add(d.label)
            allJunctionDevices.push({ id: d.id, label: d.label, gridView: d.junctionPanelGridView })
          }
        })
      )
    })
    if (currentProject) {
      collectJunctionIdentities(currentProject, 'junction_panel').forEach((label) => set.add(label))
    }
    const existingLabels = Array.from(set).sort()

    const currentLabel = getJunctionIdentity(device)
    const linkedCount = currentLabel
      ? allJunctionDevices.filter((d) => d.label === currentLabel).length
      : 0
    const isLinked = linkedCount > 1

    const onLabelChange = (identity: string) =>
      editProperties({
        actions: [
          {
            kind: 'junctionPanelIdentity',
            deviceId: device.id,
            identity,
            floorId: activeFloorId ?? undefined,
          },
        ],
      })

    const handleUnlink = () => {
      if (!currentProject || !inst) return
      const baseLabel = 'JP'
      const used = new Set(existingLabels)
      let n = 1
      let next = `${baseLabel}${n}`
      while (used.has(next)) {
        n += 1
        next = `${baseLabel}${n}`
      }

      onLabelChange(next)
    }
    return (
      <div className="space-y-4">
        {isSupplyDevice && (
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            {t('supply.trunkDevice', 'Supply wire device')}
          </p>
        )}
        {isGroundDevice && (
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            {t('ground.trunkDevice', 'Ground wire device')}
          </p>
        )}
        {!isSharedSupplyDevice && (
          <InstallDateField
            entity={device}
            project={currentProject}
            inheritedYear={
              currentProject
                ? getInstallDateTargetInheritedYear(currentProject, {
                    id: device.id,
                    type: 'trunkDevice',
                  })
                : undefined
            }
            onUpdate={(updates) => handleUpdate(updates)}
          />
        )}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <label className={`${labelClass} mb-0`}>
              {t('junctionPanel.label', 'Junction panel name')}
            </label>
            <button
              type="button"
              onClick={() =>
                handleUpdate({
                  symbolLabelDisplay: {
                    ...(device.symbolLabelDisplay ?? {}),
                    visibility: {
                      ...(device.symbolLabelDisplay?.visibility ?? {}),
                      junctionIdentityLabel: !isSymbolLabelVisible(
                        device.symbolLabelDisplay,
                        'junctionIdentityLabel',
                        true
                      ),
                    },
                  },
                })
              }
              className={visibilityToggleClass(
                isSymbolLabelVisible(device.symbolLabelDisplay, 'junctionIdentityLabel', true)
              )}
              title={t('junctionIdentity.toggleVisibility', 'Show or hide identity on diagram')}
            >
              {isSymbolLabelVisible(device.symbolLabelDisplay, 'junctionIdentityLabel', true) ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="flex gap-1 items-stretch">
            <DebouncedTextInput
              type="text"
              value={device.label || ''}
              onCommit={(v) => onLabelChange(v)}
              className={selectClass + ' flex-1 min-w-0'}
              placeholder={t(
                'junctionPanel.labelPlaceholder',
                'Name (same name = same panel on sitplan)'
              )}
              aria-label={t('junctionPanel.label', 'Junction panel name')}
            />
            <div
              className="relative flex-shrink-0 flex items-stretch gap-1"
              ref={junctionPanelPickerRef}
            >
              <button
                type="button"
                onClick={() => setJunctionPanelPickerOpen((o) => !o)}
                className="flex items-center justify-center w-9 h-[42px] rounded-md border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 focus:ring-2 focus:ring-sky-500"
                title={t(
                  'junctionPanel.pickExisting',
                  'Pick an existing junction panel name to reuse the same sitplan panel.'
                )}
                aria-expanded={junctionPanelPickerOpen}
                aria-haspopup="listbox"
              >
                <List className="w-5 h-5" aria-hidden />
              </button>
              {device.label && isLinked && (
                <button
                  type="button"
                  onClick={handleUnlink}
                  className={`flex items-center justify-center w-9 h-[42px] rounded-md border transition-colors ${
                    isLinked
                      ? 'border-sky-500 bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-200 hover:bg-sky-200 dark:hover:bg-sky-800'
                      : 'border-gray-400 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  } focus:ring-2 focus:ring-sky-500`}
                  title={t(
                    'junctionPanel.unlink',
                    'Unlink this junction panel to give it its own sitplan panel.'
                  )}
                >
                  <LinkIcon className="w-5 h-5" aria-hidden />
                </button>
              )}
              {junctionPanelPickerOpen && (
                <div
                  className="absolute right-0 top-0 z-20 mt-0 py-1 min-w-[180px] max-h-60 overflow-auto rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg"
                  role="listbox"
                >
                  {existingLabels.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                      {t('junctionPanel.noExisting', 'No existing names')}
                    </div>
                  ) : (
                    existingLabels.map((l) => (
                      <button
                        key={l}
                        type="button"
                        role="option" aria-selected={l === currentLabel}
                        className="w-full text-left px-3 py-2 text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => {
                          onLabelChange(l)
                          setJunctionPanelPickerOpen(false)
                        }}
                      >
                        {l}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t(
              'junctionPanel.labelHelp',
              'Same name on multiple symbols = one panel on sitplan. Change name to add a second panel.'
            )}
          </p>
        </div>
        <div className="border-t border-gray-200 pt-4 space-y-3 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('panelCanvas.panelLayout', 'Panel layout')}
          </h4>
          <button
            type="button"
            aria-pressed={junctionPanelGrid.terminalStripTopRail ?? false}
            onClick={() =>
              updateJunctionPanelGrid(device.id, {
                terminalStripTopRail: !junctionPanelGrid.terminalStripTopRail,
              })
            }
            className={`flex w-full items-center justify-center gap-3 rounded-md border-2 px-3 py-2 text-xs font-medium transition-colors ${
              junctionPanelGrid.terminalStripTopRail
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            <img
              src="/symbols/junction/terminal_strip.svg"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 opacity-90 dark:invert"
            />
            <span>{t('panelCanvas.topTerminalStripRail', 'Top clamp rail')}</span>
          </button>
          <PanelGridDimensionInput
            label={t('panelCanvas.rows', 'Rows')}
            value={junctionPanelGrid.rows ?? DEFAULT_PANEL_GRID_ROWS}
            min={1}
            max={32}
            resetKey={device.id}
            onChange={(rows) => updateJunctionPanelGrid(device.id, { rows })}
          />
          <PanelGridDimensionInput
            label={t('panelCanvas.columns', 'Columns')}
            value={junctionPanelGrid.columns ?? DEFAULT_PANEL_GRID_COLUMNS}
            min={1}
            max={48}
            resetKey={device.id}
            onChange={(columns) => updateJunctionPanelGrid(device.id, { columns })}
          />
          <button
            type="button"
            aria-pressed={junctionPanelGrid.terminalStripBottomRail ?? false}
            onClick={() =>
              updateJunctionPanelGrid(device.id, {
                terminalStripBottomRail: !junctionPanelGrid.terminalStripBottomRail,
              })
            }
            className={`flex w-full items-center justify-center gap-3 rounded-md border-2 px-3 py-2 text-xs font-medium transition-colors ${
              junctionPanelGrid.terminalStripBottomRail
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            <img
              src="/symbols/junction/terminal_strip.svg"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 opacity-90 dark:invert"
            />
            <span>{t('panelCanvas.bottomTerminalStripRail', 'Bottom clamp rail')}</span>
          </button>
        </div>
      </div>
    )
  }

  if (device.symbol === 'junction_box' || device.symbol === 'terminal_strip') {
    const identity = getJunctionIdentity(device)
    const visible = isSymbolLabelVisible(
      device.symbolLabelDisplay,
      'junctionIdentityLabel',
      isJunctionIdentityVisibleByDefault(device.symbol)
    )
    return (
      <div className="space-y-4">
        {isSupplyDevice && (
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            {t('supply.trunkDevice', 'Supply wire device')}
          </p>
        )}
        {isGroundDevice && (
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            {t('ground.trunkDevice', 'Ground wire device')}
          </p>
        )}
        {!isSharedSupplyDevice && (
          <InstallDateField
            entity={device}
            project={currentProject}
            inheritedYear={
              currentProject
                ? getInstallDateTargetInheritedYear(currentProject, {
                    id: device.id,
                    type: 'trunkDevice',
                  })
                : undefined
            }
            onUpdate={(updates) => handleUpdate(updates)}
          />
        )}
        <JunctionIdentityField
          value={identity}
          options={currentProject ? collectJunctionIdentities(currentProject, device.symbol) : []}
          visible={visible}
          fixedPrefix={device.symbol === 'terminal_strip' ? 'X' : undefined}
          onCommit={(junctionIdentity) => {
            if (device.symbol === 'terminal_strip') {
              const incomingPin = getTerminalStripPin(device) ?? 1
              editProperties({
                actions: [
                  {
                    kind: 'terminalStripPins',
                    entityId: device.id,
                    stripId: junctionIdentity,
                    incomingPin,
                    outgoingPin: incomingPin,
                  },
                ],
              })
            } else {
              handleUpdate({ junctionIdentity })
            }
          }}
          onToggleVisible={() =>
            handleUpdate({
              symbolLabelDisplay: {
                ...(device.symbolLabelDisplay ?? {}),
                visibility: {
                  ...(device.symbolLabelDisplay?.visibility ?? {}),
                  junctionIdentityLabel: !visible,
                },
              },
            })
          }
          label={t('junctionIdentity.label', 'Junction identity')}
          pickTitle={t('junctionIdentity.pickExisting', 'Reuse an existing identity')}
          toggleTitle={t('junctionIdentity.toggleVisibility', 'Show or hide identity on diagram')}
          emptyText={t('junctionIdentity.noExisting', 'No existing identities')}
        />
        {(device.symbol === 'terminal_strip' || device.symbol === 'junction_box') && (
          <JunctionEditorOpenButton occurrenceId={device.id} />
        )}
        {device.symbol === 'terminal_strip' && (
          <div>
            <label className={labelClass}>{t('terminalStrip.pin', 'Terminal number')}</label>
            <DebouncedTextInput
              type="number"
              min={1}
              step={1}
              value={String(getTerminalStripPin(device) ?? 1)}
              onCommit={(value) => {
                const nextPin = Math.max(1, Math.round(Number(value) || 1))
                editProperties({
                  actions: [
                    {
                      kind: 'terminalStripPin',
                      occurrenceId: `${device.id}:incoming`,
                      stripId: identity || '1',
                      pin: nextPin,
                      vacatedPin: getTerminalStripPin(device),
                    },
                  ],
                })
              }}
              className={selectClass}
            />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>{t('properties.notes', 'Notes')}</label>
            <button
              type="button"
              onClick={() =>
                handleUpdate({
                  symbolLabelDisplay: {
                    ...(device.symbolLabelDisplay ?? {}),
                    visibility: {
                      ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<string, boolean>),
                      trunkDeviceNotes: !(
                        device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true
                      ),
                    },
                  },
                })
              }
              className={visibilityToggleClass(
                device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true
              )}
              title={
                (device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true)
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {(device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true) ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <DebouncedTextarea
            value={device.notes || ''}
            onCommit={(notes) => handleUpdate({ notes })}
            delayMs={500}
            className={selectClass + ' resize-none'}
            rows={2}
          />
        </div>
      </div>
    )
  }

  const supplyProtectionNameDiagramVisible =
    device.protectionType === 'ROTATING_SWITCH'
      ? device.symbolLabelDisplay?.visibility?.supplyProtectionNameLabel === true
      : typeof device.symbolLabelDisplay?.visibility?.supplyProtectionNameLabel === 'boolean'
        ? device.symbolLabelDisplay.visibility.supplyProtectionNameLabel
        : true

  return (
    <div className="space-y-4">
      {isSupplyDevice && !isInlineSwitch && (
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
          {t('supply.trunkDevice', 'Supply wire device')}
        </p>
      )}
      {!isSharedSupplyDevice && (
        <InstallDateField
          entity={device}
          project={currentProject}
          inheritedYear={
            currentProject
              ? getInstallDateTargetInheritedYear(currentProject, {
                  id: device.id,
                  type: 'trunkDevice',
                })
              : undefined
          }
          onUpdate={(updates) => handleUpdate(updates)}
        />
      )}
      {/* Label — supply protections and inline switches can show their name above the symbol. */}
      <div>
        {isSupplyDevice && (device.type === 'protection' || device.symbol === 'relay') ? (
          <>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelClass + ' mb-0'}>{t('endpoints.label', 'Label')}</label>
              <button
                type="button"
                onClick={() => {
                  const symbolLabelDisplay = device.symbolLabelDisplay ?? {}
                  handleUpdate({
                    symbolLabelDisplay: {
                      ...symbolLabelDisplay,
                      visibility: {
                        ...(symbolLabelDisplay.visibility ?? {}),
                        supplyProtectionNameLabel: !supplyProtectionNameDiagramVisible,
                      },
                    },
                  })
                }}
                className={visibilityToggleClass(supplyProtectionNameDiagramVisible)}
                title={
                  supplyProtectionNameDiagramVisible
                    ? t('common.hide', 'Hide')
                    : t('common.show', 'Show')
                }
              >
                {supplyProtectionNameDiagramVisible ? (
                  <Eye className="w-4 h-4" />
                ) : (
                  <EyeOff className="w-4 h-4" />
                )}
              </button>
            </div>
            <DebouncedTextInput
              type="text"
              value={device.label || ''}
              onCommit={(v) => handleUpdate({ label: v })}
              className={selectClass}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t(
                'supply.nameLabelOnDiagramHint',
                'When shown, appears above the symbol on the horizontal supply wire.'
              )}
            </p>
          </>
        ) : (
          <>
            <label className={labelClass}>{t('endpoints.label', 'Label')}</label>
            <DebouncedTextInput
              type="text"
              value={device.label || ''}
              onCommit={(v) => handleUpdate({ label: v })}
              className={selectClass}
            />
          </>
        )}
      </div>

      {/* Circuit (read-only select) — only for circuit trunk devices */}
      {!isSupplyDevice && circuit && (
        <div>
          <label className={labelClass}>{t('circuit.code', 'Circuit')}</label>
          <CustomDropdown
            value={circuit.id}
            onChange={() => {}}
            options={[
              {
                value: circuit.id,
                label: `${getCircuitIdentifier(circuit.id)} (${t(`circuits.${derivedCircuitKind}`, derivedCircuitKind)})`,
              },
            ]}
            disabled
            className={selectClass + ' bg-gray-50 dark:bg-gray-800 cursor-default'}
          />
        </div>
      )}

      {isInlineSwitch && (
        <>
          {/* Circuit-trunk controls keep their placed type; only supply DC lanes offer a type picker. */}
          {device.type !== 'switch' && (
            <SwitchTypeDropdown
              value={normalizeSwitchSymbol(device.symbol)}
              onChangeSymbol={(symbol) => handleUpdate({ symbol, protectionType: undefined })}
            />
          )}
          {device.symbol === 'switch' && (
            <SwitchPolesGrid
              value={(device.poles ?? 1) as 1 | 2 | 3 | 4}
              onChange={(poles) => handleUpdate({ poles, polesConfig: `${poles}P` as PolesConfig })}
            />
          )}
          {circuit && isNumberedCircuitTrunkSwitch(device) && (
            <div>
              <label className={labelClass}>{t('protections.rating', 'Rated current')} (A)</label>
              <CustomDropdown
                value={device.ratingA == null ? '' : String(device.ratingA)}
                onChange={(value) => handleUpdate({ ratingA: value ? Number(value) : undefined })}
                options={[
                  { value: '', label: '-' },
                  ...CIRCUIT_TRUNK_SWITCH_RATINGS_A.map((r) => ({
                    value: String(r),
                    label: `${r} A`,
                  })),
                ]}
                className={selectClass}
              />
            </div>
          )}
          {(device.symbol === 'switch_1p_twoway' || device.symbol === 'switch_2p_twoway') && (
            <TwoWayPolesGrid
              value={device.symbol === 'switch_2p_twoway' ? 2 : 1}
              onChange={(poles) =>
                handleUpdate({
                  symbol: poles === 2 ? 'switch_2p_twoway' : 'switch_1p_twoway',
                  poles,
                  polesConfig: `${poles}P` as PolesConfig,
                  protectionType: undefined,
                })
              }
            />
          )}
        </>
      )}

      {device.symbol === 'relay' && (
        <RelayDeviceFields
          relay={device.relayProps}
          onChange={(relayProps) => handleUpdate({ relayProps })}
          t={panelStringT(t)}
        />
      )}

      {/* Protection-specific properties (when type === 'protection') */}
      {device.type === 'protection' &&
        !isInlineSwitch &&
        device.symbol !== 'relay' &&
        (() => {
          const isProtectionLabelVisible = (key: ProtectionLabelKey) =>
            isProtectionLabelPartVisible(device, key)
          const toggleProtectionLabel = (key: ProtectionLabelKey) => {
            handleUpdate({
              symbolLabelDisplay: toggleProtectionLabelVisibility(device, key),
            })
          }
          const effectiveProtectionType = trunkProtectionType(device)

          return (
            <ProtectionDeviceElectricalFields
              t={t}
              selectClass={selectClass}
              labelClass={labelClass}
              visibilityToggleClass={visibilityToggleClass}
              protectionType={effectiveProtectionType}
              ratingA={device.ratingA}
              curve={device.curve}
              sensitivityMa={device.sensitivityMa}
              residualCurrentType={device.residualCurrentType}
              selective={device.selective}
              superImmunized={device.superImmunized}
              breakingCapacityKa={device.breakingCapacityKa}
              breakingCapacityOption={device.breakingCapacityOption}
              surgeProtectionKind={device.surgeProtectionKind}
              polesConfig={device.polesConfig}
              poles={device.poles}
              typeDropdownOptions={supplyProtectionTypeOptions}
              onProtectionTypeChange={(nextType) => {
                const sym = protectionTypeToSymbolKey(nextType)
                const polesConfig = device.polesConfig ?? getVoltagePolesConfig(currentProject)
                handleUpdate({
                  protectionType: nextType,
                  ...(sym ? { symbol: sym } : {}),
                  ...getProtectionTypeChangePatch(device, nextType, polesConfig),
                })
              }}
              onPatch={(patch) => handleUpdate(patch)}
              isProtectionLabelVisible={isProtectionLabelVisible}
              toggleProtectionLabel={toggleProtectionLabel}
              tripTarget={isSupplyDevice ? { kind: 'trunkDevice', protection: supplyProtectionAsDevice(device) } : undefined}
            />
          )
        })()}

      {/* Conversion-specific properties (transformer/rectifier/inverter/DC‑DC as trunk devices).
          Some older projects may have these stored with a different type, so key off symbol as well. */}
      {(device.type === 'conversion' ||
        device.symbol === 'transformer' ||
        device.symbol === 'rectifier' ||
        device.symbol === 'inverter' ||
        device.symbol === 'dc_dc_converter') && (
        <>
          {isSupplyDevice &&
            currentProject &&
            canConfigureSupplyInverterAcConnection(currentProject, device) && (
              <div>
                <label className={labelClass}>
                  {t('supply.converterAcConnection', 'AC connection')}
                </label>
                <CustomDropdown
                  value={
                    hasExternalConverterChangeover
                      ? 'separate'
                      : (device.converterAcConnection ?? 'shared')
                  }
                  onChange={(value) => {
                    if (value !== 'shared' && value !== 'separate') return
                    handleUpdate({ converterAcConnection: value })
                  }}
                  options={[
                    {
                      value: 'shared',
                      label: t('supply.converterAcShared', 'Shared grid connection'),
                    },
                    {
                      value: 'separate',
                      label: t(
                        'supply.converterAcSeparate',
                        'Separate grid and backup connections'
                      ),
                    },
                  ]}
                  disabled={hasExternalConverterChangeover}
                  className={selectClass}
                />
              </div>
            )}
          {!isGroundDevice &&
            (circuit ||
              (isSupplyDevice &&
                (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'))) &&
            supportsCircuitConverterDcConnections(device) && (
              <div>
                <label className={labelClass}>
                  {isSupplyDevice
                    ? t('supply.converterTopDcConnections', 'Top DC connections')
                    : t('supply.converterDcConnections', 'DC connections')}
                </label>
                <CustomDropdown
                  value={String(circuitConverterDcConnectionCount)}
                  onChange={(value) => {
                    resizeConverterDcConnections(device.id, Number(value) || 1)
                  }}
                  options={Array.from({ length: CIRCUIT_CONVERTER_MAX_CONNECTIONS }, (_, index) => {
                    const value = index + 1
                    return {
                      value: String(value),
                      label: String(value),
                    }
                  })}
                  className={selectClass}
                />
              </div>
            )}
          {converterPhaseOptions.length > 0 && installationSystem && inverterMultiplier !== 2 && (
            <div>
              <label className={labelClass}>{t('supply.converterPhases', 'AC phases')}</label>
              <CustomDropdown
                value={getPhaseAssignmentOptionValue(
                  conv.acPhaseAssignment ??
                    getDefaultSupplyConverterAcPhaseAssignment(installationSystem),
                  installationSystem
                )}
                onChange={(value) => {
                  const acPhaseAssignment = getPhaseAssignmentForOptionValue(
                    value,
                    installationSystem
                  )
                  if (!acPhaseAssignment) return
                  handleUpdate({ conversionProps: { acPhaseAssignment } })
                }}
                options={converterPhaseOptions.map((option) => ({
                  value: option.value,
                  label: formatPhaseAssignment(option.assignment),
                }))}
                className={selectClass}
                disabled={device.symbol === 'inverter' && inverterMultiplier >= 3}
              />
            </div>
          )}
          {device.symbol === 'inverter' &&
            inverterMultiplier === 2 &&
            installationSystem &&
            inverterUnitPhaseOptions.length > 0 && (
              <div className="space-y-2">
                <label className={labelClass}>{t('supply.converterPhases', 'AC phases')}</label>
                {inverterUnitPhaseAssignments.map((assignment, index) => {
                  if (isSelectedInverterUnit && selectedInverterUnitIndex !== index) return null
                  return (
                    <div key={index}>
                      {!isSelectedInverterUnit && (
                        <label className={labelClass}>
                          {t('supply.inverterUnit', 'Inverter')} {index + 1}
                        </label>
                      )}
                      <CustomDropdown
                        value={getPhaseAssignmentOptionValue(assignment, installationSystem)}
                        onChange={(value) => {
                          const nextAssignment = getPhaseAssignmentForOptionValue(
                            value,
                            installationSystem
                          )
                          if (!nextAssignment) return
                          editProperties({
                            actions: [
                              {
                                kind: 'supplyUnit',
                                deviceId: device.id,
                                index,
                                set: { phaseAssignment: nextAssignment },
                              },
                            ],
                          })
                        }}
                        options={inverterUnitPhaseOptions.map((option) => ({
                          value: option.value,
                          label: formatPhaseAssignment(option.assignment),
                        }))}
                        className={selectClass}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          {/* Transformer-only overlays when used as trunk device */}
          {device.symbol === 'transformer' && (
            <div className="space-y-2">
              {showTransformerNameplate && (
                <TransformerNameplateFields
                  value={conv}
                  readOnly={readOnly}
                  onChange={(conversionProps) => handleUpdate({ conversionProps })}
                />
              )}
              <div>
                <label className={labelClass}>
                  {t('endpoints.transformer.safetyType', 'Safety transformer type')}
                </label>
                <div className="flex gap-2">
                  {[
                    {
                      key: 'none',
                      label: t('endpoints.transformer.safety_none', 'None'),
                      icon: null as string | null,
                    },
                    {
                      key: 'safety_closed',
                      label: t('endpoints.transformer.safety_closed_short', 'Closed'),
                      icon: TRANSFORMER_OVERLAY_PATHS.safetyClosed,
                    },
                    {
                      key: 'safety_open',
                      label: t('endpoints.transformer.safety_open_short', 'Open'),
                      icon: TRANSFORMER_OVERLAY_PATHS.safetyOpen,
                    },
                  ].map((opt) => {
                    const isActive = (conv.transformerSafetyType ?? 'none') === opt.key
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() =>
                          handleUpdate({
                            conversionProps: {
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
                            className="w-4 h-4 mb-0.5 opacity-90 dark:invert"
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
                      active: conv.transformerShortCircuitProtected ?? false,
                      label: t('endpoints.transformer.shortCircuitProtected'),
                      toggle: () =>
                        handleUpdate({
                          conversionProps: {
                            transformerShortCircuitProtected: !(
                              conv.transformerShortCircuitProtected ?? false
                            ),
                          },
                        }),
                      icon: TRANSFORMER_OVERLAY_PATHS.shortcircuit,
                    },
                    {
                      key: 'protective',
                      active: conv.transformerProtected ?? false,
                      label: t('endpoints.transformer.protective'),
                      toggle: () =>
                        handleUpdate({
                          conversionProps: {
                            transformerProtected: !(conv.transformerProtected ?? false),
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
                      handleUpdate({
                        symbolLabelDisplay: {
                          ...(device.symbolLabelDisplay ?? {}),
                          visibility: {
                            ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<
                              string,
                              boolean
                            >),
                            conversionTransformerLabel: !(
                              device.symbolLabelDisplay?.visibility?.conversionTransformerLabel ??
                              true
                            ),
                          },
                        },
                      })
                    }
                    className={visibilityToggleClass(
                      device.symbolLabelDisplay?.visibility?.conversionTransformerLabel ?? true
                    )}
                    title={
                      (device.symbolLabelDisplay?.visibility?.conversionTransformerLabel ?? true)
                        ? t('common.hide', 'Hide')
                        : t('common.show', 'Show')
                    }
                  >
                    {(device.symbolLabelDisplay?.visibility?.conversionTransformerLabel ?? true) ? (
                      <Eye className="w-4 h-4" />
                    ) : (
                      <EyeOff className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <DebouncedTextInput
                  type="text"
                  value={conv.transformerOverlayLabel ?? ''}
                  onCommit={(v) =>
                    handleUpdate({
                      conversionProps: { transformerOverlayLabel: v },
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

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelClass + ' mb-0'}>
                  {t('endpoints.conversion.pMaxPrimary', 'Pmax U prim (VA)')}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdate({
                      symbolLabelDisplay: {
                        ...(device.symbolLabelDisplay ?? {}),
                        visibility: {
                          ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<
                            string,
                            boolean
                          >),
                          conversionPmaxPrimary: !(
                            device.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true
                          ),
                        },
                      },
                    })
                  }
                  className={visibilityToggleClass(
                    device.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true
                  )}
                  title={
                    (device.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true)
                      ? t('common.hide', 'Hide')
                      : t('common.show', 'Show')
                  }
                >
                  {(device.symbolLabelDisplay?.visibility?.conversionPmaxPrimary ?? true) ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                </button>
              </div>
              <DebouncedTextInput
                type="text"
                value={conv.pMaxPrimaryW ?? ''}
                onCommit={(v) =>
                  handleUpdate({
                    conversionProps: { pMaxPrimaryW: v },
                  })
                }
                className={selectClass}
                placeholder="e.g. 250 VA"
              />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelClass + ' mb-0'}>
                  {t('endpoints.conversion.pMaxSecondary', 'Pmax U sec (VA)')}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdate({
                      symbolLabelDisplay: {
                        ...(device.symbolLabelDisplay ?? {}),
                        visibility: {
                          ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<
                            string,
                            boolean
                          >),
                          conversionPmaxSecondary: !(
                            device.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ?? true
                          ),
                        },
                      },
                    })
                  }
                  className={visibilityToggleClass(
                    device.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ?? true
                  )}
                  title={
                    (device.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ?? true)
                      ? t('common.hide', 'Hide')
                      : t('common.show', 'Show')
                  }
                >
                  {(device.symbolLabelDisplay?.visibility?.conversionPmaxSecondary ?? true) ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                </button>
              </div>
              <DebouncedTextInput
                type="text"
                value={conv.pMaxSecondaryW ?? ''}
                onCommit={(v) =>
                  handleUpdate({
                    conversionProps: { pMaxSecondaryW: v },
                  })
                }
                className={selectClass}
                placeholder="e.g. 250 VA"
              />
            </div>
          </div>

          <div className="mt-3">
            {(device.symbol === 'rectifier' || device.symbol === 'dc_dc_converter') && (
              <div>
                <label className={labelClass + ' mb-1'}>
                  {t('endpoints.conversion.dcOutputVoltage', 'DC output voltage (V)')}
                </label>
                <DebouncedTextInput
                  type="text"
                  value={conv.dcOutputVoltageV ?? ''}
                  onCommit={(v) =>
                    handleUpdate({
                      conversionProps: { dcOutputVoltageV: v },
                    })
                  }
                  className={selectClass}
                  placeholder="e.g. 48"
                />
              </div>
            )}
            {device.symbol === 'inverter' && (
              <div>
                <label className={labelClass + ' mb-1'}>
                  {t('endpoints.conversion.dcInputMinVoltage', 'DC input minimum voltage (V)')}
                </label>
                <DebouncedTextInput
                  type="text"
                  value={conv.dcInputMinVoltageV ?? ''}
                  onCommit={(v) =>
                    handleUpdate({
                      conversionProps: { dcInputMinVoltageV: v },
                    })
                  }
                  className={selectClass}
                  placeholder="e.g. 24"
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* Energy meter pole configuration (skip for energy conversion symbols that may be stored as energy_meter in old data) */}
      {device.type === 'energy_meter' && !isConversionSymbol && (
        <div>
          <label className={labelClass}>{t('protections.polesConfig', 'Pole configuration')}</label>
          <CustomDropdown
            value={polesConfigToDisplay(em.polesConfig) || configFromPoles(em.poles) || ''}
            onChange={(nextValue) => {
              const config = nextValue as PolesConfig | ''
              handleUpdate({
                energyMeterProps: {
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
      )}

      {(device.symbol === 'inverter' || device.symbol === 'rectifier') && (
        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <CertificationListingFields
            fields={
              isGroupedInverter && !isSelectedInverterUnit
                ? ['brand', 'model', 'power']
                : ['brand', 'model', 'serialNumber', 'power']
            }
            values={{
              brand: conv.brand,
              model: conv.model,
              serialNumber: isSelectedInverterUnit
                ? inverterSerialNumbers[selectedInverterUnitIndex]
                : conv.serialNumber,
              power: conv.power,
            }}
            onCommit={(patch) => {
              if (isSelectedInverterUnit && 'serialNumber' in patch) {
                updateInverterSerialNumber(selectedInverterUnitIndex, patch.serialNumber ?? '')
                return
              }
              handleUpdate({
                conversionProps: { ...patch, synergrid: undefined },
              })
            }}
            labelClass={labelClass}
            selectClass={selectClass}
            t={t}
            title={t('endpoints.certification.groupTitle', 'Device identification (certification)')}
            diagramVisible={isSymbolLabelVisible(
              device.symbolLabelDisplay,
              CERTIFICATION_LISTING_VISIBILITY_KEY,
              true
            )}
            onToggleDiagramVisible={() =>
              handleUpdate({
                symbolLabelDisplay: {
                  ...(device.symbolLabelDisplay ?? {}),
                  visibility: {
                    ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<string, boolean>),
                    [CERTIFICATION_LISTING_VISIBILITY_KEY]: !isSymbolLabelVisible(
                      device.symbolLabelDisplay,
                      CERTIFICATION_LISTING_VISIBILITY_KEY,
                      true
                    ),
                  },
                },
              })
            }
            visibilityToggleClass={visibilityToggleClass}
            synergrid={conv.synergrid}
            onOpenSynergridPicker={
              canUseSynergridList ? () => setSynergridPickerOpen(true) : undefined
            }
          />
          {isGroupedInverter && !isSelectedInverterUnit && (
            <div className="mt-3 space-y-2">
              {inverterSerialNumbers.map((serialNumber, index) => (
                <div key={index}>
                  <label className={labelClass}>
                    {t('endpoints.certification.serialNumber', 'Serial number')} {index + 1}
                  </label>
                  <DebouncedTextInput
                    type="text"
                    value={serialNumber}
                    onCommit={(value) => updateInverterSerialNumber(index, value)}
                    className={selectClass}
                  />
                </div>
              ))}
            </div>
          )}
          {canUseSynergridList ? (
            <SynergridListPicker
              open={synergridPickerOpen}
              plugAndPlayOnly={false}
              focus={synergridCatalogFocus}
              onClose={() => setSynergridPickerOpen(false)}
              onFill={applySynergridEntryToTrunkDevice}
            />
          ) : null}
        </div>
      )}

      {/* Notes */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className={labelClass + ' mb-0'}>{t('properties.notes', 'Notes')}</label>
          <button
            type="button"
            onClick={() =>
              handleUpdate({
                symbolLabelDisplay: {
                  ...(device.symbolLabelDisplay ?? {}),
                  visibility: {
                    ...((device.symbolLabelDisplay?.visibility ?? {}) as Record<string, boolean>),
                    trunkDeviceNotes: !(
                      device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true
                    ),
                  },
                },
              })
            }
            className={visibilityToggleClass(
              device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true
            )}
            title={
              (device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true)
                ? t('common.hide', 'Hide')
                : t('common.show', 'Show')
            }
          >
            {(device.symbolLabelDisplay?.visibility?.trunkDeviceNotes ?? true) ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>
          {isSupplyDevice && !isDetachedSupplyAssemblyDevice && (
            <button
              type="button"
              onClick={() =>
                updateInstallation({
                  supplyTrunkNotesOrientation:
                    supplyTrunkNotesOrientation === 'vertical' ? 'horizontal' : 'vertical',
                })
              }
              className="one-wire-visibility-toggle p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400"
              title={
                supplyTrunkNotesOrientation === 'vertical'
                  ? t('circuits.notesHorizontal', 'Draw notes horizontally')
                  : t('circuits.notesVertical', 'Draw notes vertically')
              }
            >
              {supplyTrunkNotesOrientation === 'vertical' ? (
                <SeparatorVertical className="w-4 h-4" />
              ) : (
                <SeparatorHorizontal className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
        <DebouncedTextarea
          value={device.notes || ''}
          onCommit={(v) => handleUpdate({ notes: v })}
          delayMs={500}
          className={selectClass + ' resize-none'}
          rows={2}
        />
      </div>
    </div>
  )
}

export function GroundProperties() {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)

  const installation = currentProject ? getProjectElectricalInstallation(currentProject) : undefined
  if (!installation) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('installation.notFound', 'Installation not found')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <OptionalNumberField
        label={t('installation.earthResistance', 'Earth resistance')}
        propertyField="earthResistanceOhm"
        unit="Ω"
        value={installation.earthResistanceOhm}
        onChange={(earthResistanceOhm) => updateInstallationProperties({ earthResistanceOhm })}
      />
      <div>
        <label className={labelClass}>{t('properties.notes', 'Notes')}</label>
        <DebouncedTextarea
          value={installation.notes || ''}
          onCommit={(v) => updateInstallationProperties({ notes: v })}
          delayMs={500}
          className={selectClass + ' resize-none'}
          rows={4}
          placeholder={t('installation.notes', 'Notes')}
        />
      </div>
    </div>
  )
}

export function SupplyPanelProperties({
  panelId,
  panel,
  updatePanelGrid,
}: {
  panelId: string
  panel: Panel
  updatePanelGrid: (id: string, updates: Partial<PanelGridConfig>) => void
}) {
  const { t } = useTranslation()
  const supplyPanelRows = panel.gridView?.supplyPanelRows ?? 1
  const supplyPanelColumns =
    panel.gridView?.supplyPanelColumns ?? panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t('panelCanvas.supplyPanel', 'Supply panel')}
      </h3>
      <PanelGridDimensionInput
        label={t('panelCanvas.rows')}
        value={supplyPanelRows}
        min={1}
        max={32}
        resetKey={`${panelId}:supply`}
        onChange={(supplyPanelRows) => updatePanelGrid(panelId, { supplyPanelRows })}
      />
      <PanelGridDimensionInput
        label={t('panelCanvas.columns')}
        value={supplyPanelColumns}
        min={1}
        max={48}
        resetKey={`${panelId}:supply`}
        onChange={(supplyPanelColumns) => updatePanelGrid(panelId, { supplyPanelColumns })}
      />
    </div>
  )
}
