/** Community stand-in for `components/junctionEditor/junctionEditorHostedFeatures.tsx`: no junction editor. */
import type { ProjectDocument } from '@/lib/documents/projectDocuments'

// eslint-disable-next-line react-refresh/only-export-components -- Matches the hosted hooks and components behind one alias.
export function useJunctionDocuments(): ProjectDocument[] {
  return []
}

export function JunctionDocumentView(_props: {
  zoom?: number
  onZoomChange?: (zoom: number) => void
  fitKey?: number
}) {
  return null
}

export function JunctionDocumentProperties(_props: { documentId: string }) {
  return null
}

// eslint-disable-next-line react-refresh/only-export-components -- Matches the hosted hooks and components behind one alias.
export function useJunctionEditorMenu() {
  return (items: import('@/components/common/ContextMenu').ContextMenuItem[], _candidates: ReadonlyArray<string | null | undefined>, _options?: { afterLabel?: string }) => items
}

// eslint-disable-next-line react-refresh/only-export-components -- Matches the hosted hooks and components behind one alias.
export function useOpenJunctionAsset(): (assetId: string) => void {
  return () => {}
}

export function JunctionEditorHost() {
  return null
}

export function JunctionEditorOpenButton(_props: { occurrenceId: string }) {
  return null
}
