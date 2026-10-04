import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Crosshair, Search, Unlink } from 'lucide-react'
import type { ControlSystem, Panel } from '@/types/schema'
import { findOwningPanel } from '@/lib/controlLink/addressTable'
import { getChannelCapacity, type ControlDeviceEntry } from '@/lib/controlLink/controlLink'
import {
  rankPickerItems,
  type ControlDevicePickerItem,
} from '@/lib/controlLink/controlDevicePicker'

/** Devices chosen in this session, most recent first. */
const recentDeviceIds: string[] = []

function rememberDevice(deviceId: string) {
  const index = recentDeviceIds.indexOf(deviceId)
  if (index >= 0) recentDeviceIds.splice(index, 1)
  recentDeviceIds.unshift(deviceId)
  recentDeviceIds.length = Math.min(recentDeviceIds.length, 10)
}

const POPOVER_MAX_HEIGHT = 340
const POPOVER_GAP = 4

export function ControlDevicePicker({
  value,
  devices,
  panels,
  contextCircuitId,
  missing,
  onChange,
  onPickOnCanvas,
}: {
  value: string | undefined
  devices: ControlDeviceEntry[]
  panels: Panel[]
  /** Circuit of the endpoint being linked; devices in its enclosure are suggested. */
  contextCircuitId: string | undefined
  /** The stored device id no longer resolves. */
  missing: boolean
  onChange: (deviceId: string | undefined) => void
  onPickOnCanvas: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const systemLabel = useCallback(
    (system: ControlSystem | undefined) =>
      system ? t(`endpoints.domotica.systems.${system}`, system) : undefined,
    [t]
  )
  /** A relay is described by its control mode (Impulse, Timer) instead of a system. */
  const relayLabel = useCallback(
    (device: ControlDeviceEntry) => {
      const mode = device.endpoint.relayProps?.control
      return mode ? t(`endpoints.relay.control_${mode}`, mode) : t('symbols.relay', 'Relay')
    },
    [t]
  )

  const items = useMemo<ControlDevicePickerItem[]>(
    () =>
      devices.map((device) => {
        const panel = findOwningPanel(panels, device.circuit.id)
        return {
          device,
          panelId: panel?.id,
          searchText: [
            device.endpoint.label,
            device.kind === 'relay' ? `${relayLabel(device)} ${t('symbols.relay', 'Relay')}` : undefined,
            device.fields.deviceAddress,
            systemLabel(device.fields.system),
            systemLabel(device.fields.outputSystem),
            panel?.name,
            device.circuit.code,
          ]
            .filter(Boolean)
            .join(' '),
        }
      }),
    [devices, panels, systemLabel, relayLabel, t]
  )
  const contextPanelId = contextCircuitId ? findOwningPanel(panels, contextCircuitId)?.id : undefined
  const ranked = rankPickerItems(items, { query, contextPanelId, recentIds: recentDeviceIds })
  const flat = [...ranked.suggested, ...ranked.rest]
  const selected = devices.find((device) => device.endpoint.id === value)

  const describe = (item: ControlDevicePickerItem) => {
    const { fields } = item.device
    const panelOf = () => (panels.length > 0 ? findOwningPanel(panels, item.device.circuit.id)?.name : undefined)
    if (item.device.kind === 'relay') return [relayLabel(item.device), panelOf()].filter(Boolean).join(' · ')
    const system = fields.outputSystem
      ? `${systemLabel(fields.system)} → ${systemLabel(fields.outputSystem)}`
      : systemLabel(fields.system)
    return [system, fields.deviceAddress, panelOf()].filter(Boolean).join(' · ')
  }

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) triggerRef.current?.focus()
  }, [])

  const choose = (deviceId: string | undefined) => {
    if (deviceId) rememberDevice(deviceId)
    if (deviceId !== value) onChange(deviceId)
    close()
  }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.max(rect.width, 260)
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
      const below = rect.bottom + POPOVER_GAP
      const fitsBelow = below + POPOVER_MAX_HEIGHT <= window.innerHeight - 8
      const top = fitsBelow ? below : Math.max(8, rect.top - POPOVER_GAP - POPOVER_MAX_HEIGHT)
      setPosition({ top, left, width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, close])

  useEffect(() => setActive(0), [query, open])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, flat.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = flat[active]
      if (item) choose(item.device.endpoint.id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  const renderRow = (item: ControlDevicePickerItem, index: number) => {
    const id = item.device.endpoint.id
    const capacity = getChannelCapacity(item.device)
    const description = describe(item)
    return (
      <li key={id} data-index={index}>
        <button
          type="button"
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
            index === active
              ? 'bg-sky-50 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100'
              : 'text-gray-900 dark:text-gray-100'
          }`}
          onMouseEnter={() => setActive(index)}
          onClick={() => choose(id)}
        >
          <span className="min-w-0 flex-1">
            <span className={`block truncate ${id === value ? 'font-semibold' : ''}`}>
              {item.device.endpoint.label.trim() || '?'}
            </span>
            {description && (
              <span className="block truncate text-xs text-gray-500 dark:text-gray-400">{description}</span>
            )}
          </span>
          {item.device.kind !== 'relay' && (
            <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
              {capacity.used}/{capacity.capacity}
            </span>
          )}
        </button>
      </li>
    )
  }

  const sectionTitle = (title: string) => (
    <li className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {title}
    </li>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            selected.endpoint.label.trim() || '?'
          ) : missing ? (
            <span className="text-red-600 dark:text-red-400">
              {t('endpoints.controlLink.missingDevice', 'Device not found')}
            </span>
          ) : (
            <span className="text-gray-500 dark:text-gray-400">
              {t('endpoints.controlLink.chooseDevice', 'Choose device')}
            </span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            className="fixed z-50 flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={{ top: position.top, left: position.left, width: position.width, maxHeight: POPOVER_MAX_HEIGHT }}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('endpoints.controlLink.searchDevices', 'Search devices')}
                className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
              />
            </div>
            <ul ref={listRef} role="listbox" data-app-scroll="true" className="min-h-0 flex-1 overflow-y-auto py-1">
              {ranked.suggested.length > 0 && sectionTitle(t('endpoints.controlLink.suggested', 'Suggested'))}
              {ranked.suggested.map((item, index) => renderRow(item, index))}
              {ranked.suggested.length > 0 &&
                ranked.rest.length > 0 &&
                sectionTitle(t('endpoints.controlLink.allDevices', 'All devices'))}
              {ranked.rest.map((item, index) => renderRow(item, ranked.suggested.length + index))}
              {flat.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                  {t('endpoints.controlLink.noDevices', 'No devices found')}
                </li>
              )}
            </ul>
            <div className="flex items-center gap-1 border-t border-gray-200 px-1 py-1 dark:border-gray-700">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                onClick={() => {
                  close(false)
                  onPickOnCanvas()
                }}
              >
                <Crosshair className="h-3.5 w-3.5" />
                {t('endpoints.controlLink.pickOnCanvas', 'Pick on canvas')}
              </button>
              {(value || missing) && (
                <button
                  type="button"
                  className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                  onClick={() => choose(undefined)}
                >
                  <Unlink className="h-3.5 w-3.5" />
                  {t('endpoints.controlLink.unlink', 'Unlink')}
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
