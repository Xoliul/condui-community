/**
 * Project documents (uploaded datasheets, inspection reports, source plans) are an unfinished
 * feature. Opt-in at build time with `VITE_ENABLE_PROJECT_DOCUMENTS=1`, in hosted and community
 * builds alike. Shared code must reference it only inside `@project-documents-strip` blocks so
 * disabled builds drop the feature entirely; its hosted-only parts (paid-project tables, team
 * library, cable schedule) live in `components/documents/documentsHostedFeatures`, which the
 * community edition replaces with a stub.
 */
export function isProjectDocumentsEnabled(): boolean {
  const value = import.meta.env.VITE_ENABLE_PROJECT_DOCUMENTS?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}
