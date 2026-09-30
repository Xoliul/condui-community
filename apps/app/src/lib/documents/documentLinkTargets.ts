import {
  isDocumentLinkableDevice,
  type ProjectDocumentLink,
} from '@/lib/documents/projectDocuments'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export interface DocumentLinkableDevice {
  link: Pick<ProjectDocumentLink, 'type' | 'id'>
  symbol: string
  /** The device's own label, e.g. the endpoint label "A1.3" or a supply device label. */
  label?: string
  /** Code of the circuit the device is on, when it is on one. */
  circuitCode?: string
  /** Brand and model, e.g. "Pylontech US-5000"; names the device when it has no label. */
  productName?: string
  /** Same for devices of one make and model (symbol + brand + model); absent without both. */
  specKey?: string
}

/** Brand and model from whichever equipment properties the device carries. */
export function getDeviceProduct(device: object): { brand: string; model: string } | undefined {
  for (const value of Object.values(device)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const { brand, model } = value as { brand?: unknown; model?: unknown }
    if (typeof brand !== 'string' || typeof model !== 'string') continue
    const product = {
      brand: brand.trim().replace(/\s+/g, ' '),
      model: model.trim().replace(/\s+/g, ' '),
    }
    if (product.brand && product.model) return product
  }
  return undefined
}

/** Display name of a device's product, e.g. "Deye SUN-5K-SG03LP1-EU". */
export function getDeviceProductName(device: object): string | undefined {
  const product = getDeviceProduct(device)
  if (!product) return undefined
  // Models often repeat the brand already.
  return product.model.toLowerCase().startsWith(product.brand.toLowerCase())
    ? product.model
    : `${product.brand} ${product.model}`
}

/**
 * Identifies the product a device is, so one datasheet can serve every unit of it. Reads the
 * brand and model from whichever equipment properties the device carries.
 */
export function getDeviceSpecKey(
  device: object & { symbol?: string; type?: string }
): string | undefined {
  const product = getDeviceProduct(device)
  if (!product) return undefined
  return [device.symbol ?? device.type ?? '', product.brand, product.model]
    .map((part) => part.toLowerCase())
    .join('|')
}

/** The devices of a project that share the given device's make and model, itself included. */
export function getIdenticalLinkableDevices(
  devices: readonly DocumentLinkableDevice[],
  target: Pick<ProjectDocumentLink, 'type' | 'id'>
): DocumentLinkableDevice[] {
  const self = devices.find(
    (device) => device.link.type === target.type && device.link.id === target.id
  )
  if (!self?.specKey) return self ? [self] : []
  return devices.filter((device) => device.specKey === self.specKey)
}

/**
 * Every device in the project a document can be attached to, in one-wire order: endpoints and
 * trunk devices of each circuit, then supply devices. Uses the same device rules as linking from
 * a device's own properties.
 */
export function getDocumentLinkableDevices(
  project: ProjectWithOptionalV2Electrical
): DocumentLinkableDevice[] {
  const devices: DocumentLinkableDevice[] = []
  const seen = new Set<string>()
  const push = (device: DocumentLinkableDevice) => {
    const key = `${device.link.type}:${device.link.id}`
    if (seen.has(key)) return
    seen.add(key)
    devices.push(device)
  }

  for (const panel of getProjectElectricalPanels(project)) {
    for (const circuit of getAllCircuits(panel)) {
      for (const endpoint of circuit.endpoints) {
        if (!isDocumentLinkableDevice(endpoint)) continue
        push({
          link: { type: 'endpoint', id: endpoint.id },
          symbol: endpoint.symbol ?? endpoint.type,
          label: endpoint.label?.trim() || undefined,
          circuitCode: circuit.code || undefined,
          specKey: getDeviceSpecKey(endpoint),
          productName: getDeviceProductName(endpoint),
        })
      }
      for (const device of circuit.trunkDevices ?? []) {
        if (!isDocumentLinkableDevice(device)) continue
        push({
          link: { type: 'trunkDevice', id: device.id },
          symbol: device.symbol,
          label: device.label?.trim() || undefined,
          circuitCode: circuit.code || undefined,
          specKey: getDeviceSpecKey(device),
          productName: getDeviceProductName(device),
        })
      }
    }
  }

  let supplyDevices: ReturnType<typeof getAllSupplyTrunkDevices> = []
  try {
    supplyDevices = getAllSupplyTrunkDevices(project)
  } catch {
    // A project whose supply topology cannot be resolved simply offers no supply devices.
  }
  for (const device of supplyDevices) {
    if (!isDocumentLinkableDevice(device)) continue
    push({
      link: { type: 'trunkDevice', id: device.id },
      symbol: device.symbol,
      label: device.label?.trim() || undefined,
      specKey: getDeviceSpecKey(device),
      productName: getDeviceProductName(device),
    })
  }
  return devices
}
