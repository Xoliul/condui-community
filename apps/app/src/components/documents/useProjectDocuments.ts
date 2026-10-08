import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { useProjectDocumentsStore } from '@/stores/projectDocumentsStore'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { projectHasControlDevices } from '@/lib/controlLink/addressTable'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { useJunctionDocuments } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import {
  cableScheduleDocument,
  controlAddressesDocument,
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
 * Every document the Documents canvas lists: views the project derives live (the cable
 * schedule, where available, and the domotica address table in projects with domotica modules)
 * followed by the project's documents.
 */
export function useListedProjectDocuments(): ProjectDocument[] {
  const { t } = useTranslation()
  const storedDocuments = useProjectDocuments()
  const junctionDocuments = useJunctionDocuments()
  const assets = useProjectStore((s) => s.currentProject?.assets)
  const project = useProjectStore((s) => s.currentProject)
  const hasControlDevices = useMemo(
    () => (project ? projectHasControlDevices(getProjectElectricalPanels(project)) : false),
    [project]
  )
  const cableScheduleName = t('cableSchedule.title', 'Cable schedule')
  const controlAddressesName = t('controlAddresses.title', 'Domotics addresses')
  return useMemo(
    () => [
      ...(isCableRoutesEnabled() ? [cableScheduleDocument(cableScheduleName, assets)] : []),
      ...(hasControlDevices ? [controlAddressesDocument(controlAddressesName, assets)] : []),
      ...junctionDocuments,
      ...storedDocuments,
    ],
    [assets, cableScheduleName, controlAddressesName, hasControlDevices, junctionDocuments, storedDocuments]
  )
}
