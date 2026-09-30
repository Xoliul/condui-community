import { getPanelBusSections, getProtectionBusSectionId, getCircuitBusSectionId } from '@/lib/panel/panelBusSections'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'
import {
  circuitConverterDeviceConnections,
  circuitConverterEndpointConnections,
} from '@/lib/wires/circuitWireIdentity'
import type { Circuit, Endpoint, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import type { SupplyAttachmentRef, SupplyNode } from '@/types/supplyAssembly'
import { validateOffGridSupplyAssembly } from '@/lib/supplyAssembly/validation'
import { stampTransitionWires } from './transitionWireRuns'
import { getJunctionPanelTerminal } from '@/lib/junctionPanel/grid'
import {
  assemblyOwnsPanelInput,
  getAssemblyReceivingPanelInputDevices,
  getSupplyNodePhysicalDeviceId,
  reachableSupplyNodes,
  resolveAssemblyPanelInput,
} from '@/lib/supplyAssembly/electricalTopology'
import { ELECTRICAL_STRUCTURE_INFERENCE_RULES as RULES } from './inferenceRules'
import type {
  ElectricalStructureDiagnostic,
  ElectricalStructureNode,
  ElectricalStructureNodeKind,
  ElectricalStructureRelationship,
  ElectricalStructureRelationshipKind,
  ElectricalStructureSnapshot,
  StructureBasis,
  StructureSourceReference,
} from './types'

const DATA_URL_LIMIT = 256

function safeClone(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    if (typeof value === 'string' && value.startsWith('data:') && value.length > DATA_URL_LIMIT) {
      return { summarizedDataUrl: true, length: value.length, prefix: value.slice(0, 64) }
    }
    return value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'undefined') return '[undefined]'
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => safeClone(item, seen))
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as object).sort()) {
    try {
      result[key] = safeClone((value as Record<string, unknown>)[key], seen)
    } catch {
      result[key] = '[unreadable]'
    }
  }
  return result
}

function stable(value: string): string {
  return encodeURIComponent(value || '[empty]')
}

function source(
  entityKind: string,
  entityId: string | undefined,
  container: string,
  field?: string
): StructureSourceReference {
  return { entityKind, entityId, container, ...(field ? { field } : {}) }
}

function inferred(rule: { id: string }): StructureBasis {
  return { knowledge: 'inferred', inferenceRuleId: rule.id }
}

export function buildElectricalStructureSnapshot(project: ProjectV2): ElectricalStructureSnapshot {
  const nodes: ElectricalStructureNode[] = []
  const relationships: ElectricalStructureRelationship[] = []
  const diagnostics: ElectricalStructureDiagnostic[] = []
  const nodeIds = new Set<string>()
  const canonicalIds = new Map<string, string[]>()
  const relationshipIdCounts = new Map<string, number>()
  let sourceRecordCount = 1

  const addDiagnostic = (diagnostic: ElectricalStructureDiagnostic) => diagnostics.push(diagnostic)
  const addNode = (node: ElectricalStructureNode): string => {
    let id = node.id
    if (nodeIds.has(id)) {
      let suffix = 2
      while (nodeIds.has(`${id}:conflict:${suffix}`)) suffix += 1
      const qualified = `${id}:conflict:${suffix}`
      addDiagnostic({
        code: 'DUPLICATE_CANONICAL_ID',
        severity: 'error',
        message: `Canonical records conflict on projected identity ${id}; retained as ${qualified}.`,
        source: node.source,
        relatedNodeIds: [id, qualified],
        remediation: 'Assign unique stable canonical IDs without merging either source record.',
      })
      id = qualified
      node = { ...node, id, knowledge: 'ambiguous', diagnosticCode: 'DUPLICATE_CANONICAL_ID' }
    }
    nodeIds.add(id)
    if (node.source.entityId) {
      const key = `${node.source.entityKind}:${node.source.entityId}`
      canonicalIds.set(key, [...(canonicalIds.get(key) ?? []), id])
    }
    nodes.push(node)
    return id
  }
  const resolve = (kind: string, canonicalId: string): string | undefined =>
    canonicalIds.get(`${kind}:${canonicalId}`)?.[0]
  const missing = (targetKind: string, targetId: string, src: StructureSourceReference): string => {
    const id = `missing:${stable(targetKind)}:${stable(targetId)}`
    if (!nodeIds.has(id))
      addNode({
        id,
        kind: 'missing-target',
        knowledge: 'missing',
        diagnosticCode: 'UNRESOLVED_REFERENCE',
        label: `Missing ${targetKind} ${targetId}`,
        source: src,
        sourceSummary: { targetKind, targetId },
      })
    addDiagnostic({
      code: 'UNRESOLVED_REFERENCE',
      severity: 'error',
      message: `Missing ${targetKind} target ${targetId}.`,
      source: src,
      relatedNodeIds: [id],
      remediation: 'Repair or remove the canonical reference.',
    })
    return id
  }
  const edge = (
    kind: ElectricalStructureRelationshipKind,
    from: string,
    to: string,
    src: StructureSourceReference,
    basis: StructureBasis = { knowledge: 'explicit' },
    properties?: Record<string, unknown>
  ) => {
    const baseId = `relationship:${stable(kind)}:${stable(from)}:${stable(to)}:${stable(src.entityKind)}:${stable(src.relationshipId ?? src.entityId ?? src.field ?? 'source')}`
    const occurrence = relationshipIdCounts.get(baseId) ?? 0
    relationshipIdCounts.set(baseId, occurrence + 1)
    relationships.push({
      id: occurrence ? `${baseId}:conflict:${occurrence + 1}` : baseId,
      kind,
      from,
      to,
      source: src,
      ...basis,
      ...(properties ? { properties: safeClone(properties) as Record<string, unknown> } : {}),
    })
  }
  const node = (
    kind: ElectricalStructureNodeKind,
    canonicalKind: string,
    id: string,
    container: string,
    record: unknown,
    extra: Partial<ElectricalStructureNode> = {}
  ) => {
    sourceRecordCount += 1
    return addNode({
      id: `${kind}:${stable(id)}`,
      kind,
      knowledge: 'explicit',
      source: source(canonicalKind, id, container),
      sourceSummary: safeClone(record),
      ...extra,
    })
  }

  const installation = project.disciplines.electrical?.installation
  const installationId = addNode({
    id: `installation:${stable(project.project.id)}`,
    kind: 'installation',
    label: project.project.name,
    knowledge: installation ? 'explicit' : 'missing',
    ...(installation ? {} : { diagnosticCode: 'MISSING_ELECTRICAL_DISCIPLINE' }),
    source: source('installation', project.project.id, 'disciplines.electrical.installation'),
    sourceSummary: safeClone(installation ?? null),
  })
  if (!installation)
    addDiagnostic({
      code: 'MISSING_ELECTRICAL_DISCIPLINE',
      severity: 'warning',
      message: 'The project has no canonical electrical discipline.',
      source: source('installation', project.project.id, 'disciplines.electrical'),
    })

  const circuitsById = new Map<string, string[]>()
  const incomingTrunkNodesByPanelId = new Map<string, string[]>()
  const pendingControls: Array<{
    from: string
    targetId: string
    src: StructureSourceReference
  }> = []
  const junctionMembers = new Map<
    string,
    Array<{ nodeId: string; symbol: string; source: StructureSourceReference }>
  >()
  const junctionPanelTerminalCounts = new Map<string, number>()
  const rememberCircuit = (id: string, nodeId: string) =>
    circuitsById.set(id, [...(circuitsById.get(id) ?? []), nodeId])
  const collectJunction = (
    identity: string | undefined,
    symbol: string | undefined,
    nodeId: string,
    src: StructureSourceReference
  ) => {
    const normalized = identity?.trim().toLocaleUpperCase('en-US')
    if (!normalized) return
    junctionMembers.set(normalized, [
      ...(junctionMembers.get(normalized) ?? []),
      { nodeId, symbol: symbol ?? 'unknown', source: src },
    ])
  }
  const projectPlacement = (
    placement: { id: string },
    ownerId: string,
    container: string,
    panelId?: string,
    circuitId?: string
  ) => {
    const occurrenceId = node('occurrence', 'placement', placement.id, container, placement, {
      panelId,
      circuitId,
    })
    edge(
      'represents-occurrence-of',
      occurrenceId,
      ownerId,
      {
        ...source('placement', placement.id, container),
        inferenceRuleId: RULES.placementOccurrence.id,
      },
      inferred(RULES.placementOccurrence)
    )
  }
  const projectTrunk = (
    device: TrunkDevice,
    circuitNodeId: string | undefined,
    panelId: string,
    circuitId: string | undefined,
    container: string
  ) => {
    const deviceId = node('trunk-device', 'trunk-device', device.id, container, device, {
      label: device.label,
      ...(panelId ? { panelId } : {}),
      ...(circuitId ? { circuitId } : {}),
    })
    if (circuitNodeId)
      edge(
        'belongs-to-circuit',
        deviceId,
        circuitNodeId,
        {
          ...source('trunk-device', device.id, container),
          inferenceRuleId: RULES.circuitDeviceMembership.id,
        },
        inferred(RULES.circuitDeviceMembership)
      )
    for (const placement of device.placements ?? [])
      projectPlacement(placement, deviceId, `${container}.placements`, panelId, circuitId)
    collectJunction(
      device.junctionIdentity,
      device.symbol,
      deviceId,
      source('trunk-device', device.id, container, 'junctionIdentity')
    )
    if (device.type === 'junction_panel' || device.symbol === 'junction_panel') {
      const terminalGroup = (device.junctionIdentity ?? device.label ?? device.id)
        .trim()
        .toLocaleUpperCase('en-US')
      const terminalIndex = junctionPanelTerminalCounts.get(terminalGroup) ?? 0
      junctionPanelTerminalCounts.set(terminalGroup, terminalIndex + 1)
      const terminal = getJunctionPanelTerminal(device, terminalIndex)
      const terminalId = node(
        'junction-panel-terminal',
        'junction-panel-terminal',
        terminal.id,
        `${container}.junctionPanelTerminal`,
        terminal,
        { label: terminal.label, panelId, circuitId }
      )
      edge(
        'contains',
        deviceId,
        terminalId,
        source('trunk-device', device.id, container, 'junctionPanelTerminal')
      )
    }
    return deviceId
  }
  const projectEndpoint = (
    endpoint: Endpoint,
    panelId: string,
    circuitId: string,
    container: string
  ) => {
    const endpointId = node('endpoint', 'endpoint', endpoint.id, container, endpoint, {
      label: endpoint.label,
      panelId,
      circuitId,
    })
    if (endpoint.symbol === 'panel_distribution' && endpoint.panelId) {
      const representedPanel = resolve('panel', endpoint.panelId)
      edge(
        representedPanel ? 'represents-panel' : 'unresolved-reference',
        endpointId,
        representedPanel ??
          missing('panel', endpoint.panelId, source('endpoint', endpoint.id, container, 'panelId')),
        source('endpoint', endpoint.id, container, 'panelId')
      )
    }
    for (const placement of endpoint.placements ?? [])
      projectPlacement(placement, endpointId, `${container}.placements`, panelId, circuitId)
    collectJunction(
      endpoint.junctionIdentity,
      endpoint.symbol,
      endpointId,
      source('endpoint', endpoint.id, container, 'junctionIdentity')
    )
    for (const targetId of endpoint.controlledEndpointIds ?? []) {
      pendingControls.push({
        from: endpointId,
        targetId,
        src: source('endpoint', endpoint.id, container, 'controlledEndpointIds'),
      })
    }
    return endpointId
  }
  const pendingSubCircuits: Array<{
    from: string
    targetId: string
    src: StructureSourceReference
  }> = []
  const projectCircuit = (
    circuit: Circuit,
    panelNodeId: string,
    panelId: string,
    protectionNodeId: string | undefined,
    container: string,
    busSectionId: string,
    nestedCircuitIds: ReadonlySet<string>
  ) => {
    const circuitNodeId = node('circuit', 'circuit', circuit.id, container, circuit, {
      label: circuit.code,
      panelId,
      circuitId: circuit.id,
    })
    rememberCircuit(circuit.id, circuitNodeId)
    edge(
      'contains',
      panelNodeId,
      circuitNodeId,
      {
        ...source('circuit', circuit.id, container),
        inferenceRuleId: RULES.panelCircuitContainment.id,
      },
      inferred(RULES.panelCircuitContainment)
    )
    if (!protectionNodeId && (circuit.busSectionId || !nestedCircuitIds.has(circuit.id))) {
      const src = source('circuit', circuit.id, container,
        circuit.busSectionId ? 'busSectionId' : undefined)
      const busSectionNodeId =
        resolve('bus-section', `${panelId}:${busSectionId}`) ??
        missing('bus-section', `${panelId}:${busSectionId}`, src)
      edge(
        busSectionNodeId.startsWith('missing:') ? 'unresolved-reference' : 'feeds',
        busSectionNodeId,
        circuitNodeId,
        src,
        { knowledge: circuit.busSectionId ? 'explicit' : 'inferred' }
      )
    }
    if (protectionNodeId) {
      edge(
        'protects',
        protectionNodeId,
        circuitNodeId,
        {
          ...source('circuit', circuit.id, container),
          inferenceRuleId: RULES.protectionCircuitOwnership.id,
        },
        inferred(RULES.protectionCircuitOwnership)
      )
      edge(
        'protected-by',
        circuitNodeId,
        protectionNodeId,
        {
          ...source('circuit', circuit.id, container),
          inferenceRuleId: RULES.protectionCircuitOwnership.id,
        },
        inferred(RULES.protectionCircuitOwnership)
      )
      if (
        circuit.endpoints.length === 0 &&
        (circuit.trunkDevices?.length ?? 0) === 0 &&
        !circuit.branches?.some((branch) =>
          branch.endpointIds.length > 0 || (branch.branchDevices?.length ?? 0) > 0
        ) &&
        (circuit.subCircuitIds?.length ?? 0) === 0
      ) {
        edge(
          'ordered-before',
          protectionNodeId,
          circuitNodeId,
          source('circuit', circuit.id, container, 'endpoints'),
          { knowledge: 'explicit' },
          {
            wireAnchor: deriveWireAnchorKey({
              kind: 'circuit-section',
              circuitId: circuit.id,
              nodeRef: `open-end:${protectionNodeId}`,
              domain: circuit.dcBusSource ? 'DC' : 'AC',
            }),
            emptyCircuitWire: true,
            domain: circuit.dcBusSource ? 'DC' : 'AC',
          }
        )
      }
    }
    const endpointNodeIds = new Map(
      circuit.endpoints.map((endpoint, index) => [
        endpoint.id,
        projectEndpoint(endpoint, panelId, circuit.id, `${container}.endpoints[${index}]`),
      ])
    )
    const endpointsById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
    const converterEndpointConnections = circuitConverterEndpointConnections(circuit)
    const converterDeviceConnections = circuitConverterDeviceConnections(circuit)
    // Match one-wire's stable trunk order; IDs are not electrical positions.
    const trunks = [...(circuit.trunkDevices ?? [])].sort(
      (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
    )
    const allCircuitDevices = [
      ...trunks,
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
    ]
    const localDeviceIds = new Set(allCircuitDevices.map((device) => device.id))
    const hasLocalDcConnection = (device: TrunkDevice) => {
      const connection = converterDeviceConnections.get(device.id)
      return !!connection && localDeviceIds.has(connection.converterId)
    }
    const trunkNodeIdsByCanonicalId = new Map<string, string>()
    let priorTrunkNodeId: string | undefined
    const projectedTrunkNodeIds: string[] = []
    trunks.forEach((device, index) => {
      const current = projectTrunk(
        device,
        circuitNodeId,
        panelId,
        circuit.id,
        `${container}.trunkDevices[${index}]`
      )
      trunkNodeIdsByCanonicalId.set(device.id, current)
      projectedTrunkNodeIds.push(current)
      if (priorTrunkNodeId && !hasLocalDcConnection(device))
        edge(
          'ordered-before',
          priorTrunkNodeId,
          current,
          source('trunk-device', device.id, container, 'trunkPosition'),
          { knowledge: 'explicit' }
        )
      if (!hasLocalDcConnection(device)) priorTrunkNodeId = current
    })
    if (circuit.code === 'PANEL' && trunks.length)
      incomingTrunkNodesByPanelId.set(panelId, projectedTrunkNodeIds)

    const branchMemberIds = new Set<string>()
    for (const [branchIndex, branch] of (circuit.branches ?? []).entries()) {
      // A trunk device at position k follows branch k-1. Earlier taps bypass
      // it, just as they do in the one-wire drawing.
      const upstreamTrunk = trunks.filter((device) =>
        !hasLocalDcConnection(device) && (device.trunkPosition ?? 0) <= branchIndex).at(-1)
      // A rail has explicit fan-out ownership rather than feeding every tap.
      const branchSource = upstreamTrunk?.type === 'dc_bus'
        ? circuitNodeId
        : (upstreamTrunk ? trunkNodeIdsByCanonicalId.get(upstreamTrunk.id) : undefined) ?? circuitNodeId
      // A DC-rail branch is a fan-out from the rail, not another direct child
      // of the upstream protection in the visual structure graph. Keep circuit
      // ownership as a fact, but start the visible branch path at its bus.
      let previous = branch.dcBusId
        ? (trunkNodeIdsByCanonicalId.get(branch.dcBusId) ?? circuitNodeId)
        : branchSource
      let branchMembershipEmitted = false

      // The one-wire branch list contains a domotica parent and all of its
      // output children in one array for editing/order purposes. That array is
      // not a serial electrical path: each output slot fans out from the
      // parent, while children sharing one outputIndex are the actual chain.
      const domoticaChildrenByParent = new Map<string, Map<string, string[]>>()
      const branchEndpointIds = new Set(branch.endpointIds)
      for (const endpointId of branch.endpointIds) {
        const endpoint = endpointsById.get(endpointId)
        const childProps = endpoint?.domoticaChildProps
        if (!childProps || !branchEndpointIds.has(childProps.parentEndpointId)) continue
        const parent = endpointsById.get(childProps.parentEndpointId)
        if (!parent || parent.symbol !== 'domotica') continue
        const outputKey = `${childProps.outputGroup ?? 'endpoint'}:${childProps.outputIndex}`
        const childrenByOutput = domoticaChildrenByParent.get(parent.id) ?? new Map()
        childrenByOutput.set(outputKey, [...(childrenByOutput.get(outputKey) ?? []), endpointId])
        domoticaChildrenByParent.set(parent.id, childrenByOutput)
      }

      const domoticaChildParentIds = new Set(
        [...domoticaChildrenByParent.values()].flatMap((childrenByOutput) =>
          [...childrenByOutput.values()].flatMap((children) => children)
        )
      )
      for (const [deviceIndex, device] of (branch.branchDevices ?? []).entries()) {
        const deviceNodeId = projectTrunk(
          device,
          undefined,
          panelId,
          circuit.id,
          `${container}.branches[${branchIndex}].branchDevices[${deviceIndex}]`
        )
        trunkNodeIdsByCanonicalId.set(device.id, deviceNodeId)
        if (!branchMembershipEmitted) {
          edge(
            'belongs-to-circuit',
            deviceNodeId,
            circuitNodeId,
            source(
              'trunk-device',
              device.id,
              `${container}.branches[${branchIndex}].branchDevices[${deviceIndex}]`
            ),
            { knowledge: 'explicit' }
          )
          branchMembershipEmitted = true
        }
        if (previous !== circuitNodeId && !hasLocalDcConnection(device)) {
          edge(
            'ordered-before',
            previous,
            deviceNodeId,
            source(
              'trunk-device',
              device.id,
              `${container}.branches[${branchIndex}].branchDevices[${deviceIndex}]`,
              'trunkPosition'
            ),
            { knowledge: 'explicit' }
          )
        }
        if (!hasLocalDcConnection(device)) previous = deviceNodeId
      }
      for (const [endpointIndex, endpointCanonicalId] of branch.endpointIds.entries()) {
        const endpointNodeId = endpointNodeIds.get(endpointCanonicalId)
        const src = source(
          'branch',
          branch.id,
          `${container}.branches[${branchIndex}].endpointIds[${endpointIndex}]`,
          'endpointIds'
        )
        if (!endpointNodeId) {
          edge('unresolved-reference', previous, missing('endpoint', endpointCanonicalId, src), src)
          continue
        }
        branchMemberIds.add(endpointCanonicalId)
        const converterConnection = converterEndpointConnections.get(endpointCanonicalId)
        if (converterConnection && trunkNodeIdsByCanonicalId.has(converterConnection.converterId))
          continue

        // A child is represented through its Domotica output parent rather
        // than as the next item in the enclosing circuit chain. A nested
        // Domotica child can still own and emit another output subtree.
        if (!domoticaChildParentIds.has(endpointCanonicalId)) {
          if (!branchMembershipEmitted) {
            edge('belongs-to-circuit', endpointNodeId, circuitNodeId, src, {
              knowledge: 'explicit',
            })
            branchMembershipEmitted = true
          }
          if (previous !== circuitNodeId)
            edge('ordered-before', previous, endpointNodeId, src, { knowledge: 'explicit' })
          previous = endpointNodeId
        }

        const childrenByOutput = domoticaChildrenByParent.get(endpointCanonicalId)
        if (!childrenByOutput) continue
        for (const [outputKey, children] of [...childrenByOutput.entries()].sort(([a], [b]) =>
          a.localeCompare(b, 'en-US', { numeric: true })
        )) {
          const [outputGroup, outputIndexText] = outputKey.split(':')
          const outputIndex = Number(outputIndexText)
          const rootEndpointId = children[0]
          const rootEndpointNodeId = rootEndpointId
            ? endpointNodeIds.get(rootEndpointId)
            : undefined
          if (!rootEndpointId || !rootEndpointNodeId) continue
          const childRef = endpointsById.get(rootEndpointId)?.domoticaChildProps
          const branchSource = source(
            'endpoint',
            rootEndpointId,
            `${container}.endpoints`,
            'domoticaChildProps'
          )
          edge(
            'branches-to',
            endpointNodeId,
            rootEndpointNodeId,
            {
              ...branchSource,
              inferenceRuleId: RULES.domoticaOutputBranch.id,
            },
            inferred(RULES.domoticaOutputBranch),
            {
              outputGroup,
              outputIndex,
              ...(childRef?.parentEndpointId
                ? { parentEndpointId: childRef.parentEndpointId }
                : {}),
            }
          )
          let priorChildNodeId = rootEndpointNodeId
          for (const childEndpointId of children.slice(1)) {
            const childNodeId = endpointNodeIds.get(childEndpointId)
            if (!childNodeId) continue
            edge(
              'ordered-before',
              priorChildNodeId,
              childNodeId,
              source('endpoint', childEndpointId, `${container}.endpoints`, 'domoticaChildProps'),
              inferred(RULES.domoticaOutputBranch),
              { outputGroup, outputIndex, parentEndpointId: endpointCanonicalId }
            )
            priorChildNodeId = childNodeId
          }
        }
      }
    }
    // The one-wire's widened inverter outputs are independent DC paths. They
    // are not continuations of the circuit protection or of one another.
    const converterOutputOrder = new Map<string, number>()
    let endpointOrder = 0
    for (const branch of circuit.branches ?? [])
      for (const endpointId of branch.endpointIds)
        converterOutputOrder.set(endpointId, endpointOrder++)
    const dcGroups = new Map<string, {
      converterId: string
      connectionIndex: number
      devices: TrunkDevice[]
      endpoints: Endpoint[]
    }>()
    const addDcMember = (
      connection: { converterId: string; connectionIndex: number } | undefined,
      member: { device?: TrunkDevice; endpoint?: Endpoint }
    ) => {
      if (!connection || !trunkNodeIdsByCanonicalId.has(connection.converterId)) return
      const key = `${connection.converterId}:${connection.connectionIndex}`
      const group = dcGroups.get(key) ?? {
        converterId: connection.converterId,
        connectionIndex: connection.connectionIndex,
        devices: [],
        endpoints: [],
      }
      if (member.device) group.devices.push(member.device)
      if (member.endpoint) group.endpoints.push(member.endpoint)
      dcGroups.set(key, group)
    }
    for (const device of allCircuitDevices)
      addDcMember(converterDeviceConnections.get(device.id), { device })
    for (const endpoint of circuit.endpoints)
      addDcMember(converterEndpointConnections.get(endpoint.id), { endpoint })
    for (const group of [...dcGroups.values()].sort((a, b) =>
      a.converterId.localeCompare(b.converterId) || a.connectionIndex - b.connectionIndex)) {
      let previous = trunkNodeIdsByCanonicalId.get(group.converterId)!
      const devices = group.devices.sort((a, b) =>
        a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
      const hasBus = devices.some((device) => device.type === 'dc_bus')
      for (const device of devices) {
        const current = trunkNodeIdsByCanonicalId.get(device.id)
        if (!current) continue
        edge('ordered-before', previous, current,
          source('trunk-device', device.id, container,
            device.converterDcConnection ? 'converterDcConnection' : 'trunkDevices'),
          { knowledge: device.converterDcConnection ? 'explicit' : 'inferred' },
          { domain: 'DC', converterDcConnection: {
            converterId: group.converterId, connectionIndex: group.connectionIndex,
          }, ...(previous === trunkNodeIdsByCanonicalId.get(group.converterId)
            ? { fromPortId: `dc-${group.connectionIndex}` } : {}) })
        previous = current
      }
      if (hasBus) continue // Its own rail branches carry the endpoint paths.
      for (const endpoint of group.endpoints.sort((a, b) =>
        (converterOutputOrder.get(a.id) ?? circuit.endpoints.indexOf(a)) -
        (converterOutputOrder.get(b.id) ?? circuit.endpoints.indexOf(b)))) {
        const current = endpointNodeIds.get(endpoint.id)
        if (!current) continue
        edge('ordered-before', previous, current,
          source('endpoint', endpoint.id, container,
            endpoint.converterDcConnection ? 'converterDcConnection' : 'branches'),
          { knowledge: endpoint.converterDcConnection ? 'explicit' : 'inferred' },
          { domain: 'DC', converterDcConnection: {
            converterId: group.converterId, connectionIndex: group.connectionIndex,
          }, ...(previous === trunkNodeIdsByCanonicalId.get(group.converterId)
            ? { fromPortId: `dc-${group.connectionIndex}` } : {}) })
        previous = current
      }
    }
    circuit.endpoints.forEach((endpoint) => {
      if (branchMemberIds.has(endpoint.id)) return
      edge(
        'belongs-to-circuit',
        endpointNodeIds.get(endpoint.id)!,
        circuitNodeId,
        {
          ...source('endpoint', endpoint.id, container),
          inferenceRuleId: RULES.circuitDeviceMembership.id,
        },
        inferred(RULES.circuitDeviceMembership)
      )
    })
    // A secondary distribution point is an electrical junction, independent of
    // the panel containing it. Its incoming conductor is not one of its bus taps.
    if (circuit.subCircuitIds?.length) {
      const secondaryId = `secondary-bus:${circuit.id}`
      const secondaryBusNodeId = node(
        'bus-section',
        'bus-section',
        secondaryId,
        container,
        {},
        { label: secondaryId, panelId, circuitId: circuit.id }
      )
      edge(
        'ordered-before',
        priorTrunkNodeId ?? circuitNodeId,
        secondaryBusNodeId,
        source('circuit', circuit.id, container, 'subCircuitIds'),
        inferred(RULES.subCircuitLink)
      )
      for (const targetId of circuit.subCircuitIds)
        pendingSubCircuits.push({
          from: secondaryBusNodeId,
          targetId,
          src: source('circuit', circuit.id, container, 'subCircuitIds'),
        })
    }
  }

  const projectProtection = (
    protection: ProtectionDevice,
    panelNodeId: string,
    panel: Panel,
    container: string,
    nestedCircuitIds: ReadonlySet<string>
  ) => {
    const panelId = panel.id
    const protectionNodeId = node(
      'protection',
      'protection',
      protection.id,
      container,
      protection,
      { label: protection.label, panelId }
    )
    edge('contains', panelNodeId, protectionNodeId, source('protection', protection.id, container))
    if (protection.busSectionId ||
        !protection.circuits?.some((circuit) => nestedCircuitIds.has(circuit.id))) {
      const src = source('protection', protection.id, container,
        protection.busSectionId ? 'busSectionId' : undefined)
      const busSectionNodeId =
        resolve('bus-section', `${panelId}:${getProtectionBusSectionId(panel, protection)}`) ??
        missing('bus-section', `${panelId}:${getProtectionBusSectionId(panel, protection)}`, src)
      edge(
        busSectionNodeId.startsWith('missing:') ? 'unresolved-reference' : 'feeds',
        busSectionNodeId,
        protectionNodeId,
        src,
        { knowledge: protection.busSectionId ? 'explicit' : 'inferred' }
      )
    }
    const circuits = protection.circuits ?? []
    circuits.forEach((circuit, index) =>
      projectCircuit(
        circuit,
        panelNodeId,
        panelId,
        protectionNodeId,
        `${container}.circuits[${index}]`,
        getCircuitBusSectionId(panel, circuit, protection),
        nestedCircuitIds
      )
    )
    if (protection.subPanelId) {
      const target =
        resolve('panel', protection.subPanelId) ??
        missing(
          'panel',
          protection.subPanelId,
          source('protection', protection.id, container, 'subPanelId')
        )
      edge(
        target.startsWith('missing:') ? 'unresolved-reference' : 'panel-feed',
        protectionNodeId,
        target,
        source('protection', protection.id, container, 'subPanelId'),
        inferred(RULES.panelCircuitContainment)
      )
    }
  }
  const pendingPanels: Array<{ panel: Panel; parent?: string; container: string }> = []
  const registerPanel = (panel: Panel, parent: string | undefined, container: string) => {
    const panelNodeId = node('panel', 'panel', panel.id, container, panel, {
      label: panel.name,
      panelId: panel.id,
    })
    edge(
      'contains',
      parent ?? installationId,
      panelNodeId,
      source('panel', panel.id, container),
      parent ? inferred(RULES.panelCircuitContainment) : { knowledge: 'explicit' }
    )
    for (const section of getPanelBusSections(panel)) {
      const sectionId = node(
        'bus-section',
        'bus-section',
        `${panel.id}:${section.id}`,
        `${container}.busSections`,
        section,
        {
          label: section.label,
          panelId: panel.id,
          source: source('bus-section', section.id, `${container}.busSections`),
        }
      )
      canonicalIds.set(`bus-section:${panel.id}:${section.id}`, [sectionId])
      edge(
        'contains',
        panelNodeId,
        sectionId,
        source('bus-section', section.id, `${container}.busSections`)
      )
    }
    pendingPanels.push(
      ...panel.subPanels.map((child, index) => ({
        panel: child,
        parent: panelNodeId,
        container: `${container}.subPanels[${index}]`,
      }))
    )
    return panelNodeId
  }
  const roots = project.disciplines.electrical?.panels ?? []
  roots.forEach((panel, index) =>
    pendingPanels.push({ panel, container: `disciplines.electrical.panels[${index}]` })
  )
  const registered: Array<{ panel: Panel; nodeId: string; container: string }> = []
  while (pendingPanels.length) {
    const next = pendingPanels.shift()!
    registered.push({
      panel: next.panel,
      nodeId: registerPanel(next.panel, next.parent, next.container),
      container: next.container,
    })
  }
  for (const { panel, nodeId: panelNodeId, container } of registered) {
    const nestedCircuitIds = new Set([
      ...(panel.circuits ?? []),
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ].flatMap((circuit) => circuit.subCircuitIds ?? []))
    panel.protections.forEach((protection, index) =>
      projectProtection(protection, panelNodeId, panel, `${container}.protections[${index}]`, nestedCircuitIds)
    )
    panel.circuits.forEach((circuit, index) =>
      projectCircuit(circuit, panelNodeId, panel.id, undefined, `${container}.circuits[${index}]`, getCircuitBusSectionId(panel, circuit), nestedCircuitIds)
    )
  }
  for (const pending of pendingSubCircuits) {
    const matches = circuitsById.get(pending.targetId) ?? []
    const target = matches[0] ?? missing('circuit', pending.targetId, pending.src)
    edge(
      target.startsWith('missing:') ? 'unresolved-reference' : 'branches-to',
      pending.from,
      target,
      { ...pending.src, inferenceRuleId: RULES.subCircuitLink.id },
      inferred(RULES.subCircuitLink)
    )
    if (matches.length > 1)
      addDiagnostic({
        code: 'AMBIGUOUS_CIRCUIT_REFERENCE',
        severity: 'error',
        message: `Circuit reference ${pending.targetId} resolves to multiple records.`,
        source: pending.src,
        relatedNodeIds: matches,
      })
  }
  for (const pending of pendingControls) {
    const target =
      resolve('endpoint', pending.targetId) ?? missing('endpoint', pending.targetId, pending.src)
    edge(
      target.startsWith('missing:') ? 'unresolved-reference' : 'controls',
      pending.from,
      target,
      pending.src
    )
  }

  const supplyAssemblies = project.disciplines.electrical?.supplyAssemblies ?? []
  const physicalSupplyDeviceId = getSupplyNodePhysicalDeviceId
  const assemblyDeviceIds = new Set(
    supplyAssemblies.flatMap((assembly) =>
      assembly.nodes.flatMap((supplyNode) => {
        const deviceId = physicalSupplyDeviceId(supplyNode)
        return deviceId ? [deviceId] : []
      })
    )
  )
  const ownsInput = (panelId: string, busSectionId?: string) => {
    const panel = registered.find(({ panel }) => panel.id === panelId)?.panel
    return panel ? assemblyOwnsPanelInput(project, panel, busSectionId) : false
  }
  const rootFeedUpstreamByPanelId = new Map<string, string>()
  const sharedAssemblyUpstreamById = new Map<string, string>()
  let sharedFeedTailNodeId: string | undefined

  if (installation) {
    const supplyContainer = 'disciplines.electrical.installation.mainSupply'
    const supplySourceId = node(
      'supply-source',
      'main-supply',
      project.project.id,
      supplyContainer,
      { ...installation.mainSupply, symbol: 'mains' },
      { label: 'Supply' }
    )
    edge(
      'contains',
      installationId,
      supplySourceId,
      source('main-supply', project.project.id, supplyContainer)
    )
    let priorSupplyNodeId = supplySourceId
    const sharedDevices =
      installation.feedTopology?.sharedFeed.trunkDevices ??
      installation.mainSupply.supplyTrunkDevices ??
      []
    const sharedContainer = installation.feedTopology
      ? 'disciplines.electrical.installation.feedTopology.sharedFeed.trunkDevices'
      : `${supplyContainer}.supplyTrunkDevices`
    for (const [index, device] of [...sharedDevices]
      .sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
      .entries()) {
      const current = projectTrunk(device, undefined, '', undefined, `${sharedContainer}[${index}]`)
      if (assemblyDeviceIds.has(device.id)) {
        for (const assembly of supplyAssemblies) {
          if (
            !sharedAssemblyUpstreamById.has(assembly.id) &&
            assembly.nodes.some((supplyNode) => physicalSupplyDeviceId(supplyNode) === device.id)
          ) {
            sharedAssemblyUpstreamById.set(assembly.id, priorSupplyNodeId)
          }
        }
        priorSupplyNodeId = current
        continue
      }
      edge(
        'ordered-before',
        priorSupplyNodeId,
        current,
        source('trunk-device', device.id, sharedContainer, 'trunkPosition')
      )
      priorSupplyNodeId = current
    }
    sharedFeedTailNodeId = priorSupplyNodeId
    const canonicalRootFeeds = installation.feedTopology?.rootFeeds ?? []
    const fallbackPanelIds = registered
      .filter(({ panel }) => panel.isMain)
      .map(({ panel }) => panel.id)
    const rootFeeds = canonicalRootFeeds.length
      ? canonicalRootFeeds
      : fallbackPanelIds.map((panelId) => ({ panelId, trunkDevices: [] as TrunkDevice[] }))
    const supplyTargets = rootFeeds.map((feed) => feed.panelId)
    for (const [feedIndex, feed] of [...rootFeeds]
      .sort((a, b) => a.panelId.localeCompare(b.panelId))
      .entries()) {
      const panelId = feed.panelId
      const receivingPaths = supplyAssemblies.flatMap((assembly) =>
        assembly.loadHandoffs.flatMap((handoff) =>
          resolveAssemblyPanelInput(project, handoff.target)?.panelId === panelId
            ? [{ assembly, handoff, devices: getAssemblyReceivingPanelInputDevices(project, assembly, handoff.target)
                .filter((device) => (feed.trunkDevices ?? []).some((candidate) => candidate.id === device.id)) }]
            : []
        )
      ).filter((path) => path.devices.length > 0)
      const receivingDevices = [...new Map(receivingPaths.flatMap((path) =>
        path.devices.map((device) => [device.id, device] as const)
      )).values()].sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
      const receivingPath = receivingPaths[0]
      const receivingIds = new Set(receivingDevices.map((device) => device.id))
      const receivingIsChangeoverLoad = receivingPath?.handoff.target.kind === 'panel-bus-input' &&
        receivingPath.assembly.connections.some((connection) =>
          connection.domain === 'AC' && connection.pathRole === 'load-ac' &&
          connection.endpoints[1].nodeId === receivingPath.handoff.handoffNodeId)
      const receivingChangeoverId = receivingIsChangeoverLoad
        ? receivingPath.assembly.nodes.find((candidate) =>
            candidate.kind === 'changeover-switch'
          )?.deviceId
        : undefined
      const panelSideReceivingDeviceId = receivingDevices.at(-1)?.id
      const receivingBusSectionId = receivingPath
        ? resolveAssemblyPanelInput(project, receivingPath.handoff.target)?.busSectionId
        : undefined
      const changeoverLoadAnchor = (first: string, second: string) =>
        receivingChangeoverId
          ? deriveWireAnchorKey({
              kind: 'feed-run',
              feedPathId: 'id' in feed ? feed.id : panelId,
              runKey: `supply:${panelId}:changeover-load:${[first, second].sort().join('<>')}`,
            })
          : undefined
      let priorRootNodeId = priorSupplyNodeId
      let serialTailNodeId = priorSupplyNodeId
      let assemblyUpstreamNodeId: string | undefined
      const directConverterBranch =
        (feed.trunkDevices ?? []).some((device) => device.supplyPath === 'converter-branch') &&
        !(feed.trunkDevices ?? []).some((device) => device.symbol === 'source_changeover')
      const rootContainer = `disciplines.electrical.installation.feedTopology.rootFeeds[${feedIndex}]`
      for (const [deviceIndex, device] of [...(feed.trunkDevices ?? [])]
        .sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
        .entries()) {
        const current = projectTrunk(
          device,
          undefined,
          panelId,
          undefined,
          `${rootContainer}.trunkDevices[${deviceIndex}]`
        )
        if (receivingIds.has(device.id)) continue
        if (assemblyDeviceIds.has(device.id)) {
          assemblyUpstreamNodeId ??= serialTailNodeId
          // Supply-assembly devices are projected through their explicit
          // assembly connections. Still advance the root-feed cursor so a
          // serial device that follows the assembly attaches after the
          // assembly's physical tail instead of back at its upstream
          // protection.
          if (!directConverterBranch) serialTailNodeId = current
          continue
        }
        edge(
          'ordered-before',
          serialTailNodeId,
          current,
          source('trunk-device', device.id, rootContainer, 'trunkPosition')
        )
        serialTailNodeId = current
        priorRootNodeId = current
      }
      for (let index = 1; index < receivingDevices.length; index++) {
        const upstream = receivingDevices[index - 1]!
        const downstream = receivingDevices[index]!
        const from = resolve('trunk-device', upstream.id)
        const to = resolve('trunk-device', downstream.id)
        if (from && to)
          edge(
            'ordered-before', from, to,
            source('trunk-device', downstream.id, rootContainer, 'trunkPosition'),
            { knowledge: 'explicit' },
            changeoverLoadAnchor(`device:${upstream.id}`, `device:${downstream.id}`)
              ? { wireAnchor: changeoverLoadAnchor(`device:${upstream.id}`, `device:${downstream.id}`) }
              : undefined
          )
      }
      if (panelSideReceivingDeviceId)
        priorRootNodeId = resolve('trunk-device', panelSideReceivingDeviceId) ?? priorRootNodeId
      const openChangeover = (feed.trunkDevices ?? []).find((device) =>
        device.symbol === 'source_changeover' &&
        supplyAssemblies.some((assembly) =>
          assembly.nodes.some((candidate) => candidate.id === device.id) &&
          !assembly.nodes.some((candidate) => candidate.kind === 'inverter-unit')
        )
      )
      if (openChangeover) {
        const backupDevices = (feed.trunkDevices ?? [])
          .filter((device) => device.supplyPath === 'backup-output')
          .sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
        const lastDeviceId = backupDevices.at(-1)?.id ?? openChangeover.id
        const lastNodeId = resolve('trunk-device', lastDeviceId)
        if (lastNodeId) {
          const openNodeId = addNode({
            id: `supply-node:open-backup:${stable(openChangeover.id)}`,
            kind: 'supply-node',
            knowledge: 'inferred',
            label: '○',
            panelId,
            source: source('open-backup-terminal', openChangeover.id, rootContainer),
            sourceSummary: { symbol: 'terminal_strip' },
          })
          edge(
            'ordered-before',
            lastNodeId,
            openNodeId,
            source('open-backup-terminal', openChangeover.id, rootContainer),
            { knowledge: 'inferred' },
            {
              wireAnchor: deriveWireAnchorKey({
                kind: 'feed-run',
                feedPathId: 'id' in feed ? feed.id : panelId,
                runKey: `supply:${panelId}:open-backup:device:${lastDeviceId}<>terminal:${openChangeover.id}`,
              }),
            }
          )
        }
      }
      if (assemblyUpstreamNodeId || !rootFeedUpstreamByPanelId.has(panelId))
        rootFeedUpstreamByPanelId.set(panelId, assemblyUpstreamNodeId ?? priorRootNodeId)
      const busSectionId = receivingBusSectionId ?? ('busSectionId' in feed ? feed.busSectionId : undefined)
      const rootTargetSource = source(
        'root-feed',
        'id' in feed ? feed.id : panelId,
        rootContainer,
        busSectionId ? 'busSectionId' : 'panelId'
      )
      const target = busSectionId
        ? (resolve('bus-section', `${panelId}:${busSectionId}`) ??
          missing('bus-section', `${panelId}:${busSectionId}`, rootTargetSource))
        : (resolve('panel', panelId) ?? missing('panel', panelId, rootTargetSource))
      if (panelSideReceivingDeviceId || !ownsInput(panelId, busSectionId))
        edge(
          target.startsWith('missing:') ? 'unresolved-reference' : 'panel-feed',
          priorRootNodeId,
          target,
          rootTargetSource,
          { knowledge: 'explicit' },
          panelSideReceivingDeviceId && busSectionId && receivingChangeoverId
            ? {
                wireAnchor: changeoverLoadAnchor(
                  `backup-bus:${busSectionId}`,
                  `device:${panelSideReceivingDeviceId}`
                ),
              }
            : undefined
        )
    }

    if (installation.hasGround !== false) {
      const groundContainer = 'disciplines.electrical.installation.groundTrunkDevices'
      const groundSourceId = node(
        'ground-source',
        'ground-source',
        project.project.id,
        groundContainer,
        { symbol: 'earthing', hasGround: installation.hasGround ?? true },
        { label: 'Earthing' }
      )
      edge(
        'contains',
        installationId,
        groundSourceId,
        source('ground-source', project.project.id, groundContainer)
      )
      let priorGroundNodeId = groundSourceId
      for (const [index, device] of [...(installation.groundTrunkDevices ?? [])]
        .sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
        .entries()) {
        const current = projectTrunk(
          device,
          undefined,
          '',
          undefined,
          `${groundContainer}[${index}]`
        )
        edge(
          'ordered-before',
          priorGroundNodeId,
          current,
          source('trunk-device', device.id, groundContainer, 'trunkPosition')
        )
        priorGroundNodeId = current
      }
      for (const panelId of [...new Set(supplyTargets)].sort()) {
        const target =
          resolve('panel', panelId) ??
          missing('panel', panelId, source('ground-source', project.project.id, groundContainer))
        edge(
          target.startsWith('missing:') ? 'unresolved-reference' : 'grounds',
          priorGroundNodeId,
          target,
          source('ground-source', project.project.id, groundContainer)
        )
      }
      for (const [index, placement] of (installation.earthingPlacements ?? []).entries())
        projectPlacement(
          placement,
          groundSourceId,
          `disciplines.electrical.installation.earthingPlacements[${index}]`
        )
    }

    for (const { panel, nodeId: panelNodeId, container: panelContainer } of registered) {
      if (panel.isMain !== false || panel.hasGround !== true) continue
      const groundContainer = `${panelContainer}.groundTrunkDevices`
      const groundSourceId = node(
        'ground-source',
        `panel-ground-${panel.id}`,
        panel.id,
        groundContainer,
        { symbol: 'earthing', hasGround: true },
        { label: 'Earthing', panelId: panel.id }
      )
      edge(
        'contains',
        panelNodeId,
        groundSourceId,
        source('ground-source', panel.id, groundContainer)
      )
      let priorGroundNodeId = groundSourceId
      for (const [index, device] of [...(panel.groundTrunkDevices ?? [])]
        .sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
        .entries()) {
        const current = projectTrunk(
          device,
          undefined,
          panel.id,
          undefined,
          `${groundContainer}[${index}]`
        )
        edge(
          'ordered-before',
          priorGroundNodeId,
          current,
          source('trunk-device', device.id, groundContainer, 'trunkPosition')
        )
        priorGroundNodeId = current
      }
      edge(
        'grounds',
        priorGroundNodeId,
        panelNodeId,
        source('ground-source', panel.id, groundContainer)
      )
    }
  }

  for (const [identity, members] of [...junctionMembers].sort(([a], [b]) => a.localeCompare(b))) {
    const symbols = [...new Set(members.map((member) => member.symbol))].sort()
    const ambiguous = symbols.length > 1
    const groupId = addNode({
      id: `junction-identity:${stable(symbols.join('+'))}:${stable(identity)}`,
      kind: 'junction-identity',
      label: identity,
      knowledge: ambiguous ? 'ambiguous' : 'inferred',
      inferenceRuleId: RULES.junctionIdentityGrouping.id,
      ...(ambiguous ? { diagnosticCode: 'AMBIGUOUS_JUNCTION_IDENTITY' } : {}),
      source: {
        entityKind: 'junction-identity',
        entityId: identity,
        container: 'disciplines.electrical',
        inferenceRuleId: RULES.junctionIdentityGrouping.id,
        relatedSourceIds: members.map(({ nodeId }) => nodeId),
      },
      sourceSummary: { normalizedIdentity: identity, symbols },
    })
    members.forEach((member) =>
      edge(
        'junction-membership',
        member.nodeId,
        groupId,
        { ...member.source, inferenceRuleId: RULES.junctionIdentityGrouping.id },
        ambiguous
          ? {
              knowledge: 'ambiguous',
              inferenceRuleId: RULES.junctionIdentityGrouping.id,
              diagnosticCode: 'AMBIGUOUS_JUNCTION_IDENTITY',
            }
          : inferred(RULES.junctionIdentityGrouping)
      )
    )
    if (ambiguous)
      addDiagnostic({
        code: 'AMBIGUOUS_JUNCTION_IDENTITY',
        severity: 'warning',
        message: `Junction identity ${identity} is shared by incompatible symbols: ${symbols.join(', ')}.`,
        source: members[0]!.source,
        relatedNodeIds: [groupId, ...members.map(({ nodeId }) => nodeId)],
        remediation: 'Use one supported junction symbol kind per physical identity.',
      })
  }

  const resolveAttachment = (
    attachment: SupplyAttachmentRef,
    src: StructureSourceReference
  ): string => {
    if (attachment.kind === 'root-feed') {
      const input = resolveAssemblyPanelInput(project, attachment)
      if (!input) return missing('root-feed', attachment.rootFeedId, src)
      if (input.busSectionId)
        return (
          resolve('bus-section', `${input.panelId}:${input.busSectionId}`) ??
          missing('bus-section', `${input.panelId}:${input.busSectionId}`, src)
        )
      return resolve('panel', input.panelId) ?? missing('panel', input.panelId, src)
    }
    if (attachment.kind === 'panel-bus-input')
      return (
        resolve('bus-section', `${attachment.panelId}:${attachment.busSectionId}`) ??
        missing('bus-section', `${attachment.panelId}:${attachment.busSectionId}`, src)
      )
    if (attachment.kind === 'panel-input')
      return resolve('panel', attachment.panelId) ?? missing('panel', attachment.panelId, src)
    if (attachment.kind === 'circuit-input')
      return (
        resolve('circuit', attachment.circuitId) ?? missing('circuit', attachment.circuitId, src)
      )
    return installationId
  }
  for (const [index, assembly] of supplyAssemblies.entries()) {
    const container = `disciplines.electrical.supplyAssemblies[${index}]`
    const assemblyId = node('supply-assembly', 'supply-assembly', assembly.id, container, assembly)
    edge('contains', installationId, assemblyId, source('supply-assembly', assembly.id, container))
    const supplyNodes = new Map<string, string>()
    assembly.nodes.forEach((supplyNode: SupplyNode, nodeIndex) => {
      const supplyNodeId = node(
        'supply-node',
        'supply-node',
        `${assembly.id}:${supplyNode.id}`,
        `${container}.nodes[${nodeIndex}]`,
        supplyNode,
        { label: supplyNode.label }
      )
      supplyNodes.set(supplyNode.id, supplyNodeId)
      edge('contains', assemblyId, supplyNodeId, source('supply-node', supplyNode.id, container))
      const deviceId = physicalSupplyDeviceId(supplyNode)
      if (deviceId) {
        const physicalDeviceId = resolve('trunk-device', deviceId)
        if (physicalDeviceId)
          edge(
            'shares-physical-identity-with',
            supplyNodeId,
            physicalDeviceId,
            source('supply-node', supplyNode.id, container, supplyNode.deviceId ? 'deviceId' : 'id')
          )
      }
      const enclosure = supplyNode.mounting?.enclosure
      if (enclosure?.kind === 'panel')
        edge(
          'mounted-in',
          supplyNodeId,
          resolve('panel', enclosure.panelId) ??
            missing(
              'panel',
              enclosure.panelId,
              source('supply-node', supplyNode.id, container, 'mounting')
            ),
          source('supply-node', supplyNode.id, container, 'mounting')
        )
      if (enclosure?.kind === 'auxiliary')
        edge(
          'mounted-in',
          supplyNodeId,
          resolve('auxiliary-enclosure', enclosure.enclosureId) ??
            missing(
              'auxiliary-enclosure',
              enclosure.enclosureId,
              source('supply-node', supplyNode.id, container, 'mounting')
            ),
          source('supply-node', supplyNode.id, container, 'mounting')
        )
    })
    const targetPanelId = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
    if (targetPanelId || assembly.incomingAttachment.kind === 'shared-feed') {
      const upstream =
        sharedAssemblyUpstreamById.get(assembly.id) ??
        (targetPanelId
          ? rootFeedUpstreamByPanelId.get(targetPanelId.panelId)
          : sharedFeedTailNodeId)
      const utility = assembly.nodes.find((supplyNode) => supplyNode.kind === 'utility-source')
      const utilityNodeId = utility ? supplyNodes.get(utility.id) : undefined
      if (upstream && utility && utilityNodeId)
        edge(
          'ordered-before',
          upstream,
          utilityNodeId,
          source('supply-assembly', assembly.id, container, 'incomingAttachment'),
          { knowledge: 'explicit' },
          { target: safeClone(assembly.incomingAttachment) }
        )
    }
    assembly.connections.forEach((connection, connectionIndex) => {
      const src = source(
        'supply-connection',
        connection.id,
        `${container}.connections[${connectionIndex}]`,
        'endpoints'
      )
      const from =
        supplyNodes.get(connection.endpoints[0].nodeId) ??
        missing('supply-node', `${assembly.id}:${connection.endpoints[0].nodeId}`, src)
      const to =
        supplyNodes.get(connection.endpoints[1].nodeId) ??
        missing('supply-node', `${assembly.id}:${connection.endpoints[1].nodeId}`, src)
      const receivingHandoff = connection.pathRole === 'load-ac'
        ? assembly.loadHandoffs.find((handoff) =>
            handoff.handoffNodeId === connection.endpoints[1].nodeId &&
            handoff.target.kind === 'panel-bus-input'
          )
        : undefined
      const receivingDevice = receivingHandoff
        ? getAssemblyReceivingPanelInputDevices(project, assembly, receivingHandoff.target)[0]
        : undefined
      const receivingPanelId = receivingHandoff
        ? resolveAssemblyPanelInput(project, receivingHandoff.target)?.panelId
        : undefined
      const receivingFeed = installation?.feedTopology?.rootFeeds.find((feed) =>
        feed.panelId === receivingPanelId &&
        feed.trunkDevices?.some((device) => device.id === receivingDevice?.id)
      )
      const changeover = assembly.nodes.find((candidate) => candidate.kind === 'changeover-switch')
      const loadWireAnchor = receivingDevice && receivingPanelId && receivingFeed && changeover
        ? deriveWireAnchorKey({
            kind: 'feed-run',
            feedPathId: receivingFeed.id,
            runKey: `supply:${receivingPanelId}:changeover-load:${[
              `changeover:${changeover.deviceId ?? changeover.id}:load`,
              `device:${receivingDevice.id}`,
            ].sort().join('<>')}`,
          })
        : undefined
      edge(
        'supply-assembly-connection',
        from,
        to,
        { ...src, relationshipId: connection.id },
        { knowledge: 'explicit' },
        {
          wireAnchor: loadWireAnchor ?? deriveWireAnchorKey({ kind: 'supply-connection', assemblyId: assembly.id, connectionId: connection.id }),
          domain: connection.domain,
          conductors: connection.conductors,
          pathRole: connection.pathRole,
          fromPortId: connection.endpoints[0].portId,
          toPortId: connection.endpoints[1].portId,
        }
      )
    })
    const reachable = reachableSupplyNodes(assembly)
    const outputIssues = validateOffGridSupplyAssembly(assembly).issues.filter(
      (issue) =>
        issue.code === 'invalid-handoff-source' || issue.code === 'unresolved-common-output'
    )
    assembly.loadHandoffs.forEach((handoff, handoffIndex) => {
      const src = source(
        'supply-handoff',
        handoff.id,
        `${container}.loadHandoffs[${handoffIndex}]`,
        'target'
      )
      const from =
        supplyNodes.get(handoff.handoffNodeId) ??
        missing('supply-node', `${assembly.id}:${handoff.handoffNodeId}`, src)
      const receivingDevices = getAssemblyReceivingPanelInputDevices(
        project,
        assembly,
        handoff.target
      )
      const receivingChangeover = assembly.nodes.find((candidate) =>
        candidate.kind === 'changeover-switch'
      )
      const receivingDevice = receivingDevices[0]
      const receivingInput = resolveAssemblyPanelInput(project, handoff.target)
      const receivingFeed = installation?.feedTopology?.rootFeeds.find((feed) =>
        feed.panelId === receivingInput?.panelId &&
        feed.trunkDevices?.some((device) => device.id === receivingDevice?.id)
      )
      const isChangeoverLoadHandoff = assembly.connections.some((connection) =>
        connection.domain === 'AC' && connection.pathRole === 'load-ac' &&
        connection.endpoints[1].nodeId === handoff.handoffNodeId)
      const receivingWireAnchor = receivingDevice && receivingInput && receivingFeed && receivingChangeover &&
        handoff.target.kind === 'panel-bus-input' && isChangeoverLoadHandoff
        ? deriveWireAnchorKey({
            kind: 'feed-run',
            feedPathId: receivingFeed.id,
            runKey: `supply:${receivingInput.panelId}:changeover-load:${[
              `changeover:${receivingChangeover.deviceId ?? receivingChangeover.id}:load`,
              `device:${receivingDevice.id}`,
            ].sort().join('<>')}`,
          })
        : undefined
      const to = receivingDevice
        ? (resolve('trunk-device', receivingDevice.id) ??
          missing('trunk-device', receivingDevice.id, src))
        : resolveAttachment(handoff.target, src)
      for (const issue of outputIssues.filter((issue) => issue.entityId === handoff.id)) {
        addDiagnostic({
          code:
            issue.code === 'invalid-handoff-source'
              ? 'INVALID_SUPPLY_HANDOFF_SOURCE'
              : 'UNRESOLVED_SUPPLY_COMMON_OUTPUT',
          severity: 'error',
          message: issue.message,
          source: src,
          relatedNodeIds: [from, to],
        })
      }
      if (!reachable.has(handoff.handoffNodeId))
        addDiagnostic({
          code: 'UNCONNECTED_SUPPLY_HANDOFF',
          severity: 'error',
          message: `Handoff ${handoff.id} has no connected path from an AC source.`,
          source: src,
          relatedNodeIds: [from, to],
        })
      edge(
        to.startsWith('missing:') ? 'unresolved-reference' : 'supply-handoff',
        from,
        to,
        src,
        { knowledge: 'explicit' },
        {
          conductors: handoff.conductors, target: safeClone(handoff.target),
          ...(() => {
            const incoming = assembly.connections.filter(connection => connection.endpoints.some(endpoint => endpoint.nodeId === handoff.handoffNodeId))
            return receivingWireAnchor
              ? { wireAnchor: receivingWireAnchor }
              : incoming.length === 1
                ? { wireAnchor: deriveWireAnchorKey({ kind: 'supply-connection', assemblyId: assembly.id, connectionId: incoming[0]!.id }) }
                : {}
          })(),
        }
      )
    })
  }
  for (const [index, enclosure] of (
    project.disciplines.electrical?.auxiliaryEnclosures ?? []
  ).entries()) {
    const enclosureId = node(
      'auxiliary-enclosure',
      'auxiliary-enclosure',
      enclosure.id,
      `disciplines.electrical.auxiliaryEnclosures[${index}]`,
      enclosure,
      { label: enclosure.name }
    )
    if (enclosure.ownerPanelId)
      edge(
        'contains',
        resolve('panel', enclosure.ownerPanelId) ??
          missing(
            'panel',
            enclosure.ownerPanelId,
            source(
              'auxiliary-enclosure',
              enclosure.id,
              'disciplines.electrical.auxiliaryEnclosures',
              'ownerPanelId'
            )
          ),
        enclosureId,
        source(
          'auxiliary-enclosure',
          enclosure.id,
          'disciplines.electrical.auxiliaryEnclosures',
          'ownerPanelId'
        )
      )
  }
  installation?.feedTopology?.rootFeeds.forEach((feed, index) => {
    if (ownsInput(feed.panelId, feed.busSectionId)) return
    const src = source(
      'root-feed',
      feed.id,
      `installation.feedTopology.rootFeeds[${index}]`,
      feed.busSectionId ? 'busSectionId' : 'panelId'
    )
    const target = feed.busSectionId
      ? (resolve('bus-section', `${feed.panelId}:${feed.busSectionId}`) ??
        missing('bus-section', `${feed.panelId}:${feed.busSectionId}`, src))
      : (resolve('panel', feed.panelId) ?? missing('panel', feed.panelId, src))
    edge(
      target.startsWith('missing:') ? 'unresolved-reference' : 'panel-feed',
      installationId,
      target,
      src,
      { knowledge: 'explicit' },
      { busSectionId: feed.busSectionId }
    )
  })
  for (const [index, item] of (project.validation?.quarantinedItems ?? []).entries())
    node(
      'quarantined-record',
      'quarantined-record',
      item.id,
      `validation.quarantinedItems[${index}]`,
      item,
      { label: item.kind, panelId: item.panelId }
    )

  const knownDeviceIds = new Set(
    nodes
      .filter(({ kind }) => kind === 'endpoint' || kind === 'trunk-device')
      .map(({ source }) => source.entityId)
  )
  for (const [index, device] of (project.disciplines.electrical?.devices ?? []).entries()) {
    sourceRecordCount += 1
    if (!knownDeviceIds.has(device.legacyEndpointId))
      node(
        'unsupported-record',
        'electrical-device-v2',
        device.id,
        `disciplines.electrical.devices[${index}]`,
        device,
        { label: device.type, panelId: device.panelId, circuitId: device.circuitId }
      )
  }
  for (const [index, element] of project.elements.entries())
    if (
      element.kind.startsWith('electrical.') &&
      !['electrical.panel', 'electrical.circuit', 'electrical.endpoint'].includes(element.kind)
    )
      node('unsupported-record', 'element', element.id, `elements[${index}]`, element, {
        label: element.name,
      })

  // A sub-panel's incoming devices are canonically stored on its local PANEL circuit.
  // Splice those devices into every proven panel feed so the normalized topology follows
  // the persisted physical path (parent feeder → local incoming devices → panel bus).
  for (const [panelId, incomingNodeIds] of incomingTrunkNodesByPanelId) {
    if (!incomingNodeIds.length) continue
    const panelNodeId = resolve('panel', panelId)
    if (!panelNodeId) continue
    const incomingSet = new Set(incomingNodeIds)
    const directFeeds = relationships.filter(
      (relationship) =>
        relationship.kind === 'panel-feed' &&
        relationship.to === panelNodeId &&
        !incomingSet.has(relationship.from)
    )
    for (const directFeed of directFeeds) {
      relationships.splice(relationships.indexOf(directFeed), 1)
      edge(
        'panel-feed',
        directFeed.from,
        incomingNodeIds[0]!,
        directFeed.source,
        {
          knowledge: directFeed.knowledge,
          inferenceRuleId: directFeed.inferenceRuleId,
          diagnosticCode: directFeed.diagnosticCode,
        },
        directFeed.properties
      )
      edge(
        'panel-feed',
        incomingNodeIds.at(-1)!,
        panelNodeId,
        source('circuit', panelId, 'disciplines.electrical.panels', 'PANEL.trunkDevices'),
        { knowledge: 'explicit' }
      )
    }
  }

  const protectionOwners = new Map<string, string[]>()
  relationships
    .filter(({ kind }) => kind === 'protects')
    .forEach(({ from, to }) =>
      protectionOwners.set(to, [...(protectionOwners.get(to) ?? []), from])
    )
  for (const [circuitId, owners] of protectionOwners)
    if (owners.length > 1)
      addDiagnostic({
        code: 'CONFLICTING_PROTECTION_OWNERSHIP',
        severity: 'error',
        message: `Circuit node ${circuitId} has multiple protection owners.`,
        source: nodes.find(({ id }) => id === circuitId)!.source,
        relatedNodeIds: [circuitId, ...owners],
        remediation:
          'Retain one canonical protection owner or model intentional coordination explicitly.',
      })
  for (const [canonicalCircuitId, projectedIds] of circuitsById) {
    if (projectedIds.length < 2) continue
    const owners = projectedIds.flatMap((id) => protectionOwners.get(id) ?? [])
    if (owners.length > 1)
      addDiagnostic({
        code: 'CONFLICTING_PROTECTION_OWNERSHIP',
        severity: 'error',
        message: `Canonical circuit ${canonicalCircuitId} occurs under multiple protection owners.`,
        source: source('circuit', canonicalCircuitId, 'disciplines.electrical.panels'),
        relatedNodeIds: [...projectedIds, ...owners],
        remediation: 'Give each circuit a unique identity and one canonical protection owner.',
      })
  }

  const acyclicKinds = new Set<ElectricalStructureRelationshipKind>([
    'contains',
    'feeds',
    'protects',
    'ordered-before',
    'branches-to',
    'panel-feed',
    'supply-handoff',
  ])
  const acyclicOutgoing = new Map<string, ElectricalStructureRelationship[]>()
  for (const relationship of relationships) {
    if (!acyclicKinds.has(relationship.kind)) continue
    acyclicOutgoing.set(relationship.from, [
      ...(acyclicOutgoing.get(relationship.from) ?? []),
      relationship,
    ])
  }
  const visitedForCycles = new Set<string>()
  const activeForCycles = new Set<string>()
  const reportedCycles = new Set<string>()
  const detectCycles = (nodeId: string, path: string[]): void => {
    if (activeForCycles.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId)
      const cycle = [...path.slice(cycleStart), nodeId]
      const key = [...new Set(cycle)].sort().join('|')
      if (!reportedCycles.has(key)) {
        reportedCycles.add(key)
        addDiagnostic({
          code: 'STRUCTURAL_CYCLE',
          severity: 'error',
          message: `A relationship that requires an acyclic structure forms a cycle: ${cycle.join(' -> ')}.`,
          source: source('relationship-cycle', key, 'electrical-structure'),
          relatedNodeIds: cycle,
          remediation: 'Remove the circular ownership or feed reference in canonical V2 data.',
        })
      }
      return
    }
    if (visitedForCycles.has(nodeId)) return
    activeForCycles.add(nodeId)
    for (const relationship of (acyclicOutgoing.get(nodeId) ?? []).sort((a, b) =>
      a.id.localeCompare(b.id)
    ))
      detectCycles(relationship.to, [...path, nodeId])
    activeForCycles.delete(nodeId)
    visitedForCycles.add(nodeId)
  }
  for (const nodeId of [...nodeIds].sort()) detectCycles(nodeId, [])

  nodes.sort((a, b) => a.id.localeCompare(b.id))
  relationships.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.id.localeCompare(b.id)
  )
  stampTransitionWires(project, relationships, nodes)
  const liveWireAnchors = new Set(relationships.flatMap((relationship) =>
    typeof relationship.properties?.wireAnchor === 'string'
      ? [relationship.properties.wireAnchor] : []))
  const wireAnchorOwner = new Map<string, string>()
  for (const run of project.disciplines.electrical?.wireRuns ?? []) {
    for (const anchor of run.members) {
      const src = source('wire-run', run.id, 'disciplines.electrical.wireRuns', 'members')
      if (!liveWireAnchors.has(anchor)) addDiagnostic({
        code: 'ORPHAN_WIRE_RUN_ANCHOR', severity: 'warning',
        message: `Wire run ${run.id} references an inactive connection (${anchor}).`,
        source: src,
        remediation: 'Move the authored wire properties to a current connection or remove the inactive run.',
      })
      const owner = wireAnchorOwner.get(anchor)
      if (owner && owner !== run.id) addDiagnostic({
        code: 'DUPLICATE_WIRE_RUN_ANCHOR', severity: 'error',
        message: `Wire runs ${owner} and ${run.id} both claim connection ${anchor}.`,
        source: src,
        remediation: 'Keep each connection in only one authored wire run.',
      })
      wireAnchorOwner.set(anchor, owner ?? run.id)
    }
  }
  diagnostics.sort(
    (a, b) =>
      a.code.localeCompare(b.code) ||
      (a.source.entityId ?? '').localeCompare(b.source.entityId ?? '')
  )

  const byNodeKind: ElectricalStructureSnapshot['summary']['byNodeKind'] = {}
  const byRelationshipKind: ElectricalStructureSnapshot['summary']['byRelationshipKind'] = {}
  nodes.forEach(({ kind }) => {
    byNodeKind[kind] = (byNodeKind[kind] ?? 0) + 1
  })
  relationships.forEach(({ kind }) => {
    byRelationshipKind[kind] = (byRelationshipKind[kind] ?? 0) + 1
  })
  return {
    version: 1,
    projectId: project.project.id,
    nodes,
    relationships,
    diagnostics,
    summary: {
      nodeCount: nodes.length,
      relationshipCount: relationships.length,
      diagnosticCount: diagnostics.length,
      sourceRecordCount,
      projectedSourceRecordCount: sourceRecordCount,
      byNodeKind,
      byRelationshipKind,
    },
  }
}
