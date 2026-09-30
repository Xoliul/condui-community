import { useEffect, useMemo, useState } from 'react'
import { QuickPlacerIcon } from '@/components/icons/UiIcons'
import { getAwaitingSituationPlanPlacements } from '@/lib/plan/hiddenSituationPlanPlacements'
import { useProjectStore } from '@/stores/projectStore'

const ATTENTION_PULSE_MS = 1200

/**
 * Last waiting count seen per project, kept outside the component so the bubble remounting
 * (maximising a pane, switching layouts) never replays the pulse.
 */
const lastAwaitingCountByProject = new Map<string, number>()

/**
 * Pulse once when a project starts having waiting symbols: on opening it with symbols
 * waiting, or when its count rises from zero. Later increases stay quiet.
 */
export function shouldPulseQuickPlacerAttention(projectId: string, awaitingCount: number): boolean {
  const previous = lastAwaitingCountByProject.get(projectId) ?? 0
  lastAwaitingCountByProject.set(projectId, awaitingCount)
  return previous === 0 && awaitingCount > 0
}

/** Symbols created with manual plan placement that are not on the plan yet. */
export function useAwaitingPlanPlacementCount(): number {
  const currentProject = useProjectStore((state) => state.currentProject)
  return useMemo(
    () => (currentProject ? getAwaitingSituationPlanPlacements(currentProject).length : 0),
    [currentProject]
  )
}

/** Quick Placer tool-bubble icon with a waiting-symbol count badge and a one-time pulse. */
export function QuickPlacerToolIcon({ awaitingCount }: { awaitingCount: number }) {
  const projectId = useProjectStore((state) => state.currentProject?.project.id ?? null)
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    if (!projectId || !shouldPulseQuickPlacerAttention(projectId, awaitingCount)) return
    setPulsing(true)
    const timer = window.setTimeout(() => setPulsing(false), ATTENTION_PULSE_MS)
    return () => window.clearTimeout(timer)
  }, [awaitingCount, projectId])

  return (
    <span className="relative flex h-6 w-6 items-center justify-center">
      {pulsing && (
        <span
          aria-hidden
          data-testid="quick-placer-attention"
          className="pointer-events-none absolute -inset-3 animate-ping rounded-full border-2 border-sky-400 [animation-duration:1.2s] [animation-iteration-count:1]"
        />
      )}
      <QuickPlacerIcon className="h-6 w-6" />
      {awaitingCount > 0 && (
        <span
          data-testid="quick-placer-awaiting-count"
          className="absolute -right-3 -top-3 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {awaitingCount > 99 ? '99+' : awaitingCount}
        </span>
      )}
    </span>
  )
}
