let manualPlanPlacement = false

/**
 * Mirrors the user's "place new symbols on the plan myself" preference, kept in sync by the
 * settings store. While on, new automatic placements wait off-plan until the user places them.
 */
export function setManualPlanPlacement(enabled: boolean): void {
  manualPlanPlacement = enabled
}

export function isManualPlanPlacementEnabled(): boolean {
  return manualPlanPlacement
}
