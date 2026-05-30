import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { UserCog, Plus, Trash2, Ban, CheckCircle } from 'lucide-react'

export default function ManageAdmins() {
  const [admins, setAdmins] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newAdmin, setNewAdmin] = useState({ email: '', name: '', role: 'admin' })

  useEffect(() => {
    loadAdmins()
  }, [])

  const loadAdmins = async () => {
    const { data, error } = await supabase
      .from('admins')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error) setAdmins(data || [])
    setLoading(false)
  }

  const handleAddAdmin = async () => {
    if (!newAdmin.email || !newAdmin.name) {
      toast.error('Please fill all fields')
      return
    }

    const { error } = await supabase
      .from('admins')
      .insert([{
        email: newAdmin.email,
        name: newAdmin.name,
        role: newAdmin.role,
        status: 'active',
      }])

    if (error) {
      toast.error(error.message)
    } else {
      toast.success(`Admin ${newAdmin.name} added!`)
      setShowAddModal(false)
      setNewAdmin({ email: '', name: '', role: 'admin' })
      loadAdmins()
    }
  }

  const toggleStatus = async (adminId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    const { error } = await supabase
      .from('admins')
      .update({ status: newStatus })
      .eq('id', adminId)

    if (error) {
      toast.error('Failed to update status')
    } else {
      toast.success(`Admin ${newStatus === 'active' ? 'enabled' : 'disabled'}`)
      loadAdmins()
    }
  }

  const deleteAdmin = async (adminId) => {
    if (confirm('Are you sure? This will remove admin access permanently.')) {
      const { error } = await supabase.from('admins').delete().eq('id', adminId)
      if (error) {
        toast.error('Failed to delete admin')
      } else {
        toast.success('Admin removed')
        loadAdmins()
      }
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Manage Admins</h1>
          <p className="text-sm text-muted-foreground">{admins.length} admin(s) have access</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Admin
        </button>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border/50">
              <tr>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">Email</th>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">Role</th>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="text-center py-8 text-muted-foreground">Loading...</td></tr>
              ) : admins.length === 0 ? (
                <tr><td colSpan="5" className="text-center py-8 text-muted-foreground">No admins found</td></tr>
              ) : (
                admins.map(admin => (
                  <tr key={admin.id} className="border-b border-border/30 hover:bg-secondary/20">
                    <td className="p-4 text-sm font-medium">{admin.name}</td>
                    <td className="p-4 text-sm text-muted-foreground">{admin.email}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${admin.role === 'super_admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-primary/20 text-primary'}`}>
                        {admin.role}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs ${admin.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {admin.status}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleStatus(admin.id, admin.status)}
                          className="p-1 rounded hover:bg-secondary/50 transition-colors"
                          title={admin.status === 'active' ? 'Disable' : 'Enable'}
                        >
                          {admin.status === 'active' ? <Ban className="w-4 h-4 text-yellow-400" /> : <CheckCircle className="w-4 h-4 text-green-400" />}
                        </button>
                        <button
                          onClick={() => deleteAdmin(admin.id)}
                          className="p-1 rounded hover:bg-secondary/50 transition-colors"
                          title="Remove Admin"
                        >
                          <Trash2 className="w-4 h-4 text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
           </table>
        </div>
      </div>

      {/* Add Admin Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="glass-card rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Add New Admin</h2>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Full Name *"
                value={newAdmin.name}
                onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
              />
              <input
                type="email"
                placeholder="Email *"
                value={newAdmin.email}
                onChange={(e) => setNewAdmin({ ...newAdmin, email: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
              />
              <select
                value={newAdmin.role}
                onChange={(e) => setNewAdmin({ ...newAdmin, role: e.target.value })}
                className="w-full px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
              >
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-2 rounded-lg border border-border/50 hover:bg-secondary/30">
                Cancel
              </button>
              <button onClick={handleAddAdmin} className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90">
                Add Admin
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
