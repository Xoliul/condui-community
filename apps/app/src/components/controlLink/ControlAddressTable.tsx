import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Download } from 'lucide-react'
import CustomDropdown from '@/components/common/CustomDropdown'
import { DebouncedTextInput } from '@/components/forms'
import { ExportToggle } from '@/components/documents/ExportToggle'
import { downloadText, useSidePaddingThatYields } from '@/components/cableRouting/scheduleTableLayout'
import {
  addressTableCsv,
  buildAddressTable,
  formatChannelList,
  groupAddressTable,
  type AddressTableDevice,
  type AddressTableFilter,
  type AddressTableRow,
} from '@/lib/controlLink/addressTable'
import { describeAddressTableDevice, getAddressTablePdfLabels } from '@/lib/controlLink/addressTablePdf'
import { formatGroups, normalizeChannel, parseGroupsInput } from '@/lib/controlLink/controlAddress'
import { controlAddressesDocument } from '@/lib/documents/projectDocuments'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { getSymbolById } from '@/lib/symbols'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { walkPanels } from '@/lib/panel/panelTree'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { CONTROL_SYSTEMS, type ControlSystem, type Endpoint } from '@/types/schema'

/** View and filters of the address table, kept for the session and shared with its properties. */
type AddressTableView = 'devices' | 'groups'
interface AddressTableViewState {
  view: AddressTableView
  filter: AddressTableFilter
}
let viewState: AddressTableViewState = { view: 'devices', filter: {} }
const viewListeners = new Set<() => void>()

function setViewState(patch: Partial<AddressTableViewState>) {
  viewState = { ...viewState, ...patch }
  viewListeners.forEach((listener) => listener())
}

function useViewState(): AddressTableViewState {
  return useSyncExternalStore(
    (listener) => {
      viewListeners.add(listener)
      return () => viewListeners.delete(listener)
    },
    () => viewState
  )
}

const DIRECTION_CLASS = {
  output: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100',
  input: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
} as const
const ISSUE_CLASS = 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-100'

function Badge({ className, label, title }: { className: string; label: string; title?: string }) {
  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${className}`}>
      {label}
    </span>
  )
}

function LoadCell({ endpoint, label }: { endpoint: Endpoint | undefined; label: string }) {
  const meta = endpoint?.symbol ? getSymbolById(endpoint.symbol) : undefined
  return (
    <span className="flex min-w-0 items-center gap-2" title={label}>
      {meta ? (
        <img src={meta.svgPath} alt="" className="h-5 w-5 shrink-0 object-contain dark:invert" draggable={false} />
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      <span className="truncate font-medium text-gray-800 dark:text-gray-100">{label}</span>
    </span>
  )
}

const cellInputClass =
  'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-gray-800 hover:border-gray-300 focus:border-sky-500 focus:bg-white focus:outline-none dark:text-gray-100 dark:hover:border-gray-600 dark:focus:bg-gray-800'

function useAddressTableModel() {
  const { t } = useTranslation()
  const project = useProjectStore((s) => s.currentProject)
  const projectName = useProjectStore((s) => s.currentProject?.project.name ?? '')
  const { view, filter } = useViewState()
  const panels = useMemo(() => (project ? getProjectElectricalPanels(project) : []), [project])
  const devices = useMemo(() => buildAddressTable(panels, filter), [panels, filter])
  const labels = useMemo(() => getAddressTablePdfLabels(t), [t])

  const exportCsv = () => {
    const csv = addressTableCsv(devices, {
      headers: [
        t('controlAddresses.module', 'Module'),
        t('endpoints.domotica.system', 'System'),
        t('endpoints.domotica.deviceAddress', 'Device address'),
        labels.direction,
        labels.channel,
        labels.groups,
        labels.load,
        labels.circuit,
        t('cableSchedule.board', 'Board'),
      ],
      direction: labels.directionLabel,
      system: labels.system,
      relay: labels.relay,
    })
    downloadText(csv, `${projectName || labels.title} - ${labels.title}.csv`)
  }

  return { panels, devices, view, filter, labels, exportCsv }
}

/** "Export CSV", shown in the Documents top bar next to the title (like the cable schedule). */
export function ControlAddressTableActions() {
  const { t } = useTranslation()
  const { exportCsv } = useAddressTableModel()
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-100 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
      onClick={exportCsv}
    >
      <Download className="h-4 w-4" />
      {t('cableSchedule.exportCsv', 'Export CSV')}
    </button>
  )
}

/**
 * Domotica address table: every module grouped by board, with its outputs and inputs, groups,
 * free channels and warnings. Channels and groups are editable in place; selecting a row
 * selects the endpoint everywhere. Mirrors the cable schedule's layout and interaction.
 */
export function ControlAddressTable() {
  const { t } = useTranslation()
  const { panels, devices, view, labels } = useAddressTableModel()
  const updateEndpoint = useProjectStore((s) => s.updateEndpoint)
  const selection = useUIStore((s) => s.selection)
  const setSelection = useUIStore((s) => s.setSelection)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const selectedIds = selection.type === 'endpoint' ? selection.ids : []
  const select = (endpointId: string) => setSelection({ type: 'endpoint', ids: [endpointId] })

  const endpointOf = (endpointId: string): Endpoint | undefined => {
    for (const panel of panels) {
      const found = findEndpointById(panel, endpointId)
      if (found) return found.endpoint
    }
    return undefined
  }

  const updateAddressing = (row: AddressTableRow, patch: { channel?: string; groups?: string[] }) => {
    const endpoint = endpointOf(row.endpointId)
    if (!endpoint) return
    if (row.source === 'linked' && endpoint.controlLink) {
      updateEndpoint(row.endpointId, { controlLink: { ...endpoint.controlLink, ...patch } })
    } else if (endpoint.domoticaChildProps) {
      updateEndpoint(row.endpointId, { domoticaChildProps: { ...endpoint.domoticaChildProps, ...patch } })
    }
  }

  // Boards in tree order, modules by label within each board.
  const boardOrder = useMemo(() => {
    const order = new Map<string, number>()
    let index = 0
    for (const panel of walkPanels(panels)) order.set(panel.id, index++)
    return order
  }, [panels])
  const sortedDevices = useMemo(
    () =>
      [...devices].sort(
        (left, right) =>
          (boardOrder.get(left.panelId ?? '') ?? Infinity) - (boardOrder.get(right.panelId ?? '') ?? Infinity)
      ),
    [devices, boardOrder]
  )

  const visibleRows =
    view === 'devices'
      ? sortedDevices.flatMap((device) => (collapsed.has(device.deviceId) ? [] : device.rows))
      : groupAddressTable(sortedDevices).flatMap((entry) => entry.rows)
  const listRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const sidePaddingPx = useSidePaddingThatYields(listRef, tableRef, devices.length > 0)
  const pointerInsideRef = useRef(false)
  const stepRef = useRef<(delta: number) => boolean>(() => false)
  stepRef.current = (delta) => {
    const index = visibleRows.findIndex((row) => selectedIds.includes(row.endpointId))
    if (index < 0) return false
    const row = visibleRows[index + delta]
    if (!row) return true
    select(row.endpointId)
    listRef.current
      ?.querySelector(`[data-endpoint="${CSS.escape(row.endpointId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
    return true
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (event.ctrlKey || event.metaKey || event.altKey || !pointerInsideRef.current) return
      if (isKeyboardTypingTarget(event.target) || useDialogStore.getState().dialog) return
      if (!stepRef.current(event.key === 'ArrowDown' ? 1 : -1)) return
      // Capture phase: the app-wide arrow shortcuts must not also nudge anything.
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const rowClass = (selected: boolean) =>
    `cursor-pointer rounded outline-2 -outline-offset-2 outline-yellow-400 ${
      selected ? 'bg-yellow-50 outline dark:bg-yellow-900/20' : 'hover:outline-dashed'
    }`
  const issueBadge = (
    <Badge className={ISSUE_CLASS} label={t('controlAddresses.check', 'Check')} />
  )

  const addressingCells = (row: AddressTableRow) => (
    <>
      <td className="w-24 px-2 py-1" onClick={(event) => event.stopPropagation()}>
        <DebouncedTextInput
          type="text"
          aria-label={labels.channel}
          className={`${cellInputClass} tabular-nums font-medium ${row.hasIssue ? '!text-amber-600 dark:!text-amber-400' : ''}`}
          value={row.channel ?? ''}
          resetKey={row.endpointId}
          onCommit={(value) => updateAddressing(row, { channel: normalizeChannel(value) })}
        />
      </td>
      <td className="px-2 py-1.5">
        <Badge className={DIRECTION_CLASS[row.direction]} label={labels.directionLabel(row.direction)} />
      </td>
      <td className="w-44 px-2 py-1" onClick={(event) => event.stopPropagation()}>
        <DebouncedTextInput
          type="text"
          aria-label={labels.groups}
          className={cellInputClass}
          value={formatGroups(row.groups)}
          resetKey={row.endpointId}
          onCommit={(value) => {
            const groups = parseGroupsInput(value)
            if (formatGroups(groups) !== formatGroups(row.groups)) updateAddressing(row, { groups })
          }}
        />
      </td>
    </>
  )

  const headers =
    view === 'devices'
      ? [t('controlAddresses.module', 'Module'), labels.channel, labels.direction, labels.groups, labels.load, labels.circuit, labels.source]
      : [labels.groups, t('controlAddresses.module', 'Module'), labels.channel, labels.direction, labels.load, labels.circuit, labels.source]

  let previousBoard: string | undefined
  const groups = view === 'groups' ? groupAddressTable(sortedDevices) : []

  return (
    <div
      ref={listRef}
      className="h-full overflow-auto pb-6"
      style={{ paddingInline: sidePaddingPx }}
      data-testid="control-address-table"
      data-documents-scroll="true"
      onMouseEnter={() => {
        pointerInsideRef.current = true
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false
      }}
    >
      {devices.length === 0 || (view === 'groups' && groups.length === 0) ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          {view === 'groups'
            ? t('controlAddresses.emptyGroups', 'No groups assigned yet.')
            : t('controlAddresses.empty', 'No modules match the filters.')}
        </p>
      ) : (
        <table ref={tableRef} className="w-full border-separate border-spacing-y-0.5 text-sm">
          <thead className="sticky top-0 z-10 bg-white text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-2 py-2 text-left font-medium whitespace-nowrap">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view === 'devices' &&
              sortedDevices.map((device) => {
                const boardName = device.panelName ?? ''
                const boardHeader = boardName !== previousBoard
                previousBoard = boardName
                const open = !collapsed.has(device.deviceId)
                const holdsSelection =
                  !open && device.rows.some((row) => selectedIds.includes(row.endpointId))
                const toggleLabel = open
                  ? t('controlAddresses.collapseModule', 'Collapse module')
                  : t('controlAddresses.expandModule', 'Expand module')
                const toggleButton = (
                  <button
                    type="button"
                    aria-label={toggleLabel}
                    aria-expanded={open}
                    title={toggleLabel}
                    className="-ml-1 shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggle(device.deviceId)
                    }}
                  >
                    <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                )
                const details = describeAddressTableDevice(
                  { ...device, label: '', panelName: undefined },
                  labels.system,
                  labels.relay
                )
                return (
                  <Fragment key={device.deviceId}>
                    {boardHeader && boardName && (
                      <tr>
                        <td
                          colSpan={7}
                          className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300"
                        >
                          {boardName}
                        </td>
                      </tr>
                    )}
                    {(!open || device.rows.length === 0) && (
                      <tr
                        className={`cursor-pointer rounded bg-gray-50 outline-2 -outline-offset-2 outline-yellow-400 dark:bg-gray-800/60 ${
                          holdsSelection || selectedIds.includes(device.deviceId) ? 'outline' : 'hover:outline-dashed'
                        }`}
                        onClick={() => (device.rows.length > 0 ? toggle(device.deviceId) : select(device.deviceId))}
                      >
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap text-gray-800 dark:text-gray-100">
                          <span className="flex items-center gap-1">
                            {device.rows.length > 0 && toggleButton}
                            {device.label}
                          </span>
                        </td>
                        <td colSpan={5} className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                          {details}
                          {device.freeChannels.length > 0 &&
                            ` · ${labels.free}: ${formatChannelList(device.freeChannels)}`}
                        </td>
                        <td className="px-2 py-1.5">{device.hasIssue && issueBadge}</td>
                      </tr>
                    )}
                    {open &&
                      device.rows.map((row, index) => (
                        <tr
                          key={row.endpointId}
                          data-endpoint={row.endpointId}
                          aria-selected={selectedIds.includes(row.endpointId)}
                          className={rowClass(selectedIds.includes(row.endpointId))}
                          onClick={() => select(row.endpointId)}
                        >
                          <td
                            className={`py-1.5 pr-2 font-medium whitespace-nowrap text-gray-800 dark:text-gray-100 ${
                              index === 0 ? 'pl-2' : 'pl-7'
                            }`}
                          >
                            {index === 0 ? (
                              <span className="flex items-center gap-1">
                                {toggleButton}
                                <span>{device.label}</span>
                                {details && (
                                  <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
                                    {details}
                                  </span>
                                )}
                              </span>
                            ) : (
                              device.label
                            )}
                          </td>
                          {addressingCells(row)}
                          <td className="max-w-[16rem] px-2 py-1.5">
                            <LoadCell endpoint={endpointOf(row.endpointId)} label={row.load} />
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-200">{row.circuit}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            <span className="text-gray-500 dark:text-gray-400">{labels.sourceLabel(row.source)}</span>
                            {row.hasIssue && <span className="ml-2">{issueBadge}</span>}
                          </td>
                        </tr>
                      ))}
                    {open && device.rows.length > 0 && device.freeChannels.length > 0 && (
                      <tr>
                        <td className="py-1 pl-7 pr-2 text-xs text-gray-500 dark:text-gray-400">{labels.free}</td>
                        <td colSpan={6} className="px-2 py-1 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                          {formatChannelList(device.freeChannels)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            {view === 'groups' &&
              groups.map((entry) =>
                entry.rows.map((row, index) => (
                  <tr
                    key={`${entry.group}:${row.endpointId}`}
                    data-endpoint={row.endpointId}
                    aria-selected={selectedIds.includes(row.endpointId)}
                    className={rowClass(selectedIds.includes(row.endpointId))}
                    onClick={() => select(row.endpointId)}
                  >
                    <td
                      className={`px-2 py-1.5 font-medium whitespace-nowrap tabular-nums ${
                        index === 0 ? 'text-gray-800 dark:text-gray-100' : 'text-transparent'
                      }`}
                    >
                      {entry.group}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-200">{row.deviceLabel}</td>
                    <td className="px-2 py-1.5 font-medium tabular-nums text-gray-800 dark:text-gray-100">
                      {row.channel ?? '–'}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge className={DIRECTION_CLASS[row.direction]} label={labels.directionLabel(row.direction)} />
                    </td>
                    <td className="max-w-[16rem] px-2 py-1.5">
                      <LoadCell endpoint={endpointOf(row.endpointId)} label={row.load} />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-200">{row.circuit}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className="text-gray-500 dark:text-gray-400">{labels.sourceLabel(row.source)}</span>
                      {row.hasIssue && <span className="ml-2">{issueBadge}</span>}
                    </td>
                  </tr>
                ))
              )}
          </tbody>
        </table>
      )}
    </div>
  )
}

const sectionTitleClassName = 'text-sm font-semibold text-gray-900 dark:text-white'

/** Properties of the address table: export choice, view, and filters (like the cable schedule). */
export function ControlAddressTableProperties() {
  const { t } = useTranslation()
  const assets = useProjectStore((s) => s.currentProject?.assets)
  const { panels, labels } = useAddressTableModel()
  const { view, filter } = useViewState()
  const document = controlAddressesDocument(labels.title, assets)
  const allDevices = useMemo(() => buildAddressTable(panels), [panels])
  const boards = useMemo(() => {
    const withModules = new Set(allDevices.map((device: AddressTableDevice) => device.panelId))
    return [...walkPanels(panels)].filter((panel) => withModules.has(panel.id))
  }, [allDevices, panels])
  const hasRelays = allDevices.some((device) => device.kind === 'relay')
  const views: Array<{ value: AddressTableView; label: string }> = [
    { value: 'devices', label: t('controlAddresses.viewModules', 'Modules') },
    { value: 'groups', label: labels.groups },
  ]

  return (
    <div className="space-y-5" data-testid="control-address-table-properties">
      <ExportToggle document={document} className="w-full justify-center" />

      <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h4 className={sectionTitleClassName}>{t('controlAddresses.view', 'View')}</h4>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1 dark:bg-gray-800">
          {views.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => setViewState({ view: option.value })}
              className={`rounded px-2 py-1 text-sm ${
                view === option.value
                  ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h4 className={sectionTitleClassName}>{t('controlAddresses.filters', 'Filters')}</h4>
        <CustomDropdown
          ariaLabel={t('endpoints.domotica.system', 'System')}
          value={filter.system ?? ''}
          onChange={(value) =>
            setViewState({ filter: { ...filter, system: (value || undefined) as ControlSystem | undefined } })
          }
          options={[
            { value: '', label: t('controlAddresses.allSystems', 'All systems') },
            ...CONTROL_SYSTEMS.map((system) => ({ value: system, label: labels.system(system) })),
          ]}
        />
        {boards.length > 1 && (
          <CustomDropdown
            ariaLabel={t('cableSchedule.board', 'Board')}
            value={filter.panelId ?? ''}
            onChange={(value) => setViewState({ filter: { ...filter, panelId: value || undefined } })}
            options={[
              { value: '', label: t('controlAddresses.allBoards', 'All boards') },
              ...boards.map((panel) => ({ value: panel.id, label: panel.name })),
            ]}
          />
        )}
        <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={filter.issuesOnly === true}
            onChange={(event) =>
              setViewState({ filter: { ...filter, issuesOnly: event.target.checked || undefined } })
            }
            className="rounded border-gray-400"
          />
          {t('controlAddresses.issuesOnly', 'Only modules to check')}
        </label>
        {hasRelays && (
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={filter.hideRelays === true}
              onChange={(event) =>
                setViewState({ filter: { ...filter, hideRelays: event.target.checked || undefined } })
              }
              className="rounded border-gray-400"
            />
            {t('controlAddresses.hideRelays', 'Hide relays')}
          </label>
        )}
      </div>
    </div>
  )
}
