import {
  electricalImportSchema,
  getElectricalImportPlans,
  type ElectricalImportDiagnostic,
  type ElectricalImportValidationResult,
} from './types'
import type { ElectricalImportSupplySystem } from './supplyTypes'
import { getElectricalImportInstallation } from '@/lib/import/electricalImportTarget'

export function validateElectricalImport(input: unknown): ElectricalImportValidationResult {
  const parsed = electricalImportSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      diagnostics: parsed.error.issues.map((issue) => ({
        severity: 'error',
        path: issue.path.length ? issue.path.join('.') : '$',
        message: issue.message,
      })),
    }
  }

  const diagnostics: ElectricalImportDiagnostic[] = []
  const refs = new Set<string>()
  const addRef = (ref: string, path: string) => {
    if (refs.has(ref)) {
      diagnostics.push({ severity: 'error', path, message: `Duplicate ref "${ref}".` })
    }
    refs.add(ref)
  }
  const validateCircuit = (
    circuit: {
      ref: string
      branches: Array<{
        ref?: string
        repeat?: number
        endpoints: Array<{
          ref?: string
          type: string
          symbol?: string | null
          quantity?: number | null
          waterproof?: boolean | null
          controls?: string[]
        }>
      }>
      endpoints: Array<{
        ref?: string
        type: string
        symbol?: string | null
        quantity?: number | null
        waterproof?: boolean | null
        controls?: string[]
      }>
    },
    circuitPath: string
  ) => {
    addRef(circuit.ref, `${circuitPath}.ref`)
    const expandedBranchCount = circuit.branches.reduce(
      (total, branch) => total + (branch.repeat ?? 1),
      0
    )
    if (expandedBranchCount > 250) {
      diagnostics.push({
        severity: 'error',
        path: `${circuitPath}.branches`,
        message: 'Expanded branch count must not exceed 250.',
      })
    }
    circuit.branches.forEach((branch, branchIndex) => {
      const branchPath = `${circuitPath}.branches.${branchIndex}`
      if (branch.ref) addRef(branch.ref, `${branchPath}.ref`)
      branch.endpoints.forEach((endpoint, endpointIndex) => {
        if (endpoint.ref) addRef(endpoint.ref, `${branchPath}.endpoints.${endpointIndex}.ref`)
        validateEndpointModifiers(endpoint, `${branchPath}.endpoints.${endpointIndex}`, diagnostics)
      })
    })
    circuit.endpoints.forEach((endpoint, endpointIndex) => {
      if (endpoint.ref) addRef(endpoint.ref, `${circuitPath}.endpoints.${endpointIndex}.ref`)
      validateEndpointModifiers(endpoint, `${circuitPath}.endpoints.${endpointIndex}`, diagnostics)
    })
    validateCircuitEndpointRefs(circuit, circuitPath, diagnostics)
  }
  addRef(parsed.data.panel.ref, 'panel.ref')
  const installation = getElectricalImportInstallation(parsed.data)
  if (installation.supply?.system) {
    validateSupplySystem(
      installation.supply.system,
      installation.voltageSystem,
      addRef,
      diagnostics
    )
  }
  if (installation.supply == null) {
    diagnostics.push({
      severity: 'warning',
      path: 'installation.supply',
      message: 'Incoming supply was not recognized; no default supply devices will be added.',
    })
  }
  const plans = getElectricalImportPlans(parsed.data)
  const placementTargets = new Set<string>()
  plans.forEach((plan, planIndex) => {
    const planPath = parsed.data.plans ? `plans.${planIndex}` : 'plan'
    const wallRefs = new Set<string>()
    plan.floor.walls.forEach((wall, index) => {
      if (wallRefs.has(wall.ref)) {
        diagnostics.push({
          severity: 'error',
          path: `${planPath}.floor.walls.${index}.ref`,
          message: `Duplicate wall ref "${wall.ref}".`,
        })
      }
      wallRefs.add(wall.ref)
    })
    ;(['doors', 'windows'] as const).forEach((collection) => {
      plan.floor[collection].forEach((opening, index) => {
        if (!wallRefs.has(opening.wallRef)) {
          diagnostics.push({
            severity: 'error',
            path: `${planPath}.floor.${collection}.${index}.wallRef`,
            message: `Unknown wall ref "${opening.wallRef}".`,
          })
        }
      })
    })
    plan.floor.placements.forEach(({ target }, index) => {
      const key = `${target.circuitCode}/${target.branch}/${target.endpoint}/${target.instance ?? 1}`
      if (placementTargets.has(key)) {
        diagnostics.push({
          severity: 'error',
          path: `${planPath}.floor.placements.${index}.target`,
          message: `Duplicate plan placement target "${key}".`,
        })
      }
      placementTargets.add(key)
    })
  })
  parsed.data.panel.groups.forEach((group, groupIndex) => {
    addRef(group.ref, `panel.groups.${groupIndex}.ref`)
    if (group.protection.type !== 'RCD' && group.protection.type !== 'RCBO') {
      diagnostics.push({
        severity: 'warning',
        path: `panel.groups.${groupIndex}.protection.type`,
        message: 'Groups normally use an RCD or RCBO; the compiler will preserve this device.',
      })
    }
    group.circuits.forEach((circuit, circuitIndex) => {
      const circuitPath = `panel.groups.${groupIndex}.circuits.${circuitIndex}`
      validateCircuit(circuit, circuitPath)
    })
  })
  parsed.data.panel.circuits.forEach((circuit, circuitIndex) => {
    const circuitPath = `panel.circuits.${circuitIndex}`
    validateCircuit(circuit, circuitPath)
  })

  const errors = diagnostics.filter(({ severity }) => severity === 'error')
  return errors.length
    ? { success: false, diagnostics }
    : { success: true, document: parsed.data, diagnostics }
}

function validateSupplySystem(
  system: ElectricalImportSupplySystem,
  voltageSystem: string | null,
  addRef: (ref: string, path: string) => void,
  diagnostics: ElectricalImportDiagnostic[]
): void {
  const base = 'installation.supply.system'
  const error = (path: string, message: string) => {
    diagnostics.push({ severity: 'error', path: `${base}.${path}`, message })
  }
  if (voltageSystem !== '1N~' && voltageSystem !== '3N~') {
    diagnostics.push({
      severity: 'error',
      path: 'installation.voltageSystem',
      message: 'A semantic supply system requires an explicit 1N~ or 3N~ installation.',
    })
  }
  if (system.inverter.unitCount === 3 && voltageSystem !== '3N~') {
    error(
      'inverter.unitCount',
      'Three inverter units require a 3N~ installation, one unit per phase.'
    )
  }
  if (system.topology === 'manual_changeover') {
    if (!system.changeover)
      error(
        'changeover',
        'A manual changeover requires its explicit ref, poles, and neutralTreatment: switched.'
      )
    else if (
      (voltageSystem === '1N~' && system.changeover.poles !== '2P') ||
      (voltageSystem === '3N~' && system.changeover.poles !== '4P')
    ) {
      error(
        'changeover.poles',
        'The manual changeover must switch 2 poles for 1N~ or 4 poles for 3N~.'
      )
    }
  } else if (system.changeover)
    error('changeover', 'A direct backup topology cannot include an external changeover.')
  if (!system.gridInputConnected && system.acProtections?.grid) {
    error(
      'acProtections.grid',
      'Grid-input protection cannot be supplied when the inverter grid input is disconnected.'
    )
  }
  if (!system.gridInputConnected && system.topology === 'manual_changeover') {
    diagnostics.push({
      severity: 'warning',
      path: `${base}.gridInputConnected`,
      message:
        'The inverter grid input is disconnected; the manual changeover still retains its utility bypass.',
    })
  }
  for (const [role, protection] of Object.entries(system.acProtections ?? {})) {
    if (!protection?.poles) continue
    const supportedPoles = voltageSystem === '1N~' ? ['1P+N', '2P'] : ['3P+N', '4P']
    if (!supportedPoles.includes(protection.poles))
      error(
        `acProtections.${role}.poles`,
        'AC protection on the common supply path must match the installation phase and neutral configuration.'
      )
  }
  if (!system.dcBus && (system.branches.length > 1 || system.inverter.unitCount === 3)) {
    error(
      'dcBus',
      'Multiple source branches or three inverter units require an explicit shared DC bus.'
    )
  }
  addRef(system.ref, `${base}.ref`)
  addRef(system.inverter.ref, `${base}.inverter.ref`)
  if (system.changeover) addRef(system.changeover.ref, `${base}.changeover.ref`)
  if (system.dcBus) addRef(system.dcBus.ref, `${base}.dcBus.ref`)
  const knownVoltage =
    system.dcBus?.voltageV ??
    system.branches.find(({ source }) => source.voltageV !== undefined)?.source.voltageV
  system.branches.forEach((branch, index) => {
    const path = `branches.${index}`
    addRef(branch.ref, `${base}.${path}.ref`)
    addRef(branch.source.ref, `${base}.${path}.source.ref`)
    if (
      knownVoltage !== undefined &&
      branch.source.voltageV !== undefined &&
      Math.abs(branch.source.voltageV - knownVoltage) > 0.001
    ) {
      error(
        `${path}.source.voltageV`,
        'Sources connected to the same DC bus must have compatible nominal voltages; separate converter inputs are not represented by this format.'
      )
    }
    const protection = branch.protection
    if (
      protection &&
      (protection.type === 'RCD' ||
        protection.type === 'RCBO' ||
        protection.sensitivityMa != null ||
        protection.residualCurrentType != null)
    ) {
      error(
        `${path}.protection`,
        'Residual-current protection is not supported on these DC source branches.'
      )
    }
    if (protection?.poles && protection.poles !== '1P' && protection.poles !== '2P') {
      error(
        `${path}.protection.poles`,
        'A DC source branch accepts only 1P or 2P protection poles.'
      )
    }
  })
}

function validateEndpointModifiers(
  endpoint: {
    type: string
    symbol?: string | null
    quantity?: number | null
    waterproof?: boolean | null
  },
  path: string,
  diagnostics: ElectricalImportDiagnostic[]
): void {
  const supportsQuantity =
    endpoint.type === 'light_point' ||
    (endpoint.type === 'switch' &&
      (endpoint.symbol === 'switch_impulse' ||
        endpoint.symbol === 'smoke_detector' ||
        endpoint.symbol === 'motion_detector')) ||
    ['buzzer', 'bell', 'horn', 'siren'].includes(endpoint.symbol ?? '')
  if (endpoint.quantity != null && !supportsQuantity) {
    diagnostics.push({
      severity: 'error',
      path: `${path}.quantity`,
      message: 'This endpoint symbol does not support a quantity multiplier.',
    })
  }
  if (
    endpoint.waterproof === true &&
    endpoint.type !== 'socket' &&
    endpoint.type !== 'light_point'
  ) {
    diagnostics.push({
      severity: 'error',
      path: `${path}.waterproof`,
      message: 'The waterproof h modifier is supported only for sockets and light points.',
    })
  }
}

function validateCircuitEndpointRefs(
  circuit: {
    branches: Array<{ endpoints: Array<{ ref?: string; controls?: string[] }> }>
    endpoints: Array<{ ref?: string; controls?: string[] }>
  },
  path: string,
  diagnostics: ElectricalImportDiagnostic[]
): void {
  const entries = [
    ...circuit.branches.flatMap((branch, branchIndex) =>
      branch.endpoints.map((endpoint, endpointIndex) => ({
        endpoint,
        path: `${path}.branches.${branchIndex}.endpoints.${endpointIndex}`,
      }))
    ),
    ...circuit.endpoints.map((endpoint, endpointIndex) => ({
      endpoint,
      path: `${path}.endpoints.${endpointIndex}`,
    })),
  ]
  const endpointRefs = new Set<string>()
  entries.forEach(({ endpoint, path: endpointPath }) => {
    if (!endpoint.ref) return
    if (endpointRefs.has(endpoint.ref)) {
      diagnostics.push({
        severity: 'error',
        path: `${endpointPath}.ref`,
        message: `Duplicate endpoint ref "${endpoint.ref}" in this circuit.`,
      })
    }
    endpointRefs.add(endpoint.ref)
  })
  entries.forEach(({ endpoint, path: endpointPath }) => {
    endpoint.controls?.forEach((targetRef, targetIndex) => {
      if (endpointRefs.has(targetRef)) return
      diagnostics.push({
        severity: 'error',
        path: `${endpointPath}.controls.${targetIndex}`,
        message: `Unknown endpoint ref "${targetRef}" in this circuit.`,
      })
    })
  })
}

export function parseAndValidateElectricalImport(json: string): ElectricalImportValidationResult {
  try {
    return validateElectricalImport(JSON.parse(json))
  } catch (error) {
    return {
      success: false,
      diagnostics: [
        {
          severity: 'error',
          path: '$',
          message: error instanceof Error ? error.message : 'Invalid JSON.',
        },
      ],
    }
  }
}
