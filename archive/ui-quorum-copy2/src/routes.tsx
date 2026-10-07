import {
  createBrowserRouter,
  Navigate,
  useLocation,
  useParams,
} from "react-router"
import Shell from "./Shell"
import Overview from "./pages/Overview"
import CaseDetail from "./pages/CaseDetail"
import Incidents from "./pages/Incidents"
import Registry from "./pages/Registry"
import Network from "./pages/Network"
import DesignSystem from "./pages/DesignSystem"
import NotFound from "./pages/NotFound"
import Controls from "./pages/Controls"
import Decoys from "./pages/Decoys"

function LegacyControls() {
  const location = useLocation()
  const route = useParams()
  const aliases: Record<string, string> = {
    requests: "requests",
    traps: "triggers",
    vaults: "vaults",
    approvals: "approvals",
    config: "policies",
    workflows: "activity",
    execution: "activity",
    reports: "activity",
  }
  const section = route.tab ?? location.pathname.split("/")[1]
  const tab = aliases[section] ?? (["triggers", "policies", "activity"].includes(section) ? section : "triggers")
  const params = new URLSearchParams(location.search)
  params.set("tab", tab)
  const id =
    route.id ??
    params.get("id") ??
    params.get("request") ??
    params.get("policy") ??
    params.get("run")
  if (id) params.set(`${tab}.id`, tab === "triggers" && !id.startsWith("trigger-") ? `trigger-${id}` : id)
  return <Navigate replace to={`/controls?${params.toString()}`} />
}

export const router = createBrowserRouter(
  [
    {
      path: "/",
      Component: Shell,
      children: [
        { index: true, Component: Overview },
        { path: "cases", Component: Incidents },
        { path: "cases/:id", Component: CaseDetail },
        { path: "decoys", Component: Decoys },
        { path: "controls", Component: Controls },
        { path: "controls/:tab/:id?", Component: LegacyControls },
        { path: "requests", Component: LegacyControls },
        { path: "requests/:id", Component: LegacyControls },
        { path: "traps", Component: LegacyControls },
        { path: "traps/:id", Component: LegacyControls },
        { path: "vaults", Component: LegacyControls },
        { path: "vaults/:id", Component: LegacyControls },
        { path: "workflows", Component: LegacyControls },
        { path: "execution", Component: LegacyControls },
        { path: "approvals", Component: LegacyControls },
        { path: "approvals/:id", Component: LegacyControls },
        { path: "registry", Component: Registry },
        { path: "network", Component: Network },
        { path: "config", Component: LegacyControls },
        { path: "reports", Component: LegacyControls },
        { path: "system", Component: DesignSystem },
        { path: "*", Component: NotFound },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" },
)
