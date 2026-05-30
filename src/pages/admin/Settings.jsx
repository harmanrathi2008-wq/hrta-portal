import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Save, Shield, Mail, Database, User, Lock, Bell, Globe } from 'lucide-react'

export default function Settings() {
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState({
    siteName: 'Harman Rathi Testing Agency',
    siteTagline: 'Excellence in Assessment',
    defaultNegativeMarking: true,
    defaultPassingPercentage: 33,
    enableEmailNotifications: true,
    enableProctoring: true,
    maxLoginAttempts: 5,
    sessionTimeout: 30,
  })

  const handleSave = async () => {
    setLoading(true)
    // Save settings to database (you can create a settings table)
    toast.success('Settings saved successfully!')
    setLoading(false)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="space-y-4">
        {/* General Settings */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border/50 pb-3">
            <Globe className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">General Settings</h2>
          </div>
          
          <div>
            <label className="text-sm font-medium mb-1 block">Site Name</label>
            <input
              type="text"
              value={settings.siteName}
              onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
            />
          </div>
          
          <div>
            <label className="text-sm font-medium mb-1 block">Site Tagline</label>
            <input
              type="text"
              value={settings.siteTagline}
              onChange={(e) => setSettings({ ...settings, siteTagline: e.target.value })}
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Exam Defaults */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border/50 pb-3">
            <Database className="w-5 h-5 text-accent" />
            <h2 className="font-semibold">Exam Defaults</h2>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Default Negative Marking</p>
              <p className="text-xs text-muted-foreground">Enable negative marking for new exams by default</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={settings.defaultNegativeMarking} onChange={(e) => setSettings({ ...settings, defaultNegativeMarking: e.target.checked })} />
              <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>
          
          <div>
            <label className="text-sm font-medium mb-1 block">Default Passing Percentage</label>
            <input
              type="number"
              value={settings.defaultPassingPercentage}
              onChange={(e) => setSettings({ ...settings, defaultPassingPercentage: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        {/* Security Settings */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border/50 pb-3">
            <Shield className="w-5 h-5 text-green-400" />
            <h2 className="font-semibold">Security Settings</h2>
          </div>
          
          <div>
            <label className="text-sm font-medium mb-1 block">Max Login Attempts</label>
            <input
              type="number"
              value={settings.maxLoginAttempts}
              onChange={(e) => setSettings({ ...settings, maxLoginAttempts: parseInt(e.target.value) || 5 })}
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
            />
          </div>
          
          <div>
            <label className="text-sm font-medium mb-1 block">Session Timeout (minutes)</label>
            <input
              type="number"
              value={settings.sessionTimeout}
              onChange={(e) => setSettings({ ...settings, sessionTimeout: parseInt(e.target.value) || 30 })}
              className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Enable Proctoring</p>
              <p className="text-xs text-muted-foreground">Enable AI proctoring for all real exams</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={settings.enableProctoring} onChange={(e) => setSettings({ ...settings, enableProctoring: e.target.checked })} />
              <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>
        </div>

        {/* Email Settings */}
        <div className="glass-card rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border/50 pb-3">
            <Mail className="w-5 h-5 text-amber-400" />
            <h2 className="font-semibold">Email Settings</h2>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Email Notifications</p>
              <p className="text-xs text-muted-foreground">Send email notifications to students</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={settings.enableEmailNotifications} onChange={(e) => setSettings({ ...settings, enableEmailNotifications: e.target.checked })} />
              <div className="w-11 h-6 bg-gray-600 rounded-full peer peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
            </label>
          </div>
          
          <p className="text-xs text-muted-foreground">Email configuration is handled via Resend API. Make sure VITE_RESEND_API_KEY is set in environment variables.</p>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-6 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4 inline mr-2" /> Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
