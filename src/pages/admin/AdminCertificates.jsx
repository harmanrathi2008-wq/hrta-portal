import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Award, Download } from 'lucide-react'

export default function AdminCertificates() {
  const [certificates, setCertificates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCertificates()
  }, [])

  const loadCertificates = async () => {
    const { data } = await supabase
      .from('certificates')
      .select('*, students(full_name, application_id), exams(title)')
      .order('created_at', { ascending: false })
    
    setCertificates(data || [])
    setLoading(false)
  }

  if (loading) return <div className="text-center py-12">Loading...</div>

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Certificates</h1>

      {certificates.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Award className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No certificates generated yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Certificates are auto-generated for 90%+ scores or top 3 ranks</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {certificates.map(cert => (
            <div key={cert.id} className="glass-card rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{cert.students?.full_name}</p>
                <p className="text-xs text-muted-foreground">{cert.exams?.title} • {cert.percentage}% • Rank #{cert.rank}</p>
                <p className="text-xs font-mono text-primary mt-1">{cert.certificate_id}</p>
              </div>
              <button className="p-2 rounded-lg hover:bg-primary/10">
                <Download className="w-4 h-4 text-primary" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
