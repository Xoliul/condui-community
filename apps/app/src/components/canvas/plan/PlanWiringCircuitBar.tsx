import { useTranslation } from 'react-i18next'
import CanvasScaledOverlay from '../CanvasScaledOverlay'

export interface PlanWiringCircuitOption {
  id: string
  label: string
}

/**
 * Wire mode's working circuit, in the top-centre slot the selection path uses elsewhere: pick
 * another circuit, or clear this one's automatic wires and draw it again.
 */
export function PlanWiringCircuitBar({
  circuits,
  focusCircuitId,
  onFocusCircuit,
  redrawProgress,
  onStartRedraw,
  onFinishRedraw,
}: {
  circuits: PlanWiringCircuitOption[]
  focusCircuitId: string
  onFocusCircuit: (circuitId: string) => void
  /** Set while the circuit is being redrawn. */
  redrawProgress: { connected: number; total: number } | null
  onStartRedraw: () => void
  onFinishRedraw: () => void
}) {
  const { t } = useTranslation()
  const options = circuits.some((circuit) => circuit.id === focusCircuitId)
    ? circuits
    : [{ id: focusCircuitId, label: focusCircuitId }, ...circuits]

  return (
    <CanvasScaledOverlay
      data-canvas-overlay-anchor="top-center"
      className="absolute left-1/2 top-3 z-20 max-w-[min(72%,56rem)] -translate-x-1/2"
      transformOrigin="top center"
      resolveTransform={(scale) => `translateX(-50%) scale(${scale})`}
    >
      <div
        data-testid="plan-wiring-circuit-bar"
        className="flex items-center gap-2 whitespace-nowrap rounded bg-black/40 px-2 py-1 text-sm text-white shadow-sm backdrop-blur-sm dark:bg-gray-700/50"
      >
        <select
          aria-label={t('planWiring.focusCircuit')}
          value={focusCircuitId}
          onChange={(event) => onFocusCircuit(event.target.value)}
          className="max-w-[16rem] truncate rounded border border-white/20 bg-transparent px-1.5 py-0.5 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 [&>option]:text-gray-900"
        >
          {options.map((circuit) => (
            <option key={circuit.id} value={circuit.id}>
              {circuit.label}
            </option>
          ))}
        </select>
        {redrawProgress ? (
          <>
            <span className="tabular-nums text-white/80">
              {t('planWiring.redrawProgress', {
                connected: redrawProgress.connected,
                total: redrawProgress.total,
              })}
            </span>
            <button
              type="button"
              onClick={onFinishRedraw}
              className="rounded bg-sky-600 px-2 py-0.5 font-medium text-white hover:bg-sky-500"
            >
              {t('planWiring.redrawDone')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onStartRedraw}
            className="rounded border border-white/30 px-2 py-0.5 font-medium text-white hover:bg-white/10"
          >
            {t('planWiring.redraw')}
          </button>
        )}
      </div>
    </CanvasScaledOverlay>
  )
}
