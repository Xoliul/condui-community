import { getChannelSystem } from './controlAddress'
import { getChannelCapacity, type ControlDeviceEntry } from './controlLink'

/** Searchable text of one device as shown in the picker. */
export interface ControlDevicePickerItem {
  device: ControlDeviceEntry
  /** Enclosure that owns the device's circuit. */
  panelId: string | undefined
  /** Label, device address, system name, enclosure and circuit, used for matching. */
  searchText: string
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9./]+/g, ' ')
    .trim()
}

/** Every whitespace-separated token of the query must occur in the item's text. */
export function matchesPickerQuery(item: ControlDevicePickerItem, query: string): boolean {
  const needle = normalizeSearch(query)
  if (!needle) return true
  const haystack = normalizeSearch(item.searchText)
  return needle.split(' ').every((token) => haystack.includes(token))
}

export interface RankedPickerItems {
  /** Devices in the same enclosure or recently used; only filled without a query. */
  suggested: ControlDevicePickerItem[]
  /** Every other matching device, naturally sorted by label. */
  rest: ControlDevicePickerItem[]
}

function byLabel(left: ControlDevicePickerItem, right: ControlDevicePickerItem): number {
  return left.device.endpoint.label.localeCompare(right.device.endpoint.label, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

/**
 * Picker order. Without a query, devices in the edited endpoint's enclosure and recently used
 * devices are suggested first (recent order, then label). With a query the list is flat:
 * same enclosure and recent devices still sort first.
 */
export function rankPickerItems(
  items: ControlDevicePickerItem[],
  options: { query: string; contextPanelId?: string; recentIds: readonly string[]; maxSuggested?: number }
): RankedPickerItems {
  const { query, contextPanelId, recentIds, maxSuggested = 5 } = options
  const recentRank = (item: ControlDevicePickerItem) => {
    const index = recentIds.indexOf(item.device.endpoint.id)
    return index < 0 ? Number.POSITIVE_INFINITY : index
  }
  const isSuggested = (item: ControlDevicePickerItem) =>
    recentRank(item) !== Number.POSITIVE_INFINITY ||
    (contextPanelId != null && item.panelId === contextPanelId)
  const bySuggestion = (left: ControlDevicePickerItem, right: ControlDevicePickerItem) =>
    recentRank(left) - recentRank(right) || byLabel(left, right)

  const matching = items.filter((item) => matchesPickerQuery(item, query))
  if (query.trim() !== '') {
    const suggested = matching.filter(isSuggested).sort(bySuggestion)
    const rest = matching.filter((item) => !isSuggested(item)).sort(byLabel)
    return { suggested: [], rest: [...suggested, ...rest] }
  }
  const suggested = matching.filter(isSuggested).sort(bySuggestion).slice(0, maxSuggested)
  const suggestedIds = new Set(suggested.map((item) => item.device.endpoint.id))
  // A short list needs no suggestion section.
  if (matching.length <= maxSuggested) return { suggested: [], rest: [...matching].sort(byLabel) }
  return {
    suggested,
    rest: matching.filter((item) => !suggestedIds.has(item.device.endpoint.id)).sort(byLabel),
  }
}

const MAX_CHANNEL_CHIPS = 32

/**
 * Output channels that can be offered as chips, or undefined when the scheme is not
 * enumerable (DALI's 64 short addresses, Loxone I/O names, very large devices). KNX devices
 * that already use letter channels are offered letters, everything else numbers from 1. A
 * derived capacity gets one extra slot so there is always a free channel to pick. Relays get no
 * chips: they usually have a single contact.
 */
export function getOutputChannelOptions(device: ControlDeviceEntry): string[] | undefined {
  if (device.kind === 'relay') return undefined
  const system = getChannelSystem(device.fields)
  if (system === 'dali' || system === 'loxone') return undefined
  const capacity = getChannelCapacity(device)
  const count = capacity.explicit ? capacity.capacity : capacity.capacity + 1
  const letters =
    system === 'knx' &&
    device.connections.some(
      (entry) => entry.direction === 'output' && /^[A-Za-z]$/.test(entry.channel ?? '')
    )
  if (count < 1 || count > (letters ? 26 : MAX_CHANNEL_CHIPS)) return undefined
  return Array.from({ length: count }, (_, index) =>
    letters ? String.fromCharCode(65 + index) : String(index + 1)
  )
}
