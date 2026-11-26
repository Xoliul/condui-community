import type { WireSegment } from '@/types/schema'
import {
  isHorizontalSupplyTrunkSegment,
  isMainSupplyVerticalWireSegment,
} from '@/lib/wireTextLabel'
import {
  resolveShowFireClassLabel,
  resolveShowWireLengthLabel,
} from '@/lib/wires/circuitWireDefaults'

export function isSupplyWireSegmentForLabel(wireSegment: WireSegment): boolean {
  return (
    wireSegment.isSupplyTrunk === true ||
    wireSegment.isSubPanelSupply === true ||
    wireSegment.supplySectionKey != null ||
    wireSegment.supplyConnectionId != null ||
    isMainSupplyVerticalWireSegment(wireSegment)
  )
}

export function isBusBarProtectionStubSegment(wireSegment: WireSegment): boolean {
  return (
    wireSegment.type === 'vertical' &&
    wireSegment.toElementType === 'protection' &&
    (wireSegment.fromElementType === 'mainBus' || wireSegment.fromElementType === 'secondaryBus')
  )
}

export function isRouteIndicatorVisibleForSegment(wireSegment: WireSegment): boolean {
  // The crossbar and risers of a circuit in columns are the trunk's cable, not another run.
  if (wireSegment.trunkContinuation) return false
  const isVertical = wireSegment.startPoint.x === wireSegment.endPoint.x
  if (isSupplyWireSegmentForLabel(wireSegment)) {
    return !isBusBarProtectionStubSegment(wireSegment)
  }
  return (
    isVertical &&
    wireSegment.type === 'vertical' &&
    !isHorizontalSupplyTrunkSegment(wireSegment) &&
    !isBusBarProtectionStubSegment(wireSegment)
  )
}

export function isWireLabelVisibleForSegment(wireSegment: WireSegment): boolean {
  if (wireSegment.supplyMergedIntoBusDrop || wireSegment.trunkContinuation) return false
  if (isSupplyWireSegmentForLabel(wireSegment)) {
    if (wireSegment.hideWireLabel === true) return false
    if (wireSegment.hideWireLabel === false) return true
    // A secondary board's incoming cable is the ordinary feeder circuit,
    // not an optional installation-supply caption. Keep its specifications
    // visible on the physical cable, before any local incoming device.
    return wireSegment.isSubPanelSupply === true &&
      wireSegment.fromElementId === wireSegment.feederProtectionId
  }

  if (wireSegment.type !== 'vertical') return false
  const isBusStub = isBusBarProtectionStubSegment(wireSegment)
  if (isBusStub && !wireSegment.showWireLabelOnBusStub) return false

  if (wireSegment.hideWireLabel === true) return false
  if (wireSegment.hideWireLabel === false) return true

  const isCircuitProtectionOutput =
    wireSegment.fromElementType === 'protection' && wireSegment.toElementType !== 'protection'
  const isMergedPanelFeederBusToEndpoint =
    !!wireSegment.feederProtectionId &&
    !!wireSegment.circuitId &&
    (wireSegment.fromElementType === 'mainBus' || wireSegment.fromElementType === 'secondaryBus') &&
    wireSegment.toElementType === 'endpoint'
  if (wireSegment.showWireLabelOnBusStub) return true
  if (isMergedPanelFeederBusToEndpoint) return true
  return isCircuitProtectionOutput
}

export function isFireClassLabelVisibleForSegment(wireSegment: WireSegment): boolean {
  const domain = wireSegment.domain ?? 'AC'
  if (!resolveShowFireClassLabel(wireSegment.showFireClassLabel, domain)) return false
  if (!wireSegment.cable.fireClass) return false
  if (wireSegment.supplyMergedIntoBusDrop) return false
  if (!isWireLabelVisibleForSegment(wireSegment)) return false
  return true
}

export function isWireLengthLabelVisibleForSegment(wireSegment: WireSegment): boolean {
  if (!resolveShowWireLengthLabel(wireSegment.showWireLengthLabel)) return false
  if (wireSegment.wireLengthM == null || wireSegment.wireLengthM <= 0) return false
  if (wireSegment.supplyMergedIntoBusDrop) return false
  if (!isWireLabelVisibleForSegment(wireSegment)) return false
  return true
}
