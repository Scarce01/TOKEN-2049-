import { Outlet, useLocation } from "react-router"
import { Header, Sidebar } from "./components/Chrome"
import { ReplayProvider } from "./components/replay"

export default function Shell() {
  const { pathname } = useLocation()
  const immersive = pathname === "/"
  const controls = pathname === "/controls" || pathname.startsWith("/controls/")
  return (
    <ReplayProvider>
      <div
        className={`flex h-screen ${
          controls ? "min-w-0" : "min-w-[1180px]"
        } bg-ink text-cream`}
      >
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main
            key={pathname}
            className={`flex-1 min-h-0 ${
              immersive
                ? "overflow-hidden"
                : controls
                  ? "overflow-hidden p-4 lg:p-6"
                  : "overflow-y-auto px-8 py-7"
            }`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </ReplayProvider>
  )
}
