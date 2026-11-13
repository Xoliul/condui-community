/** Column-aware circuit note stacking and label collision clearance. */
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'

import { getProtectionAnchorOffset } from './bottomUpPanelTransforms'

import type { TrunkDevice } from '@/types/schema'

import { getTrunkDeviceBranchGapY } from './bottomUpBranchPass'

import {
  CIRCUIT_NOTES_HORIZONTAL_SLICE_CLEARANCE,
  CIRCUIT_NOTES_LINE_HEIGHT,
  CIRCUIT_NOTES_VERTICAL_SLICE_CLEARANCE,
  estimateCircuitNotesBlockHeight,
  getCircuitNotesPaintBounds,
  normalizeCircuitNotesText,
} from './circuitNoteMetrics'

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
  CIRCUIT_NOTES_VERTICAL_OFFSET,
  getTopmostCircuitBranch,
  getCircuitLineTopY,
} from './bottomUpCircuitGeometry'

import type { BottomUpCircuitLayoutPass } from './bottomUpCircuitLayout'

import type { BottomUpSupplyMetadataPass } from './bottomUpSupplyMetadata'

type PlacePanelCircuitNotesInput =
  Pick<BottomUpPanelLayoutInput, 'installation'> &
  Pick<
    BottomUpCircuitLayoutPass,
    | 'circuitLayouts'
    | 'mainBusY'
    | 'trunks'
    | 'branches'
  > &
  Pick<BottomUpSupplyMetadataPass, 'minY'> &
  Pick<BottomUpSupplyElements, 'elements'>

export function placePanelCircuitNotes(input: PlacePanelCircuitNotesInput) {
  const {
    installation,
    circuitLayouts,
    mainBusY,
    trunks,
    branches,
    elements,
  } = input
  let {
    minY,
  } = input
  // Precompute circuit notes positions: reserve a slot for every circuit with notes (ignore notesVisible so layout is stable)
  // Notes are stacked per vertical trunk and must sit above the *entire* circuit tree:
  // parent circuit + all nested sub‑circuits that hang from the same trunk / secondary bus.
  // Note blocks use the same explicit-line and word-wrap metrics as the renderer.
  const NOTES_BLOCK_GAP = 4
  const notesPositionMap = new Map<
    string,
    {
      x: number
      y: number
      label: string
      notesOrientation: 'horizontal' | 'vertical'
      notesVisible: boolean
    }
  >()
  let circuitNotesLocal: Array<{
    circuitId: string
    x: number
    y: number
    label: string
    notesOrientation: 'horizontal' | 'vertical'
    notesVisible: boolean
  }> = []
  {
    // Index layouts and sub‑circuit relationships so we can compute a "top Y" per circuit.
    // IMPORTANT: We do this per-column (trunkX), so a tall subcircuit in a different
    // secondary-bus column does not push parent/sibling notes further up.
    const layoutByCircuitId = new Map<string, (typeof circuitLayouts)[number]>()
    for (const cl of circuitLayouts) {
      layoutByCircuitId.set(cl.circuit.id, cl)
    }

    const childrenByCircuitId = new Map<string, string[]>()
    for (const cl of circuitLayouts) {
      const subIds = cl.circuit.subCircuitIds ?? []
      if (subIds.length === 0) continue
      childrenByCircuitId.set(cl.circuit.id, [
        ...(childrenByCircuitId.get(cl.circuit.id) ?? []),
        ...subIds,
      ])
    }

    // Precompute a column key (rounded trunkX) for each circuit so recursion can be column-aware.
    const columnKeyByCircuitId = new Map<string, number>()

    const computeTrunkX = (cl: (typeof circuitLayouts)[number]): number => {
      const circuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)
      const topmostBranch =
        circuitBranches.length > 0
          ? circuitBranches.reduce((top, branch) => (branch.branchY < top.branchY ? branch : top))
          : null

      if (topmostBranch) {
        return topmostBranch.trunkX
      }

      if (cl.parentRcd) {
        const trunk = trunks.find((t) => t.protectionId === cl.parentRcd!.id)
        if (trunk) {
          return trunk.x + trunk.width / 2
        }
        return cl.x + getProtectionAnchorOffset(cl.leftReserve)
      }

      return cl.x + getProtectionAnchorOffset(cl.leftReserve)
    }

    for (const cl of circuitLayouts) {
      columnKeyByCircuitId.set(cl.circuit.id, Math.round(computeTrunkX(cl)))
    }

    const circuitTopYInColumnCache = new Map<string, number>()

    const getTrunkDeviceYBeforeElements = (
      cl: (typeof circuitLayouts)[number],
      device: TrunkDevice
    ): number | undefined => {
      // Circuit notes are solved before the drawable elements are materialized.
      // Mirror trunk-device positioning for both ordinary and nested circuits
      // so notes clear the whole device stack before elements are materialized.
      const trunkDevices = cl.parentCircuit
        ? (cl.circuit.trunkDevices ?? [])
        : (cl.circuit.trunkDevices ?? []).filter((candidate) => !candidate.converterDcConnection)
      if (!trunkDevices.includes(device)) return undefined

      const circuitBranches = branches.filter((branch) => branch.circuitId === cl.circuit.id)
      let mcbYForDevices = cl.parentRcd
        ? (trunks.find((trunk) => trunk.protectionId === cl.parentRcd!.id)?.y ??
            mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET) - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        : cl.circuit.supplySource?.kind === 'converter-backup'
          ? cl.protectionY
          : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
      if (cl.parentCircuit) {
        const parentLayout = layoutByCircuitId.get(cl.parentCircuit.id)
        if (!parentLayout) return undefined
        const parentBranches = branches.filter(
          (branch) => branch.circuitId === parentLayout.circuit.id
        )
        const topmostParentBranch = getTopmostCircuitBranch(parentBranches)
        const parentLineEndY =
          parentBranches.some((branch) => branch.endpoints.length > 0) &&
          parentLayout.secondaryBusY != null
            ? parentLayout.secondaryBusY
            : (topmostParentBranch?.branchY ?? mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET)
        mcbYForDevices = parentLineEndY - LAYOUT_CONSTANTS.MCB_Y_OFFSET
      }
      const terminalDcBusBranch =
        device.type === 'dc_bus' &&
        circuitBranches.length === 1 &&
        circuitBranches[0]?.endpoints.length === 0
          ? circuitBranches[0]
          : undefined

      if (device.type === 'dc_bus' && !device.converterDcConnection) {
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
        return precedingDevicePosition != null
          ? precedingDevicePosition - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
          : (terminalDcBusBranch?.branchY ?? mcbYForDevices - LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP)
      }

      if (terminalDcBusBranch) return terminalDcBusBranch.branchY
      if (device.trunkPosition === 0) {
        const devicesAtPositionBefore = trunkDevices
          .filter((candidate) => candidate.trunkPosition === 0)
          .indexOf(device)
        return (
          mcbYForDevices -
          LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP -
          devicesAtPositionBefore *
            (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
        )
      }

      const branchAbove = circuitBranches[device.trunkPosition - 1]
      const gapY = getTrunkDeviceBranchGapY(device, trunkDevices, circuitBranches, LAYOUT_CONSTANTS)
      if (gapY != null) return gapY
      if (branchAbove) {
        const devicesAtSamePositionBefore = trunkDevices
          .filter((candidate) => candidate.trunkPosition === device.trunkPosition)
          .indexOf(device)
        return (
          branchAbove.branchY -
          LAYOUT_CONSTANTS.BRANCH_START_OFFSET -
          devicesAtSamePositionBefore *
            (LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING + LAYOUT_CONSTANTS.SYMBOL_SIZE)
        )
      }
      return (
        mcbYForDevices -
        LAYOUT_CONSTANTS.TRUNK_DEVICE_MCB_GAP
      )
    }

    const computeOwnTopY = (cl: (typeof circuitLayouts)[number]): number => {
      const circuitBranches = branches.filter((b) => b.circuitId === cl.circuit.id)

      // No branches: use the top of the "free" trunk wire above the MCB so spacing
      // matches circuits that *do* have branches (whose first branch sits at roughly
      // MCB - BRANCH_START_OFFSET).
      const mcbY = cl.parentRcd
        ? (trunks.find((t) => t.protectionId === cl.parentRcd!.id)?.y ??
            mainBusY - LAYOUT_CONSTANTS.RCD_TRUNK_OFFSET) - LAYOUT_CONSTANTS.MCB_Y_OFFSET
        : mainBusY - LAYOUT_CONSTANTS.MCB_Y_OFFSET

      const hasSubPanelAtLineEnd = !!cl.protection?.subPanelId
      let topY = getCircuitLineTopY(circuitBranches, mcbY, hasSubPanelAtLineEnd)
      const topBranchWireY =
        getTopmostCircuitBranch(circuitBranches)?.branchY ??
        mcbY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
      const dcBusStep = LAYOUT_CONSTANTS.SYMBOL_SIZE + LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING

      // A device above the final branch extends the circuit beyond that branch.
      // Include its painted height (including tall converter specs) in the same
      // top bound used to stack notes for this circuit and its parent column.
      let topmostTrunkDevice: { device: TrunkDevice; y: number } | undefined
      for (const device of cl.circuit.trunkDevices ?? []) {
        const deviceY =
          elements.find(
            (element) => element.type === 'trunkDevice' && element.trunkDeviceId === device.id
          )?.position.y ?? getTrunkDeviceYBeforeElements(cl, device)
        if (deviceY == null) continue
        if (!topmostTrunkDevice || deviceY < topmostTrunkDevice.y) {
          topmostTrunkDevice = { device, y: deviceY }
        }
        topY = Math.min(
          topY,
          deviceY - getTrunkDeviceVerticalPaintHeight(device, LAYOUT_CONSTANTS.SYMBOL_SIZE) / 2
        )
      }
      if (topmostTrunkDevice && topmostTrunkDevice.y <= topBranchWireY) {
        // layoutTree and deriveWires extend the trunk above a topmost device.
        // Notes must clear that wire stub as well as the device's painted body.
        const { device, y } = topmostTrunkDevice
        const hasUpperTrunkStub =
          device.type !== 'dc_bus' &&
          !(supportsCircuitConverterDcConnections(device) &&
            getCircuitConverterDcConnectionCount(device) > 1)
        if (hasUpperTrunkStub) {
          topY = Math.min(topY, y - LAYOUT_CONSTANTS.BRANCH_START_OFFSET)
        }
      }

      for (const bus of (cl.circuit.trunkDevices ?? []).filter(
        (device) => device.type === 'dc_bus'
      )) {
        let busY = elements.find(
          (element) => element.type === 'trunkDevice' && element.trunkDeviceId === bus.id
        )?.position.y
        busY ??= getTrunkDeviceYBeforeElements(cl, bus)
        if (busY == null && bus.converterDcConnection) {
          const converter = cl.circuit.trunkDevices?.find(
            (device) => device.id === bus.converterDcConnection?.converterId
          )
          const converterElement = converter
            ? elements.find(
                (element) =>
                  element.type === 'trunkDevice' && element.trunkDeviceId === converter.id
              )
            : undefined
          if (converter && converterElement) {
            busY = getOrdinaryCircuitConverterOutputRowY(
              converter,
              converterElement.position.y,
              bus.converterDcConnection.connectionIndex
            )
          }
        }
        if (busY == null) continue

        const nestedConverterIds = new Set(
          (cl.circuit.branches ?? []).flatMap((branch) =>
            (branch.branchDevices ?? []).flatMap((device) =>
              supportsCircuitConverterDcConnections(device) ? [device.id] : []
            )
          )
        )
        for (const branch of (cl.circuit.branches ?? []).filter(
          (candidate) => candidate.dcBusId === bus.id
        )) {
          const directDevices = (branch.branchDevices ?? []).filter(
            (device) =>
              !device.converterDcConnection ||
              !nestedConverterIds.has(device.converterDcConnection.converterId)
          )
          const directEndpointCount = branch.endpointIds.filter((endpointId) => {
            const endpoint = cl.circuit.endpoints.find((candidate) => candidate.id === endpointId)
            return (
              !endpoint?.converterDcConnection ||
              !nestedConverterIds.has(endpoint.converterDcConnection.converterId)
            )
          }).length
          const directItemCount = directDevices.length + directEndpointCount
          if (directItemCount > 0) {
            topY = Math.min(
              topY,
              busY - directItemCount * dcBusStep - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
            )
          }

          directDevices.forEach((device, deviceIndex) => {
            if (!supportsCircuitConverterDcConnections(device)) return
            const converterY = busY - (deviceIndex + 1) * dcBusStep
            const topOutputY = getOrdinaryCircuitConverterOutputRowY(
              device,
              converterY,
              getCircuitConverterDcConnectionCount(device) - 1
            )
            topY = Math.min(topY, topOutputY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
            const callouts = getCircuitConverterMetadataCallouts({
              circuit: cl.circuit,
              device,
              anchor: { x: 0, y: converterY },
              symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
              applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
            })
            for (const callout of callouts.values()) {
              topY = Math.min(topY, callout.rect.top)
            }
          })
        }
      }

      return topY
    }

    const getCircuitTopYInColumn = (circuitId: string): number => {
      const cached = circuitTopYInColumnCache.get(circuitId)
      if (cached != null) return cached

      const cl = layoutByCircuitId.get(circuitId)
      if (!cl) {
        // Should not happen, but keep layout robust.
        const fallback = mainBusY
        circuitTopYInColumnCache.set(circuitId, fallback)
        return fallback
      }

      let topY = computeOwnTopY(cl)
      const myKey = columnKeyByCircuitId.get(circuitId)

      const childIds = childrenByCircuitId.get(circuitId) ?? []
      for (const childId of childIds) {
        // Only consider descendants that live in the SAME column (same trunkX key).
        if (myKey != null && columnKeyByCircuitId.get(childId) !== myKey) continue
        const childTopY = getCircuitTopYInColumn(childId)
        topY = Math.min(topY, childTopY)
      }

      circuitTopYInColumnCache.set(circuitId, topY)
      return topY
    }

    const pendingNotes: Array<{
      circuitId: string
      trunkX: number
      topY: number
      label: string
      notesOrientation: 'horizontal' | 'vertical'
      notesVisible: boolean
    }> = []

    const globalOrientation: 'horizontal' | 'vertical' =
      installation?.circuitNotesOrientation ?? 'horizontal'

    for (const cl of circuitLayouts) {
      if (!cl.circuit.notes?.trim()) continue

      const trunkX = computeTrunkX(cl)
      const topY = getCircuitTopYInColumn(cl.circuit.id)

      pendingNotes.push({
        circuitId: cl.circuit.id,
        trunkX,
        topY,
        label: normalizeCircuitNotesText(cl.circuit.notes),
        // Pass through global orientation so render/export and envelope layout agree.
        notesOrientation: globalOrientation,
        notesVisible: cl.circuit.notesVisible !== false,
      })
    }

    const byTrunkX = new Map<number, typeof pendingNotes>()
    for (const n of pendingNotes) {
      const key = Math.round(n.trunkX)
      if (!byTrunkX.has(key)) byTrunkX.set(key, [])
      byTrunkX.get(key)!.push(n)
    }

    for (const group of byTrunkX.values()) {
      // Circuits that start higher on screen (smaller Y) conceptually own more
      // vertical space; sort by their subtree top and then stack upwards.
      group.sort((a, b) => a.topY - b.topY)

      // Horizontal notes stack by their complete wrapped block height. Rotated notes
      // pack along X by that same height, because it becomes their painted width.
      const groupOrientation = group[0]?.notesOrientation ?? 'horizontal'

      if (groupOrientation === 'vertical') {
        const blockWidths = group.map((note) => estimateCircuitNotesBlockHeight(note.label))
        const totalWidth =
          blockWidths.reduce((sum, width) => sum + width, 0) +
          NOTES_BLOCK_GAP * Math.max(0, group.length - 1)
        let cursorX = group[0]!.trunkX + totalWidth / 2
        for (const [index, n] of group.entries()) {
          const blockWidth = blockWidths[index] ?? CIRCUIT_NOTES_LINE_HEIGHT
          const desiredY = n.topY - CIRCUIT_NOTES_VERTICAL_OFFSET
          const notesX = cursorX - blockWidth / 2
          cursorX -= blockWidth + NOTES_BLOCK_GAP
          notesPositionMap.set(n.circuitId, {
            x: notesX,
            y: desiredY,
            label: n.label,
            notesOrientation: n.notesOrientation,
            notesVisible: n.notesVisible,
          })
        }
      } else {
        let nextAnchorY = Infinity
        for (const n of group) {
          const desiredY = n.topY - 25
          const blockHeight = estimateCircuitNotesBlockHeight(n.label)
          const notesY = Math.min(desiredY + 4, nextAnchorY)
          nextAnchorY = notesY - blockHeight - NOTES_BLOCK_GAP
          notesPositionMap.set(n.circuitId, {
            x: n.trunkX,
            y: notesY,
            label: n.label,
            notesOrientation: n.notesOrientation,
            notesVisible: n.notesVisible,
          })
        }
      }
    }

    // Materialize once so consumers don't depend on elements array shape/order.
    circuitNotesLocal = Array.from(notesPositionMap.entries()).map(([circuitId, pos]) => {
      return {
        circuitId,
        x: pos.x,
        y: pos.y,
        label: pos.label,
        notesOrientation: pos.notesOrientation,
        notesVisible: pos.notesVisible,
      }
    })
  }

  // Ensure the panel frame includes circuit notes (they sit above circuits).
  if (circuitNotesLocal.length > 0) {
    for (const note of circuitNotesLocal) {
      if (!note.notesVisible) continue
      const paintBounds = getCircuitNotesPaintBounds(note.label, note.notesOrientation)
      const extraClearance =
        note.notesOrientation === 'vertical'
          ? CIRCUIT_NOTES_VERTICAL_SLICE_CLEARANCE
          : CIRCUIT_NOTES_HORIZONTAL_SLICE_CLEARANCE
      minY = Math.min(minY, note.y + paintBounds.top - extraClearance)
    }
  }

  return {
    notesPositionMap,
    circuitNotesLocal,
    minY,
  }
}

export type BottomUpCircuitNotesPass = ReturnType<typeof placePanelCircuitNotes>
