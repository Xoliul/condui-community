import { BrowserRouter as Router, Route, Routes } from 'react-router-dom'
import './i18n'
import Home from '@/editions/community/CommunityHome'
import ProjectPage from '@/editions/community/CommunityProjectPage'
import DemoProjectPage from '@/editions/community/CommunityDemoProjectPage'
import { Dialog } from '@/components/common'
import { DeployRefreshBanner } from '@/components/deploy/DeployRefreshBanner'
import { OfflineConnectivityNotice } from '@/components/connectivity/OfflineConnectivityNotice'
import {
  LanguageRouteShell,
  UnprefixedLanguageRedirect,
} from '@/components/routing/LanguageRouteShell'
import { useBaseAppEffects } from '@/hooks/useBaseAppEffects'
import { useCommunitySymbolFavoritesSync } from '@/editions/community/communitySymbolFavorites'
import { useCommunityEditorPreferencesSync } from '@/editions/community/communityEditorPreferences'

export default function CommunityApp() {
  useBaseAppEffects()
  useCommunitySymbolFavoritesSync()
  useCommunityEditorPreferencesSync()
  const basename = import.meta.env.BASE_URL ?? '/'

  return (
    <Router basename={basename}>
      <OfflineConnectivityNotice />
      <DeployRefreshBanner />
      <Routes>
        <Route path="/:lang" element={<LanguageRouteShell />}>
          <Route index element={<Home />} />
          <Route path="demo" element={<DemoProjectPage />} />
          <Route path="project/:id" element={<ProjectPage />} />
        </Route>
        <Route path="*" element={<UnprefixedLanguageRedirect />} />
      </Routes>
      <Dialog />
    </Router>
  )
}
