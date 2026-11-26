import type { Circuit, Endpoint, Panel, ProtectionDevice, SocketDeviceProps } from '@/types/schema'
import { isStructuralCarrierProtection } from '@/lib/eendraad/structuralCarrier'

/** Library-only preset id; drops resolve to a grounded child-protected socket. */
export const MODULAR_SOCKET_LIBRARY_ID = 'modular_socket'

export const MODULAR_SOCKET_SINGLE_MODULE_WIDTH = 2
export const MODULAR_SOCKET_DOUBLE_MODULE_WIDTH = 4
export const MODULAR_SOCKET_MAX_COUNT = 2

export function isModularSocketLibraryId(id: string | undefined): boolean {
  return id === MODULAR_SOCKET_LIBRARY_ID
}

/** Panel-mounted DIN socket. Electrically the same endpoint type as a wall socket. */
export function isModularSocket(endpoint: Endpoint | null | undefined): boolean {
  return endpoint?.type === 'socket' && endpoint.socketProps?.modular === true
}

export function getModularSocketCount(endpoint: Endpoint): 1 | 2 {
  return (endpoint.socketProps?.socketCount ?? 1) >= 2 ? 2 : 1
}

export function getModularSocketModuleWidth(endpoint: Endpoint): 2 | 4 {
  return getModularSocketCount(endpoint) === 2
    ? MODULAR_SOCKET_DOUBLE_MODULE_WIDTH
    : MODULAR_SOCKET_SINGLE_MODULE_WIDTH
}

/** Single sockets occupy 2 modules; dragging toward 4 snaps to a double. */
export function snapModularSocketModuleWidth(widthCols: number): 2 | 4 {
  return widthCols >= 3 ? MODULAR_SOCKET_DOUBLE_MODULE_WIDTH : MODULAR_SOCKET_SINGLE_MODULE_WIDTH
}

/** Keep a double socket at 4 modules only when the row still has room. */
export function snapModularSocketModuleWidthWithin(widthCols: number, maxWidthCols: number): 2 | 4 {
  if (maxWidthCols < MODULAR_SOCKET_DOUBLE_MODULE_WIDTH) return MODULAR_SOCKET_SINGLE_MODULE_WIDTH
  return snapModularSocketModuleWidth(widthCols)
}

export function socketCountForModularWidth(widthCols: number): 1 | 2 {
  return snapModularSocketModuleWidth(widthCols) === MODULAR_SOCKET_DOUBLE_MODULE_WIDTH ? 2 : 1
}

export function clampModularSocketCount(count: number): 1 | 2 {
  return count >= 2 ? 2 : 1
}

export function modularSocketAllowedCounts(): readonly (1 | 2)[] {
  return [1, 2]
}

export const STANDARD_SOCKET_COUNTS = [1, 2, 3, 4] as const

export function allowedSocketCountsForEndpoint(endpoint: Endpoint): readonly number[] {
  return isModularSocket(endpoint) ? modularSocketAllowedCounts() : STANDARD_SOCKET_COUNTS
}

/** Keep the modular flag and clamp count to 1 or 2. */
export function normalizeModularSocketProps(
  props: SocketDeviceProps | undefined
): SocketDeviceProps | undefined {
  if (!props?.modular) return props
  const next: SocketDeviceProps = { ...props, modular: true }
  delete next.switchOverlay
  delete next.switchOverlayLock
  delete next.waterproof
  if (next.socketCount == null || next.socketCount <= 1) {
    delete next.socketCount
    return next
  }
  next.socketCount = 2
  return next
}

export function withModularSocketProps(
  existing?: SocketDeviceProps,
  count: 1 | 2 = 1
): SocketDeviceProps {
  return normalizeModularSocketProps({
    ...(existing ?? {}),
    modular: true,
    socketCount: count <= 1 ? undefined : 2,
  })!
}

function isFeederProtection(protection: ProtectionDevice): boolean {
  return isStructuralCarrierProtection(protection)
}

function lastCircuitOnProtection(protection: ProtectionDevice): Circuit | undefined {
  const circuits = (protection.circuits ?? []).filter((circuit) => circuit.code !== 'PANEL')
  return circuits[circuits.length - 1]
}

function lastProtectionOfType(
  protections: ProtectionDevice[],
  type: ProtectionDevice['type']
): ProtectionDevice | undefined {
  for (let index = protections.length - 1; index >= 0; index -= 1) {
    const protection = protections[index]
    if (protection && protection.type === type && !isFeederProtection(protection)) {
      return protection
    }
  }
  return undefined
}

/** MCBs first, then RCBOs. RCDs and other devices are never a drop target. */
export function findPreferredModularSocketProtection(
  panel: Panel | null | undefined,
  preferredProtection?: ProtectionDevice | null
): ProtectionDevice | undefined {
  if (
    preferredProtection &&
    (preferredProtection.type === 'MCB' || preferredProtection.type === 'RCBO') &&
    !isFeederProtection(preferredProtection)
  ) {
    return preferredProtection
  }
  const protections = panel?.protections ?? []
  return lastProtectionOfType(protections, 'MCB') ?? lastProtectionOfType(protections, 'RCBO')
}

export function findPreferredModularSocketCircuit(
  panel: Panel | null | undefined,
  preferredProtection?: ProtectionDevice | null
): Circuit | undefined {
  const protection = findPreferredModularSocketProtection(panel, preferredProtection)
  return protection ? lastCircuitOnProtection(protection) : undefined
}

export function canDropModularSocketOnPanel(
  panel: Panel | null | undefined,
  preferredProtection?: ProtectionDevice | null
): boolean {
  return findPreferredModularSocketProtection(panel, preferredProtection) != null
}
