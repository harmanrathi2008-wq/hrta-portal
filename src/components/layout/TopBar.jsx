import { Bell, User, LogOut } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export default function TopBar() {
  const { user, student, logout } = useAuth()
  
  const displayName = student?.full_name || user?.displayName || user?.email?.split('@')[0] || 'User'
  const appId = student?.application_id || ''

  return (
    <header className="h-14 glass border-b border-border/50 flex items-center justify-between px-6 sticky top-0 z-30">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          HARMAN RATHI TESTING AGENCY
        </h2>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-secondary/50 transition-colors">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-medium">{displayName}</p>
                {appId && <p className="text-[10px] text-muted-foreground">{appId}</p>}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem className="text-xs text-muted-foreground" disabled>
              {user?.email}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
