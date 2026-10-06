import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { DebouncedTextInput } from '@/components/forms'
import CustomDropdown, { type CustomDropdownOption } from '@/components/common/CustomDropdown'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import {
  CONTROL_SYSTEMS,
  type ControlAddressing,
  type ControlDeviceFields,
  type ControlSystem,
  type DomoticaDeviceProps,
  type Endpoint,
} from '@/types/schema'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  buildControlDeviceIndex,
  collectControlLinkEntries,
  CONTROL_LINK_NOTE_SEPARATOR,
  getConnectionDirection,
  getChannelCapacity,
  getNextFreeChannel,
  issuesForConnection,
  normalizeChannel,
  validateControlDevices,
  type ConnectedEndpointEntry,
  type ControlDeviceEntry,
  type ControlDeviceIssue,
} from '@/lib/controlLink/controlLink'
import { getOutputChannelOptions } from '@/lib/controlLink/controlDevicePicker'
import {
  cancelControlDevicePick,
  startControlDevicePick,
  useControlDevicePickTarget,
} from '@/handlers/controlDeviceCanvasPick'
import { ControlDevicePicker } from './ControlDevicePicker'
import {
  addressKey,
  deviceUsesGroups,
  formatGroups,
  getChannelSystem,
  normalizeGroups,
  parseGroupsInput,
} from '@/lib/controlLink/controlAddress'
import { labelClass } from '../shared/propertiesSharedUtils'

const NONE_VALUE = ''
const inputClass =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500'
const warningClass = 'mt-1 text-xs text-amber-600 dark:text-amber-400'

/**
 * One open/closed state for every domotica group, remembered across selections (and, when
 * storage is available, sessions), so users who never use addressing never see it expanded.
 */
const DOMOTICA_GROUP_STORAGE_KEY = 'condui.properties.domoticaGroupOpen'
const domoticaGroupListeners = new Set<() => void>()
let domoticaGroupOpen = (() => {
  try {
    return globalThis.localStorage?.getItem(DOMOTICA_GROUP_STORAGE_KEY) === '1'
  } catch {
    return false
  }
})()

function setDomoticaGroupOpen(open: boolean) {
  domoticaGroupOpen = open
  try {
    globalThis.localStorage?.setItem(DOMOTICA_GROUP_STORAGE_KEY, open ? '1' : '0')
  } catch {
    // Storage is a convenience only.
  }
  domoticaGroupListeners.forEach((listener) => listener())
}

function useDomoticaGroupOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      domoticaGroupListeners.add(listener)
      return () => domoticaGroupListeners.delete(listener)
    },
    () => domoticaGroupOpen
  )
}

function DomoticaGroup({
  title,
  summary,
  warning,
  children,
}: {
  title: string
  summary?: string
  warning?: boolean
  children: ReactNode
}) {
  const open = useDomoticaGroupOpen()
  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left text-sm font-medium text-gray-700 dark:text-gray-200"
        aria-expanded={open}
        onClick={() => setDomoticaGroupOpen(!open)}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
        {!open && (summary || warning) && (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-xs font-normal text-gray-500 dark:text-gray-400">
            {summary && <span className="truncate">{summary}</span>}
            {warning && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
          </span>
        )}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  )
}

function useElectricalPanels() {
  const project = useProjectStore((state: ProjectState) => state.currentProject)
  return useMemo(() => (project ? getProjectElectricalPanels(project) : []), [project])
}

function useControlDeviceState() {
  const panels = useElectricalPanels()
  const index = useMemo(() => buildControlDeviceIndex(panels), [panels])
  const issues = useMemo(() => validateControlDevices(panels), [panels])
  return { panels, index, issues }
}

function sameGroups(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return formatGroups(normalizeGroups(left)) === formatGroups(normalizeGroups(right))
}

function useSystemLabel() {
  const { t } = useTranslation()
  return (system: ControlSystem | undefined) =>
    system ? t(`endpoints.domotica.systems.${system}`, system) : ''
}

/** Warning lines for one connection's issues. */
function ConnectionWarnings({
  issues,
  system,
}: {
  issues: ControlDeviceIssue[]
  system: ControlSystem | undefined
}) {
  const { t } = useTranslation()
  const systemLabel = useSystemLabel()
  const lines = new Set<string>()
  for (const issue of issues) {
    if (issue.kind === 'duplicate-channel') {
      lines.add(t('endpoints.controlLink.duplicateChannel', 'Channel already used'))
    } else if (issue.kind === 'invalid-channel') {
      lines.add(
        t('endpoints.controlLink.invalidChannel', 'Channel does not match the {{system}} format', {
          system: systemLabel(system),
        })
      )
    } else if (issue.kind === 'invalid-group') {
      lines.add(t('endpoints.controlLink.invalidGroup', 'Group {{group}} is not valid', { group: issue.group }))
    }
  }
  return (
    <>
      {[...lines].map((line) => (
        <p key={line} className={warningClass}>
          {line}
        </p>
      ))}
    </>
  )
}

/** Channel and (when the device's system uses them) groups of one connection. */
/** Output channel chips: free, used by another endpoint, or this endpoint's own channel. */
function ChannelChips({
  device,
  endpointId,
  channel,
  onPick,
}: {
  device: ControlDeviceEntry
  endpointId: string
  channel: string | undefined
  onPick: (channel: string) => void
}) {
  const options = getOutputChannelOptions(device)
  if (!options) return null
  const usedBy = new Map<string, string>()
  for (const entry of device.connections) {
    if (entry.direction !== 'output' || entry.endpoint.id === endpointId || entry.channel == null) continue
    usedBy.set(addressKey(entry.channel), entry.endpoint.label.trim() || '?')
  }
  const current = channel != null ? addressKey(channel) : undefined
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {options.map((option) => {
        const key = addressKey(option)
        const owner = usedBy.get(key)
        const isCurrent = key === current
        return (
          <button
            key={option}
            type="button"
            title={owner}
            aria-pressed={isCurrent}
            onClick={() => onPick(option)}
            className={`min-w-7 rounded px-1.5 py-0.5 text-xs tabular-nums ${
              isCurrent
                ? owner
                  ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-400 dark:bg-amber-900/50 dark:text-amber-100'
                  : 'bg-sky-100 text-sky-800 ring-1 ring-sky-400 dark:bg-sky-900/60 dark:text-sky-100'
                : owner
                  ? 'bg-gray-100 text-gray-400 line-through dark:bg-gray-700/60 dark:text-gray-500'
                  : 'border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function ControlAddressingInputs({
  endpointId,
  device,
  chipsDevice,
  addressing,
  issues,
  onChange,
}: {
  endpointId: string
  device: ControlDeviceFields | undefined
  /** Device whose free output channels are offered as chips. */
  chipsDevice?: ControlDeviceEntry
  addressing: ControlAddressing
  issues: ControlDeviceIssue[]
  onChange: (next: ControlAddressing) => void
}) {
  const { t } = useTranslation()
  const showGroups = deviceUsesGroups(device) || normalizeGroups(addressing.groups).length > 0
  return (
    <div className="space-y-2">
      <div>
        <label className={labelClass}>{t('endpoints.controlLink.channel', 'Channel')}</label>
        <DebouncedTextInput
          type="text"
          className={inputClass}
          placeholder={t('endpoints.controlLink.channelPlaceholder', '3, C, Q7')}
          value={normalizeChannel(addressing.channel) ?? ''}
          resetKey={endpointId}
          onCommit={(value) =>
            onChange({ ...addressing, channel: value.trim() === '' ? undefined : value.trim() })
          }
        />
        {chipsDevice && (
          <ChannelChips
            device={chipsDevice}
            endpointId={endpointId}
            channel={normalizeChannel(addressing.channel)}
            onPick={(channel) => onChange({ ...addressing, channel })}
          />
        )}
      </div>
      {showGroups && (
        <div>
          <label className={labelClass}>{t('endpoints.controlLink.groups', 'Groups')}</label>
          <DebouncedTextInput
            type="text"
            className={inputClass}
            placeholder={t('endpoints.controlLink.groupsPlaceholder', '1/1/3, 1/4/3')}
            value={formatGroups(addressing.groups)}
            resetKey={endpointId}
            onCommit={(value) => {
              const groups = parseGroupsInput(value)
              if (!sameGroups(groups, addressing.groups)) onChange({ ...addressing, groups })
            }}
          />
        </div>
      )}
      <ConnectionWarnings issues={issues} system={getChannelSystem(device)} />
    </div>
  )
}

/** Channel and groups for an endpoint wired to a domotica module. */
export function DomoticaChildAddressFields({
  endpointId,
  endpoint,
  onUpdate,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
}) {
  const { t } = useTranslation()
  const { index, issues } = useControlDeviceState()
  const child = endpoint.domoticaChildProps
  if (!child) return null
  const device = index.devices.get(child.parentEndpointId)
  const connectionIssues = issuesForConnection(issues, endpointId)
  const isOutput = getConnectionDirection(endpoint, 'wired') === 'output'
  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.section', 'Domotics')}
      summary={normalizeChannel(child.channel)}
      warning={connectionIssues.length > 0}
    >
      <ControlAddressingInputs
        endpointId={endpointId}
        device={device?.fields}
        chipsDevice={isOutput ? device : undefined}
        addressing={child}
        issues={connectionIssues}
        onChange={({ channel, groups }) =>
          onUpdate(endpointId, { domoticaChildProps: { ...child, channel, groups } })
        }
      />
    </DomoticaGroup>
  )
}

/**
 * "Operated by" section for a contact (or "Connected to" for a switch or pushbutton): pick a
 * domotica module or relay and the channel on it.
 */
export function ControlLinkOperatedByFields({
  endpointId,
  endpoint,
  onUpdate,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
}) {
  const { t } = useTranslation()
  const { panels, index, issues } = useControlDeviceState()
  const pickTarget = useControlDevicePickTarget()
  const link = endpoint.controlLink
  const direction = getConnectionDirection(endpoint, 'linked')
  const devices = useMemo(() => [...index.devices.values()], [index])
  const linkedDevice = link ? index.devices.get(link.deviceId) : undefined
  const contextCircuitId = useMemo(
    () => collectControlLinkEntries(panels).find((entry) => entry.endpoint.id === endpointId)?.circuit.id,
    [panels, endpointId]
  )

  const connectionIssues = issuesForConnection(issues, endpointId)
  const summary = linkedDevice
    ? [linkedDevice.endpoint.label.trim() || '?', normalizeChannel(link?.channel)]
        .filter(Boolean)
        .join(CONTROL_LINK_NOTE_SEPARATOR)
    : undefined

  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.controlSection', 'Control')}
      summary={summary}
      warning={connectionIssues.length > 0 || (link != null && !linkedDevice)}
    >
      <div>
        <label className={labelClass}>
          {direction === 'input'
            ? t('endpoints.controlLink.connectedTo', 'Connected to')
            : t('endpoints.controlLink.operatedBy', 'Operated by')}
        </label>
        <ControlDevicePicker
          value={link?.deviceId}
          devices={devices}
          panels={panels}
          contextCircuitId={contextCircuitId}
          missing={link != null && !linkedDevice}
          onChange={(deviceId) =>
            onUpdate(endpointId, {
              controlLink: deviceId
                ? { deviceId, channel: getNextFreeChannel(panels, deviceId, endpointId, direction) || undefined }
                : undefined,
            })
          }
          onPickOnCanvas={() => startControlDevicePick(endpointId)}
        />
        {pickTarget === endpointId && (
          <p className="mt-1 flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300">
            {t('endpoints.controlLink.pickHint', 'Click a device on the canvas')}
            <button
              type="button"
              className="underline hover:no-underline"
              onClick={() => cancelControlDevicePick()}
            >
              {t('common.cancel', 'Cancel')}
            </button>
          </p>
        )}
      </div>
      {link && (
        <ControlAddressingInputs
          endpointId={endpointId}
          device={linkedDevice?.fields}
          chipsDevice={direction === 'output' ? linkedDevice : undefined}
          addressing={link}
          issues={connectionIssues}
          onChange={({ channel, groups }) =>
            onUpdate(endpointId, { controlLink: { deviceId: link.deviceId, channel, groups } })
          }
        />
      )}
    </DomoticaGroup>
  )
}

/** Collapsed domotica group on a domotica module: system, bus address, line, capacity. */
export function ControlDeviceAddressingFields({
  endpointId,
  endpoint,
  onUpdate,
}: {
  endpointId: string
  endpoint: Endpoint
  onUpdate: (id: string, updates: Partial<Endpoint>) => void
}) {
  const { t } = useTranslation()
  const systemLabel = useSystemLabel()
  const { index, issues } = useControlDeviceState()
  const deviceProps: DomoticaDeviceProps = endpoint.domoticaProps ?? {}
  const device = index.devices.get(endpointId)
  const capacity = device ? getChannelCapacity(device) : undefined
  const addressIssue = issues.some(
    (issue) => issue.kind === 'invalid-device-address' && issue.deviceId === endpointId
  )
  const overCapacity = issues.some((issue) => issue.kind === 'over-capacity' && issue.deviceId === endpointId)
  const deviceHasIssues = issues.some((issue) => issue.deviceId === endpointId)
  const summary = [
    deviceProps.system ? systemLabel(deviceProps.system) : undefined,
    capacity && capacity.used > 0 ? `${capacity.used}/${capacity.capacity}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  const update = (fields: Partial<ControlDeviceFields>) =>
    onUpdate(endpointId, { domoticaProps: { ...deviceProps, ...fields } })
  const systemOptions = (unsetLabel: string): CustomDropdownOption[] => [
    { value: NONE_VALUE, label: unsetLabel },
    ...CONTROL_SYSTEMS.map((system) => ({ value: system, label: systemLabel(system) })),
  ]
  const textField = (value: string | undefined) => (value?.trim() ? value.trim() : undefined)

  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.section', 'Domotics')}
      summary={summary || undefined}
      warning={deviceHasIssues}
    >
      <div>
        <label className={labelClass}>{t('endpoints.domotica.system', 'System')}</label>
        <CustomDropdown
          value={deviceProps.system ?? NONE_VALUE}
          onChange={(value) =>
            update({ system: value === NONE_VALUE ? undefined : (value as ControlSystem) })
          }
          options={systemOptions(t('endpoints.domotica.systems.unspecified', 'Not specified'))}
        />
      </div>
      {deviceProps.system && (
        <div>
          <label className={labelClass}>{t('endpoints.domotica.outputSystem', 'Gateway to')}</label>
          <CustomDropdown
            value={deviceProps.outputSystem ?? NONE_VALUE}
            onChange={(value) =>
              update({ outputSystem: value === NONE_VALUE ? undefined : (value as ControlSystem) })
            }
            options={systemOptions(t('endpoints.domotica.outputSystem_none', 'No gateway'))}
          />
        </div>
      )}
      <div>
        <label className={labelClass}>{t('endpoints.domotica.deviceAddress', 'Device address')}</label>
        <DebouncedTextInput
          type="text"
          className={inputClass}
          placeholder={t('endpoints.domotica.deviceAddressPlaceholder', '1.1.12')}
          value={deviceProps.deviceAddress ?? ''}
          resetKey={endpointId}
          onCommit={(value) => update({ deviceAddress: textField(value) })}
        />
        {addressIssue && (
          <p className={warningClass}>
            {t('endpoints.domotica.invalidDeviceAddress', 'Address does not match the {{system}} format', {
              system: systemLabel(deviceProps.system),
            })}
          </p>
        )}
      </div>
      {(getChannelSystem(deviceProps) === 'dali' || deviceProps.line != null) && (
        <div>
          <label className={labelClass}>{t('endpoints.domotica.line', 'Line')}</label>
          <DebouncedTextInput
            type="text"
            className={inputClass}
            value={deviceProps.line ?? ''}
            resetKey={endpointId}
            onCommit={(value) => update({ line: textField(value) })}
          />
        </div>
      )}
      <div>
        <label className={labelClass}>{t('endpoints.domotica.channelCount', 'Channels')}</label>
        <DebouncedTextInput
          type="number"
          min={1}
          className={inputClass}
          placeholder={capacity ? String(capacity.capacity) : undefined}
          value={deviceProps.channelCount != null ? String(deviceProps.channelCount) : ''}
          resetKey={endpointId}
          onCommit={(value) => {
            const parsed = Math.floor(Number(value))
            update({ channelCount: value.trim() !== '' && parsed > 0 ? parsed : undefined })
          }}
        />
        {overCapacity && capacity && (
          <p className={warningClass}>
            {t('endpoints.domotica.overCapacity', '{{used}} of {{capacity}} channels used', {
              used: capacity.used,
              capacity: capacity.capacity,
            })}
          </p>
        )}
      </div>
      <ControlLinkConnectedList deviceId={endpointId} />
    </DomoticaGroup>
  )
}

/** Connections of a relay: contacts it operates on other circuits and the switches that signal it. */
export function RelayOperatedContactsFields({ endpointId }: { endpointId: string }) {
  const { t } = useTranslation()
  const { index, issues } = useControlDeviceState()
  const device = index.devices.get(endpointId)
  if (device?.kind !== 'relay' || device.connections.length === 0) return null
  const operated = device.connections.filter((entry) => entry.direction === 'output')
  const signalling = device.connections.filter((entry) => entry.direction === 'input')
  return (
    <DomoticaGroup
      title={t('endpoints.controlLink.controlSection', 'Control')}
      summary={String(device.connections.length)}
      warning={device.connections.some((entry) => issuesForConnection(issues, entry.endpoint.id).length > 0)}
    >
      {operated.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.operates', 'Operates')}
          count={String(operated.length)}
          connections={operated}
          issues={issues}
        />
      )}
      {signalling.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.inputs', 'Inputs')}
          count={String(signalling.length)}
          connections={signalling}
          issues={issues}
        />
      )}
    </DomoticaGroup>
  )
}

/** One direction of a module's connections; clicking a row selects the endpoint. */
function ConnectionRows({
  title,
  count,
  connections,
  issues,
}: {
  title: string
  count: string
  connections: ConnectedEndpointEntry[]
  issues: ControlDeviceIssue[]
}) {
  const getCircuitIdentifier = useProjectStore((state: ProjectState) => state.getCircuitIdentifier)
  const setSelection = useUIStore((state) => state.setSelection)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className={labelClass}>{title}</label>
        <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{count}</span>
      </div>
      <ul className="space-y-1">
        {connections.map(({ endpoint, circuit, channel, groups }) => {
          const hasIssue = issuesForConnection(issues, endpoint.id).length > 0
          return (
            <li key={endpoint.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={() => setSelection({ type: 'endpoint', ids: [endpoint.id] })}
              >
                <span
                  className={`min-w-8 max-w-24 shrink-0 truncate tabular-nums ${hasIssue ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}
                >
                  {channel ?? '–'}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {endpoint.label.trim() || '?'}
                  {groups.length > 0 && (
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                      {formatGroups(groups)}
                    </span>
                  )}
                </span>
                <span
                  className="shrink-0 text-xs text-gray-500 dark:text-gray-400"
                  title={getCircuitIdentifier(circuit.id)}
                >
                  {getCircuitIdentifier(circuit.id)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** A module's connections, outputs (with capacity) and inputs listed separately. */
function ControlLinkConnectedList({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation()
  const { index, issues } = useControlDeviceState()
  const device = index.devices.get(deviceId)
  if (!device || device.connections.length === 0) return null
  const capacity = getChannelCapacity(device)
  const outputs = device.connections.filter((entry) => entry.direction === 'output')
  const inputs = device.connections.filter((entry) => entry.direction === 'input')

  return (
    <>
      {outputs.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.outputs', 'Outputs')}
          count={`${capacity.used}/${capacity.capacity}`}
          connections={outputs}
          issues={issues}
        />
      )}
      {inputs.length > 0 && (
        <ConnectionRows
          title={t('endpoints.controlLink.inputs', 'Inputs')}
          count={String(inputs.length)}
          connections={inputs}
          issues={issues}
        />
      )}
    </>
  )
}
