/**
 * Core type definitions for the export system
 */

import type Konva from 'konva'
import type { ProjectAddress, ProjectPartyContact, WireSegment } from '@/types/schema'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'

import type { ExportPaperSize } from '@/lib/export/pageSizes'
import type { PlanGraphicExportDescriptor } from '@/lib/export/planGraphicSvgInject'
import type { SymbolExportDescriptor } from '@/lib/export/symbolSvgInject'
import type { AnnotationProject } from '@/lib/projectV2/annotations'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

/**
 * Export theme option - always explicit, default 'light'
 */
export type ExportTheme = 'light' | 'dark'

/**
 * Export options with explicit theme
 */
export interface ExportOptions {
  includeEendraad: boolean
  includePanel: boolean
  includeSitplan: boolean
  /** Merge multi-panel sitplan exports into one page per floor. */
  mergePlanPages: boolean
  includeInstallDates: boolean
  /** Paper format of the one-wire pages. Other page types stay A4. Defaults to A4. */
  eendraadPaperSize?: ExportPaperSize
  /** Include the effective installer signature in PDF info blocks. */
  includeSignature: boolean
  /** Append attached documents marked for export (hosted Documents feature). */
  includeDocuments?: boolean
  theme: ExportTheme // Always required, no optional
  
}



/** Fills defaults for persisted or partial export option objects. */
export function normalizeExportOptions(
  options: Partial<ExportOptions> &
    Pick<ExportOptions, 'includeEendraad' | 'includePanel' | 'includeSitplan' | 'theme'>
): ExportOptions {
  // Export selections are persisted in UI state and may come from older or
  // partially migrated documents. Treat only the explicit boolean `true` as
  // enabled so a stale truthy value such as the string "false" can never add
  // an unintended one-wire page to a panel-only export.
  const includeEendraad = options.includeEendraad === true
  const includePanel = options.includePanel === true
  const includeSitplan = options.includeSitplan === true
  const mergePlanPages = options.mergePlanPages === true

  

  return {
    includeEendraad,
    includePanel,
    includeSitplan,
    mergePlanPages,
    includeInstallDates: options.includeInstallDates ?? false,
    eendraadPaperSize: options.eendraadPaperSize === 'A3' ? 'A3' : 'A4',
    includeSignature: options.includeSignature ?? true,
    includeDocuments: options.includeDocuments === true,
    theme: options.theme,
    
  }
}

export interface ExportPageReference {
  url: string
  displayHost: string
  imageDataUrl: string
}

/**
 * Scene coordinate space - enforces single coordinate system
 */
export interface SceneBounds {
  x: number
  y: number
  width: number
  height: number
  space: 'scene' // Type-level enforcement
}

/**
 * When present, this eendraad slice uses a fixed scale and main-bus Y so all
 * slice pages align and use the same scale.
 */
export interface EendraadSliceExportMeta {
  /** Scale (mm per scene pixel) so full diagram height fits page; same for all slices. */
  globalScale: number
  /** Main bus Y in scene coordinates; kept at same page Y on every slice. */
  mainBusY: number
}

/**
 * Isolated export scene - self-contained, no live references
 */
export interface ExportScene {
  id: string // e.g. "panel-abc123" or "eendraad-slice-0"
  kind: 'eendraad' | 'panel' | 'sitplan'
  /** Theme already baked into rootNode. Target-themed SVG assets are injected after conversion. */
  renderedTheme?: ExportTheme
  rootNode: Konva.Group | Konva.Layer // Isolated clone, not live node
  bounds: SceneBounds // Must match rootNode coordinate space
  preferredOrientation?: 'portrait' | 'landscape'
  metadata?: Record<string, string>
  /** Set for eendraad slice exports: fixed scale and main-bus Y for alignment. */
  eendraadSlice?: EendraadSliceExportMeta
  /**
   * When set (e.g. slice overlap), clip rendered content to this rect in scene coords.
   * Same coordinate system as bounds; used so overlap is drawn but only this rect is visible.
   */
  contentClipRect?: SceneBounds
  /** Sitplan catalog graphics injected into SVG after Konva export (preserves rotation). */
  planGraphicExports?: PlanGraphicExportDescriptor[]
  /** Catalog symbol images removed before Konva export and injected as vectors afterward. */
  symbolExports?: SymbolExportDescriptor[]
}

export interface ComposedPagePlacement {
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
  fitBounds: SceneBounds
  scale: number
}

/**
 * Export page descriptor - what goes on one PDF page
 */
export interface ExportPage {
  id: string
  scene: ExportScene
  pageSize: ExportPaperSize
  orientation: 'portrait' | 'landscape'
}

/**
 * Diagnostic information for export issues
 */
export interface ExportDiagnostic {
  level: 'info' | 'warn' | 'error'
  code:
    | 'STAGE_UNAVAILABLE'
    | 'NO_CONTENT'
    | 'BOUNDS_INVALID'
    | 'SLICE_VALIDATION_FAILED'
    | 'SVG_RENDER_FAILED'
    | 'PDF_COMPOSE_FAILED'
    | 'THEME_SWITCH_FAILED'
    | 'DOCUMENT_APPEND_FAILED'
  pageId?: string
  canvasKind?: 'eendraad' | 'panel' | 'sitplan'
  message: string
  details?: Record<string, unknown>
}

/**
 * Export result with diagnostics
 */
export interface ExportResult {
  blob: Blob
  diagnostics: ExportDiagnostic[]
  pageCount: number
}

export type ExportProjectInstallerOverride = {
  name: string
  address: ProjectAddress
  companyNumber?: string
  email?: string
  mobile?: string
  phone?: string
  signatureDataUrl: string | null
  logoDataUrl: string | null
}

export type ExportProject = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2Building &
  AnnotationProject & {
    project: {
      id: string
      name?: string
      installerOverride?: ExportProjectInstallerOverride
      inspectionAgency?: ProjectPartyContact
      showInspectionAgencyInInfoBlock?: boolean
    }
  }

/**
 * Export context for building export plan
 */
export interface ExportContext {
  project: ExportProject
  eendraadLayout: BottomUpLayoutResult | null
  eendraadWireSegments?: WireSegment[]
  resolvePageReference?: (
    project: ExportProject,
    baseHref: string
  ) => Promise<ExportPageReference | null>
  advancedPanelLabels?: boolean
}

/**
 * Error class for export failures
 */
export class ExportError extends Error {
  constructor(
    public code: ExportDiagnostic['code'],
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ExportError'
  }
}
