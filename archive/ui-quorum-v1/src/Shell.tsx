import { Outlet, useLocation } from 'react-router'
import { Header, Sidebar } from './components/Chrome'

export default function Shell() {
  const { pathname } = useLocation()
  const immersive = pathname === '/'
  return (
    <div className="flex h-screen min-w-[1280px] bg-ink text-cream">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main key={pathname} className={`flex-1 overflow-y-auto ${immersive ? '' : 'px-8 py-7'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
