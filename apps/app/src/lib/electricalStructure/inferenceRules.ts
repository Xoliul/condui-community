import type { ElectricalStructureRelationshipKind } from './types'

export interface ElectricalStructureInferenceRule {
  id: string
  description: string
  acceptedSourceFacts: string[]
  emits: ElectricalStructureRelationshipKind | 'junction-identity'
  ambiguityCondition?: string
  reviewCondition: string
}

export const ELECTRICAL_STRUCTURE_INFERENCE_RULES = {
  protectionCircuitOwnership: {
    id: 'v2.protection-circuit-ownership',
    description: 'A circuit nested in ProtectionDevice.circuits is protected by that protection.',
    acceptedSourceFacts: ['Panel.protections[].circuits[]'],
    emits: 'protects',
    reviewCondition: 'Remove when V2 persists a dedicated protection-to-circuit relationship.',
  },
  panelCircuitContainment: {
    id: 'v2.panel-circuit-containment',
    description: 'A circuit is contained by the panel tree record that owns it.',
    acceptedSourceFacts: ['Panel.circuits[]', 'Panel.protections[].circuits[]'],
    emits: 'contains',
    reviewCondition: 'Remove when circuit ownership is an explicit canonical relationship.',
  },
  circuitDeviceMembership: {
    id: 'v2.circuit-device-membership',
    description: 'Endpoints and trunk devices nested in a circuit belong to that circuit.',
    acceptedSourceFacts: [
      'Circuit.endpoints[]',
      'Circuit.trunkDevices[]',
      'Circuit.branches[].branchDevices[]',
    ],
    emits: 'belongs-to-circuit',
    reviewCondition: 'Remove when V2 persists device membership relationships.',
  },
  domoticaOutputBranch: {
    id: 'v2.domotica-output-branch',
    description:
      'A domotica child is a direct output branch of its parent; children sharing one output index remain an ordered serial chain.',
    acceptedSourceFacts: [
      'Endpoint.domoticaChildProps.parentEndpointId',
      'Endpoint.domoticaChildProps.outputIndex',
      'Circuit.branches[].endpointIds[]',
    ],
    emits: 'branches-to',
    reviewCondition: 'Remove when V2 persists explicit domotica output relationships.',
  },
  junctionIdentityGrouping: {
    id: 'v2.junction-identity-grouping',
    description:
      'Equal normalized junction identities for the same supported symbol group occurrences.',
    acceptedSourceFacts: ['Endpoint.junctionIdentity', 'TrunkDevice.junctionIdentity'],
    emits: 'junction-identity',
    ambiguityCondition: 'The same identity is used by incompatible junction symbols.',
    reviewCondition: 'Remove when V2 stores physical junction entities explicitly.',
  },
  subCircuitLink: {
    id: 'v2.sub-circuit-link',
    description: 'Circuit.subCircuitIds documents logical downstream circuit links.',
    acceptedSourceFacts: ['Circuit.subCircuitIds[]'],
    emits: 'branches-to',
    reviewCondition: 'Remove when V2 stores circuit links as explicit relationships.',
  },
  placementOccurrence: {
    id: 'v2.placement-occurrence',
    description: 'A placement is a physical/view occurrence of its owning device.',
    acceptedSourceFacts: ['Endpoint.placements[]', 'TrunkDevice.placements[]'],
    emits: 'represents-occurrence-of',
    reviewCondition: 'Remove when placements are first-class typed V2 occurrences.',
  },
} as const satisfies Record<string, ElectricalStructureInferenceRule>
