/** Circuit columns, grouping trunks, endpoint branches and the initial vertical envelope. */
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import { drawsHostedFeederStubs } from '@/lib/layout/supplyFrameRole'

import { getProtectionAnchorOffset } from './bottomUpPanelTransforms'

import type { Circuit, ProtectionDevice } from '@/types/schema'
import { getSupplyTapCircuitIds } from './supplyTapLayout'

import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'
import { EENDRAAD_PANEL_SYMBOL_WIDTH } from '@/lib/canvas/symbolGeometry'

import {
  getPrimaryPanelBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import {
  assignHostedFeedStubFeeders,
  collectHostedFeedStubFeeders,
  getHostedFeederColumnShift,
  type FeedStubFeeder,
} from './feedStubFeeders'

import { getPanelInputDeviceStartIndex } from '@/lib/supplyAssembly/electricalTopology'
import { resolvePanelSupplyLinksForSourcePanelInPanels } from '@/lib/eendraad/panelSupplyLink'

import { getProtectionOneWireLabelLines } from '@/lib/protectionLabels'

import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

import { getPanelSymbolLabel } from '@/lib/panel/panelDiagramLabels'

import { collectCircuits, findPanelById } from '@/lib/panel/panelTree'

import { getTrunkDeviceBranchGapY } from './bottomUpBranchPass'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { getCircuitWireLabelSpan } from './circuitWireLabelSpacing'
import { getEndpointLayoutOffsets } from './bottomUpBranchWidths'
import {
  getHorizontalDomoticaGeometry,
  getHorizontalDomoticaOutputCount,
  isHorizontalDomotica,
} from './domoticaHorizontalGeometry'
import type { CircuitEnvelopeConfig, CircuitLayoutEnvelope } from './circuitLayoutEnvelope'

import {
  getCircuitConverterDcConnectionCount,
  getOrdinaryCircuitConverterOutputRowY,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'

import type { BottomUpCircuitLayout } from './bottomUpLayout'
import type { BottomUpPanelLayoutInput } from './bottomUpPanelLayoutInput'
import {
  PROTECTION_LABEL_X_OFFSET_FROM_MCB,
  SPD_PROTECTION_LABEL_X_OFFSET_FROM_TRUNK,
  PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL,
  buildCircuitMap,
  findProtectionForCircuit,
  findParentRcd,
  findParentCircuit,
  calculateTrunks,
  calculateBranches,
  getCircuitColumnEnvelope,
  getCircuitLeftReserve,
  pushNestedCircuitLayout,
  ensureDescendantNestedCircuitLayouts,
} from './bottomUpCircuitGeometry'

type CalculatePanelCircuitLayoutInput =
  Pick<BottomUpPanelLayoutInput,
    'project' | 'panel' | 'manualOverrides' | 'parentMcbInfo' | 'installation' | 'rootPanels' | 'options'
  >

export function calculatePanelCircuitLayout(input: CalculatePanelCircuitLayoutInput) {
  const {
    project,
    panel,
    manualOverrides,
    parentMcbInfo,
    installation,
    rootPanels,
    options,
  } = input

  const supplyTrunkNotesOrientation: 'horizontal' | 'vertical' =
    options.frameRole === 'supply'
      ? 'horizontal'
      : (installation?.supplyTrunkNotesOrientation ?? 'horizontal')
  const panelCircuits = collectCircuits(panel)
  const circuitMap = buildCircuitMap(panel)
  const protectionByCircuitId = new Map<string, ProtectionDevice>()
  for (const protection of panel.protections) {
    for (const circuit of protection.circuits ?? []) {
      protectionByCircuitId.set(circuit.id, protection)
    }
  }
  const envelopeConfig: CircuitEnvelopeConfig = {
    symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    protectionWidth: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
    branchLeadIn: LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
    endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
    applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
    endpointBranchSpacing: LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING,
    protectionLabelOffset: PROTECTION_LABEL_X_OFFSET_FROM_MCB,
    spdProtectionLabelOffset: SPD_PROTECTION_LABEL_X_OFFSET_FROM_TRUNK,
    protectionTechnicalLabelOffset: PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL,
    secondaryBusPanelColumnWidth: LAYOUT_CONSTANTS.SECONDARY_BUS_PANEL_COLUMN_WIDTH,
    secondaryBusPanelLabelWidth: (protection, circuit) => {
      const panelId =
        protection?.subPanelId ??
        circuit?.endpoints.find((endpoint) => endpoint.symbol === 'panel_distribution')?.panelId
      const targetPanel = panelId ? findPanelById(rootPanels ?? [panel], panelId) : undefined
      if (!targetPanel) return 0

      // Layout runs in a worker without edition context. Reserve the larger
      // numbered form as a stable upper bound; entitled renderers may show it,
      // while non-entitled renderers simply get a little extra breathing room.
      const label = getPanelSymbolLabel(project, targetPanel, true)
      return (
        EENDRAAD_PANEL_SYMBOL_WIDTH / 2 + 5 + measureSymbolLabelTextWidth(label, 'Figtree', 11) + 8
      )
    },
    secondaryBusExtension: LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION,
    dcBusMinWidth: LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
    dcBusBranchLeadIn: LAYOUT_CONSTANTS.DC_BUS_BRANCH_LEAD_IN,
    dcBusBranchMinSpacing: LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_MIN_SPACING,
    dcBusBranchLabelGap: LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_LABEL_GAP,
    nestedGutter: LAYOUT_CONSTANTS.CIRCUIT_ENVELOPE_GUTTER,
    circuitNotesOrientation: installation?.circuitNotesOrientation ?? 'horizontal',
  }
  const envelopeMemo = new Map<string, CircuitLayoutEnvelope>()

  // Build circuit layouts
  const circuitLayouts: BottomUpCircuitLayout[] = []
  let currentX = LAYOUT_CONSTANTS.LEFT_MARGIN
  // Supply taps pack in their own column run: they are moved onto the supply lane afterwards
  // and must not widen the board's bus.
  const tapCircuitIds = getSupplyTapCircuitIds(panel)
  let tapX = LAYOUT_CONSTANTS.LEFT_MARGIN
  const feedStubLabelReach = new Map<string, { left: number; right: number }>()
  if (panel.isMain && options.frameRole !== 'supply' && hasExplicitPanelBusSections(panel)) {
    for (const section of panel.busSections ?? []) {
      const feed = installation?.feedTopology?.rootFeeds.find((candidate) =>
        candidate.panelId === panel.id &&
        (candidate.busSectionId ?? getPrimaryPanelBusSectionId(panel)) === section.id
      )
      const allDevices = feed?.trunkDevices ?? []
      const devices = allDevices.slice(getPanelInputDeviceStartIndex(project, allDevices))
      feedStubLabelReach.set(section.id, {
        left: Math.max(45, ...devices.flatMap((device) =>
          [device.label, device.notes]
            .filter((line): line is string => !!line?.trim())
            .map((line) => 25 + measureSymbolLabelTextWidth(line, 'Figtree', 8))
        )),
        right: Math.max(45, ...devices.flatMap((device) =>
          getProtectionOneWireLabelLines(device).map((line) =>
            25 + measureSymbolLabelTextWidth(line.text, 'Figtree', 10)
          )
        )),
      })
    }
  }
  let previousMainBusSectionId: string | undefined
  // Feeders hosted here for other main panels' stubs; a later section that
  // hosts some needs room on the bus before it for their legs and panels.
  const hostedFeedersBySection =
    !parentMcbInfo && panel.isMain !== false && hasExplicitPanelBusSections(panel) &&
      installation && rootPanels
      ? assignHostedFeedStubFeeders(
          panel, collectHostedFeedStubFeeders(project, installation, rootPanels, panel))
      : new Map<string, FeedStubFeeder[]>()
  const reservesHostedFeederGaps = drawsHostedFeederStubs(options, panel)
  const enteredMainBusSectionIds = new Set<string>()

  for (const circuit of panelCircuits) {
    const protection = findProtectionForCircuit(panel, circuit)
    const parentRcd = findParentRcd(panel, circuit)

    // Check if this is a nested circuit (has a parent circuit)
    const parentCircuit = findParentCircuit(panel, circuit)

    // Nested circuits are positioned horizontally on secondary bus bar
    if (parentCircuit) {
      // Find parent circuit layout
      const parentLayout = circuitLayouts.find((cl) => cl.circuit.id === parentCircuit.id)
      // Nested circuits may already have been inserted while laying out their parent (recovery loop).
      if (parentLayout && !circuitLayouts.some((cl) => cl.circuit.id === circuit.id)) {
        const circuitEnvelope = getCircuitColumnEnvelope(
          circuit,
          circuitMap,
          protectionByCircuitId,
          envelopeConfig,
          envelopeMemo
        )
        const circuitWidth = circuitEnvelope.right - circuitEnvelope.left
        const circuitLeftReserve = getCircuitLeftReserve(circuitEnvelope)

        // Find all nested circuits for this parent to calculate their X positions.
        // IMPORTANT: Use the order from subCircuitIds, not the order in panelCircuits.
        const allNestedCircuits = (parentCircuit.subCircuitIds || [])
          .map((id) => panelCircuits.find((c) => c.id === id))
          .filter((c): c is Circuit => c !== undefined)

        // Check if there's only one nested circuit
        const hasSingleNested = allNestedCircuits.length === 1

        let nestedX: number
        if (hasSingleNested) {
          // ONE nested circuit: align protection anchors, not column left edges.
          // Label reserves can differ per protection; aligning the columns would
          // otherwise create a sideways jog in what should be one vertical feeder.
          nestedX =
            parentLayout.x +
            getProtectionAnchorOffset(parentLayout.leftReserve) -
            getProtectionAnchorOffset(circuitLeftReserve)
        } else {
          // MULTIPLE nested circuits: pack their painted envelopes along the
          // secondary bus, keeping every child anchor relative to the parent trunk.
          const parentEnvelope = getCircuitColumnEnvelope(
            parentCircuit,
            circuitMap,
            protectionByCircuitId,
            envelopeConfig,
            envelopeMemo
          )
          const parentAnchorX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
          const nestedAnchorOffset = parentEnvelope.nestedAnchorOffsets.get(circuit.id) ?? 0
          nestedX =
            parentAnchorX + nestedAnchorOffset - getProtectionAnchorOffset(circuitLeftReserve)
        }

        circuitLayouts.push({
          circuit,
          protection,
          parentRcd,
          parentCircuit,
          x: nestedX, // Positioned at parent's X for single, or horizontally on secondary bus for multiple
          width: circuitWidth,
          leftReserve: circuitLeftReserve,
          ...(circuitEnvelope.columnAnchorOffsets ? { columnAnchorOffsets: circuitEnvelope.columnAnchorOffsets } : {}),
          protectionY: LAYOUT_CONSTANTS.PROTECTION_Y,
          trunkY: undefined,
          branch: null,
          secondaryBusY: undefined,
        })
      }
      // Skip incrementing currentX for nested circuits
      continue
    }

    // Top-level circuits get their own X position.
    // Use the same recursive max-branch-span helper as nested circuits so
    // every circuit width is derived the same way.
    const circuitEnvelope = getCircuitColumnEnvelope(
      circuit,
      circuitMap,
      protectionByCircuitId,
      envelopeConfig,
      envelopeMemo
    )
    let circuitWidth = circuitEnvelope.right - circuitEnvelope.left

    circuitWidth = Math.max(circuitWidth, LAYOUT_CONSTANTS.CIRCUIT_MIN_WIDTH)

    // Check for manual override
    const override = manualOverrides?.get(`circuit-${circuit.id}`)
    const isTapCircuit = tapCircuitIds.has(circuit.id)
    if (circuit.supplySource?.kind !== 'converter-backup' && !isTapCircuit) {
      const sectionId = protection?.busSectionId ?? circuit.busSectionId ??
        getPrimaryPanelBusSectionId(panel)
      if (!override && previousMainBusSectionId && sectionId !== previousMainBusSectionId) {
        const previousReach = feedStubLabelReach.get(previousMainBusSectionId)
        const nextReach = feedStubLabelReach.get(sectionId)
        if (previousReach && nextReach) {
          currentX += Math.max(0, previousReach.right + nextReach.left + 8 - 110)
        }
        if (reservesHostedFeederGaps && !enteredMainBusSectionIds.has(sectionId)) {
          currentX += getHostedFeederColumnShift(
            hostedFeedersBySection.get(sectionId)?.length ?? 0)
        }
      }
      if (!override) enteredMainBusSectionIds.add(sectionId)
      previousMainBusSectionId = sectionId
    }
    const x = override ? override.x : isTapCircuit ? tapX : currentX

    circuitLayouts.push({
      circuit,
      protection,
      parentRcd,
      parentCircuit,
      x,
      width: circuitWidth,
      leftReserve: getCircuitLeftReserve(circuitEnvelope),
      ...(circuitEnvelope.columnAnchorOffsets ? { columnAnchorOffsets: circuitEnvelope.columnAnchorOffsets } : {}),
      protectionY: LAYOUT_CONSTANTS.PROTECTION_Y,
      trunkY: undefined, // Will be calculated from trunk if parentRcd exists
      branch: null, // Will be calculated later
      secondaryBusY: undefined, // Will be calculated in calculateBranches if nested circuit
    })

    // Converter-backed circuits are positioned beside their converter after the supply
    // geometry is known. They must not reserve a normal main-bus column.
    if (circuit.supplySource?.kind === 'converter-backup') {
      continue
    }

    // Add nested circuits for this parent that were skipped (they appeared before parent in panelCircuits).
    // Demoting a main-bus circuit puts it in parent's subCircuitIds but its protection may come earlier in
    // panel.protections, so without this pass the nested circuit would never get a layout and would "disappear".
    for (const nested of panelCircuits) {
      const nestedParent = findParentCircuit(panel, nested)
      if (nestedParent?.id !== circuit.id) continue
      pushNestedCircuitLayout(
        panel,
        panelCircuits,
        circuitMap,
        protectionByCircuitId,
        envelopeConfig,
        envelopeMemo,
        circuitLayouts,
        nested,
        circuit
      )
    }

    if (!override) {
      if (isTapCircuit) tapX += circuitWidth + LAYOUT_CONSTANTS.CIRCUIT_ENVELOPE_GUTTER
      else currentX += circuitWidth + LAYOUT_CONSTANTS.CIRCUIT_ENVELOPE_GUTTER
    }
  }

  ensureDescendantNestedCircuitLayouts(
    panel,
    panelCircuits,
    circuitMap,
    protectionByCircuitId,
    envelopeConfig,
    envelopeMemo,
    circuitLayouts
  )

  // Calculate total width first
  const totalWidth = currentX + LAYOUT_CONSTANTS.LEFT_MARGIN

  // Calculate main bus (needed for trunk calculation)
  const mainBusX = LAYOUT_CONSTANTS.LEFT_MARGIN
  const rawMainBusWidth = totalWidth - LAYOUT_CONSTANTS.LEFT_MARGIN * 2
  // Enforce minimum width so the drop zone is usable even when the panel has no circuits
  const mainBusWidth = Math.max(rawMainBusWidth, LAYOUT_CONSTANTS.MIN_MAIN_BUS_WIDTH)
  const mainBusY = LAYOUT_CONSTANTS.MAIN_BUS_Y

  // Calculate trunks (needs mainBusY)
  const trunks = calculateTrunks(panel, circuitLayouts, mainBusY)

  // Calculate branches (needs mainBusY)
  const wireRuns = new Map(selectProjectWireRuns(project).flatMap((run) => run.members.map((anchor) => [anchor, run] as const)))
  for (const layout of circuitLayouts) layout.wireLabelSpan = getCircuitWireLabelSpan(layout.circuit, wireRuns)
  const branches = calculateBranches(circuitLayouts, trunks, mainBusY, panel)

  // Update circuit layouts with branch info and trunkY
  branches.forEach((branch) => {
    const circuitLayout = circuitLayouts.find((cl) => cl.circuit.id === branch.circuitId)
    if (circuitLayout) {
      circuitLayout.branch = branch
      // Update trunkY if parentRcd exists
      if (circuitLayout.parentRcd) {
        const trunk = trunks.find((t) => t.protectionId === circuitLayout.parentRcd!.id)
        if (trunk) {
          circuitLayout.trunkY = trunk.y
        }
      }
    }
  })

  // Calculate total dimensions
  // Find the lowest Y (topmost element on screen) and highest Y (bottommost element)
  // Y increases downward, so lower Y = higher on screen
  let minY: number = Infinity // Start high so Math.min works correctly
  // Start maxY at the main bus; content below (supply, labels) will extend it.
  const maxY: number = LAYOUT_CONSTANTS.MAIN_BUS_Y

  // Circuits feeding a sub-panel should reserve one extra "branch step" above
  // their top-most branch so the panel symbol can cap the trunk at the top.
  resolvePanelSupplyLinksForSourcePanelInPanels([panel], panel).forEach((link) => {
    if (link.sourcePanelEndpoint?.domoticaChildProps) return
    const feederCircuit = link.feederCircuit
    if (!feederCircuit) return
    if (feederCircuit.supplySource?.kind === 'converter-backup') return
    const feederCircuitId = feederCircuit.id
    const feederBranches = branches.filter((b) => b.circuitId === feederCircuitId)
    if (feederBranches.length === 0) return
    const topmostFeederBranch = feederBranches.reduce((top, b) =>
      b.branchY < top.branchY ? b : top
    )
    const panelSymbolY = topmostFeederBranch.branchY - LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING
    const PANEL_TOP_MARGIN = 4
    minY = Math.min(minY, panelSymbolY - LAYOUT_CONSTANTS.SYMBOL_SIZE - PANEL_TOP_MARGIN)
  })

  // Find min Y (topmost element, lowest Y value) and max Y (bottommost element, highest Y value)
  // Branches go UP (lower Y values = higher on screen)
  branches.forEach((branch) => {
    const branchCircuit = circuitMap.get(branch.circuitId)
    // Direct converter-backup circuits are initially calculated at the normal
    // circuit height and repositioned onto the inverter lane later in this pass.
    // Measuring that provisional Y here creates a large empty band above the
    // detached supply content as soon as its first protection is added.
    if (branchCircuit?.supplySource?.kind === 'converter-backup') return
    if (tapCircuitIds.has(branch.circuitId)) return
    const endpointOffsets = getEndpointLayoutOffsets(
      branch.endpoints,
      LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
      LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
      LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
      LAYOUT_CONSTANTS.SYMBOL_SIZE
    )
    if (branch.endpoints.length === 0) {
      // Empty circuits still render an upward trunk wire. Keep that wire inside
      // the panel frame so its drop hint remains reachable by hit testing.
      minY = Math.min(minY, branch.branchY - LAYOUT_CONSTANTS.SYMBOL_SIZE - 4)
    }
    branch.endpoints.forEach((endpoint, index) => {
      const endpointY = branch.branchY + (endpointOffsets[index]?.y ?? 0)
      if (isHorizontalDomotica(endpoint)) {
        const body = getHorizontalDomoticaGeometry(
          { x: 0, y: endpointY },
          getHorizontalDomoticaOutputCount(endpoint)
        )
        minY = Math.min(minY, body.top - 8)
      } else if (endpoint.symbol === 'domotica') {
        const endpointCount = Math.max(
          DOMOTICA_MIN_ENDPOINT_OUTPUTS,
          Math.min(
            DOMOTICA_MAX_ENDPOINT_OUTPUTS,
            Math.trunc(endpoint.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
          )
        )
        const variableHeight = Math.max(0, endpointCount - 1) * DOMOTICA_OUTPUT_SPACING
        const boxTop = endpointY - variableHeight - DOMOTICA_BASE_HEIGHT / 2
        minY = Math.min(minY, boxTop - 8)
      } else {
        // Preserve the existing regular-endpoint frame reserve; only Domotica
        // modules need the recursive top-bound calculation above.
        minY = Math.min(minY, endpointY - LAYOUT_CONSTANTS.SYMBOL_SIZE - 4)
      }
    })
  })

  // Extra converter DC rows are synthetic layout-tree branches, so reserve their
  // vertical paint here before the frame offset is solved.
  circuitLayouts.forEach((cl) => {
    if (tapCircuitIds.has(cl.circuit.id)) return
    const trunkDevices = (cl.circuit.trunkDevices ?? []).filter(
      (device) => !device.converterDcConnection
    )
    if (trunkDevices.length === 0) return
    const mcbYForDevices = cl.parentRcd
      ? (trunks.find((trunk) => trunk.protectionId === cl.parentRcd!.id)?.y ??
          mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET) - LAYOUT_CONSTANTS.MCB_Y_OFFSET
      : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
    const circuitBranches = branches.filter((branch) => branch.circuitId === cl.circuit.id)

    trunkDevices.forEach((device) => {
      const count = getCircuitConverterDcConnectionCount(device)
      if (!supportsCircuitConverterDcConnections(device) || count <= 1) return
      let deviceY: number
      if (device.trunkPosition === 0) {
        const before = trunkDevices
          .filter((candidate) => candidate.trunkPosition === 0)
          .indexOf(device)
        deviceY =
          mcbYForDevices -
          LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
          before * (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
      } else {
        const branchAbove = circuitBranches[device.trunkPosition - 1]
        const gapY = getTrunkDeviceBranchGapY(device, trunkDevices, circuitBranches, LAYOUT_CONSTANTS)
        if (gapY != null) {
          deviceY = gapY
        } else if (branchAbove) {
          const before = trunkDevices
            .filter((candidate) => candidate.trunkPosition === device.trunkPosition)
            .indexOf(device)
          deviceY =
            branchAbove.branchY -
            LAYOUT_CONSTANTS.BRANCH_START_OFFSET -
            before * (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
        } else {
          deviceY =
            mcbYForDevices -
            LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP
        }
      }
      const topOutputRowY = getOrdinaryCircuitConverterOutputRowY(device, deviceY, count - 1)
      minY = Math.min(minY, topOutputRowY - LAYOUT_CONSTANTS.SYMBOL_SIZE)
    })
  })

  // Also check RCD trunks (they're above main bus, so lower Y = higher on screen)
  trunks.forEach((trunk) => {
    if (trunk.circuits.some((circuit) => tapCircuitIds.has(circuit.id))) return
    minY = Math.min(minY, trunk.y - LAYOUT_CONSTANTS.SYMBOL_SIZE)
  })

  // Also check nested protection positions (they might extend above branches)
  circuitLayouts.forEach((cl) => {
    if (tapCircuitIds.has(cl.circuit.id)) return
    if (cl.parentCircuit && cl.protection) {
      // Find parent layout to get nested MCB position
      const parentLayout = circuitLayouts.find((pcl) => pcl.circuit.id === cl.parentCircuit!.id)
      if (parentLayout) {
        const parentBranches = branches.filter((b) => b.circuitId === parentLayout.circuit.id)
        const parentHasEndpointBranches = parentBranches.some((b) => b.endpoints.length > 0)
        let nestedMcbY: number
        if (parentHasEndpointBranches && parentLayout.secondaryBusY != null) {
          nestedMcbY = parentLayout.secondaryBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        } else if (parentBranches.length > 0) {
          const topmostParentBranch = parentBranches.reduce((top, b) =>
            b.branchY < top.branchY ? b : top
          )
          nestedMcbY = topmostParentBranch.branchY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        } else {
          nestedMcbY = mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET * 2
        }

        // Check nested circuit's branches too
        const nestedBranches = branches.filter((b) => b.circuitId === cl.circuit.id)
        if (nestedBranches.length > 0) {
          const topmostNestedBranchY = nestedBranches.reduce(
            (min, b) => (b.branchY < min ? b.branchY : min),
            Infinity
          )
          minY = Math.min(minY, topmostNestedBranchY - LAYOUT_CONSTANTS.SYMBOL_SIZE)
        } else {
          // No branches, but wire extends upward from MCB - account for wire extension
          const wireExtension = 50 // Match wireSegments.ts extension
          minY = Math.min(minY, nestedMcbY - wireExtension - LAYOUT_CONSTANTS.SYMBOL_SIZE)
        }
      }
    }
  })

  // If no branches or trunks, use main bus as top
  if (minY === Infinity) {
    minY = mainBusY
  }

  return {
    supplyTrunkNotesOrientation,
    circuitMap,
    circuitLayouts,
    hostedFeedersBySection,
    totalWidth,
    mainBusX,
    mainBusWidth,
    mainBusY,
    trunks,
    branches,
    minY,
    maxY,
  }
}

export type BottomUpCircuitLayoutPass = ReturnType<typeof calculatePanelCircuitLayout>
