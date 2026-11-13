import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { useEffectiveInstallerProfile } from '@/hooks/useEffectiveInstallerProfile'
import { useCanvasFontFamily } from '@/hooks/useCanvasFontFamily'
import { getInfoBlockContent } from '@/lib/infoBlockContent'

/** Only height changes wake layout subscribers; ordinary project edits retain their geometry. */
export function useInfoBlockHeight(enabled = true): number {
  const [id, installerOverride] = useProjectStore(useShallow((state) => [
    enabled ? state.currentProject?.project.id : undefined,
    enabled ? state.currentProject?.project.installerOverride : undefined,
  ] as const))
  const profileProject = useMemo(() => id ? { project: { id, installerOverride } } : null,
    [id, installerOverride])
  const { profile } = useEffectiveInstallerProfile(profileProject)
  const { t } = useTranslation()
  const font = useCanvasFontFamily()
  const country = t('installation.countryBelgium', 'Belgium')
  return useProjectStore((state) =>
    getInfoBlockContent(enabled ? state.currentProject : null, profile, country, font).height)
}
