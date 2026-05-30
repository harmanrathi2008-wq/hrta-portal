import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  FileText,
  ClipboardList,
  BarChart3,
  Settings,
  Award,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Shield,
  UserCog,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const adminLinks = [
  { path: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/admin/students', icon: Users, label: 'Students' },
  { path: '/admin/exams', icon: FileText, label: 'Exams' },
  { path: '/admin/results', icon: BarChart3, label: 'Results' },
  { path: '/admin/admins', icon: UserCog, label: 'Manage Admins' },
  { path: '/admin/settings', icon: Settings, label: 'Settings' },
]

const studentLinks = [
  { path: '/student', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/student/exams', icon: FileText, label: 'My Exams' },
  { path: '/student/results', icon: BarChart3, label: 'Results' },
  { path: '/student/leaderboard', icon: Award, label: 'Leaderboard' },
  { path: '/student/profile', icon: Settings, label: 'Profile' },
]

export default function Sidebar({ role, user }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { logout } = useAuth()
  
  const links = role === 'admin' ? adminLinks : studentLinks
  const isSuperAdmin = user?.role === 'super_admin'

  const NavLinks = () => (
    <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
      {links.map((link) => {
        // Hide Manage Admins link for regular admins (only super admin sees it)
        if (link.path === '/admin/admins' && !isSuperAdmin) return null
        
        const isActive = location.pathname === link.path ||
          (link.path !== '/admin' && link.path !== '/student' && location.pathname.startsWith(link.path))
        
        return (
          <Link
            key={link.path}
            to={link.path}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200",
              isActive
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            <link.icon className={cn("w-5 h-5 flex-shrink-0", isActive && "text-primary")} />
            {(!collapsed || mobileOpen) && <span className="truncate">{link.label}</span>}
          </Link>
        )
      })}
      
      <button
        onClick={logout}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200 mt-4"
      >
        <LogOut className="w-5 h-5 flex-shrink-0" />
        {(!collapsed || mobileOpen) && <span className="truncate">Logout</span>}
      </button>
    </nav>
  )

  return (
    <>
      {/* Mobile menu button */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg glass border border-border/50"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile sidebar */}
      <aside className={cn(
        "md:hidden fixed left-0 top-0 h-full z-50 flex flex-col glass border-r border-border/50 w-64 transition-transform duration-300",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center gap-3 p-4 border-b border-border/50">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <span className="text-sm font-bold text-primary">HRTA</span>
          </div>
          <div>
            <h1 className="text-sm font-bold">HRTA</h1>
            <p className="text-[10px] text-muted-foreground">Testing Agency</p>
          </div>
        </div>
        <NavLinks />
      </aside>

      {/* Desktop sidebar */}
      <aside className={cn(
        "hidden md:flex fixed left-0 top-0 h-full z-40 flex-col transition-all duration-300 glass border-r border-border/50",
        collapsed ? "w-16" : "w-64"
      )}>
        <div className="flex items-center gap-3 p-4 border-b border-border/50">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-primary">HRTA</span>
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-sm font-bold">HRTA</h1>
              <p className="text-[10px] text-muted-foreground">Testing Agency</p>
            </div>
          )}
        </div>
        <NavLinks />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center p-3 border-t border-border/50 text-muted-foreground hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>
    </>
  )
}
