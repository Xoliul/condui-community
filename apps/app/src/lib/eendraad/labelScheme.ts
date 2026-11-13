import type {
  Installation,
  LabelScheme,
  LabelSeparator,
  LabelSequenceStyle,
  Panel,
  PanelNumberStyle,
} from '@/types/schema'

/** Today's labels: A, B, C… per panel, branches A1, domotica outputs A1.1, panels B01. */
export const CLASSIC_LABEL_SCHEME: LabelScheme = Object.freeze({
  version: 1,
  separator: '.',
  panel: Object.freeze({ prefix: 'B', style: 'number2', start: 1, nested: false }),
  circuit: Object.freeze({ style: 'upper', panelPart: 'none', joinPanel: true }),
  branch: Object.freeze({ join: true }),
}) as LabelScheme

export type BuiltInLabelStyleId =
  | 'classic'
  | 'panel-letter-letter'
  | 'numbers'
  | 'panel-letter-number'
  | 'panel-dot-circuit'

type SchemeRules = Pick<LabelScheme, 'panel' | 'circuit' | 'branch'>

const BUILT_IN_RULES: Record<BuiltInLabelStyleId, SchemeRules> = {
  classic: {
    panel: CLASSIC_LABEL_SCHEME.panel,
    circuit: CLASSIC_LABEL_SCHEME.circuit,
    branch: CLASSIC_LABEL_SCHEME.branch,
  },
  'panel-letter-letter': {
    panel: { prefix: '', style: 'upper', start: 1, nested: false },
    circuit: { style: 'upper', panelPart: 'number', joinPanel: true },
    branch: { join: true },
  },
  numbers: {
    panel: CLASSIC_LABEL_SCHEME.panel,
    circuit: { style: 'number', panelPart: 'none', joinPanel: true },
    branch: { join: true },
  },
  'panel-letter-number': {
    panel: { prefix: '', style: 'upper', start: 1, nested: false },
    circuit: { style: 'number', panelPart: 'number', joinPanel: true },
    branch: { join: true },
  },
  'panel-dot-circuit': {
    panel: { prefix: 'B', style: 'number', start: 1, nested: true },
    circuit: { style: 'number', panelPart: 'number', joinPanel: false },
    branch: { join: true },
  },
}

export const BUILT_IN_LABEL_STYLE_IDS = Object.keys(BUILT_IN_RULES) as BuiltInLabelStyleId[]

/** Built-in style applied on top of `base`, keeping the separator the user picked. */
export function builtInLabelScheme(id: BuiltInLabelStyleId, base: LabelScheme = CLASSIC_LABEL_SCHEME): LabelScheme {
  const rules = BUILT_IN_RULES[id]
  return {
    version: 1,
    separator: base.separator,
    panel: { ...rules.panel },
    circuit: { ...rules.circuit },
    branch: { ...rules.branch },
  }
}

/** The built-in style whose rules equal the scheme's, ignoring the separator. */
export function matchBuiltInLabelStyle(scheme: LabelScheme): BuiltInLabelStyleId | null {
  const key = rulesKey(scheme)
  return BUILT_IN_LABEL_STYLE_IDS.find((id) => rulesKey(BUILT_IN_RULES[id]) === key) ?? null
}

function rulesKey(rules: SchemeRules): string {
  const { panel, circuit, branch } = rules
  return [
    panel.prefix, panel.style, panel.start, panel.nested,
    circuit.style, circuit.panelPart, circuit.joinPanel,
    branch.join,
  ].join('|')
}

export function labelSchemesEqual(a: LabelScheme, b: LabelScheme): boolean {
  return a.separator === b.separator && rulesKey(a) === rulesKey(b)
}

/** Whether a style that puts the panel in circuit labels needs panel numbering. */
export function labelSchemeUsesPanelPart(scheme: LabelScheme): boolean {
  return scheme.circuit.panelPart === 'number' || scheme.circuit.panelPart === 'full'
}

const SEPARATORS: readonly LabelSeparator[] = ['.', '-', '/']
const SEQUENCE_STYLES: readonly LabelSequenceStyle[] = ['upper', 'lower', 'number', 'number2']
const PANEL_STYLES: readonly PanelNumberStyle[] = ['number', 'number2', 'upper']
export const MAX_PANEL_PREFIX_LENGTH = 6

/** Validates stored or imported data; returns `undefined` for anything that is not a scheme. */
export function parseLabelScheme(value: unknown): LabelScheme | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const panel = v.panel as Record<string, unknown> | undefined
  const circuit = v.circuit as Record<string, unknown> | undefined
  const branch = v.branch as Record<string, unknown> | undefined
  if (v.version !== 1 || !panel || !circuit || !branch) return undefined
  if (!SEPARATORS.includes(v.separator as LabelSeparator)) return undefined
  if (typeof panel.prefix !== 'string' || panel.prefix.length > MAX_PANEL_PREFIX_LENGTH) return undefined
  if (/[\s0-9]/.test(panel.prefix)) return undefined
  if (!PANEL_STYLES.includes(panel.style as PanelNumberStyle)) return undefined
  if (panel.start !== 0 && panel.start !== 1) return undefined
  if (typeof panel.nested !== 'boolean') return undefined
  if (!SEQUENCE_STYLES.includes(circuit.style as LabelSequenceStyle)) return undefined
  if (!['none', 'number', 'full', 'continuous'].includes(circuit.panelPart as string)) return undefined
  if (typeof circuit.joinPanel !== 'boolean' || typeof branch.join !== 'boolean') return undefined
  return {
    version: 1,
    separator: v.separator as LabelSeparator,
    panel: {
      prefix: panel.prefix,
      style: panel.style as PanelNumberStyle,
      start: panel.start,
      nested: panel.nested,
    },
    circuit: {
      style: circuit.style as LabelSequenceStyle,
      panelPart: circuit.panelPart as LabelScheme['circuit']['panelPart'],
      joinPanel: circuit.joinPanel,
    },
    branch: { join: branch.join },
  }
}

const parsedSchemes = new WeakMap<object, LabelScheme>()

/** The installation's scheme, or classic when none (or an invalid one) is stored. */
export function resolveLabelScheme(raw: Installation['labelScheme'] | unknown): LabelScheme {
  if (!raw || typeof raw !== 'object') return CLASSIC_LABEL_SCHEME
  const cached = parsedSchemes.get(raw)
  if (cached) return cached
  const parsed = parseLabelScheme(raw) ?? CLASSIC_LABEL_SCHEME
  parsedSchemes.set(raw, parsed)
  return parsed
}

/** Value to store on the installation: classic is stored as "no scheme" for older readers. */
export function labelSchemeForStorage(scheme: LabelScheme): LabelScheme | undefined {
  return labelSchemesEqual(scheme, CLASSIC_LABEL_SCHEME) ? undefined : scheme
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Spreadsheet-style letters from a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function lettersFromZeroBasedIndex(index: number): string {
  let n = index + 1
  let label = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

/** Formats the `index`-th (0-based) item of a circuit sequence. */
export function formatLabelSequence(index: number, style: LabelSequenceStyle | PanelNumberStyle): string {
  switch (style) {
    case 'upper':
      return lettersFromZeroBasedIndex(index)
    case 'lower':
      return lettersFromZeroBasedIndex(index).toLowerCase()
    case 'number2':
      return String(index + 1).padStart(2, '0')
    default:
      return String(index + 1)
  }
}

const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9'

/**
 * Joins two label parts. Two numbers are always separated, so `1` + `2` gives `1.2`, never `12`.
 */
export function joinLabelParts(left: string, right: string, join: boolean, separator: LabelSeparator): string {
  if (!left) return right
  if (!right) return left
  if (!join || (isDigit(left[left.length - 1]) && isDigit(right[0]))) return `${left}${separator}${right}`
  return `${left}${right}`
}

/** Branch `n` (1-based) of a circuit labeled `code`: A1, 1.1, A-1, … */
export function formatBranchLabel(scheme: LabelScheme, code: string, n: number): string {
  return joinLabelParts(code, String(n), scheme.branch.join, scheme.separator)
}

/** Output row `n` (1-based) of a domotica module labeled `base`: A1.1 (always separated). */
export function formatDomoticaOutputLabel(scheme: LabelScheme, base: string, n: number): string {
  return joinLabelParts(base, String(n), false, scheme.separator)
}

/** Part of a circuit label taken from the panel number, per the scheme. */
export function panelPartForCircuitLabels(
  scheme: LabelScheme,
  panelCode: PanelCode | undefined,
): string {
  if (!panelCode) return ''
  if (scheme.circuit.panelPart === 'number') return panelCode.number
  if (scheme.circuit.panelPart === 'full') return panelCode.code
  return ''
}

/** Circuit label for 0-based `slot` on a panel whose circuit-label part is `panelPart`. */
export function formatCircuitCode(scheme: LabelScheme, slot: number, panelPart = ''): string {
  return joinLabelParts(
    panelPart,
    formatLabelSequence(slot, scheme.circuit.style),
    scheme.circuit.joinPanel,
    scheme.separator,
  )
}

/** Whether `label` is a label this scheme could produce on a panel with circuit-label part `panelPart`. */
export function isSchemeCircuitLabel(scheme: LabelScheme, label: string, panelPart = ''): boolean {
  const text = label.trim()
  let rest = text
  if (panelPart) {
    if (!text.startsWith(panelPart)) return false
    rest = text.slice(panelPart.length)
    if (rest.startsWith(scheme.separator)) rest = rest.slice(scheme.separator.length)
  }
  const pattern = {
    upper: /^[A-Z]+$/,
    lower: /^[a-z]+$/,
    number: /^[1-9]\d*$/,
    number2: /^\d{2,}$/,
  }[scheme.circuit.style]
  return pattern.test(rest)
}

// ---------------------------------------------------------------------------
// Panel numbers
// ---------------------------------------------------------------------------

export interface PanelCode {
  /** The number part without prefix: `01`, `A`, `1.2`. */
  number: string
  /** The full panel code: `B01`, `A`, `B1.2`. */
  code: string
}

/**
 * Panel codes in numbering order (each panel, then its sub-panels). Flat schemes continue one
 * sequence through sub-panels (B01, B02, B03); nested schemes number sub-panels under their
 * parent (B1, B1.1, B2). A panel's typed `numberOverride` replaces its own code only.
 */
export function buildPanelCodesById(panels: readonly Panel[], scheme: LabelScheme): Map<string, PanelCode> {
  const codes = new Map<string, PanelCode>()
  const start = scheme.panel.style === 'upper' ? 1 : scheme.panel.start
  let flatIndex = start - 1
  const visit = (list: readonly Panel[], parentNumber: string | null) => {
    let childIndex = 0
    for (const panel of list) {
      let number: string
      if (parentNumber === null || !scheme.panel.nested) {
        flatIndex += 1
        number = formatPanelNumber(flatIndex, scheme.panel.style)
      } else {
        childIndex += 1
        number = joinLabelParts(parentNumber, String(childIndex), false, scheme.separator)
      }
      let code = `${scheme.panel.prefix}${number}`
      const override = panel.numberOverride?.trim()
      if (override) {
        // A typed number replaces the code; its number part drops the scheme prefix when present.
        code = override
        const prefix = scheme.panel.prefix
        number = prefix && override.startsWith(prefix) && override.length > prefix.length
          ? override.slice(prefix.length)
          : override
      }
      codes.set(panel.id, { number, code })
      visit(panel.subPanels ?? [], number)
    }
  }
  visit(panels, null)
  return codes
}

function formatPanelNumber(value: number, style: PanelNumberStyle): string {
  if (style === 'upper') return lettersFromZeroBasedIndex(value - 1)
  if (style === 'number2') return String(value).padStart(2, '0')
  return String(value)
}

// ---------------------------------------------------------------------------
// Saved styles ("My styles", synced with the user's editor preferences)
// ---------------------------------------------------------------------------

export interface SavedLabelStyle {
  id: string
  name: string
  scheme: LabelScheme
}

export const MAX_SAVED_LABEL_STYLES = 20
export const MAX_SAVED_LABEL_STYLE_NAME_LENGTH = 40

/** Keeps the valid saved styles; anything malformed is dropped. */
export function parseSavedLabelStyles(value: unknown): SavedLabelStyle[] {
  if (!Array.isArray(value)) return []
  const styles: SavedLabelStyle[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { id, name, scheme } = item as Record<string, unknown>
    const parsed = parseLabelScheme(scheme)
    if (typeof id !== 'string' || !id || typeof name !== 'string' || !parsed) continue
    const trimmed = name.trim().slice(0, MAX_SAVED_LABEL_STYLE_NAME_LENGTH)
    if (!trimmed || styles.some((style) => style.id === id)) continue
    styles.push({ id, name: trimmed, scheme: parsed })
    if (styles.length === MAX_SAVED_LABEL_STYLES) break
  }
  return styles
}

/** The saved style whose scheme equals `scheme` exactly (separator included). */
export function matchSavedLabelStyle(
  styles: readonly SavedLabelStyle[],
  scheme: LabelScheme
): SavedLabelStyle | null {
  return styles.find((style) => labelSchemesEqual(style.scheme, scheme)) ?? null
}
