import { createContext, useContext } from 'react'
import type { ProjectV2 } from '@/types/projectV2'
import { useProjectStore } from '@/stores/projectStore'
import type { TerminalNumberFormat } from '@/types/junction'
import { getProjectTerminalNumberFormat } from '@/lib/terminalStrip/labels'

export interface OneWireRenderProject {
  project: ProjectV2
  /** The open project, whose access decides which labels the drawing may show. */
  accessProjectId: string | null
  /** Leave out the title block in each frame (small previews). */
  hideInfoBlock?: boolean
}

/**
 * Project a one-wire drawing shows. Unset in the editor canvas, where symbols read the open
 * project; set by read-only drawings of another project, such as the label style preview.
 */
export const OneWireRenderProjectContext = createContext<OneWireRenderProject | null>(null)

interface OneWireProjectState {
  currentProject: ProjectV2 | null
}

/** Reads the drawn project: the context's project when set, otherwise the open project. */
export function useOneWireProjectSelector<T>(selector: (state: OneWireProjectState) => T): T {
  const override = useContext(OneWireRenderProjectContext)
  const live = useProjectStore((state) => (override ? undefined : selector(state)))
  return override ? selector({ currentProject: override.project }) : (live as T)
}

/** Terminal strip number format (X1-1, X1.1, X1.01) of the drawn project's naming preset. */
export function useOneWireTerminalNumberFormat(): TerminalNumberFormat {
  return useOneWireProjectSelector((state) =>
    state.currentProject ? getProjectTerminalNumberFormat(state.currentProject) : 'X5-1'
  )
}

/** Project id to check feature access with: the open project, also while drawing a preview. */
export function useOneWireAccessProjectId(drawnProjectId: string | undefined): string | undefined {
  const override = useContext(OneWireRenderProjectContext)
  return override ? (override.accessProjectId ?? undefined) : drawnProjectId
}

export function useOneWireHidesInfoBlock(): boolean {
  return useContext(OneWireRenderProjectContext)?.hideInfoBlock === true
}
