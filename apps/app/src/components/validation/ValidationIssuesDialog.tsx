import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getValidationDisplayKind,
  useValidationStore,
  type ValidationState,
} from '@/stores/validationStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { AlertCircle, AlertTriangle, CheckCircle2, RotateCcw, RotateCw, CircleHelp } from 'lucide-react'
import { focusIssue } from '@/lib/validation/core/api'
import type { Issue, ScopeType } from '@/lib/validation/core/types'
import type { Selection } from '@/types/ui'
import type { Panel, Circuit, WireSegment } from '@/types/schema'
import { useEendraadWireSegments } from '@/hooks/eendraad/useEendraadWireSegments'
import { computeAreiCircuitEndpointLimitCount } from '@/lib/validation/areiCircuitEndpointCount'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { focusSelectionOnCanvas } from '@/lib/ui/focusSelectionOnCanvas'
import { logger } from '@/lib/logger'
import {
  buildCircuitCableValidationDebug,
  pickRootmostLiveCircuitWireSegmentForFocus,
  pickRootmostLiveDcWireSegmentForFocus,
  resolveLiveWireSegmentsForMinimumCrossSectionFocus,
} from '@/lib/validation/circuitCableSection'
import { DefaultQueryAPI } from '@/lib/validation/core/query-api'
import { getValidationJurisdiction } from '@/lib/validation/core/jurisdiction'
import { queryOneWireSegments } from '@/lib/projectV2/annotations'
import { getValidationAreiUrl } from '@/lib/validation/areiLinks'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  HIDDEN_SITUATION_PLAN_RULE_ID,
  openHiddenSituationPlanValidationDialog,
} from './hiddenSituationPlanValidationDialog'

interface ValidationIssuesDialogProps {
  showHeader?: boolean
  onClose?: () => void
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  headerActions?: ReactNode
}

const DC_CROSS_SECTION_HEURISTIC_RULE_ID = 'be.areibook1.2025.dc-cross-section-heuristic'
const MINIMUM_CROSS_SECTION_RULE_ID = 'be.areibook1.2025.minimum-cross-section'

const DEFAULT_SCOPE_LABELS: Record<ScopeType, string> = {
  circuit: 'Circuit',
  board: 'Panel',
  device: 'Device',
  placement: 'Plan symbol',
  segment: 'Wire',
  subgraph: 'Supply',
}

/** Endpoint symbols the DC cross-section heuristic uses for P/U estimates (matches primitives). */
const DC_HEURISTIC_FOCUS_SYMBOLS = new Set<string>([
  'solar_panel',
  'battery',
  'battery_inverter_combo',
  'inverter',
  'rectifier',
  'dc_dc_converter',
])

function collectEndpointsForCircuit(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): string[] {
  const out: string[] = []
  const visitCircuit = (circuit: { id: string; endpoints: { id: string }[] }) => {
    if (circuit.id !== circuitId) return
    for (const ep of circuit.endpoints) out.push(ep.id)
  }
  const walk = (panels: Panel[]) => {
    for (const panel of panels) {
      for (const c of panel.circuits) visitCircuit(c)
      for (const prot of panel.protections) {
        for (const c of prot.circuits ?? []) visitCircuit(c)
      }
      walk(panel.subPanels ?? [])
    }
  }
  walk(getProjectElectricalPanels(project))
  return out
}

function collectDcCrossSectionHeuristicFocusEndpoints(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): string[] {
  const preferred: string[] = []
  const visitCircuit = (circuit: { id: string; endpoints: { symbol?: string; id: string }[] }) => {
    if (circuit.id !== circuitId) return
    for (const ep of circuit.endpoints) {
      if (ep.symbol && DC_HEURISTIC_FOCUS_SYMBOLS.has(ep.symbol)) preferred.push(ep.id)
    }
  }
  const walk = (panels: Panel[]) => {
    for (const panel of panels) {
      for (const c of panel.circuits) visitCircuit(c)
      for (const prot of panel.protections) {
        for (const c of prot.circuits ?? []) visitCircuit(c)
      }
      walk(panel.subPanels ?? [])
    }
  }
  walk(getProjectElectricalPanels(project))
  if (preferred.length > 0) return preferred
  return collectEndpointsForCircuit(project, circuitId)
}

export function ValidationRevalidateButton() {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const validate = useValidationStore((state: ValidationState) => state.validate)
  const isLoading = useValidationStore((state: ValidationState) => state.isLoading)
  const buttonLabel = isLoading
    ? t('validation.revalidateInProgress', { defaultValue: 'Re-validating…' })
    : t('validation.revalidate', { defaultValue: 'Re-validate now' })

  return (
    <button
      type="button"
      onClick={() => {
        if (currentProject) {
          trackGoogleAnalyticsEvent('validation_manual_revalidate', {
            source: 'validation_panel',
          })
          void validate(currentProject, undefined, 'manual_revalidate')
        }
      }}
      disabled={!currentProject || isLoading}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={buttonLabel}
      title={buttonLabel}
    >
      <RotateCcw className="h-4 w-4" />
    </button>
  )
}

function ValidationIssuesDialog({
  showHeader = true,
  onClose = () => {},
  onHeaderPointerDown,
  headerActions,
}: ValidationIssuesDialogProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const language = useSettingsStore((state) => state.language)
  const issues = useValidationStore((state: ValidationState) => state.issues)
  const status = useValidationStore((state: ValidationState) => state.status)
  const isLoading = useValidationStore((state: ValidationState) => state.isLoading)
  const isDirty = useValidationStore((state: ValidationState) => state.isDirty)
  const lastValidatedSignature = useValidationStore(
    (state: ValidationState) => state.lastValidatedSignature
  )
  const currentSignature = useValidationStore((state: ValidationState) => state.currentSignature)
  const errorCount = useValidationStore((state: ValidationState) => state.getErrorCount())
  const warningCount = useValidationStore((state: ValidationState) => state.getWarningCount())
  const setSelection = useUIStore((s) => s.setSelection)
  const eendraadWireSegments = useEendraadWireSegments()
  const storedWireSegments = currentProject ? queryOneWireSegments(currentProject) : []
  const validationDisabledOutsideBelgium =
    currentProject != null &&
    getValidationJurisdiction(
      getProjectElectricalInstallation(currentProject)?.address.country
    ) !== 'BE'
  const displayKind = validationDisabledOutsideBelgium
    ? 'warning'
    : getValidationDisplayKind({
        status,
        isLoading,
        isDirty,
        lastValidatedSignature,
        currentSignature,
      })

  const [severityFilter, setSeverityFilter] = useState<Record<string, boolean>>({
    error: true,
    warning: true,
    info: true,
  })

  const severityCounts: Record<string, number> = {}
  for (const issue of issues) {
    const sev = issue.severity as string
    severityCounts[sev] = (severityCounts[sev] ?? 0) + 1
  }

  const getIssueTopicGroup = (issue: Issue): string => {
    const ruleId = issue.ruleId
    if (
      ruleId === 'be.areibook1.2025.minimum-cross-section' ||
      ruleId === 'be.areibook1.2025.breaker-vs-cross-section' ||
      ruleId === 'be.areibook1.2025.cable-cross-section'
    )
      return 'cable-protection'
    if (
      ruleId === 'be.areibook1.2025.main-rcd' ||
      ruleId === 'be.areibook1.2025.rcd-required-by-circuit-type' ||
      ruleId === 'be.areibook1.2025.rcd-grouping' ||
      ruleId === 'be.areibook1.2025.rcd-selectivity'
    )
      return 'rcd'
    if (
      ruleId === 'be.areibook1.2025.board-global-isolation' ||
      ruleId === 'be.areibook1.2025.board-local-isolation-hint'
    )
      return 'board-isolation'
    if (ruleId === 'be.areibook1.2025.electrical-domain') return 'domain'
    return 'other'
  }
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 }
  const topicOrder: Record<string, number> = {
    'cable-protection': 0,
    rcd: 1,
    'board-isolation': 2,
    domain: 3,
    other: 4,
  }
  const filteredIssues = issues
    .filter((issue) => {
      const sev = issue.severity as string
      const enabled = severityFilter[sev]
      return enabled ?? true
    })
    .map((issue) => {
      const topic = getIssueTopicGroup(issue)
      const scopeGroup = `${issue.scope.type}:${issue.scope.id}`
      return { issue, topic, scopeGroup, relationGroup: `${scopeGroup}:${topic}` }
    })
    .sort((a, b) => {
      const aSev = severityOrder[a.issue.severity] ?? 99
      const bSev = severityOrder[b.issue.severity] ?? 99
      if (aSev !== bSev) return aSev - bSev
      if (a.scopeGroup !== b.scopeGroup) return a.scopeGroup.localeCompare(b.scopeGroup)
      const aTopic = topicOrder[a.topic] ?? 99
      const bTopic = topicOrder[b.topic] ?? 99
      if (aTopic !== bTopic) return aTopic - bTopic
      return a.issue.ruleId.localeCompare(b.issue.ruleId)
    })

  const toggleSeverity = (severity: string) => {
    setSeverityFilter((prev) => ({
      ...prev,
      [severity]: !prev[severity],
    }))
  }

  const getShortTitle = (issue: Issue) => {
    const key = `validation.rules.${issue.ruleId}.shortTitle`
    return t(key, { defaultValue: issue.message })
  }

  const getCitationCodeLabel = (code: string) => {
    return t(`validation.citations.${code}.code`, { defaultValue: code })
  }

  const getIssueLabels = (issue: Issue): string[] => {
    const labels = new Set<string>()
    const project = currentProject
    if (!project) return []

    const forEachCircuit = (
      fn: (c: import('@/types/schema').Circuit, panel: import('@/types/schema').Panel) => void
    ) => {
      const walk = (panels: import('@/types/schema').Panel[]) => {
        for (const panel of panels) {
          for (const circuit of panel.circuits) {
            fn(circuit, panel)
          }
          for (const protection of panel.protections) {
            if (protection.circuits) {
              for (const circuit of protection.circuits) {
                fn(circuit, panel)
              }
            }
          }
          walk(panel.subPanels ?? [])
        }
      }
      walk(getProjectElectricalPanels(project))
    }

    const findCircuitById = (
      id: string
    ): {
      circuit: import('@/types/schema').Circuit
      panel: import('@/types/schema').Panel
    } | null => {
      let result: {
        circuit: import('@/types/schema').Circuit
        panel: import('@/types/schema').Panel
      } | null = null
      forEachCircuit((c, panel) => {
        if (!result && c.id === id) {
          result = { circuit: c, panel }
        }
      })
      return result
    }

    const findEndpointById = (id: string): import('@/types/schema').Endpoint | null => {
      let result: import('@/types/schema').Endpoint | null = null
      forEachCircuit((c) => {
        if (result) return
        const ep = c.endpoints.find((e) => e.id === id)
        if (ep) result = ep
      })
      return result
    }

    const findProtectionById = (id: string) => {
      const walk = (
        panels: import('@/types/schema').Panel[]
      ): import('@/types/schema').ProtectionDevice | null => {
        for (const panel of panels) {
          const prot = panel.protections.find((p) => p.id === id)
          if (prot) return prot
          const found = walk(panel.subPanels ?? [])
          if (found) return found
        }
        return null
      }
      return walk(getProjectElectricalPanels(project))
    }

    // Scope primary label
    if (issue.scope.type === 'circuit') {
      const found = findCircuitById(issue.scope.id)
      if (found && found.circuit.code) {
        labels.add(found.circuit.code)
      }
    } else if (issue.scope.type === 'board') {
      const panel = findPanelById(getProjectElectricalPanels(project), issue.scope.id)
      if (panel?.name) labels.add(panel.name)
    }

    // Offender labels (endpoints, circuits, protections)
    for (const offender of issue.offenders) {
      if (offender.kind === 'endpoint') {
        const ep = findEndpointById(offender.id)
        if (ep?.label) labels.add(ep.label)
      } else if (offender.kind === 'circuit') {
        const found = findCircuitById(offender.id)
        if (found) {
          labels.add(
            found.circuit.code?.trim() ||
              t('validation.labels.unnamedCircuit', { defaultValue: '[unnamed circuit]' })
          )
        }
      } else if (offender.kind === 'protection') {
        const prot = findProtectionById(offender.id)
        if (prot) {
          labels.add(
            prot.label?.trim() ||
              t('validation.labels.unnamedProtection', { defaultValue: '[unnamed protection]' })
          )
        }
      } else if (offender.kind === 'board') {
        const panel = findPanelById(getProjectElectricalPanels(project), offender.id)
        if (panel?.name) labels.add(panel.name)
      }
    }

    return Array.from(labels)
  }

  const getIssueBadgeLabel = (issue: Issue): string => {
    const labels = getIssueLabels(issue)
    if (labels.length > 0) return labels.join(', ')

    return t(`validation.scopeLabels.${issue.scope.type}`, {
      defaultValue: DEFAULT_SCOPE_LABELS[issue.scope.type],
    })
  }

  const handleIssueClick = (
    issue: Issue,
    interactionMethod: 'pointer' | 'keyboard' = 'pointer'
  ) => {
    trackGoogleAnalyticsEvent('validation_issue_card_click', {
      rule_id: issue.ruleId,
      severity: issue.severity,
      scope_type: issue.scope.type,
      source: 'validation_card',
      interaction_method: interactionMethod,
    })

    if (issue.ruleId === HIDDEN_SITUATION_PLAN_RULE_ID && currentProject) {
      if (!openHiddenSituationPlanValidationDialog(currentProject, t)) {
        onClose()
        return
      }
      trackGoogleAnalyticsEvent('validation_issue_focus', {
        rule_id: issue.ruleId,
        severity: issue.severity,
        scope_type: issue.scope.type,
        selection_type: 'hidden_situation_plan_dialog',
        source: 'validation_card',
        interaction_method: interactionMethod,
      })
      return
    }

    const { elementIds } = focusIssue(issue.id, issues)
    let selectionType: 'endpoint' | 'protection' | 'trunkDevice' | 'wire' | null = null
    let ids: string[] = []
    let explicitSelection: Selection | null = null
    const isVisibleWireSegment = (segment: WireSegment) =>
      Math.abs(segment.startPoint.x - segment.endPoint.x) > 0.001 ||
      Math.abs(segment.startPoint.y - segment.endPoint.y) > 0.001

    const getBoardSupplyWireSelection = (boardId: string): Selection | null => {
      const verticalIncoming =
        eendraadWireSegments.find(
          (ws: WireSegment) =>
            isVisibleWireSegment(ws) &&
            ws.panelId === boardId &&
            ws.type === 'vertical' &&
            ws.fromElementType !== 'ground' &&
            (ws.isSubPanelSupply === true ||
              ws.circuitId == null ||
              ws.fromElementType === 'protection')
        ) ?? null
      const supplyTrunk =
        eendraadWireSegments.find(
          (ws: WireSegment) =>
            isVisibleWireSegment(ws) && ws.panelId === boardId && ws.isSupplyTrunk === true
        ) ?? null
      const target = verticalIncoming ?? supplyTrunk
      if (!target) return null
      return {
        type: 'wire',
        ids: [target.id],
        wireMetadata: [
          {
            id: target.id,
            type: target.type,
            circuitId: target.circuitId,
            panelId: target.panelId,
            fromElementType: target.fromElementType,
            fromElementId: target.fromElementId,
            toElementType: target.toElementType,
            toElementId: target.toElementId,
            domain: target.domain,
            isSupply: true,
            ...(target.supplySegmentIndex !== undefined
              ? { supplySegmentIndex: target.supplySegmentIndex }
              : {}),
            ...(target.supplyWireRole !== undefined
              ? { supplyWireRole: target.supplyWireRole }
              : {}),
            ...(target.supplyFeedScope !== undefined
              ? { supplyFeedScope: target.supplyFeedScope }
              : {}),
          },
        ],
      }
    }

    const isCircuitProtectionRule =
      issue.ruleId === 'be.areibook1.2025.max-endpoints-per-circuit' ||
      issue.ruleId === 'be.areibook1.2025.breaker-vs-cross-section' ||
      issue.ruleId === 'be.areibook1.2025.minimum-cross-section' ||
      issue.ruleId === 'be.areibook1.2025.rcd-required-by-circuit-type'

    const isWireSectionRule =
      issue.ruleId === MINIMUM_CROSS_SECTION_RULE_ID ||
      issue.ruleId === DC_CROSS_SECTION_HEURISTIC_RULE_ID

    const buildWireSelectionFromSegments = (wireSegments: typeof eendraadWireSegments): boolean => {
      if (wireSegments.length === 0) return false
      selectionType = 'wire'
      ids = wireSegments.map((ws) => ws.id)
      explicitSelection = {
        type: 'wire',
        ids,
        wireMetadata: wireSegments.map((ws) => ({
          id: ws.id,
          type: ws.type,
          domain: ws.domain,
          circuitId: ws.circuitId,
          panelId: ws.panelId,
          fromElementType: ws.fromElementType,
          fromElementId: ws.fromElementId,
          toElementType: ws.toElementType,
          toElementId: ws.toElementId,
          ...(ws.isSupplyTrunk === true ? { isSupply: true } : {}),
          ...(ws.supplySegmentIndex !== undefined
            ? { supplySegmentIndex: ws.supplySegmentIndex }
            : {}),
          ...(ws.supplyAssemblyId !== undefined ? { supplyAssemblyId: ws.supplyAssemblyId } : {}),
          ...(ws.supplyConnectionId !== undefined
            ? { supplyConnectionId: ws.supplyConnectionId }
            : {}),
          ...(ws.supplySectionKey !== undefined ? { supplySectionKey: ws.supplySectionKey } : {}),
        })),
      }
      return true
    }

    const query = currentProject ? new DefaultQueryAPI(currentProject) : null
    const offenderCircuitId =
      issue.scope.type === 'circuit'
        ? issue.scope.id
        : issue.offenders.find((offender) => offender.kind === 'circuit')?.id
    const pickRootCircuitSegment = (
      circuitId: string,
      candidates: WireSegment[],
      domain?: 'AC' | 'DC'
    ): WireSegment | undefined => {
      const protectionId = query?.getProtectionForCircuit(circuitId)?.id
      return pickRootmostLiveCircuitWireSegmentForFocus(candidates, circuitId, protectionId, domain)
    }

    if (issue.ruleId === 'be.areibook1.2025.phase-protection-compatibility') {
      const protectionIds = issue.offenders
        .filter((offender) => offender.kind === 'protection')
        .map((offender) => offender.id)
      const trunkDeviceIds = issue.offenders
        .filter((offender) => offender.kind === 'device')
        .map((offender) => offender.id)
      if (protectionIds.length > 0) {
        selectionType = 'protection'
        ids = protectionIds
      } else if (trunkDeviceIds.length > 0) {
        selectionType = 'trunkDevice'
        ids = trunkDeviceIds
      }
    }

    // Cable sizing rules should focus one stable, visible root wire. Validation and
    // rendering derive different transient segment IDs, so never rely on offender IDs.
    const cableRuleIdsPreferWireOffenders = new Set([
      'be.areibook1.2025.breaker-vs-cross-section',
      'be.areibook1.2025.stove-sizing-hint',
    ])
    if (cableRuleIdsPreferWireOffenders.has(issue.ruleId) && query && offenderCircuitId) {
      const protectionId = query.getProtectionForCircuit(offenderCircuitId)?.id
      const weakest = resolveLiveWireSegmentsForMinimumCrossSectionFocus(
        eendraadWireSegments,
        offenderCircuitId,
        protectionId,
        (segment) => query.getCrossSection(segment),
        { domain: 'AC' }
      )
      const root = pickRootCircuitSegment(offenderCircuitId, weakest, 'AC')
      if (root) buildWireSelectionFromSegments([root])
    }

    if (
      !selectionType &&
      issue.ruleId === 'be.areibook1.2025.cable-cross-section' &&
      query &&
      offenderCircuitId
    ) {
      const missingSection = eendraadWireSegments.filter((segment) => {
        if (segment.circuitId !== offenderCircuitId) return false
        const section = query.getCrossSection(segment)
        return section == null || section <= 0
      })
      const root = pickRootCircuitSegment(offenderCircuitId, missingSection)
      if (root) buildWireSelectionFromSegments([root])
    }

    if (
      !selectionType &&
      issue.ruleId === 'be.areibook1.2025.nonhousehold-circuit-cable-length' &&
      offenderCircuitId
    ) {
      const root = pickRootCircuitSegment(offenderCircuitId, eendraadWireSegments, 'AC')
      if (root) buildWireSelectionFromSegments([root])
    }

    if (isWireSectionRule) {
      const circuitId = issue.scope.type === 'circuit' ? issue.scope.id : null
      let selectedSegments: WireSegment[] = []
      if (circuitId && issue.ruleId === DC_CROSS_SECTION_HEURISTIC_RULE_ID) {
        // Validation and the canvas derive fresh segment IDs independently. Resolve this
        // rule against the current rendered DC wires first; a stored ID may exist but point
        // to no live Konva wire, which creates an invisible selection.
        selectedSegments = resolveLiveWireSegmentsForMinimumCrossSectionFocus(
          eendraadWireSegments,
          circuitId,
          undefined,
          (segment) => query?.getCrossSection(segment) ?? segment.cable?.sectionMm2,
          { domain: 'DC' }
        )
        const conversionDeviceIds = new Set(
          (query?.getCircuitById(circuitId)?.trunkDevices ?? [])
            .filter((device) => device.type === 'conversion')
            .map((device) => device.id)
        )
        const rootmost = pickRootmostLiveDcWireSegmentForFocus(
          selectedSegments,
          conversionDeviceIds
        )
        selectedSegments = rootmost ? [rootmost] : []
      } else if (circuitId && issue.ruleId === MINIMUM_CROSS_SECTION_RULE_ID && query) {
        const protectionId = query.getProtectionForCircuit(circuitId)?.id
        const weakest = resolveLiveWireSegmentsForMinimumCrossSectionFocus(
          eendraadWireSegments,
          circuitId,
          protectionId,
          (segment) => query.getCrossSection(segment),
          { domain: 'AC' }
        )
        const root = pickRootCircuitSegment(circuitId, weakest, 'AC')
        selectedSegments = root ? [root] : []
      }

      if (selectedSegments.length > 0) {
        buildWireSelectionFromSegments(selectedSegments)
      } else if (
        circuitId &&
        issue.ruleId === DC_CROSS_SECTION_HEURISTIC_RULE_ID &&
        currentProject
      ) {
        const epIds = collectDcCrossSectionHeuristicFocusEndpoints(currentProject, circuitId)
        if (epIds.length > 0) {
          selectionType = 'endpoint'
          ids = epIds
          explicitSelection = { type: 'endpoint', ids: epIds }
        }
      }
    }

    if (!selectionType && isCircuitProtectionRule && currentProject) {
      const circuitIds: string[] =
        issue.ruleId === 'be.areibook1.2025.rcd-required-by-circuit-type'
          ? Array.from(
              new Set((issue.offenders ?? []).filter((o) => o.kind === 'circuit').map((o) => o.id))
            )
          : issue.scope.type === 'circuit'
            ? [issue.scope.id]
            : elementIds[0]
              ? [elementIds[0]]
              : []

      const protectionIds = new Set<string>()
      const walkPanelsForProtections = (panels: import('@/types/schema').Panel[]) => {
        for (const panel of panels) {
          for (const protection of panel.protections) {
            if (protection.circuits?.some((c) => circuitIds.includes(c.id))) {
              protectionIds.add(protection.id)
            }
          }
          walkPanelsForProtections(panel.subPanels ?? [])
        }
      }
      walkPanelsForProtections(getProjectElectricalPanels(currentProject))

      if (protectionIds.size > 0) {
        selectionType = 'protection'
        ids = Array.from(protectionIds).sort()
      }
      if (!selectionType) {
        selectionType = 'endpoint'
        ids = elementIds
      }
    } else if (issue.ruleId === 'be.areibook1.2025.electrical-domain') {
      const connectedElementIds = new Set(
        issue.offenders
          .filter((offender) => offender.kind === 'endpoint' || offender.kind === 'protection')
          .map((offender) => offender.id)
      )
      const connected = eendraadWireSegments.find(
        (segment) =>
          isVisibleWireSegment(segment) &&
          (offenderCircuitId == null || segment.circuitId === offenderCircuitId) &&
          ((segment.fromElementId != null && connectedElementIds.has(segment.fromElementId)) ||
            (segment.toElementId != null && connectedElementIds.has(segment.toElementId)))
      )
      if (connected) {
        buildWireSelectionFromSegments([connected])
      }
    } else if (issue.ruleId === 'be.areibook1.2025.post-main-bus-pe-conductor') {
      if (offenderCircuitId) {
        const root = pickRootCircuitSegment(offenderCircuitId, eendraadWireSegments, 'AC')
        if (root) buildWireSelectionFromSegments([root])
      } else if (issue.scope.type === 'board') {
        const role = issue.id.includes('supply:crossing')
          ? 'crossing'
          : issue.id.includes('supply:downstream')
            ? 'downstream'
            : null
        const supplySegment = role
          ? eendraadWireSegments.find(
              (segment) =>
                isVisibleWireSegment(segment) &&
                segment.panelId === issue.scope.id &&
                segment.supplyWireRole === role
            )
          : null
        if (supplySegment) buildWireSelectionFromSegments([supplySegment])
      }
    } else if (
      (issue.ruleId === 'be.areibook1.2025.board-global-isolation' ||
        issue.ruleId === 'be.areibook1.2025.main-rcd') &&
      currentProject
    ) {
      const boardId = issue.scope.type === 'board' ? issue.scope.id : null
      if (boardId) {
        const supplySelection = getBoardSupplyWireSelection(boardId)
        if (supplySelection) {
          selectionType = 'wire'
          ids = supplySelection.ids
          explicitSelection = supplySelection
        } else {
          explicitSelection = { type: 'panel', ids: [boardId] }
        }
      }
    } else if (
      (issue.ruleId === 'be.areibook1.2025.nonhousehold-board-grounded-network' ||
        issue.ruleId === 'be.areibook1.2025.nonhousehold-board-numbering') &&
      issue.scope.type === 'board'
    ) {
      explicitSelection = { type: 'panel', ids: [issue.scope.id] }
    } else if (issue.ruleId === 'be.areibook1.2025.board-local-isolation-hint' && currentProject) {
      const boardId = issue.scope.type === 'board' ? issue.scope.id : null
      if (boardId) {
        const subPanelSupply = eendraadWireSegments.filter(
          (ws: WireSegment) =>
            isVisibleWireSegment(ws) &&
            ws.panelId === boardId &&
            ws.type === 'vertical' &&
            ws.fromElementType === 'protection' &&
            (ws.isSubPanelSupply === true || (ws.toElementId == null && ws.toElementType == null))
        )
        if (subPanelSupply.length > 0) {
          const target = subPanelSupply[0]!
          selectionType = 'wire'
          ids = [target.id]
          explicitSelection = {
            type: 'wire',
            ids: [target.id],
            wireMetadata: [
              {
                id: target.id,
                type: target.type,
                circuitId: target.circuitId,
                panelId: target.panelId,
                fromElementType: target.fromElementType,
                fromElementId: target.fromElementId,
                toElementType: target.toElementType,
                toElementId: target.toElementId,
                domain: target.domain,
              },
            ],
          }
        } else {
          explicitSelection = { type: 'panel', ids: [boardId] }
        }
      }
    }

    if (!selectionType && issue.offenders.some((offender) => offender.kind === 'segment')) {
      const offenderSegmentIds = new Set(
        issue.offenders
          .filter((offender) => offender.kind === 'segment')
          .map((offender) => offender.id)
      )
      const exactLive = eendraadWireSegments.find(
        (segment) =>
          (offenderSegmentIds.has(segment.id) ||
            (segment.supplyConnectionId != null &&
              offenderSegmentIds.has(segment.supplyConnectionId)) ||
            (segment.supplySectionKey != null &&
              offenderSegmentIds.has(segment.supplySectionKey))) &&
          isVisibleWireSegment(segment)
      )
      const backupSupplyRcdSegments =
        issue.ruleId === 'be.areibook1.2025.backup-supply-rcd'
          ? eendraadWireSegments.filter(
              (segment) =>
                segment.supplyConnectionId != null &&
                offenderSegmentIds.has(segment.supplyConnectionId) &&
                isVisibleWireSegment(segment)
            )
          : []
      if (issue.ruleId === 'be.areibook1.2025.backup-supply-rcd' && currentProject) {
        const assembly = selectProjectSupplyAssemblies(currentProject).find(
          (candidate) => candidate.id === issue.scope.id
        )
        const backupPanelIds = new Set<string>()
        const backupCircuitIds = new Set<string>()
        for (const handoff of assembly?.loadHandoffs ?? []) {
          const connection = assembly?.connections.find(
            (candidate) =>
              offenderSegmentIds.has(candidate.id) &&
              candidate.endpoints.some((endpoint) => endpoint.nodeId === handoff.handoffNodeId)
          )
          if (!connection) continue
          const target = handoff.target
          if (target.kind === 'circuit-input') {
            backupPanelIds.add(target.panelId)
            backupCircuitIds.add(target.circuitId)
          } else if (target.kind === 'panel-input' || target.kind === 'panel-bus-input') {
            backupPanelIds.add(target.panelId)
          } else if (target.kind === 'root-feed') {
            const panelId = getProjectElectricalInstallation(
              currentProject
            )?.feedTopology?.rootFeeds.find((feed) => feed.id === target.rootFeedId)?.panelId
            if (panelId) backupPanelIds.add(panelId)
          }
        }
        const visibleBackupBusSegments = eendraadWireSegments.filter(
          (segment) =>
            isVisibleWireSegment(segment) &&
            segment.busFeedKind === 'backup' &&
            segment.panelId != null &&
            backupPanelIds.has(segment.panelId)
        )
        const visibleBackupCircuitSegments = eendraadWireSegments.filter(
          (segment) =>
            isVisibleWireSegment(segment) &&
            segment.circuitId != null &&
            backupCircuitIds.has(segment.circuitId)
        )
        const visibleBackupCircuitOutputs = visibleBackupCircuitSegments.filter(
          (segment) => segment.fromElementType === 'protection'
        )
        const visibleBackupPanelFeedSegments = eendraadWireSegments.filter(
          (segment) =>
            isVisibleWireSegment(segment) &&
            segment.supplyWireRole === 'downstream' &&
            segment.panelId != null &&
            backupPanelIds.has(segment.panelId)
        )
        if (backupSupplyRcdSegments.length > 0) {
          buildWireSelectionFromSegments(backupSupplyRcdSegments)
        } else if (visibleBackupCircuitOutputs.length > 0) {
          buildWireSelectionFromSegments(visibleBackupCircuitOutputs)
        } else if (visibleBackupCircuitSegments.length > 0) {
          buildWireSelectionFromSegments(visibleBackupCircuitSegments)
        } else if (visibleBackupBusSegments.length > 0) {
          buildWireSelectionFromSegments(visibleBackupBusSegments)
        } else if (visibleBackupPanelFeedSegments.length > 0) {
          buildWireSelectionFromSegments(visibleBackupPanelFeedSegments)
        }
      }
      const root =
        exactLive ??
        (offenderCircuitId
          ? pickRootCircuitSegment(offenderCircuitId, eendraadWireSegments)
          : undefined)
      if (!selectionType && root) buildWireSelectionFromSegments([root])
    }

    if (!selectionType) {
      const endpointOffenderIds = Array.from(
        new Set((issue.offenders ?? []).filter((o) => o.kind === 'endpoint').map((o) => o.id))
      )
      if (endpointOffenderIds.length === 1) {
        selectionType = 'endpoint'
        ids = endpointOffenderIds
      }
    }

    if (!selectionType) {
      if (currentProject && issue.scope.type === 'circuit') {
        let protectionId: string | null = null
        outer: for (const panel of getProjectElectricalPanels(currentProject)) {
          for (const protection of panel.protections) {
            if (protection.circuits?.some((c: Circuit) => c.id === issue.scope.id)) {
              protectionId = protection.id
              break outer
            }
          }
        }
        if (protectionId) {
          selectionType = 'protection'
          ids = [protectionId]
        }
      }
    }
    if (!selectionType) {
      if (elementIds.length === 0) {
        onClose()
        return
      }
      selectionType = 'endpoint'
      ids = elementIds
    }

    const nextSelection = explicitSelection ?? { type: selectionType, ids }
    if (nextSelection.type === 'wire') {
      logger.info('[Wire Selection Debug][validation click]', {
        ruleId: issue.ruleId,
        issueId: issue.id,
        scope: issue.scope,
        offenderSegmentIds: issue.offenders
          .filter((offender) => offender.kind === 'segment')
          .map((offender) => offender.id),
        selectedIds: nextSelection.ids,
        wireMetadata: nextSelection.wireMetadata,
      })
    }
    setSelection(nextSelection)
    trackGoogleAnalyticsEvent('validation_issue_focus', {
      rule_id: issue.ruleId,
      severity: issue.severity,
      scope_type: issue.scope.type,
      selection_type: explicitSelection?.type ?? selectionType,
      source: 'validation_card',
      interaction_method: interactionMethod,
    })
    focusSelectionOnCanvas(nextSelection, { preferredCanvas: 'eendraad' })
    onClose()
  }

  const getAreiLinkLabel = (severity: Issue['severity']) =>
    t(
      severity === 'error'
        ? 'validation.readMoreAboutError'
        : severity === 'warning'
          ? 'validation.readMoreAboutWarning'
          : 'validation.readMoreAboutInfo',
      {
        defaultValue:
          severity === 'error'
            ? 'Read more about this error'
            : severity === 'warning'
              ? 'Read more about this warning'
              : 'Read more about this message',
      }
    )

  return (
    <div className={`flex flex-col h-full ${showHeader ? 'max-h-[80vh]' : ''}`.trim()}>
      {showHeader && (
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div
            className={`flex min-w-0 items-center gap-3 ${onHeaderPointerDown ? 'cursor-grab active:cursor-grabbing select-none' : ''}`}
            onPointerDown={onHeaderPointerDown}
          >
            {displayKind === 'error' && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
            )}
            {displayKind === 'warning' && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/30">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              </div>
            )}
            {displayKind === 'ok' && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              </div>
            )}
            {displayKind === 'pending' && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <RotateCw className="w-5 h-5 animate-spin text-gray-500 dark:text-gray-400" />
              </div>
            )}
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {t('validation.title', { defaultValue: 'Validation Results' })}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {headerActions ?? <ValidationRevalidateButton />}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5 sm:px-4 sm:py-3">
        {validationDisabledOutsideBelgium ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <AlertTriangle className="mb-3 h-14 w-14 text-yellow-500" />
            <h3 className="mb-1.5 text-lg font-semibold text-gray-900 dark:text-white">
              {t('validation.disabledOutsideBelgium', { defaultValue: 'Validation disabled outside Belgium.' })}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('validation.belgianRulesOnly', { defaultValue: 'The app currently only checks AREI rules for Belgium.' })}
            </p>
          </div>
        ) : displayKind === 'pending' && issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <RotateCw className="mb-3 h-14 w-14 animate-spin text-gray-400 dark:text-gray-500" />
            <h3 className="mb-1.5 text-lg font-semibold text-gray-900 dark:text-white">
              {t('validation.checking', { defaultValue: 'Checking...' })}
            </h3>
          </div>
        ) : displayKind === 'ok' && issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <CheckCircle2 className="mb-3 h-14 w-14 text-green-500" />
            <h3 className="mb-1.5 text-lg font-semibold text-gray-900 dark:text-white">
              {t('validation.allClear', { defaultValue: 'All available checks passed' })}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('validation.noIssues', {
                defaultValue:
                  'No issues were found by these checks. This does not guarantee full AREI compliance.',
              })}
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 sm:space-y-3">
            {/* Summary */}
            <div className="rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-800 sm:p-3">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
                {errorCount > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleSeverity('error')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm ${
                      (severityFilter.error ?? true)
                        ? 'bg-red-100 border-red-300 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-100'
                        : 'bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500 opacity-60'
                    }`}
                  >
                    <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span>
                      {errorCount} {t('validation.errors', { defaultValue: 'error(s)' })}
                    </span>
                  </button>
                )}
                {warningCount > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleSeverity('warning')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm ${
                      (severityFilter.warning ?? true)
                        ? 'bg-yellow-100 border-yellow-300 text-yellow-700 dark:bg-yellow-900/40 dark:border-yellow-700 dark:text-yellow-100'
                        : 'bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500 opacity-60'
                    }`}
                  >
                    <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span>
                      {warningCount} {t('validation.warnings', { defaultValue: 'warning(s)' })}
                    </span>
                  </button>
                )}
                {severityCounts.info != null && severityCounts.info > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleSeverity('info')}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm ${
                      (severityFilter.info ?? true)
                        ? 'bg-sky-100 border-sky-300 text-sky-700 dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-100'
                        : 'bg-gray-50 border-gray-200 text-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500 opacity-60'
                    }`}
                  >
                    <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5" />
                    <span>
                      {severityCounts.info} {t('validation.infos', { defaultValue: 'info(s)' })}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Issues List */}
            <div className="space-y-1.5">
              {filteredIssues.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('validation.noFilteredIssues', {
                    defaultValue: 'No issues match the current filters.',
                  })}
                </p>
              )}
              {filteredIssues.map((entry, index) => {
                const issue = entry.issue
                const prev = index > 0 ? filteredIssues[index - 1] : null
                const next = index < filteredIssues.length - 1 ? filteredIssues[index + 1] : null
                const isGrouped =
                  prev?.relationGroup === entry.relationGroup ||
                  next?.relationGroup === entry.relationGroup
                const startsGroup = prev?.relationGroup !== entry.relationGroup
                const endsGroup = next?.relationGroup !== entry.relationGroup
                return (
                  <div key={issue.id} className="relative">
                    {isGrouped && (
                      <div
                        className={`absolute -left-3 w-1 rounded-full bg-sky-500/90 dark:bg-sky-400/90 ${
                          startsGroup && endsGroup
                            ? 'top-3 bottom-3'
                            : startsGroup
                              ? 'top-3 bottom-0'
                              : endsGroup
                                ? 'top-0 bottom-3'
                                : 'top-0 bottom-0'
                        }`}
                        title={t('validation.linkedIssuesTooltip', {
                          defaultValue:
                            'These issues are linked. Fixing one may resolve the other.',
                        })}
                        aria-label={t('validation.linkedIssuesTooltip', {
                          defaultValue:
                            'These issues are linked. Fixing one may resolve the other.',
                        })}
                      />
                    )}
                    <div
                      onClick={() => handleIssueClick(issue)}
                      className="w-full cursor-pointer rounded-md border border-gray-200 p-2 text-left transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 sm:p-3"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleIssueClick(issue, 'keyboard')
                        }
                      }}
                    >
                      <div className="flex items-start gap-2 sm:gap-3">
                        {issue.severity === 'error' ? (
                          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        ) : issue.severity === 'warning' ? (
                          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="w-5 h-5 text-sky-500 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="mb-1 flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white sm:text-base">
                              {getShortTitle(issue)}
                            </h4>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 cursor-pointer"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleIssueClick(issue)
                              }}
                            >
                              {getIssueBadgeLabel(issue)}
                            </span>
                          </div>
                          <p className="mb-1.5 text-sm text-gray-600 dark:text-gray-400">
                            {issue.message}
                          </p>
                          {issue.ruleId === HIDDEN_SITUATION_PLAN_RULE_ID && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleIssueClick(issue)
                              }}
                              className="mb-1.5 inline-flex rounded-md border border-sky-300 px-2.5 py-1 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40"
                            >
                              {t('contextMenu.showHidden', 'Show hidden…')}
                            </button>
                          )}
                          <div className="mb-1.5">
                            <a
                              href={getValidationAreiUrl(issue.ruleId, language)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => {
                                event.stopPropagation()
                                trackGoogleAnalyticsEvent('validation_arei_link_open', {
                                  rule_id: issue.ruleId,
                                  severity: issue.severity,
                                  source: 'validation_card',
                                })
                              }}
                              className="group inline-flex items-center gap-1 text-xs font-medium text-sky-700 underline decoration-sky-300 underline-offset-2 transition-colors hover:text-sky-900 hover:decoration-sky-700 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-300 dark:decoration-sky-700 dark:hover:text-sky-100 dark:hover:decoration-sky-200 dark:focus-visible:outline-sky-300"
                              title={getAreiLinkLabel(issue.severity)}
                              aria-label={getAreiLinkLabel(issue.severity)}
                            >
                              <CircleHelp
                                className="h-3.5 w-3.5 transition-transform group-hover:scale-110"
                                aria-hidden="true"
                              />
                              <span>{getAreiLinkLabel(issue.severity)}</span>
                            </a>
                          </div>
                          {(issue.citations.length > 0 ||
                            (import.meta.env.DEV && currentProject)) && (
                            <div className="flex items-center justify-between mt-2">
                              {issue.citations.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                  {issue.citations.map((citation, idx) => (
                                    <span
                                      key={idx}
                                      className="text-xs px-2 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300"
                                    >
                                      {getCitationCodeLabel(citation.code)} {citation.section}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {import.meta.env.DEV && currentProject && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // Detailed debug log for this issue

                                    // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
                                    console.group('[Validation Debug]', issue.id)

                                    logger.info('Rule ID:', issue.ruleId)

                                    logger.info('Severity:', issue.severity)

                                    logger.info('Scope:', issue.scope)

                                    logger.info('Offenders:', issue.offenders)

                                    logger.info('Message:', issue.message)

                                    logger.info('Details:', issue.details)

                                    logger.info('Citations:', issue.citations)

                                    logger.info('Tags:', issue.tags)

                                    // When this is a circuit-scoped issue, also dump the live circuit data
                                    if (issue.scope.type === 'circuit') {
                                      const circuitId = issue.scope.id
                                      const panelCircuit = (() => {
                                        const walk = (
                                          panels: import('@/types/schema').Panel[]
                                        ): import('@/types/schema').Circuit | null => {
                                          for (const panel of panels) {
                                            for (const circuit of panel.circuits) {
                                              if (circuit.id === circuitId) return circuit
                                            }
                                            for (const protection of panel.protections) {
                                              if (protection.circuits) {
                                                for (const circuit of protection.circuits) {
                                                  if (circuit.id === circuitId) return circuit
                                                }
                                              }
                                            }
                                            const found = walk(panel.subPanels ?? [])
                                            if (found) return found
                                          }
                                          return null
                                        }
                                        return walk(getProjectElectricalPanels(currentProject))
                                      })()

                                      logger.info('--- Live circuit snapshot ---')
                                      logger.info('Circuit ID:', circuitId)
                                      logger.info('Circuit found:', !!panelCircuit)
                                      if (panelCircuit) {
                                        logger.info('Circuit code:', panelCircuit.code)
                                        const {
                                          endpointCount,
                                          switchOnlyBranchCredits,
                                          rawEndpoints,
                                          breakdown,
                                        } = computeAreiCircuitEndpointLimitCount(panelCircuit)

                                        logger.info('Raw endpoint count:', rawEndpoints.length)
                                        logger.info(
                                          'Switch-only branch credits:',
                                          switchOnlyBranchCredits
                                        )
                                        logger.info(
                                          'Effective endpoint count (dev recompute):',
                                          endpointCount
                                        )
                                        // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
                                        console.table(breakdown)
                                      }
                                    }

                                    // Cable / breaker rules use derived layout wires when possible — log the same inputs as primitives
                                    if (
                                      currentProject &&
                                      issue.scope.type === 'circuit' &&
                                      (issue.ruleId ===
                                        'be.areibook1.2025.breaker-vs-cross-section' ||
                                        issue.ruleId ===
                                          'be.areibook1.2025.minimum-cross-section' ||
                                        issue.ruleId === 'be.areibook1.2025.cable-cross-section' ||
                                        issue.ruleId === 'be.areibook1.2025.stove-sizing-hint')
                                    ) {
                                      const query = new DefaultQueryAPI(currentProject)
                                      const snap = buildCircuitCableValidationDebug(
                                        query,
                                        issue.scope.id
                                      )
                                      logger.info(
                                        '--- Cable / breaker validation snapshot (matches rule inputs) ---'
                                      )
                                      if (!snap) {
                                        logger.info(
                                          'Circuit not found for scope id:',
                                          issue.scope.id
                                        )
                                      } else {
                                        logger.info('Summary (effective values used by rules):', {
                                          circuitCode: snap.circuitCode,
                                          circuitKind: snap.circuitKind,
                                          segmentListSource: snap.segmentListSource,
                                          sectionResolutionBasis: snap.sectionResolutionBasis,
                                          circuitDefaultCableSectionMm2:
                                            snap.circuitDefaultCableSectionMm2,
                                          effectiveSectionMm2: snap.effectiveSectionMm2,
                                          minAcSegmentIds: snap.minAcSegmentIds,
                                          upstreamProtectionId: snap.upstreamProtectionId,
                                          upstreamBreakerRatingA: snap.upstreamBreakerRatingA,
                                          maxAdmissibleBreakerAForEffectiveSection:
                                            snap.maxAdmissibleBreakerAForEffectiveSection,
                                          minimumCrossSectionRequiredMm2:
                                            snap.minimumCrossSectionRequiredMm2,
                                        })
                                        logger.info(
                                          'AC wire segments (sectionMm2 from segment.cable; min drives effectiveSection):'
                                        )
                                        // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
                                        console.table(snap.acSegments)
                                        const stored = storedWireSegments.filter(
                                          (ws: WireSegment) => ws.circuitId === issue.scope.id
                                        )
                                        if (stored.length > 0) {
                                          logger.info(
                                            'Same circuit in stored one-wire segments (stored; may differ if rules use derived layout):'
                                          )
                                          // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
                                          console.table(
                                            stored.map((ws: WireSegment) => ({
                                              id: ws.id,
                                              type: ws.type,
                                              domain: ws.domain,
                                              sectionMm2: ws.cable?.sectionMm2,
                                              fromElementType: ws.fromElementType,
                                              fromElementId: ws.fromElementId,
                                              toElementType: ws.toElementType,
                                              toElementId: ws.toElementId,
                                            }))
                                          )
                                        }
                                      }
                                    }

                                    // Extra debug for electrical-domain rule: dump wire segment domains + connections
                                    if (issue.ruleId === 'be.areibook1.2025.electrical-domain') {
                                      const wireSegments = storedWireSegments
                                      const segmentOffenders = (issue.offenders ?? []).filter(
                                        (o) => o.kind === 'segment'
                                      )

                                      logger.info(
                                        '--- Wire segment snapshot(s) for domain-mismatch ---'
                                      )
                                      for (const segOff of segmentOffenders) {
                                        const seg = wireSegments.find(
                                          (ws: WireSegment) => ws.id === segOff.id
                                        )
                                        if (!seg) {
                                          logger.info(
                                            'Segment not found in stored one-wire segments:',
                                            segOff.id
                                          )
                                          continue
                                        }

                                        // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
                                        console.group('Wire segment', seg.id)
                                        logger.info('Panel ID:', seg.panelId)
                                        logger.info('Circuit ID:', seg.circuitId)
                                        logger.info('Wire domain:', seg.domain)
                                        logger.info('From element:', {
                                          type: seg.fromElementType,
                                          id: seg.fromElementId,
                                        })
                                        logger.info('To element:', {
                                          type: seg.toElementType,
                                          id: seg.toElementId,
                                        })
                                        // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
                                        console.groupEnd()
                                      }
                                    }

                                    // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
                                    console.groupEnd()
                                  }}
                                  className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                  DEBUG
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ValidationIssuesDialog
