import { createBrowserRouter } from 'react-router'
import Shell from './Shell'
import Overview from './pages/Overview'
import CaseDetail from './pages/CaseDetail'
import Incidents from './pages/Incidents'
import Requests from './pages/Requests'
import Traps from './pages/Traps'
import Vaults from './pages/Vaults'
import Workflows from './pages/Workflows'
import Execution from './pages/Execution'
import Approvals from './pages/Approvals'
import Registry from './pages/Registry'
import Network from './pages/Network'
import Config from './pages/Config'
import Reports from './pages/Reports'
import DesignSystem from './pages/DesignSystem'
import AttackTrace from './pages/AttackTrace'
import NotFound from './pages/NotFound'

export const router = createBrowserRouter(
  [
    {
      path: '/',
      Component: Shell,
      children: [
        { index: true, Component: Overview },
        { path: 'cases', Component: Incidents },
        { path: 'cases/:id', Component: CaseDetail },
        { path: 'requests', Component: Requests },
        { path: 'traps', Component: Traps },
        { path: 'vaults', Component: Vaults },
        { path: 'workflows', Component: Workflows },
        { path: 'execution', Component: Execution },
        { path: 'approvals', Component: Approvals },
        { path: 'registry', Component: Registry },
        { path: 'network', Component: Network },
        { path: 'config', Component: Config },
        { path: 'reports', Component: Reports },
        { path: 'attack', Component: AttackTrace },
        { path: 'system', Component: DesignSystem },
        { path: '*', Component: NotFound },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
)
