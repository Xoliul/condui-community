import type { ProjectDocument } from '@/lib/documents/projectDocuments'

/** Community edition of the Documents canvas' hosted parts: no paid-project tables or team library. */
export type TeamDocumentLibraryAccess = { teamId: string; canManage: boolean }

export interface ExternalInfluencesEntry {
  locked: boolean
  disabled: boolean
  add: (name: string) => string | null
}

const noSave = { canSave: () => false, pendingId: null, save: () => undefined }

export function useTeamDocumentLibraryAccess(): TeamDocumentLibraryAccess | null {
  return null
}

export function useSaveToTeamLibrary(_access: TeamDocumentLibraryAccess | null): {
  canSave: (document: ProjectDocument) => boolean
  pendingId: string | null
  save: (document: ProjectDocument) => void
} {
  return noSave
}

export function TeamLibraryPicker(_props: { teamId: string }): null {
  return null
}

export function useExternalInfluencesEntry(): ExternalInfluencesEntry | null {
  return null
}

export function ExternalInfluencesDocumentView(_props: { documentId: string }): null {
  return null
}

export function ExternalInfluencesDocumentActions(_props: {
  documentId: string
  documentName: string
}): null {
  return null
}

export function usePaidDocumentPageCount(
  _documents: readonly ProjectDocument[],
  _enabled: boolean
): number {
  return 0
}
