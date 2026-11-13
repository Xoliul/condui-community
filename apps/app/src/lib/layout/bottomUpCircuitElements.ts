/** Protection and circuit elements, with nested DC-bus subtrees and matching frame extents. */
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'

import { getProtectionAnchorOffset } from './bottomUpPanelTransforms'

import { getTrunkDeviceBranchGapY } from './bottomUpBranchPass'
import { getEndpointLayoutOffsets } from './bottomUpBranchWidths'

import {
  getTrunkDeviceVerticalPaintHeight,
} from './trunkDeviceSpacing'
import {
  getCircuitConverterDcConnectionCount,
  getOrdinaryCircuitConverterOutputRowY,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'

import { getCircuitConverterMetadataCallouts } from './circuitConverterMetadataCallouts'

import type { BottomUpPanelLayoutInput, BottomUpSupplyElements } from './bottomUpPanelLayoutInput'
import {
  isPanelOnlySubPanelFeeder,
  getProtectionLabelXOffset,
  getProtectionLabelYOffset,
} from './bottomUpCircuitGeometry'

import type { BottomUpCircuitLayoutPass } from './bottomUpCircuitLayout'

import type { BottomUpCircuitNotesPass } from './bottomUpCircuitNotes'

type BuildPanelCircuitElementsInput =
  Pick<BottomUpPanelLayoutInput, 'panel'> &
  Pick<
    BottomUpCircuitLayoutPass,
    | 'circuitMap'
    | 'circuitLayouts'
    | 'mainBusY'
    | 'trunks'
    | 'branches'
  > &
  Pick<BottomUpCircuitNotesPass, 'minY' | 'notesPositionMap' | 'circuitNotesLocal'> &
  Pick<BottomUpSupplyElements, 'elements' | 'renderedProtectionLabelIds'>

export function buildPanelCircuitElements(input: BuildPanelCircuitElementsInput) {
  const {
    panel,
    circuitMap,
    circuitLayouts,
    mainBusY,
    trunks,
    branches,
    elements,
    renderedProtectionLabelIds,
    notesPositionMap,
    circuitNotesLocal,
  } = input
  let {
    minY,
  } = input
  // Protection devices and circuits
  circuitLayouts.forEach((cl) => {
    // Skip nested circuits for main processing - they'll be handled separately
    if (cl.parentCircuit) {
      // Nested circuit protection - positioned on parent's vertical wire or secondary bus
      if (cl.protection) {
        // Find parent circuit layout
        const parentLayout = circuitLayouts.find((pcl) => pcl.circuit.id === cl.parentCircuit!.id)
        if (parentLayout) {
          // Find all nested circuits for this parent
          const allNestedForParent = circuitLayouts.filter(
            (ncl) => ncl.parentCircuit && ncl.parentCircuit.id === cl.parentCircuit!.id
          )

          // Calculate nested MCB Y position - place at exact end of parent's wire
          // Find the topmost branch of the parent circuit (lowest Y = highest on screen = wire end)
          const parentBranches = branches.filter((b) => b.circuitId === parentLayout.circuit.id)
          let mcbY: number

          const parentHasEndpointBranches = parentBranches.some((b) => b.endpoints.length > 0)
          if (parentHasEndpointBranches && parentLayout.secondaryBusY != null) {
            mcbY = parentLayout.secondaryBusY
          } else if (parentBranches.length > 0) {
            // Parent has branches - wire ends at the topmost branch (lowest Y value)
            const topmostParentBranch = parentBranches.reduce((top, b) =>
              b.branchY < top.branchY ? b : top
            )
            mcbY = topmostParentBranch.branchY // Position at exact wire end
          } else {
            // Parent has no branches - wire ends at parent MCB position
            mcbY = mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
          }

          // Determine MCB X position
          let mcbX: number

          // Always offset MCB from the virtual secondary bus so wire insets
          // can determine direction and create proper gaps around the symbol.
          mcbY = mcbY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

          if (allNestedForParent.length === 1) {
            // ONE nested circuit: draw directly on parent's vertical wire (same X as parent)
            mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
          } else if (allNestedForParent.length > 1) {
            // MULTIPLE nested circuits: position on secondary bus bar with vertical lines
            // Use nested circuit's own X position (positioned horizontally on secondary bus)
            mcbX = cl.x + getProtectionAnchorOffset(cl.leftReserve)
          } else {
            // No nested circuits (shouldn't happen, but handle gracefully)
            mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
          }

          // Update protectionY to actual MCB position for correct tree-building
          cl.protectionY = mcbY

          // Keep the protection element as a topology/wire anchor even for panel-only feeders.
          // Rendering suppresses the visible protection symbol in that case, but deriveWires still
          // needs an MCB node to connect secondary buses and panel symbols correctly.
          const protection = cl.protection
          const isPanelOnlyFeeder = isPanelOnlySubPanelFeeder(protection, cl.circuit)
          const sameProtectionAsParent =
            !!parentLayout.protection &&
            !!protection &&
            parentLayout.protection.id === protection.id

          if (protection && isPanelOnlyFeeder && sameProtectionAsParent) {
            const nestElId = `protection-${protection.id}-nest-${cl.circuit.id}`
            if (!elements.find((e) => e.id === nestElId)) {
              elements.push({
                id: nestElId,
                type: 'protection',
                position: {
                  x: mcbX,
                  y: mcbY,
                },
                protectionId: protection.id,
                circuitId: cl.circuit.id,
              })
            }
          } else if (protection && !elements.find((e) => e.id === `protection-${protection.id}`)) {
            elements.push({
              id: `protection-${protection.id}`,
              type: 'protection',
              position: {
                x: mcbX, // LOCAL coordinates
                y: mcbY,
              },
              protectionId: protection.id,
              circuitId: cl.circuit.id,
            })
          }

          // Secondary bus bar is now created as a wire segment in deriveWires.ts
          // No need to create it as an element here

          // Add circuit label for nested circuits (including panel-only sub-panel feeders).
          const nestedLabel = (protection?.label ?? '').trim()
          const nestedLetterVisible = cl.circuit.eendraadLetterVisible !== false
          if (
            protection &&
            nestedLabel &&
            nestedLetterVisible &&
            !renderedProtectionLabelIds.has(protection.id) &&
            !elements.find((e) => e.id === `label-${cl.circuit.id}`)
          ) {
            elements.push({
              id: `label-${cl.circuit.id}`,
              type: 'label',
              position: {
                x: mcbX + getProtectionLabelXOffset(protection), // LOCAL coordinates
                y: mcbY + getProtectionLabelYOffset(protection),
              },
              circuitId: cl.circuit.id,
              label: nestedLabel,
            })
            renderedProtectionLabelIds.add(protection.id)
          }
        }
      }

      // Create branch and endpoint visual elements for nested circuits
      // (same as for top-level circuits, so nested circuits get visible wires and drop targets)
      const nestedCircuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)

      nestedCircuitBranches.forEach((branch) => {
        // Branch visual element
        const firstEndpoint = branch.endpoints[0]
        const hasSwitches = firstEndpoint?.type === 'switch'
        const isDcBusBranch = !!cl.circuit.dcBusSource
        const branchVisualX = isDcBusBranch
          ? branch.branchX
          : hasSwitches
            ? branch.branchX + LAYOUT_CONSTANTS.BRANCH_LEAD_IN
            : branch.branchX
        const branchVisualWidth = isDcBusBranch
          ? 0
          : hasSwitches
            ? branch.branchWidth - LAYOUT_CONSTANTS.BRANCH_LEAD_IN
            : branch.branchWidth

        elements.push({
          id: `branch-visual-${branch.id}`,
          type: 'branch',
          position: {
            x: branchVisualX, // LOCAL coordinates
            y: branch.branchY,
          },
          width: branchVisualWidth,
          height: LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH,
          branchId: branch.id,
          circuitId: cl.circuit.id,
        })

        // Endpoint elements on this branch (with appliance-after-socket gap)
        const nestedOffsets = getEndpointLayoutOffsets(
          branch.endpoints,
          LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
          LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
          LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
          LAYOUT_CONSTANTS.SYMBOL_SIZE
        )
        branch.endpoints.forEach((endpoint, index) => {
          const endpointX = isDcBusBranch
            ? branch.branchX
            : branch.branchX + (branch.endpointXOffsets?.[index] ?? nestedOffsets[index]?.x ?? 0)
          const endpointY = branch.branchY + (nestedOffsets[index]?.y ?? 0)
          elements.push({
            id: `endpoint-${endpoint.id}`,
            type: 'endpoint',
            position: {
              x: endpointX,
              y: endpointY,
            },
            endpointId: endpoint.id,
            circuitId: cl.circuit.id,
          })
        })

        // Branch label — read from branch.label (source of truth).
        // Only show when non-empty, so circuits with endpoints but no explicit
        // branch label don't leak the raw circuit code as a label.
        if (branch.endpoints.length > 0) {
          const labelText = (branch.label ?? '').trim()
          if (!labelText) return
          elements.push({
            id: `branch-label-${branch.id}`,
            type: 'label',
            position: {
              x: (branch.labelX ?? branch.branchX) - LAYOUT_CONSTANTS.LABEL_OFFSET, // LOCAL coordinates; legs share the root label column
              y: branch.branchY,
            },
            label: labelText,
            branchId: branch.id,
            circuitId: cl.circuit.id,
          })
        }
      })

      // Trunk devices for nested circuit - positioned on vertical wire between MCB and branches
      const nestedTrunkDevices = cl.circuit.trunkDevices || []
      if (nestedTrunkDevices.length > 0) {
        // Find parent circuit layout to calculate MCB position
        const parentLayout = circuitLayouts.find((pcl) => pcl.circuit.id === cl.parentCircuit!.id)
        if (!parentLayout) return // Can't position trunk devices without parent

        // Find all nested circuits for this parent
        const allNestedForParent = circuitLayouts.filter(
          (ncl) => ncl.parentCircuit && ncl.parentCircuit.id === cl.parentCircuit!.id
        )

        // Calculate nested MCB Y position
        const parentBranches = branches.filter((b) => b.circuitId === parentLayout.circuit.id)
        let mcbY: number

        const parentHasEndpointBranchesForDevices = parentBranches.some(
          (b) => b.endpoints.length > 0
        )
        if (parentHasEndpointBranchesForDevices && parentLayout.secondaryBusY != null) {
          mcbY = parentLayout.secondaryBusY
        } else if (parentBranches.length > 0) {
          const topmostParentBranch = parentBranches.reduce((top, b) =>
            b.branchY < top.branchY ? b : top
          )
          mcbY = topmostParentBranch.branchY
        } else {
          mcbY = mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        }

        // Determine MCB X position
        let mcbX: number

        // Always offset MCB from virtual secondary bus (consistent with element creation above)
        mcbY = mcbY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

        if (allNestedForParent.length === 1) {
          mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
        } else if (allNestedForParent.length > 1) {
          mcbX = cl.x + getProtectionAnchorOffset(cl.leftReserve)
        } else {
          mcbX = parentLayout.x + getProtectionAnchorOffset(parentLayout.leftReserve)
        }

        const deviceX = mcbX // Same X as nested MCB (vertical wire center)

        // Calculate MCB Y position for trunk device positioning
        const mcbYForDevices = mcbY

        // Group trunk devices by position for layout
        nestedTrunkDevices.forEach((device) => {
          let deviceY: number
          const circuitBranchesLocal = nestedCircuitBranches
          const terminalDcBusBranch =
            device.type === 'dc_bus' &&
            circuitBranchesLocal.length === 1 &&
            circuitBranchesLocal[0]?.endpoints.length === 0
              ? circuitBranchesLocal[0]
              : undefined

          if (device.type === 'dc_bus' && !device.converterDcConnection) {
            // Keep an ordinary circuit DC rail on the same trunk row whether it
            // is empty or already has outgoing branches. Branch population is
            // rendered above this fixed rail and must not move the rail itself.
            const deviceIndex = nestedTrunkDevices.indexOf(device)
            const precedingDevices = nestedTrunkDevices.slice(0, Math.max(0, deviceIndex))
            const precedingDevice = precedingDevices.findLast(
              (candidate) => candidate.type !== 'dc_bus' && !candidate.converterDcConnection
            )
            const precedingDeviceIndex = precedingDevice
              ? precedingDevices.lastIndexOf(precedingDevice)
              : -1
            const precedingDevicePosition = precedingDevice
              ? mcbYForDevices -
                LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
                precedingDevices
                  .slice(0, precedingDeviceIndex)
                  .filter((candidate) => candidate.trunkPosition === precedingDevice.trunkPosition)
                  .length *
                  (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
              : undefined
            deviceY =
              precedingDevicePosition != null
                ? precedingDevicePosition - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
                : (terminalDcBusBranch?.branchY ??
                  mcbYForDevices - LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP)
          } else if (terminalDcBusBranch) {
            deviceY = terminalDcBusBranch.branchY
          } else if (device.trunkPosition === 0) {
            // Before all branches: position between MCB and first branch
            const devicesAtPos0Before = nestedTrunkDevices
              .filter((d) => d.trunkPosition === 0)
              .indexOf(device)
            deviceY =
              mcbYForDevices -
              LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
              devicesAtPos0Before *
                (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
          } else {
            // Between branches: position between branch (trunkPosition-1) and branch (trunkPosition)
            const branchAbove = circuitBranchesLocal[device.trunkPosition - 1]

            const gapY = getTrunkDeviceBranchGapY(device, nestedTrunkDevices, circuitBranchesLocal, LAYOUT_CONSTANTS)
            if (gapY != null) {
              deviceY = gapY
            } else if (branchAbove) {
              // After all branches (top-most): keep full spacing above branch,
              // then stack additional devices further up.
              const devicesAtSamePosBefore = nestedTrunkDevices
                .filter((d) => d.trunkPosition === device.trunkPosition)
                .indexOf(device)
              deviceY =
                device.type === 'dc_bus' && branchAbove.endpoints.length === 0
                  ? branchAbove.branchY
                  : branchAbove.branchY -
                    LAYOUT_CONSTANTS.BRANCH_START_OFFSET -
                    devicesAtSamePosBefore *
                      (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
            } else {
              // Fallback
              deviceY =
                mcbYForDevices -
                LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP
            }
          }

          elements.push({
            id: `trunkDevice-${device.id}`,
            type: 'trunkDevice',
            position: {
              x: deviceX, // LOCAL coordinates
              y: deviceY,
            },
            trunkDeviceId: device.id,
            circuitId: cl.circuit.id,
            label: device.label,
          })
        })
      }

      return
    }

    // Protection device (sits on vertical branch slightly up from main bus)
    // All protection types (MCB, RCD, RCBO, FUSE, etc.) that directly protect a circuit are positioned identically.
    //
    // Decide display label once:
    // - For circuits under a protection device: use the protection's label (can be empty).
    // - For direct circuits (no protection): use circuit.code.
    const displayLabel = cl.protection
      ? (cl.protection.label ?? '').trim()
      : (cl.circuit.code ?? '').trim()

    if (cl.protection) {
      // Protection position: on vertical branch, slightly up from main bus (LOCAL coordinates)
      // IMPORTANT: protection must be at the same X as branchX (protection center), not circuit center
      // This ensures the vertical wire and horizontal branch align correctly
      const mcbY =
        cl.circuit.supplySource?.kind === 'converter-backup'
          ? cl.protectionY
          : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
      const mcbX = cl.x + getProtectionAnchorOffset(cl.leftReserve) // Protection center, matches branchX

      // Only create protection element if one doesn't already exist (prevent duplicates)
      const protection = cl.protection
      if (protection && !elements.find((e) => e.id === `protection-${protection.id}`)) {
        elements.push({
          id: `protection-${protection.id}`,
          type: 'protection',
          position: {
            x: mcbX, // LOCAL coordinates
            y: mcbY,
          },
          protectionId: protection.id,
          circuitId: cl.circuit.id,
        })
      }

      // Circuit label is above horizontal backup protections and beside regular protections.
      // Only create label if one doesn't already exist (prevent duplicates) and we actually have a label.
      if (
        displayLabel &&
        !renderedProtectionLabelIds.has(protection.id) &&
        !elements.find((e) => e.id === `label-${cl.circuit.id}`)
      ) {
        const isHorizontalConverterBackup = cl.circuit.supplySource?.kind === 'converter-backup'
        elements.push({
          id: `label-${cl.circuit.id}`,
          type: 'label',
          position: {
            x: isHorizontalConverterBackup ? mcbX : mcbX + getProtectionLabelXOffset(cl.protection), // LOCAL coordinates
            y: isHorizontalConverterBackup
              ? mcbY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 - 3
              : mcbY + getProtectionLabelYOffset(cl.protection),
          },
          circuitId: cl.circuit.id,
          label: displayLabel,
        })
        renderedProtectionLabelIds.add(protection.id)
      }
    } else {
      // No protection device - keep label below main bus as fallback
      // Only create label if one doesn't already exist (prevent duplicates) and we actually have a label.
      if (displayLabel && !elements.find((e) => e.id === `label-${cl.circuit.id}`)) {
        elements.push({
          id: `label-${cl.circuit.id}`,
          type: 'label',
          position: {
            x: cl.x + cl.width / 2, // LOCAL coordinates
            y: mainBusY + 20,
          },
          circuitId: cl.circuit.id,
          label: displayLabel,
        })
      }
    }

    // RCD (if parent) - positioned on vertical line from main bus
    if (cl.parentRcd) {
      const trunk = trunks.find((t) => t.protectionId === cl.parentRcd!.id)
      if (trunk && cl.circuit.id === cl.parentRcd.circuits?.[0]?.id) {
        // Only add RCD element for first circuit in group
        // RCD sits on vertical line from main bus (going UP = lower Y)
        const rcdY = mainBusY - LAYOUT_CONSTANTS.RCD_VERTICAL_OFFSET
        // RCD X position is at the center of the trunk
        const rcdX = trunk.x + trunk.width / 2
        elements.push({
          id: `rcd-${cl.parentRcd.id}`,
          type: 'rcd',
          position: {
            x: rcdX, // LOCAL coordinates
            y: rcdY,
          },
          protectionId: cl.parentRcd.id,
        })
      }
    }

    // Trunk (visual element)
    if (cl.parentRcd) {
      const trunk = trunks.find((t) => t.protectionId === cl.parentRcd!.id)
      if (trunk) {
        elements.push({
          id: `trunk-visual-${trunk.id}`,
          type: 'trunk',
          position: {
            x: trunk.x, // LOCAL coordinates
            y: trunk.y,
          },
          width: trunk.width,
          height: LAYOUT_CONSTANTS.BUS_THICKNESS,
          trunkId: trunk.id,
        })
      }
    }

    // Trunk devices - positioned on the vertical wire between MCB and branches
    const trunkDevices = (cl.circuit.trunkDevices || []).filter(
      (device) => !device.converterDcConnection
    )
    if (trunkDevices.length > 0) {
      const deviceX = cl.x + getProtectionAnchorOffset(cl.leftReserve) // Same X as MCB (vertical wire center)

      // Calculate MCB Y position for this circuit
      const mcbYForDevices = cl.parentRcd
        ? (trunks.find((t) => t.protectionId === cl.parentRcd!.id)?.y ??
            mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET) - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        : cl.circuit.supplySource?.kind === 'converter-backup'
          ? cl.protectionY
          : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

      // Group trunk devices by position for layout
      trunkDevices.forEach((device) => {
        let deviceY: number
        const circuitBranchesLocal = branches.filter((b) => b.circuitId === cl.circuit.id)
        const terminalDcBusBranch =
          device.type === 'dc_bus' &&
          circuitBranchesLocal.length === 1 &&
          circuitBranchesLocal[0]?.endpoints.length === 0
            ? circuitBranchesLocal[0]
            : undefined

        if (device.type === 'dc_bus' && !device.converterDcConnection) {
          // Keep an ordinary circuit DC rail on the same trunk row whether it
          // is empty or already has outgoing branches. Branch population is
          // rendered above this fixed rail and must not move the rail itself.
          const deviceIndex = trunkDevices.indexOf(device)
          const precedingDevices = trunkDevices.slice(0, Math.max(0, deviceIndex))
          const precedingDevice = precedingDevices.findLast(
            (candidate) => candidate.type !== 'dc_bus' && !candidate.converterDcConnection
          )
          const precedingDeviceIndex = precedingDevice
            ? precedingDevices.lastIndexOf(precedingDevice)
            : -1
          const precedingDevicePosition = precedingDevice
            ? mcbYForDevices -
              LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
              precedingDevices
                .slice(0, precedingDeviceIndex)
                .filter((candidate) => candidate.trunkPosition === precedingDevice.trunkPosition)
                .length *
                (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
            : undefined
          deviceY =
            precedingDevicePosition != null
              ? precedingDevicePosition - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
              : (terminalDcBusBranch?.branchY ??
                mcbYForDevices - LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP)
        } else if (terminalDcBusBranch) {
          deviceY = terminalDcBusBranch.branchY
        } else if (device.trunkPosition === 0) {
          // Before all branches: position between MCB and first branch
          // Each device at position 0 stacks upward from MCB
          const devicesAtPos0Before = trunkDevices
            .filter((d) => d.trunkPosition === 0)
            .indexOf(device)
          deviceY =
            mcbYForDevices -
            LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
            devicesAtPos0Before *
              (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
        } else {
          // Between branches: position between branch (trunkPosition-1) and branch (trunkPosition)
          const branchAbove = circuitBranchesLocal[device.trunkPosition - 1]

          const gapY = getTrunkDeviceBranchGapY(device, trunkDevices, circuitBranchesLocal, LAYOUT_CONSTANTS)
          if (gapY != null) {
            deviceY = gapY
          } else if (branchAbove) {
            // After all branches (top-most): keep full spacing above branch,
            // then stack additional devices further up.
            const devicesAtSamePosBefore = trunkDevices
              .filter((d) => d.trunkPosition === device.trunkPosition)
              .indexOf(device)
            deviceY =
              device.type === 'dc_bus' && branchAbove.endpoints.length === 0
                ? branchAbove.branchY
                : branchAbove.branchY -
                  LAYOUT_CONSTANTS.BRANCH_START_OFFSET -
                  devicesAtSamePosBefore *
                    (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
          } else {
            // Fallback
            deviceY =
              mcbYForDevices -
              LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP
          }
        }

        elements.push({
          id: `trunkDevice-${device.id}`,
          type: 'trunkDevice',
          position: {
            x: deviceX, // LOCAL coordinates
            y: deviceY,
          },
          trunkDeviceId: device.id,
          circuitId: cl.circuit.id,
          label: device.label,
        })
      })
    }

    // Branch and endpoints - each endpoint has its own branch
    // Get all branches for this circuit
    const circuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)

    // Circuit notes: positions were precomputed in notesPositionMap (above circuit top, stacked for nested)
    const notesPos = notesPositionMap.get(cl.circuit.id)
    if (notesPos) {
      elements.push({
        id: `circuit-notes-${cl.circuit.id}`,
        type: 'label' as const,
        position: { x: notesPos.x, y: notesPos.y },
        label: notesPos.label,
        circuitId: cl.circuit.id,
        notesOrientation: notesPos.notesOrientation,
        notesVisible: notesPos.notesVisible,
      })
    }

    circuitBranches.forEach((branch) => {
      // Whole-circuit board references cap the trunk; output-fed boards belong
      // on their actual module row alongside its other endpoints.
      const normalEndpoints = branch.endpoints.filter((e) => e.symbol !== 'panel_distribution' || !!e.domoticaChildProps)
      const isHorizontalConverterBackup = cl.circuit.supplySource?.kind === 'converter-backup'
      const isDcBusBranch = !!cl.circuit.dcBusSource

      // Each branch is a horizontal line going right from the vertical branch
      // If the first endpoint is a switch, the visual line should start at the switch position
      const firstEndpoint = normalEndpoints[0]
      const hasSwitches = firstEndpoint?.type === 'switch'
      const branchVisualX = isDcBusBranch
        ? branch.branchX
        : isHorizontalConverterBackup
          ? branch.branchX
          : hasSwitches
            ? branch.branchX + LAYOUT_CONSTANTS.BRANCH_LEAD_IN // Start at first switch position
            : branch.branchX // Start at vertical connection point
      const branchVisualWidth = isDcBusBranch
        ? 0
        : isHorizontalConverterBackup
          ? branch.branchWidth
          : hasSwitches
            ? branch.branchWidth - LAYOUT_CONSTANTS.BRANCH_LEAD_IN // Adjust width when starting at switch position
            : branch.branchWidth // Full width when starting at branchX

      // Always create branch element (needed by tree builder for vertical wire).
      // For panel-only branches this will have width 0 so no horizontal line is drawn.
      elements.push({
        id: `branch-visual-${branch.id}`,
        type: 'branch',
        position: {
          x: branchVisualX, // LOCAL coordinates - adjusted for switches
          y: branch.branchY,
        },
        width: branchVisualWidth,
        height: LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH,
        branchId: branch.id,
        circuitId: cl.circuit.id,
      })

      // Multiple endpoints can be on the same branch, spaced horizontally (with appliance-after-socket gap)
      const endpointOffsets = getEndpointLayoutOffsets(
        normalEndpoints,
        LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
        LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
        LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
        LAYOUT_CONSTANTS.SYMBOL_SIZE
      )
      normalEndpoints.forEach((endpoint, index) => {
        const endpointOffset = endpointOffsets[index]
        const endpointX = isDcBusBranch
          ? branch.branchX
          : endpoint.domoticaChildProps
            ? branch.branchX + (endpointOffset?.x ?? 0)
            : isHorizontalConverterBackup
              ? branch.branchX +
                branch.branchWidth -
                ((endpointOffset?.x ?? 0) +
                  (LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING - LAYOUT_CONSTANTS.BRANCH_LEAD_IN))
              : branch.branchX + (branch.endpointXOffsets?.[index] ?? endpointOffset?.x ?? 0)
        const endpointY = branch.branchY + (endpointOffset?.y ?? 0)
        elements.push({
          id: `endpoint-${endpoint.id}`,
          type: 'endpoint',
          position: {
            x: endpointX,
            y: endpointY,
          },
          endpointId: endpoint.id,
          circuitId: cl.circuit.id,
          mirrorEndpointHorizontally: isHorizontalConverterBackup,
        })
      })

      // Label on the left at the same height as this horizontal branch
      // Read from branch.label (source of truth shared by all endpoints on the branch).
      // Only show label if there are actual (non-panel) endpoints AND a non-empty label.
      if (normalEndpoints.length > 0) {
        const labelText = (branch.label ?? '').trim()
        if (!labelText) return
        elements.push({
          id: `branch-label-${branch.id}`,
          type: 'label',
          position: {
            // Anchor the RIGHT edge of the label at a fixed distance
            // left of the trunk wire. CircuitLabel uses left-aligned
            // text with an 80px width for branch labels, so we shift
            // by that width here.
            x: (branch.labelX ?? branch.branchX) - LAYOUT_CONSTANTS.LABEL_OFFSET, // LOCAL coordinates; legs share the root label column
            y: branch.branchY,
          },
          label: labelText,
          branchId: branch.id,
          circuitId: cl.circuit.id,
        })
      }
    })
  })

  // Add RCD elements for RCDs with 0 circuits
  panel.protections.forEach((protection) => {
    if (
      (protection.type === 'RCD' || protection.type === 'RCBO') &&
      (!protection.circuits || protection.circuits.length === 0)
    ) {
      const trunk = trunks.find((t) => t.protectionId === protection.id)
      if (trunk) {
        // RCD sits on vertical line from main bus (going UP = lower Y)
        const rcdY = mainBusY - LAYOUT_CONSTANTS.RCD_VERTICAL_OFFSET
        const rcdX = trunk.x + trunk.width / 2
        elements.push({
          id: `rcd-${protection.id}`,
          type: 'rcd',
          position: {
            x: rcdX, // LOCAL coordinates
            y: rcdY,
          },
          protectionId: protection.id,
        })
      }
    }
  })

  // A circuit owned by a converter-linked DC bus is a real secondary-bus
  // branch. Its protection and endpoint subtree belongs above that rail, not
  // near the panel main bus where generic nested-circuit placement starts.
  // Move the bottom-up source geometry here so painting, hit zones, debug
  // envelopes, frame bounds, and exported layout all share one position.
  const shiftedDcBusCircuitIds = new Set<string>()
  for (const parentLayout of circuitLayouts) {
    for (const dcBus of (parentLayout.circuit.trunkDevices ?? []).filter(
      (device) => device.type === 'dc_bus' && !!device.converterDcConnection
    )) {
      const converter = (parentLayout.circuit.trunkDevices ?? []).find(
        (device) => device.id === dcBus.converterDcConnection?.converterId
      )
      const converterElement = converter
        ? elements.find(
            (element) => element.type === 'trunkDevice' && element.trunkDeviceId === converter.id
          )
        : undefined
      if (!converter || !converterElement) continue

      const busY = getOrdinaryCircuitConverterOutputRowY(
        converter,
        converterElement.position.y,
        dcBus.converterDcConnection!.connectionIndex
      )
      const declaredRootIds = dcBus.dcBusProps?.branchCircuitIds ?? []
      const ownedRootIds = [
        ...declaredRootIds,
        ...(parentLayout.circuit.subCircuitIds ?? []).filter(
          (id) =>
            !declaredRootIds.includes(id) && circuitMap.get(id)?.dcBusSource?.busId === dcBus.id
        ),
      ]

      for (const rootId of ownedRootIds) {
        if (shiftedDcBusCircuitIds.has(rootId)) continue
        const rootLayout = circuitLayouts.find((layout) => layout.circuit.id === rootId)
        const rootProtectionElement = rootLayout?.protection
          ? elements.find(
              (element) =>
                element.type === 'protection' &&
                element.circuitId === rootId &&
                element.protectionId === rootLayout.protection!.id
            )
          : undefined
        if (!rootLayout || !rootProtectionElement) continue

        const descendantIds = new Set<string>()
        const collectDescendants = (circuitId: string) => {
          if (descendantIds.has(circuitId)) return
          descendantIds.add(circuitId)
          for (const childId of circuitMap.get(circuitId)?.subCircuitIds ?? []) {
            collectDescendants(childId)
          }
        }
        collectDescendants(rootId)
        const dy = busY - LAYOUT_CONSTANTS.MCB_Y_OFFSET - rootProtectionElement.position.y

        for (const element of elements) {
          if (element.circuitId && descendantIds.has(element.circuitId)) {
            element.position.y += dy
          }
        }
        for (const branch of branches) {
          if (!descendantIds.has(branch.circuitId)) continue
          branch.branchY += dy
          branch.trunkY += dy
        }
        for (const note of circuitNotesLocal) {
          if (descendantIds.has(note.circuitId)) note.y += dy
        }
        for (const layout of circuitLayouts) {
          if (!descendantIds.has(layout.circuit.id)) continue
          layout.protectionY += dy
          if (layout.trunkY != null) layout.trunkY += dy
          if (layout.secondaryBusY != null) layout.secondaryBusY += dy
        }
        descendantIds.forEach((id) => shiftedDcBusCircuitIds.add(id))

        const shiftedElements = elements.filter(
          (element) => element.circuitId && descendantIds.has(element.circuitId)
        )
        minY = Math.min(
          minY,
          busY - LAYOUT_CONSTANTS.SYMBOL_SIZE,
          ...shiftedElements.map((element) => element.position.y - LAYOUT_CONSTANTS.SYMBOL_SIZE)
        )
      }
    }
  }

  // DC-bus endpoints are materialized as layout-tree children of the bus, not
  // as top-level BottomUp elements. Include their vertical extent in the panel
  // envelope so the frame and debug division box surround the complete rail
  // subtree instead of stopping at the main bus.
  const circuitById = new Map(circuitLayouts.map((layout) => [layout.circuit.id, layout.circuit]))
  const dcBusBranchStep = LAYOUT_CONSTANTS.SYMBOL_SIZE + LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING
  for (const circuitLayout of circuitLayouts) {
    const circuit = circuitById.get(circuitLayout.circuit.id)
    if (!circuit) continue

    for (const device of circuit.trunkDevices ?? []) {
      const deviceElement = elements.find((element) =>
        element.type === 'trunkDevice' && element.trunkDeviceId === device.id)
      if (deviceElement) {
        minY = Math.min(minY, deviceElement.position.y -
          getTrunkDeviceVerticalPaintHeight(device, LAYOUT_CONSTANTS.SYMBOL_SIZE) / 2 - 4)
      }
    }

    for (const bus of (circuit.trunkDevices ?? []).filter((device) => device.type === 'dc_bus')) {
      let busY = elements.find(
        (element) => element.type === 'trunkDevice' && element.trunkDeviceId === bus.id
      )?.position.y

      if (busY == null && bus.converterDcConnection) {
        const converterElement = elements.find(
          (element) =>
            element.type === 'trunkDevice' &&
            element.trunkDeviceId === bus.converterDcConnection?.converterId
        )
        const converter = circuit.trunkDevices?.find(
          (device) => device.id === bus.converterDcConnection?.converterId
        )
        if (converterElement && converter) {
          busY = getOrdinaryCircuitConverterOutputRowY(
            converter,
            converterElement.position.y,
            bus.converterDcConnection.connectionIndex
          )
        }
      }
      if (busY == null) continue

      minY = Math.min(minY, busY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 - 4)
      for (const branch of (circuit.branches ?? []).filter(
        (candidate) => candidate.dcBusId === bus.id
      )) {
        const branchItemCount = (branch.branchDevices?.length ?? 0) + branch.endpointIds.length
        if (branchItemCount === 0) continue
        const topEndpointY = busY - branchItemCount * dcBusBranchStep
        // Layout-tree endpoint bounds use the symbol's top-left Y, unlike the
        // centered BottomUp element positions.
        minY = Math.min(minY, topEndpointY - 4)

        // A branch-local converter replaces the ordinary serial content above
        // it with output rows, including its first A1 row at width one. Those rows are created
        // later by the layout tree, so reserve their exact vertical envelope
        // here before the panel frame is solved.
        const directBranchDevices = (branch.branchDevices ?? []).filter(
          (device) => !device.converterDcConnection
        )
        directBranchDevices.forEach((device, deviceIndex) => {
          if (!supportsCircuitConverterDcConnections(device)) {
            return
          }
          const converterY = busY - (deviceIndex + 1) * dcBusBranchStep
          const topOutputY = getOrdinaryCircuitConverterOutputRowY(
            device,
            converterY,
            getCircuitConverterDcConnectionCount(device) - 1
          )
          minY = Math.min(minY, topOutputY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 - 8)
          const nestedCallouts = getCircuitConverterMetadataCallouts({
            circuit,
            device,
            anchor: { x: 0, y: converterY },
            symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
            applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
          })
          for (const callout of nestedCallouts.values()) {
            minY = Math.min(minY, callout.rect.top - 12)
          }
        })
      }
    }
  }

  return {
    minY,
  }
}

export type BottomUpCircuitElementsPass = ReturnType<typeof buildPanelCircuitElements>
