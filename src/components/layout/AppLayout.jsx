import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useAuth } from '@/hooks/useAuth'

export default function AppLayout({ role }) {
  const { user, student } = useAuth()

  return (
    <div className="min-h-screen bg-background">
      <Sidebar role={role} user={user} />
      <div className="md:ml-64 ml-0 transition-all duration-300 min-h-screen">
        <TopBar user={user} student={student} />
        <main className="p-4 md:p-6">
          <Outlet context={{ user, student }} />
        </main>
      </div>
    </div>
  )
}
