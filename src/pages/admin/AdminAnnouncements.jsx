import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Plus, Pin, Bell, Trash2, Edit, Send } from 'lucide-react'

export default function AdminAnnouncements() {
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newAnnouncement, setNewAnnouncement] = useState({
    title: '',
    message: '',
    priority: 'normal',
    pinned: false
  })

  useEffect(() => {
    loadAnnouncements()
  }, [])

  const loadAnnouncements = async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
    
    setAnnouncements(data || [])
    setLoading(false)
  }

  const handleAddAnnouncement = async () => {
    if (!newAnnouncement.title || !newAnnouncement.message) {
      toast.error('Please fill all fields')
      return
    }

    const { error } = await supabase
      .from('announcements')
      .insert([{
        title: newAnnouncement.title,
        message: newAnnouncement.message,
        priority: newAnnouncement.priority,
        pinned: newAnnouncement.pinned,
        created_by: sessionStorage.getItem('userId')
      }])

    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Announcement sent!')
      setShowAddModal(false)
      setNewAnnouncement({ title: '', message: '', priority: 'normal', pinned: false })
      loadAnnouncements()
    }
  }

  const deleteAnnouncement = async (id) => {
    if (confirm('Delete this announcement?')) {
      await supabase.from('announcements').delete().eq('id', id)
      toast.success('Announcement deleted')
      loadAnnouncements()
    }
  }

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'urgent': return 'bg-red-500/20 text-red-400 border-red-500/30'
      case 'important': return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    }
  }

  if (loading) return <div className="text-center py-12">Loading...</div>

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Announcements</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" /> New Announcement
        </button>
      </div>

      <div className="space-y-3">
        {announcements.length === 0 ? (
          <div className="glass-card rounded-xl p-12 text-center">
            <Bell className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No announcements yet.</p>
          </div>
        ) : (
          announcements.map(ann => (
            <div key={ann.id} className={`glass-card rounded-xl p-5 border-l-4 ${ann.pinned ? 'border-l-primary' : 'border-l-border'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {ann.pinned && <Pin className="w-3 h-3 text-primary" />}
                    <h3 className="font-semibold">{ann.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${getPriorityColor(ann.priority)}`}>
                      {ann.priority}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{ann.message}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {ann.created_at ? new Date(ann.created_at).toLocaleString() : ''}
                  </p>
                </div>
                <button onClick={() => deleteAnnouncement(ann.id)} className="p-2 rounded-lg hover:bg-red-500/20">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="glass-card rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">New Announcement</h2>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Title"
                value={newAnnouncement.title}
                onChange={(e) => setNewAnnouncement({...newAnnouncement, title: e.target.value})}
                className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
              />
              <textarea
                placeholder="Message"
                value={newAnnouncement.message}
                onChange={(e) => setNewAnnouncement({...newAnnouncement, message: e.target.value})}
                rows={4}
                className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none resize-none"
              />
              <select
                value={newAnnouncement.priority}
                onChange={(e) => setNewAnnouncement({...newAnnouncement, priority: e.target.value})}
                className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50"
              >
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </select>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAnnouncement.pinned}
                  onChange={(e) => setNewAnnouncement({...newAnnouncement, pinned: e.target.checked})}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm">Pin to top</span>
              </label>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-2 rounded-lg border border-border/50 hover:bg-secondary/30">Cancel</button>
              <button onClick={handleAddAnnouncement} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
