import { useMemo } from 'react'
import type { Floor } from '@/types/schema'
import { useUIStore } from '@/stores/uiStore'
import { clamp } from '@/lib/geometry'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import {
  DEFAULT_SYMBOL_SIZE_CM,
  MIN_SYMBOL_SIZE_CM,
  MAX_SYMBOL_SIZE_CM,
  PLAN_SYMBOL_FALLBACK_PX,
  PLAN_LABEL_FONT_SIZE_AT_FALLBACK,
} from '@/constants/planConstants'

/** Label scale factor vs symbol size: 20 cm = 1.3 (30% bigger), 10 cm = 0.7 (30% smaller), 50 cm = 2.0 (double). */
function getLabelScaleFactor(symbolSizeCm: number): number {
  const cm = clamp(symbolSizeCm, MIN_SYMBOL_SIZE_CM, MAX_SYMBOL_SIZE_CM)
  if (cm <= DEFAULT_SYMBOL_SIZE_CM) {
    return 0.7 + (1.3 - 0.7) * (cm - MIN_SYMBOL_SIZE_CM) / (DEFAULT_SYMBOL_SIZE_CM - MIN_SYMBOL_SIZE_CM)
  }
  return 1.3 + (2.0 - 1.3) * (cm - DEFAULT_SYMBOL_SIZE_CM) / (MAX_SYMBOL_SIZE_CM - DEFAULT_SYMBOL_SIZE_CM)
}

/**
 * Calculate pixels per meter from floor scale.
 *
 * Shared helper so all plan scale consumers stay in sync.
 */
export function calculatePxPerMeter(floor: Floor | null): number | null {
  return resolvePlanPxPerMeter(floor?.scale)
}

/**
 * Hook to calculate scale-related values for plan canvas.
 * Symbol size comes from the active floor when set (export/import), else the visibility
 * panel / persisted UI default (default 20 cm).
 */
export function usePlanScale(activeFloor: Floor | null) {
  const pxPerMeter = useMemo(() => calculatePxPerMeter(activeFloor), [activeFloor])
  const symbolSizeCmFromUi = useUIStore((s) => s.planVisibility.symbolSizeCm ?? DEFAULT_SYMBOL_SIZE_CM)
  const symbolSizeCm = Math.max(
    MIN_SYMBOL_SIZE_CM,
    Math.min(
      MAX_SYMBOL_SIZE_CM,
      activeFloor?.sitplanSymbolSizeCm ?? symbolSizeCmFromUi
    )
  )
  const planGridSize = useUIStore((s) => s.planView.gridSize)

  const baseSymbolSizePx = useMemo(
    () => {
      // When a real floor scale is known, derive symbol size directly from pxPerMeter.
      if (pxPerMeter != null) {
        return (symbolSizeCm / 100) * pxPerMeter
      }

      // No calibrated scale: tie symbol size robustly to the plan grid so their
      // physical ratio stays correct across projects.
      //
      // Semantics:
      // - Grid slider is expressed in centimeters (e.g. 25 = 25 cm).
      // - When there is no scale, grid world units map 1:1 to screen pixels,
      //   so planView.gridSize is both the numeric cm value and the pixel spacing.
      //
      // We therefore choose:
      //   symbol_px / grid_px  =  symbol_cm / grid_cm
      //   ⇒ symbol_px = grid_px * (symbol_cm / grid_cm)
      //
      // This makes a 20 cm symbol exactly 0.8 of a 25 cm grid cell even on
      // uncalibrated floors.
      if (!Number.isFinite(planGridSize) || planGridSize <= 0) {
        // Fallback: preserve previous behaviour if grid size is somehow invalid.
        return PLAN_SYMBOL_FALLBACK_PX * (symbolSizeCm / DEFAULT_SYMBOL_SIZE_CM)
      }

      const gridStepPx = planGridSize
      const gridStepCm = planGridSize
      const symbolToGridRatio = symbolSizeCm / gridStepCm
      return gridStepPx * symbolToGridRatio
    },
    [pxPerMeter, symbolSizeCm, planGridSize]
  )

  const planLabelFontSize = useMemo(
    () =>
      PLAN_LABEL_FONT_SIZE_AT_FALLBACK *
      (baseSymbolSizePx / PLAN_SYMBOL_FALLBACK_PX) *
      getLabelScaleFactor(symbolSizeCm),
    [baseSymbolSizePx, symbolSizeCm]
  )

  return {
    pxPerMeter,
    baseSymbolSizePx,
    planLabelFontSize,
  }
}
