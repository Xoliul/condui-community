/**
 * Calculate page counts for PDF export
 */

import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { buildSitplanExportTargets } from './sitplanExportPlan'
import { estimateEendraadPageCount } from './slicing/eendraadSlicing'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { buildPanelExportTargets, countElectricalPanels } from './exportPlan'

type PageCountProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalV2Building

export interface PageCountSummary {
  eendraad: number
  panel: number
  sitplan: number
  total: number
}

// ExportOptions is now defined in types.ts, but for page counting we only need these fields
export interface PageCountOptions {
  includeEendraad: boolean
  includePanel: boolean
  includeSitplan: boolean
  mergePlanPages?: boolean
  eendraadPaperSize?: 'A4' | 'A3'
}

/**
 * Calculate page counts for export
 *
 * @param options Export options
 * @param project Current project
 * @param layout Eendraad layout (optional)
 */
export function calculatePageCounts(
  options: PageCountOptions,
  project: PageCountProject,
  layout?: BottomUpLayoutResult | null,
  _getFramesByPanel?: (panelId: string) => import('@/types/schema').Frame[]
): PageCountSummary {
  // If project not provided, try to get from store (but this won't work in non-React context)
  // So we require it as a parameter
  if (!project) {
    return { eendraad: 0, panel: 0, sitplan: 0, total: 0 }
  }

  let eendraad = 0
  let panel = 0
  let sitplan = 0

  // Calculate sitplan pages (1 per floor)
  if (options.includeSitplan === true) {
    sitplan = buildSitplanExportTargets(project, options.mergePlanPages === true).length
  }

  // Calculate panel pages (1 per panel)
  if (options.includePanel === true) {
    const projectPanels = getProjectElectricalPanels(project)
    panel = buildPanelExportTargets(project).length
    if (projectPanels.length > 0) {
      panel += 1
    }
  }

  // Calculate 1draad pages (sliced frames)
  if (options.includeEendraad === true) {
    if (layout) {
      eendraad = estimateEendraadPageCount(layout.panels, options.eendraadPaperSize)
    } else {
      // No layout available - estimate based on number of panels
      const panelCount = countElectricalPanels(getProjectElectricalPanels(project))
      // Rough estimate: assume 1 page per panel (will be more accurate during actual export)
      eendraad = panelCount
    }
  }

  const total = eendraad + panel + sitplan

  return { eendraad, panel, sitplan, total }
}
