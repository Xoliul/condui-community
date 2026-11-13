import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import type {
  LabelScheme,
  LabelSeparator,
  LabelSequenceStyle,
  Panel,
  PanelNumberStyle,
} from '@/types/schema'
import {
  BUILT_IN_LABEL_STYLE_IDS,
  MAX_PANEL_PREFIX_LENGTH,
  MAX_SAVED_LABEL_STYLES,
  MAX_SAVED_LABEL_STYLE_NAME_LENGTH,
  buildPanelCodesById,
  builtInLabelScheme,
  formatBranchLabel,
  formatCircuitCode,
  formatLabelSequence,
  joinLabelParts,
  labelSchemesEqual,
  labelSchemeUsesPanelPart,
  matchBuiltInLabelStyle,
  matchSavedLabelStyle,
  panelPartForCircuitLabels,
  resolveLabelScheme,
  type BuiltInLabelStyleId,
  type SavedLabelStyle,
} from '@/lib/eendraad/labelScheme'
import { countLabelChangesForScheme } from '@/lib/eendraad/labelSchemeChanges'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { applyLabelScheme } from '@/handlers/properties/applyLabelScheme'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDialogStore } from '@/stores/dialogStore'
import { generateId } from '@/utils/id'
import { installationHideFeederLetters } from '@/lib/eendraad/eendraadNamingInstall'
import { LabelSchemePreview } from './LabelSchemePreview'
import { LabelPreviewContext, type LabelPreviewSection } from './labelPreviewContext'
import { LabelSettingHelp } from './LabelSettingHelp'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'

const BUILT_IN_STYLE_NAME_KEYS: Record<BuiltInLabelStyleId, [string, string]> = {
  classic: ['canvas.eendraadNaming.scheme.styleClassic', 'Classic'],
  'panel-letter-letter': [
    'canvas.eendraadNaming.scheme.stylePanelLetterLetter',
    'Panel letter + letter',
  ],
  numbers: ['canvas.eendraadNaming.scheme.styleNumbers', 'Numbers'],
  'panel-letter-number': [
    'canvas.eendraadNaming.scheme.stylePanelLetterNumber',
    'Panel letter + number',
  ],
  'panel-dot-circuit': ['canvas.eendraadNaming.scheme.stylePanelDotCircuit', 'Panel.circuit'],
}

const SAMPLE_PANELS = [{ id: 'sample', subPanels: [] }] as unknown as Panel[]
/** A main panel with one sub-panel, then a second panel: shows how sub-panels are numbered. */
const SUB_PANEL_SAMPLE = [
  { id: 'main', subPanels: [{ id: 'sub', subPanels: [] }] },
  { id: 'next', subPanels: [] },
] as unknown as Panel[]

/** A few labels the scheme produces, for example `A1, A2, A1.1`. */
function labelSchemeExample(scheme: LabelScheme): string {
  const panelPart = panelPartForCircuitLabels(
    scheme,
    buildPanelCodesById(SAMPLE_PANELS, scheme).get('sample')
  )
  const first = formatCircuitCode(scheme, 0, panelPart)
  return [first, formatCircuitCode(scheme, 1, panelPart), formatBranchLabel(scheme, first, 1)].join(
    ', '
  )
}

type StyleKey = `builtin:${BuiltInLabelStyleId}` | `saved:${string}` | 'custom'

function styleKeyFor(scheme: LabelScheme, saved: readonly SavedLabelStyle[]): StyleKey {
  const own = matchSavedLabelStyle(saved, scheme)
  if (own) return `saved:${own.id}`
  const builtIn = matchBuiltInLabelStyle(scheme)
  return builtIn ? `builtin:${builtIn}` : 'custom'
}

function schemeForStyleKey(
  key: StyleKey,
  current: LabelScheme,
  saved: readonly SavedLabelStyle[]
): LabelScheme | null {
  if (key.startsWith('builtin:'))
    return builtInLabelScheme(key.slice(8) as BuiltInLabelStyleId, current)
  if (key.startsWith('saved:'))
    return saved.find((style) => style.id === key.slice(6))?.scheme ?? null
  return null
}

interface LabelStyleSelectProps {
  id: string
  scheme: LabelScheme
  savedStyles: readonly SavedLabelStyle[]
  /** Styles that put the panel in circuit labels need panel numbering, which this edition may lack. */
  panelPartAvailable: boolean
  onChange: (scheme: LabelScheme) => void
  className?: string
}

export function LabelStyleSelect({
  id,
  scheme,
  savedStyles,
  panelPartAvailable,
  onChange,
  className,
}: LabelStyleSelectProps) {
  const { t } = useTranslation()
  const value = styleKeyFor(scheme, savedStyles)
  return (
    <select
      id={id}
      data-testid={id}
      value={value}
      onChange={(event) => {
        const next = schemeForStyleKey(event.target.value as StyleKey, scheme, savedStyles)
        if (next) onChange(next)
      }}
      className={
        className ??
        'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
      }
    >
      <optgroup label={t('canvas.eendraadNaming.scheme.conduiStyles', 'Condui styles')}>
        {BUILT_IN_LABEL_STYLE_IDS.map((styleId) => {
          const builtIn = builtInLabelScheme(styleId, scheme)
          const [key, fallback] = BUILT_IN_STYLE_NAME_KEYS[styleId]
          return (
            <option
              key={styleId}
              value={`builtin:${styleId}`}
              disabled={!panelPartAvailable && labelSchemeUsesPanelPart(builtIn)}
            >
              {`${t(key, fallback)} (${labelSchemeExample(builtIn)})`}
            </option>
          )
        })}
      </optgroup>
      {savedStyles.length > 0 ? (
        <optgroup label={t('canvas.eendraadNaming.scheme.myStyles', 'My styles')}>
          {savedStyles.map((style) => (
            <option
              key={style.id}
              value={`saved:${style.id}`}
              disabled={!panelPartAvailable && labelSchemeUsesPanelPart(style.scheme)}
            >
              {`${style.name} (${labelSchemeExample(style.scheme)})`}
            </option>
          ))}
        </optgroup>
      ) : null}
      {value === 'custom' ? (
        <option value="custom">
          {t('canvas.eendraadNaming.scheme.customStyle', 'Custom (not saved)')}
        </option>
      ) : null}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface SegmentOption<T> {
  value: T
  label: ReactNode
  disabled?: boolean
  title?: string
}

/** Small (i) marker whose hover text explains a setting. */
function HelpHint({ text }: { text: string }) {
  return (
    <span aria-label={text} className="inline-flex cursor-help text-gray-400 dark:text-gray-500">
      <Info className="h-3.5 w-3.5" aria-hidden />
    </span>
  )
}

function SegmentButtons<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  help,
}: {
  label: string
  help?: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
}) {
  const helpIdPrefix = useId()
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-fit max-w-full shrink-0 flex-wrap overflow-hidden rounded-md border border-gray-300 dark:border-gray-600"
    >
      {options.map((option, index) => {
        const selected = option.value === value
        const helpText = [help, option.title].filter(Boolean).join(' ')
        const descriptionId = helpText ? `${helpIdPrefix}-${index}` : undefined
        return (
          <LabelSettingHelp
            key={String(option.value)}
            className="border-r border-gray-300 last:border-r-0 dark:border-gray-600"
            text={helpText}
            descriptionId={descriptionId}
          >
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={option.disabled}
              aria-describedby={descriptionId}
              onClick={() => onChange(option.value)}
              className={`border-gray-300 px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 ${
                selected
                  ? 'bg-sky-600 font-medium text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {option.label}
            </button>
          </LabelSettingHelp>
        )
      })}
    </div>
  )
}

/** One setting on one line: label (and optional help) on the left, choices on the right. */
function Segmented<T extends string | number | boolean>({
  label,
  help,
  value,
  options,
  onChange,
  labelAbove = false,
}: {
  label: string
  help?: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  /** Label on its own line, for choices too wide to share a line with it. */
  labelAbove?: boolean
}) {
  return (
    <div className={labelAbove ? 'grid justify-items-start gap-1' : 'flex items-center justify-between gap-3'}>
      <LabelSettingHelp text={help}>
        <span className="flex min-w-0 items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
          {label}
          {help ? <HelpHint text={help} /> : null}
        </span>
      </LabelSettingHelp>
      <SegmentButtons
        label={label}
        help={help}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  )
}

/** Example label in a choice button. */
const sample = (text: string) => <span className="font-mono">{text}</span>

const SectionHoverContext = createContext<(section: LabelPreviewSection | null) => void>(() => {})
function Section({
  title,
  aside,
  children,
  section,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  section: LabelPreviewSection
}) {
  const highlight = useContext(SectionHoverContext)
  return (
    <section
      data-label-section={section}
      data-testid={`label-scheme-section-${section}`}
      onMouseEnter={() => highlight(section)}
      onMouseLeave={() => highlight(null)}
      onFocusCapture={() => highlight(section)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) highlight(null)
      }}
      className="grid gap-2.5 rounded-md border border-gray-200 p-3 dark:border-gray-700"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

const isNumericCircuitStyle = (style: LabelSequenceStyle) =>
  style === 'number' || style === 'number2'

export function LabelSchemeDialogContent() {
  const { t } = useTranslation()
  const numberingHelpId = useId()
  const prefixHelpId = useId()
  const project = useProjectStore((state) => state.currentProject)
  const storageMode = useProjectStore((state) => state.currentProjectStorageMode)
  const { advancedPanelLabels } = useEditionFeatureAvailability(project?.project.id, {
    storageMode,
  })
  const savedStyles = useSettingsStore((state) => state.labelStyles)
  const setLabelStyles = useSettingsStore((state) => state.setLabelStyles)
  const closeDialog = useDialogStore((state) => state.closeDialog)
  const installation = project ? getProjectElectricalInstallation(project) : undefined
  const [draft, setDraft] = useState<LabelScheme>(() =>
    resolveLabelScheme(installation?.labelScheme)
  )
  // The project's setting until the user changes it here; feature access resolves after mount.
  const [numberingDraft, setNumbering] = useState<boolean | null>(null)
  const numbering = numberingDraft ?? !!installation?.panelNumberingEnabled
  const [highlighted, setHighlighted] = useState<LabelPreviewSection | null>(null)
  const [saveName, setSaveName] = useState<string | null>(null)
  const [lastSavedId, setLastSavedId] = useState<string | null>(
    () => matchSavedLabelStyle(savedStyles, draft)?.id ?? null
  )

  const styleKey = styleKeyFor(draft, savedStyles)
  const lastSaved = savedStyles.find((style) => style.id === lastSavedId) ?? null
  const panelPartOn = numbering && labelSchemeUsesPanelPart(draft)
  const panelIsNumeric = draft.panel.style !== 'upper'
  const circuitIsNumeric = isNumericCircuitStyle(draft.circuit.style)
  const panelJoinForced = panelPartOn && panelIsNumeric && circuitIsNumeric
  const branchJoinForced = circuitIsNumeric
  const lettersRunTogether =
    panelPartOn && !panelIsNumeric && !circuitIsNumeric && draft.circuit.joinPanel
  const separated = t('canvas.eendraadNaming.scheme.separated', 'Separated')
  const joined = t('canvas.eendraadNaming.scheme.joined', 'Joined')
  const help = {
    numberingHelp: t(
      'canvas.eendraadNaming.scheme.numberingHelp',
      'Numbers boards in residential and non-residential installations.'
    ),
    prefixHelp: t(
      'canvas.eendraadNaming.scheme.prefixHelp',
      'Letters before each board number, such as B in B1.'
    ),
    panelSequenceHelp: t(
      'canvas.eendraadNaming.scheme.panelSequenceHelp',
      'Use numbers, padded numbers or letters for boards.'
    ),
    startHelp: t(
      'canvas.eendraadNaming.scheme.startHelp',
      'The first board number. Letter sequences start at A.'
    ),
    circuitSequenceHelp: t(
      'canvas.eendraadNaming.scheme.circuitSequenceHelp',
      'Use uppercase letters, lowercase letters or numbers for circuits.'
    ),
    betweenPanelAndCircuitHelp: t(
      'canvas.eendraadNaming.scheme.betweenPanelAndCircuitHelp',
      'Join the board and circuit codes or put the separator between them.'
    ),
    betweenCircuitAndBranchHelp: t(
      'canvas.eendraadNaming.scheme.betweenCircuitAndBranchHelp',
      'Join the circuit code and branch number or put the separator between them.'
    ),
  }
  const numbersSeparated = t(
    'canvas.eendraadNaming.scheme.numbersSeparated',
    'Two numbers are always separated.'
  )

  // Labels each choice would produce, shown on its button.
  const samplePanel = buildPanelCodesById(SAMPLE_PANELS, draft).get('sample')
  const firstCircuit = formatLabelSequence(0, draft.circuit.style)
  const currentPart = panelPartForCircuitLabels(draft, samplePanel)
  const circuitExamples = {
    none: firstCircuit,
    number: joinLabelParts(
      samplePanel?.number ?? '',
      firstCircuit,
      draft.circuit.joinPanel,
      draft.separator
    ),
    full: joinLabelParts(
      samplePanel?.code ?? '',
      firstCircuit,
      draft.circuit.joinPanel,
      draft.separator
    ),
    // A forced separator leaves "joined" disabled; its button shows the run-together label why.
    joined: panelJoinForced
      ? `${currentPart}${firstCircuit}`
      : joinLabelParts(currentPart, firstCircuit, true, draft.separator),
    separated: joinLabelParts(currentPart, firstCircuit, false, draft.separator),
  }
  const firstCode = formatCircuitCode(draft, 0, panelPartOn ? currentPart : '')
  const branchExamples = {
    joined: branchJoinForced
      ? `${firstCode}1`
      : joinLabelParts(firstCode, '1', true, draft.separator),
    separated: joinLabelParts(firstCode, '1', false, draft.separator),
  }
  const subPanelCodes = (nested: boolean) =>
    [
      ...buildPanelCodesById(SUB_PANEL_SAMPLE, {
        ...draft,
        panel: { ...draft.panel, nested },
      }).values(),
    ]
      .map((code) => code.code)
      .join(', ')
  const subPanelExamples = { own: subPanelCodes(false), nested: subPanelCodes(true) }

  const changeCount = useMemo(
    () => (project ? countLabelChangesForScheme(project, draft, numbering) : 0),
    [project, draft, numbering]
  )
  const unchanged =
    labelSchemesEqual(resolveLabelScheme(installation?.labelScheme), draft) &&
    numbering === !!installation?.panelNumberingEnabled

  const update = (patch: (scheme: LabelScheme) => LabelScheme) =>
    setDraft((current) => patch(current))
  const chooseScheme = (scheme: LabelScheme) => {
    setDraft(scheme)
    if (labelSchemeUsesPanelPart(scheme) && advancedPanelLabels) setNumbering(true)
    const own = matchSavedLabelStyle(savedStyles, scheme)
    setLastSavedId(own?.id ?? null)
  }

  const saveStyle = () => {
    const name = (saveName ?? '').trim().slice(0, MAX_SAVED_LABEL_STYLE_NAME_LENGTH)
    if (!name) return
    const id = generateId()
    setLabelStyles([...savedStyles, { id, name, scheme: draft }].slice(-MAX_SAVED_LABEL_STYLES))
    setLastSavedId(id)
    setSaveName(null)
  }

  return (
    // On wide screens the dialog keeps its height: only the settings column scrolls, so the preview
    // and the footer stay in view. Narrow screens stack everything and scroll the whole dialog.
    <SectionHoverContext.Provider value={setHighlighted}>
      <div
        className="flex flex-col gap-3 text-sm text-gray-700 dark:text-gray-200 md:h-[min(800px,calc(95dvh-10rem))]"
        data-testid="label-scheme-dialog"
      >
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[320px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
          <div
            data-app-scroll="true"
            data-testid="label-scheme-settings"
            className="grid h-[min(44dvh,360px)] min-h-0 min-w-0 content-start gap-3 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] md:h-auto md:pr-1"
          >
            <div className="grid gap-2">
              <label
                htmlFor="label-scheme-style"
                className="text-xs text-gray-500 dark:text-gray-400"
              >
                {t('canvas.eendraadNaming.scheme.style', 'Style')}
              </label>
              <LabelStyleSelect
                id="label-scheme-style"
                scheme={draft}
                savedStyles={savedStyles}
                panelPartAvailable={advancedPanelLabels}
                onChange={chooseScheme}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <div className="grid h-9 items-center" data-testid="label-scheme-style-actions">
                {saveName === null ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {styleKey === 'custom' && lastSaved ? (
                      <button
                        type="button"
                        className="max-w-full truncate text-left font-medium text-sky-600 hover:underline dark:text-sky-400"
                        onClick={() =>
                          setLabelStyles(
                            savedStyles.map((style) =>
                              style.id === lastSaved.id ? { ...style, scheme: draft } : style
                            )
                          )
                        }
                      >
                        {t('canvas.eendraadNaming.scheme.updateStyle', 'Update “{{name}}”', {
                          name: lastSaved.name,
                        })}
                      </button>
                    ) : null}
                    {styleKey === 'custom' && savedStyles.length < MAX_SAVED_LABEL_STYLES ? (
                      <button
                        type="button"
                        data-testid="label-scheme-save-style"
                        className="font-medium text-sky-600 hover:underline dark:text-sky-400"
                        onClick={() => setSaveName('')}
                      >
                        {t('canvas.eendraadNaming.scheme.saveStyle', 'Save as my style')}
                      </button>
                    ) : null}
                    {styleKey.startsWith('saved:') ? (
                      <button
                        type="button"
                        className="font-medium text-red-600 hover:underline dark:text-red-400"
                        onClick={() => {
                          setLabelStyles(
                            savedStyles.filter((style) => `saved:${style.id}` !== styleKey)
                          )
                          setLastSavedId(null)
                        }}
                      >
                        {t('canvas.eendraadNaming.scheme.deleteStyle', 'Delete style')}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveStyle()
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={t('canvas.eendraadNaming.scheme.styleName', 'Style name')}
                      placeholder={t('canvas.eendraadNaming.scheme.styleName', 'Style name')}
                      value={saveName}
                      maxLength={MAX_SAVED_LABEL_STYLE_NAME_LENGTH}
                      onChange={(event) => setSaveName(event.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
                    />
                    <button
                      type="submit"
                      disabled={!saveName.trim()}
                      className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {t('common.save', 'Save')}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-gray-300 px-3 py-1 text-xs dark:border-gray-600"
                      onClick={() => setSaveName(null)}
                    >
                      {t('common.cancel', 'Cancel')}
                    </button>
                  </form>
                )}
              </div>
            </div>

            <Segmented<LabelSeparator>
              label={t('canvas.eendraadNaming.scheme.separator', 'Separator')}
              help={t(
                'canvas.eendraadNaming.scheme.separatorHelp',
                'Written between the parts of a label wherever they are separated, as in A1.1.'
              )}
              value={draft.separator}
              options={(['.', '-', '/'] as const).map((value) => ({
                value,
                label: <span className="px-1 font-mono">{value}</span>,
              }))}
              onChange={(separator) => update((scheme) => ({ ...scheme, separator }))}
            />

            {advancedPanelLabels ? (
              <Section
                section="panels"
                title={
                  <LabelSettingHelp text={help.numberingHelp}>
                    <label htmlFor="label-scheme-numbering" className="flex items-center gap-1">
                      {t('panels.panelNumbering', 'Panel numbering')}
                      <HelpHint text={help.numberingHelp} />
                    </label>
                  </LabelSettingHelp>
                }
                aside={
                  <LabelSettingHelp text={help.numberingHelp} descriptionId={numberingHelpId}>
                    <input
                      id="label-scheme-numbering"
                      type="checkbox"
                      checked={numbering}
                      onChange={(event) => setNumbering(event.target.checked)}
                      className="rounded border-gray-400"
                      aria-describedby={numberingHelpId}
                    />
                  </LabelSettingHelp>
                }
              >
                {numbering ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <LabelSettingHelp text={help.prefixHelp}>
                        <label
                          htmlFor="label-scheme-prefix"
                          className="text-xs text-gray-500 dark:text-gray-400"
                        >
                          {t('canvas.eendraadNaming.scheme.prefix', 'Prefix')}
                        </label>
                      </LabelSettingHelp>
                      <LabelSettingHelp text={help.prefixHelp} descriptionId={prefixHelpId}>
                        <input
                          id="label-scheme-prefix"
                          value={draft.panel.prefix}
                          maxLength={MAX_PANEL_PREFIX_LENGTH}
                          spellCheck={false}
                          onChange={(event) => {
                            const prefix = event.target.value.replace(/[\s0-9]/g, '')
                            update((scheme) => ({ ...scheme, panel: { ...scheme.panel, prefix } }))
                          }}
                          className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-sm dark:border-gray-600 dark:bg-gray-700"
                          aria-describedby={prefixHelpId}
                        />
                      </LabelSettingHelp>
                    </div>
                    {/* Sequence and start are two parts of the same number, so they share a line. */}
                    <div className="flex items-end justify-between gap-3">
                      <div className="grid gap-1">
                        <LabelSettingHelp text={help.panelSequenceHelp}>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {t('canvas.eendraadNaming.scheme.sequence', 'Sequence')}
                          </span>
                        </LabelSettingHelp>
                        <SegmentButtons<PanelNumberStyle>
                          help={help.panelSequenceHelp}
                          label={t('canvas.eendraadNaming.scheme.sequence', 'Sequence')}
                          value={draft.panel.style}
                          options={[
                            { value: 'number', label: '1 2 3' },
                            { value: 'number2', label: '01 02' },
                            { value: 'upper', label: 'A B C' },
                          ]}
                          onChange={(style) =>
                            update((scheme) => ({ ...scheme, panel: { ...scheme.panel, style } }))
                          }
                        />
                      </div>
                      <div className="grid gap-1">
                        <LabelSettingHelp text={help.startHelp}>
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {t('canvas.eendraadNaming.scheme.startsAt', 'Starts at')}
                          </span>
                        </LabelSettingHelp>
                        <SegmentButtons<0 | 1>
                          help={help.startHelp}
                          label={t('canvas.eendraadNaming.scheme.startsAt', 'Starts at')}
                          value={draft.panel.style === 'upper' ? 1 : draft.panel.start}
                          options={[
                            {
                              value: 0,
                              label: draft.panel.style === 'number2' ? '00' : '0',
                              disabled: draft.panel.style === 'upper',
                            },
                            {
                              value: 1,
                              label:
                                draft.panel.style === 'number2'
                                  ? '01'
                                  : draft.panel.style === 'upper'
                                    ? 'A'
                                    : '1',
                            },
                          ]}
                          onChange={(start) =>
                            update((scheme) => ({ ...scheme, panel: { ...scheme.panel, start } }))
                          }
                        />
                      </div>
                    </div>
                    <Segmented<boolean>
                      labelAbove
                      label={t('canvas.eendraadNaming.scheme.subPanels', 'Sub-panels')}
                      help={t(
                        'canvas.eendraadNaming.scheme.subPanelsHelp',
                        'Own number continues the sequence; under parent numbers a sub-panel after the panel that feeds it.'
                      )}
                      value={draft.panel.nested}
                      options={[
                        {
                          value: false,
                          label: sample(subPanelExamples.own),
                          title: t('canvas.eendraadNaming.scheme.ownNumber', 'Own number'),
                        },
                        {
                          value: true,
                          label: sample(subPanelExamples.nested),
                          title: t('canvas.eendraadNaming.scheme.underParent', 'Under parent'),
                        },
                      ]}
                      onChange={(nested) =>
                        update((scheme) => ({ ...scheme, panel: { ...scheme.panel, nested } }))
                      }
                    />
                  </>
                ) : null}
              </Section>
            ) : null}

            <Section
              section="circuits"
              title={t('canvas.eendraadNaming.scheme.circuits', 'Circuits')}
            >
              <Segmented<LabelSequenceStyle>
                help={help.circuitSequenceHelp}
                label={t('canvas.eendraadNaming.scheme.sequence', 'Sequence')}
                value={draft.circuit.style}
                options={[
                  { value: 'upper', label: 'A B C' },
                  { value: 'lower', label: 'a b c' },
                  { value: 'number', label: '1 2 3' },
                  { value: 'number2', label: '01 02' },
                ]}
                onChange={(style) =>
                  update((scheme) => ({ ...scheme, circuit: { ...scheme.circuit, style } }))
                }
              />
              <Segmented<LabelScheme['circuit']['panelPart']>
                labelAbove
                label={t('canvas.eendraadNaming.scheme.panelInLabel', 'Panel in label')}
                help={t(
                  'canvas.eendraadNaming.scheme.panelInLabelHelp',
                  'Start again on each board, include its number, or continue the circuit sequence across boards.'
                )}
                value={draft.circuit.panelPart}
                options={[
                  {
                    value: 'continuous',
                    label: t('canvas.eendraadNaming.scheme.continueAcrossBoards', 'Continue across boards'),
                  },
                  {
                    value: 'none',
                    label: sample(circuitExamples.none),
                    title: t('canvas.eendraadNaming.scheme.panelPartNone', 'None'),
                  },
                  {
                    value: 'number',
                    label: sample(circuitExamples.number),
                    title: t('canvas.eendraadNaming.scheme.panelPartNumber', 'Number'),
                    disabled: !advancedPanelLabels || !numbering,
                  },
                  {
                    value: 'full',
                    label: sample(circuitExamples.full),
                    title: t('canvas.eendraadNaming.scheme.panelPartFull', 'Full'),
                    disabled: !advancedPanelLabels || !numbering || !draft.panel.prefix,
                  },
                ]}
                onChange={(panelPart) =>
                  update((scheme) => ({ ...scheme, circuit: { ...scheme.circuit, panelPart } }))
                }
              />
              {panelPartOn ? (
                <Segmented<boolean>
                  label={t(
                    'canvas.eendraadNaming.scheme.betweenPanelAndCircuit',
                    'Between panel and circuit'
                  )}
                  help={help.betweenPanelAndCircuitHelp}
                  value={panelJoinForced ? false : draft.circuit.joinPanel}
                  options={[
                    {
                      value: true,
                      label: sample(circuitExamples.joined),
                      disabled: panelJoinForced,
                      title: panelJoinForced ? numbersSeparated : joined,
                    },
                    { value: false, label: sample(circuitExamples.separated), title: separated },
                  ]}
                  onChange={(joinPanel) =>
                    update((scheme) => ({ ...scheme, circuit: { ...scheme.circuit, joinPanel } }))
                  }
                />
              ) : null}
              {lettersRunTogether ? (
                <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  {t(
                    'canvas.eendraadNaming.scheme.lettersRunTogether',
                    'Past 26 circuits, panel and circuit letters can no longer be told apart.'
                  )}
                </p>
              ) : null}
            </Section>

            <Section
              section="branches"
              title={t('canvas.eendraadNaming.scheme.branches', 'Branches')}
            >
              <Segmented<boolean>
                label={t(
                  'canvas.eendraadNaming.scheme.betweenCircuitAndBranch',
                  'Between circuit and branch'
                )}
                help={help.betweenCircuitAndBranchHelp}
                value={branchJoinForced ? false : draft.branch.join}
                options={[
                  {
                    value: true,
                    label: sample(branchExamples.joined),
                    disabled: branchJoinForced,
                    title: branchJoinForced ? numbersSeparated : joined,
                  },
                  { value: false, label: sample(branchExamples.separated), title: separated },
                ]}
                onChange={(join) => update((scheme) => ({ ...scheme, branch: { join } }))}
              />
            </Section>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <div className="h-[min(60dvh,600px)] min-h-0 md:h-auto md:flex-1">
              <LabelPreviewContext.Provider value={{ highlighted }}>
                <LabelSchemePreview
                  scheme={draft}
                  panelNumberingEnabled={numbering}
                  hideFeederLetters={installationHideFeederLetters(installation)}
                  advancedPanelLabels={advancedPanelLabels}
                  accessProjectId={project?.project.id ?? null}
                />
              </LabelPreviewContext.Provider>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
          <span
            className="text-xs text-gray-500 dark:text-gray-400"
            data-testid="label-scheme-change-count"
          >
            {installation?.eendraadAutomaticNaming
              ? t('canvas.eendraadNaming.scheme.changeCount', '{{count}} labels change', {
                  count: changeCount,
                })
              : null}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              data-testid="label-scheme-apply"
              disabled={unchanged}
              onClick={() => {
                applyLabelScheme(draft, advancedPanelLabels ? numbering : undefined)
                closeDialog()
              }}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {t('canvas.eendraadNaming.scheme.apply', 'Apply')}
            </button>
          </div>
        </div>
      </div>
    </SectionHoverContext.Provider>
  )
}
