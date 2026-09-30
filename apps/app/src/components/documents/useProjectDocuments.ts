import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { useProjectDocumentsStore } from '@/stores/projectDocumentsStore'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import {
  cableScheduleDocument,
  getProjectDocuments,
  type ProjectDocument,
} from '@/lib/documents/projectDocuments'

/** Documents derived from project files followed by uploads and tables created in the editor. */
export function useProjectDocuments(): ProjectDocument[] {
  const projectId = useProjectStore((s) => s.currentProject?.project.id ?? null)
  const assets = useProjectStore((s) => s.currentProject?.assets)
  const createdAt = useProjectStore((s) => s.currentProject?.project.createdAt)
  const floors = useProjectStore((s) => s.currentProject?.building.floors)
  const bindProject = useProjectDocumentsStore((s) => s.bindProject)

  useEffect(() => {
    bindProject(projectId)
  }, [bindProject, projectId])

  return useMemo(() => getProjectDocuments(assets, createdAt, floors), [assets, createdAt, floors])
}

/**
 * Every document the Documents canvas lists: views every project derives live (the cable
 * schedule, where available) followed by the project's documents.
 */
export function useListedProjectDocuments(): ProjectDocument[] {
  const { t } = useTranslation()
  const storedDocuments = useProjectDocuments()
  const assets = useProjectStore((s) => s.currentProject?.assets)
  const cableScheduleName = t('cableSchedule.title', 'Cable schedule')
  return useMemo(
    () =>
      isCableRoutesEnabled()
        ? [cableScheduleDocument(cableScheduleName, assets), ...storedDocuments]
        : storedDocuments,
    [assets, cableScheduleName, storedDocuments]
  )
}
