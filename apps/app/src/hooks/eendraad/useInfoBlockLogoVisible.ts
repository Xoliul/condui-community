import { useMemo } from 'react'
import { useEffectiveInstallerProfile } from '@/hooks/useEffectiveInstallerProfile'
import { useInfoBlockLogoImage } from './useInfoBlockLogoImage'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'

/**
 * Whether drawing info blocks get the large installer logo column. The effective
 * installer profile already omits logos when project access does not include one,
 * so an uploaded logo appears automatically whenever the effective profile includes it.
 * The column waits until the logo decodes, so a broken image never leaves an empty box.
 */
export function useInfoBlockLogoVisible(enabled = true): boolean {
  const projectId = useProjectStore((state: ProjectState) =>
    enabled ? state.currentProject?.project.id : undefined
  )
  const installerOverride = useProjectStore((state: ProjectState) =>
    enabled ? state.currentProject?.project.installerOverride : undefined
  )
  const profileProject = useMemo(
    () => (projectId ? { project: { id: projectId, installerOverride } } : null),
    [projectId, installerOverride]
  )
  const { profile } = useEffectiveInstallerProfile(profileProject)
  const logoImage = useInfoBlockLogoImage(enabled ? profile?.logoDataUrl : null)
  return enabled && logoImage != null
}
