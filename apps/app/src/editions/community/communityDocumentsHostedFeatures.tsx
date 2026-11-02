/* eslint react-refresh/only-export-components: off -- Community stubs mirror the hosted Documents API. */
import type { ProjectDocument } from '@/lib/documents/projectDocuments'
import type { AdjustableTripControl } from '@/components/properties/ProtectionDeviceElectricalFields'
import type { ProtectionDevice } from '@/types/schema'

/** Community edition of the Documents canvas' hosted parts: no paid-project tables or team library. */
export type TeamDocumentLibraryAccess = { teamId: string; canManage: boolean }

export interface ExternalInfluencesEntry {
  locked: boolean
  disabled: boolean
  add: (name: string) => string | null
}

export interface ShortCircuitEntry {
  locked: boolean
  add: (name: string, language: string) => string | null
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

export function useShortCircuitEntry(): ShortCircuitEntry | null {
  return null
}

export function ShortCircuitDocumentView(_props: { documentId: string }): null {
  return null
}

export function useAdjustableTrip(_protection: ProtectionDevice | undefined): AdjustableTripControl | null {
  return null
}

export function ShortCircuitDocumentHeaderActions(_props: { documentId: string }): null {
  return null
}
