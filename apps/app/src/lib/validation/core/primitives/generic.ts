import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Issue, ProtectionType } from './common'
import { i18n, validationCircuitCode } from './common'

/**
 * Check if a circuit has an upstream overcurrent protection device
 */
function hasUpstreamOvercurrent(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) {
    return { passed: true } // Circuit not found, skip
  }

  // PANEL is the panel's own terminal distribution circuit. It represents
  // the board symbol and local supply trunk, not a downstream final circuit
  // that needs another owning MCB/RCBO/fuse.
  if (circuit.code === 'PANEL') {
    return { passed: true }
  }

  // RCD grouping uses a no-load "container" circuit with subCircuitIds pointing at each MCB leaf.
  // Upstream is only an RCD (not counted as overcurrent here); each child has its own MCB and is
  // validated separately — flagging the container produces false positives (same letter as first child).
  if (circuit.subCircuitIds && circuit.subCircuitIds.length > 0) {
    return { passed: true }
  }

  // An RCD may temporarily own an empty circuit row while it has no connected
  // load yet. There is nothing downstream to protect in that state, so do not
  // report the missing overcurrent device warning until the circuit is used.
  const directProtection = query.getProtectionForCircuit(circuit.id)
  const isSurgeProtectionDevice = (device: {
    type: string
    protectionType?: string
  }) => device.type === 'SPD' || (device.type === 'protection' && device.protectionType === 'SPD')
  const hasConnectedLoad =
    circuit.endpoints.length > 0 ||
    (circuit.branches ?? []).some(
      (branch) =>
        branch.endpointIds.length > 0 ||
        (branch.branchDevices?.length ?? 0) === 0 ||
        branch.branchDevices?.some((device) => !isSurgeProtectionDevice(device)) === true
    ) ||
    (circuit.trunkDevices ?? []).some((device) => !isSurgeProtectionDevice(device))
  const hasStandaloneSurgeProtection =
    directProtection?.type === 'SPD' ||
    (circuit.trunkDevices ?? []).some(isSurgeProtectionDevice) ||
    (circuit.branches ?? []).some(
      (branch) =>
        branch.endpointIds.length === 0 &&
        (branch.branchDevices?.length ?? 0) > 0 &&
        branch.branchDevices?.every(isSurgeProtectionDevice) === true
    )
  if (
    !hasConnectedLoad &&
    (directProtection?.type === 'RCD' || hasStandaloneSurgeProtection)
  ) {
    return { passed: true }
  }

  const upstream = query.getUpstream(scope.id)
  const hasOvercurrent = upstream.some((item: { type: 'protection' | 'circuit'; id: string }) => {
    if (item.type === 'protection') {
      const protection = query.getProtectionById(item.id)
      if (protection) {
        const overcurrentTypes: ProtectionType[] = ['MCB', 'RCBO', 'FUSE']
        return overcurrentTypes.includes(protection.type)
      }
    }
    return false
  })

  if (hasOvercurrent) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [
      {
        kind: 'circuit',
        id: scope.id,
        viewHint: 'eendraad',
      },
    ],
    message: i18n.t('validation.primitives.hasUpstreamOvercurrent.message', {
      circuitCode: validationCircuitCode(circuit.code),
      defaultValue: `Circuit ${circuit.code} lacks upstream overcurrent protection`,
    }),
    details: i18n.t('validation.primitives.hasUpstreamOvercurrent.details', {
      defaultValue:
        'Every circuit must have an upstream overcurrent protective device (MCB, RCBO, or fuse).',
    }),
  }
}

/**
 * Check if count is under a threshold
 */
function countUnderThreshold(
  _context: CheckContext,
  params?: Record<string, unknown>
): CheckResult | Issue[] {
  const threshold = params?.threshold as number | undefined
  const count = params?.count as number | undefined

  if (threshold == null || count == null) {
    return { passed: true } // Invalid params, skip
  }

  if (count <= threshold) {
    return { passed: true }
  }

  return {
    passed: false,
    message: i18n.t('validation.primitives.countUnderThreshold.message', {
      count,
      threshold,
      defaultValue: `Count ${count} exceeds threshold ${threshold}`,
    }),
    details: i18n.t('validation.primitives.countUnderThreshold.details', {
      count,
      threshold,
      defaultValue: `The count of ${count} exceeds the maximum allowed threshold of ${threshold}.`,
    }),
  }
}

/**
 * Check if a value is present (not null/undefined)
 */
function hasValue(_context: CheckContext, params?: Record<string, unknown>): CheckResult | Issue[] {
  const value = params?.value
  const fieldName = (params?.fieldName as string) || 'value'

  if (value != null) {
    return { passed: true }
  }

  return {
    passed: false,
    message: i18n.t('validation.primitives.hasValue.message', {
      fieldName,
      defaultValue: `Missing required ${fieldName}`,
    }),
    details: i18n.t('validation.primitives.hasValue.details', {
      fieldName,
      defaultValue: `The required field ${fieldName} is missing or undefined.`,
    }),
  }
}

registerPrimitive('hasUpstreamOvercurrent', hasUpstreamOvercurrent)
registerPrimitive('countUnderThreshold', countUnderThreshold)
registerPrimitive('hasValue', hasValue)
