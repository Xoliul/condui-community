import type { Endpoint } from '@/types/schema'
import {
  getDomoticaOutputBaseLabel,
  isDomoticaRowLabelVisible,
  resolveDomoticaRowLabel,
} from '@/lib/eendraad/domoticaRowLabel'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import {
  DOMOTICA_HORIZONTAL_LABEL_FONT_SIZE,
  DOMOTICA_HORIZONTAL_LABEL_GAP,
  DOMOTICA_HORIZONTAL_LABEL_RISE,
  getHorizontalDomoticaGeometry,
  getHorizontalDomoticaOutputCount,
  isHorizontalDomotica,
} from './domoticaHorizontalGeometry'

/** Upright number label of one output of a horizontal module ("F1.1"), painted beside its wire. */
export interface HorizontalDomoticaOutputLabel {
  /** Stable id of the label: module id plus output index. */
  id: string
  moduleId: string
  outputIndex: number
  /** Left edge of the text. */
  x: number
  /** Vertical centre of the text line. */
  y: number
  text: string
}

/**
 * Output labels of `module` (every output, occupied or not), reusing the vertical module's row
 * label rules: the generated `{module label}.{n}` text, a per-row override stored on the first
 * device of the output, and the per-row visibility toggle. `position` is the module element's
 * anchor (`x` of the first output column, `y` of the branch wire).
 */
export function getHorizontalDomoticaOutputLabels(
  module: Endpoint,
  branchEndpoints: readonly Endpoint[],
  position: { x: number; y: number },
  circuitCode: string
): HorizontalDomoticaOutputLabel[] {
  if (!isHorizontalDomotica(module)) return []
  const body = getHorizontalDomoticaGeometry(position, getHorizontalDomoticaOutputCount(module))
  const base = getDomoticaOutputBaseLabel(module, circuitCode)
  const slots = module.domoticaProps?.endpointChildEndpointIds ?? []
  return body.outputs.flatMap((port) => {
    const root = branchEndpoints.find((candidate) => candidate.id === slots[port.index])
    if (root && !isDomoticaRowLabelVisible(root)) return []
    return [
      {
        id: `${module.id}:output:${port.index}`,
        moduleId: module.id,
        outputIndex: port.index,
        x: port.x + DOMOTICA_HORIZONTAL_LABEL_GAP,
        y: port.y - DOMOTICA_HORIZONTAL_LABEL_RISE,
        text: resolveDomoticaRowLabel(base, port.index, root?.domoticaRowLabel),
      },
    ]
  })
}

/** Painted width of an output label, the same estimate the circuit envelope uses. */
export function measureHorizontalDomoticaOutputLabel(label: Pick<HorizontalDomoticaOutputLabel, 'text'>): number {
  return measureSymbolLabelTextWidth(label.text, 'Figtree', DOMOTICA_HORIZONTAL_LABEL_FONT_SIZE)
}

/** A cut stays this far right of a wire (the child symbol standing on it) and left of the next wire. */
const CUT_SYMBOL_HALF_WIDTH = 12
const CUT_NEXT_WIRE_CLEARANCE = 3

/**
 * X positions where a page of a PDF export may cut through a module wider than one sheet: between
 * two outputs, right of the previous output's label and left of the next output's wire, so no
 * label, wire or child symbol is split. Output `index` and `index + 1` are separated by one cut
 * at most; pairs whose label reaches the next wire offer none.
 */
export function getHorizontalDomoticaPageCutPoints(
  module: Endpoint,
  branchEndpoints: readonly Endpoint[],
  position: { x: number; y: number },
  circuitCode: string
): number[] {
  if (!isHorizontalDomotica(module)) return []
  const body = getHorizontalDomoticaGeometry(position, getHorizontalDomoticaOutputCount(module))
  const labels = new Map(
    getHorizontalDomoticaOutputLabels(module, branchEndpoints, position, circuitCode).map(
      (label) => [label.outputIndex, label]
    )
  )
  const cuts: number[] = []
  body.outputs.forEach((port, index) => {
    const next = body.outputs[index + 1]
    if (!next) return
    const label = labels.get(index)
    const clearLeft = Math.max(
      port.x + CUT_SYMBOL_HALF_WIDTH,
      label ? label.x + measureHorizontalDomoticaOutputLabel(label) : 0
    )
    const clearRight = next.x - CUT_NEXT_WIRE_CLEARANCE
    if (clearLeft < clearRight) cuts.push((clearLeft + clearRight) / 2)
  })
  return cuts
}
