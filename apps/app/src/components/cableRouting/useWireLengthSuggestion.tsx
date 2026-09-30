import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { useProjectStore } from '@/stores/projectStore'
import type { CableSpec } from '@/types/schema'
import { useCableRouteEstimation } from './useCableRouteEstimation'

/** Round up to half a metre: a longer cable is the safe side for the far-end fault check. */
export function acceptedEstimateLengthM(highM: number): number {
  return Math.ceil(highM * 2) / 2
}

function formatM(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })
}

/**
 * Plan-estimated length for one wire: a placeholder range, an action to accept it, or a note
 * that the stored length was accepted from the plan.
 */
export function useWireLengthSuggestion(
  anchor: string,
  cable: CableSpec
): { placeholder?: string; hint?: ReactNode } {
  const { t } = useTranslation()
  const estimation = useCableRouteEstimation(isCableRoutesEnabled())
  const project = useProjectStore((s) => s.currentProject)
  const update = useProjectStore((s) => s.updateWireRunAtAnchor)
  const route = estimation?.byAnchor.get(anchor)
  if (!project || !route || route.highM <= 0) return {}

  const run = findWireRunForAnchor(selectProjectWireRuns(project), anchor)
  const storedM = run?.segmentLengths?.[anchor]
  const storedEstimate = run?.segmentLengthSources?.[anchor] === 'estimated'
  const range = t('wires.lengthEstimateRange', '≈ {{low}}–{{high}} m from plan', {
    low: formatM(route.lowM),
    high: formatM(route.highM),
  })
  const quiet = 'text-[11px] leading-4 text-gray-500 dark:text-gray-400'
  if (route.scaleCalibrated === false) return { hint: <p className={quiet}>{t('wires.calibratePlan', 'Set the plan scale to estimate lengths')}</p> }

  if (storedM != null && !route.estimateNeedsReview) {
    return storedEstimate
      ? { hint: <p className={quiet}>{t('wires.lengthFromPlan', 'Estimated from plan')}</p> }
      : {}
  }
  const acceptM = acceptedEstimateLengthM(route.highM)
  return {
    placeholder: range,
    hint: (
      <div>
        {route.estimateNeedsReview && <p className={quiet}>{t('wires.lengthEstimateStale', 'Plan changed. Review this length.')}</p>}
        <button
          type="button"
          className="text-[11px] leading-4 text-sky-600 hover:underline dark:text-sky-400"
          onClick={() => update(anchor, cable, { lengthM: acceptM, lengthSource: 'estimated' })}
        >
          {t('wires.useLengthEstimate', 'Use ≈ {{value}} m', { value: formatM(acceptM) })}
        </button>
      </div>
    ),
  }
}
