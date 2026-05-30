import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { 
  Eye, CheckCircle, Clock, Filter, Search, RotateCcw, 
  ShieldAlert, ShieldCheck, Award, UserPlus, Trash2, XCircle, Play
} from 'lucide-react'

export default function ResultsManagement() {
  const [submissions, setSubmissions] = useState([])
  const [filteredSubmissions, setFilteredSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Personal Assignments State
  const [students, setStudents] = useState([])
  const [exams, setExams] = useState([])
  const [personalAssignments, setPersonalAssignments] = useState([])
  const [selectedStudent, setSelectedStudent] = useState('')
  const [selectedExam, setSelectedExam] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignmentsError, setAssignmentsError] = useState(false)

  useEffect(() => {
    loadSubmissions()
    loadStudentsAndExams()
    loadPersonalAssignments()
  }, [])

  useEffect(() => {
    filterSubmissions()
  }, [searchQuery, statusFilter, submissions])

  const loadSubmissions = async () => {
    const { data, error } = await supabase
      .from('exam_results')
      .select('*, exams(title, subject), students(full_name, application_id)')
      .order('submitted_at', { ascending: true }) // Sort ascending first to count chronologically

    if (!error && data) {
      // Calculate attempt numbers dynamically
      const attemptTracker = {}; // key: studentId_examId, value: counter
      const processed = data.map(sub => {
        const key = `${sub.student_id}_${sub.exam_id}`;
        attemptTracker[key] = (attemptTracker[key] || 0) + 1;
        return {
          ...sub,
          attempt_number: attemptTracker[key]
        };
      });
      // Sort back to descending order of submitted_at for display
      processed.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
      
      setSubmissions(processed)
      setFilteredSubmissions(processed)
    }
    setLoading(false)
  }

  const loadStudentsAndExams = async () => {
    try {
      const [studentsRes, examsRes] = await Promise.all([
        supabase.from('students').select('id, full_name, application_id').eq('status', 'active').order('full_name'),
        supabase.from('exams').select('id, title, subject').eq('status', 'published').order('title')
      ])
      if (!studentsRes.error) setStudents(studentsRes.data || [])
      if (!examsRes.error) setExams(examsRes.data || [])
    } catch (err) {
      console.error("Error loading selection lists:", err)
    }
  }

  const loadPersonalAssignments = async () => {
    try {
      const { data, error } = await supabase
        .from('personal_assignments')
        .select('*, exams(title, subject), students(full_name, application_id)')
        .order('assigned_at', { ascending: false })

      if (error) {
        console.warn("personal_assignments table might not exist yet.", error.message)
        setAssignmentsError(true)
      } else {
        setPersonalAssignments(data || [])
        setAssignmentsError(false)
      }
    } catch (err) {
      console.error("Error loading personal assignments:", err)
      setAssignmentsError(true)
    }
  }

  const filterSubmissions = () => {
    let filtered = [...submissions]

    if (statusFilter !== 'all') {
      filtered = filtered.filter(s => s.status === statusFilter)
    }

    if (searchQuery) {
      filtered = filtered.filter(s => {
        const name = s.students?.full_name || s.student_name || '';
        const appId = s.students?.application_id || s.application_id || '';
        return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
               appId.toLowerCase().includes(searchQuery.toLowerCase());
      })
    }

    setFilteredSubmissions(filtered)
  }

  const handleResetAttempt = async (id, studentName, examTitle) => {
    if (!window.confirm(`Are you sure you want to RESET the attempt for ${studentName} on "${examTitle}"?\n\nThis will delete their exam submission permanently and let them take the test again.`)) {
      return
    }
    try {
      const { error } = await supabase
        .from('exam_results')
        .delete()
        .eq('id', id)
      if (error) throw error
      toast.success("Attempt reset successfully. Candidate can now retake this exam.")
      loadSubmissions()
    } catch (err) {
      console.error(err)
      toast.error("Failed to reset attempt.")
    }
  }

  const handleToggleAccess = async (id, currentStatus, studentName, examTitle) => {
    const isBlocking = currentStatus !== 'blocked'
    const confirmMessage = isBlocking
      ? `Are you sure you want to REVOKE access for ${studentName} on "${examTitle}"?\n\nThey will not be able to view their scorecard or attempt it again.`
      : `Are you sure you want to RESTORE access for ${studentName} on "${examTitle}"?`

    if (!window.confirm(confirmMessage)) {
      return
    }

    try {
      const newStatus = isBlocking ? 'blocked' : 'submitted'
      const { error } = await supabase
        .from('exam_results')
        .update({ status: newStatus })
        .eq('id', id)

      if (error) throw error
      toast.success(isBlocking ? "Access revoked successfully." : "Access restored successfully.")
      loadSubmissions()
    } catch (err) {
      console.error(err)
      toast.error("Failed to update access status.")
    }
  }

  // --- Personal Assignments Actions ---
  const handleAssignPersonally = async (e) => {
    e.preventDefault()
    if (!selectedStudent || !selectedExam) {
      toast.error("Please select both a student and an exam.")
      return
    }

    setAssigning(true)
    try {
      // Upsert / Insert assignment (forcing status to active if exists)
      const { error } = await supabase
        .from('personal_assignments')
        .upsert([{
          student_id: selectedStudent,
          exam_id: selectedExam,
          status: 'active',
          assigned_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }], { onConflict: 'student_id,exam_id' })

      if (error) throw error
      toast.success("Exam assigned personally to candidate!")
      setSelectedStudent('')
      setSelectedExam('')
      loadPersonalAssignments()
    } catch (err) {
      console.error(err)
      toast.error("Failed to assign exam: " + err.message)
    } finally {
      setAssigning(false)
    }
  }

  const handleRevokePersonalAccess = async (id) => {
    try {
      const { error } = await supabase
        .from('personal_assignments')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success("Personal access revoked.")
      loadPersonalAssignments()
    } catch (err) {
      console.error(err)
      toast.error("Failed to revoke access.")
    }
  }

  const handleRestorePersonalAccess = async (id) => {
    try {
      const { error } = await supabase
        .from('personal_assignments')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success("Personal access restored (active).")
      loadPersonalAssignments()
    } catch (err) {
      console.error(err)
      toast.error("Failed to restore access.")
    }
  }

  const handleDeleteAssignment = async (id) => {
    if (!window.confirm("Are you sure you want to delete this assignment record permanently?")) return
    try {
      const { error } = await supabase
        .from('personal_assignments')
        .delete()
        .eq('id', id)
      if (error) throw error
      toast.success("Assignment deleted.")
      loadPersonalAssignments()
    } catch (err) {
      console.error(err)
      toast.error("Failed to delete assignment.")
    }
  }

  const getStatusBadge = (status) => {
    const config = {
      submitted: { color: 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400', icon: Clock },
      reviewed: { color: 'bg-blue-500/10 border border-blue-500/20 text-blue-400', icon: CheckCircle },
      published: { color: 'bg-green-500/10 border border-green-500/20 text-green-400', icon: CheckCircle },
      blocked: { color: 'bg-red-500/10 border border-red-500/20 text-red-400', icon: ShieldAlert },
    }
    const StatusIcon = config[status]?.icon || Clock
    return (
      <span className={`px-2.5 py-0.5 rounded border text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 w-fit ${config[status]?.color || 'bg-gray-500/10 border-white/5 text-gray-400'}`}>
        <StatusIcon className="w-3 h-3" /> {status === 'blocked' ? 'Revoked' : status}
      </span>
    )
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto text-slate-100 font-sans pb-12">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-cyan-400 tracking-tight uppercase">Results & Attempt Management</h1>
        <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wide">Review exam submissions, control candidate access, and manage personalized attempt permissions.</p>
      </div>

      {/* Grid Layout: Main Table on Left, Search/Filters & Quick Controls on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        
        {/* Results List (3 Cols) */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-transparent border-b border-white/5 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="font-bold uppercase tracking-wider text-xs text-white">All Exam Submissions</h2>
              
              {/* Filters */}
              <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                <div className="relative flex-grow sm:flex-grow-0">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search candidate..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full sm:w-60 pl-9 pr-4 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs focus:border-cyan-500/50 focus:outline-none placeholder-slate-500 font-semibold"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs focus:border-cyan-500/50 focus:outline-none font-semibold text-slate-300"
                >
                  <option value="all" className="bg-[#020205]">All Statuses</option>
                  <option value="submitted" className="bg-[#020205]">Pending Review</option>
                  <option value="reviewed" className="bg-[#020205]">Reviewed</option>
                  <option value="published" className="bg-[#020205]">Published</option>
                  <option value="blocked" className="bg-[#020205]">Access Revoked</option>
                </select>
              </div>
            </div>

            <div className="p-0 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="border-b border-white/5">
                  <tr className="text-slate-400 uppercase tracking-wider font-bold">
                    <th className="px-6 py-4">Student</th>
                    <th className="px-6 py-4">Exam Details</th>
                    <th className="px-6 py-4">Score / Performance</th>
                    <th className="px-6 py-4">Submitted At</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-semibold text-slate-300">
                  {loading ? (
                    <tr><td colSpan="6" className="text-center py-12 text-slate-500 font-bold">Loading submissions data...</td></tr>
                  ) : filteredSubmissions.length === 0 ? (
                    <tr><td colSpan="6" className="text-center py-12 text-slate-500 font-bold">No candidate submissions found.</td></tr>
                  ) : (
                    filteredSubmissions.map((sub) => {
                      const studentName = sub.students?.full_name || sub.student_name || 'Student';
                      const appId = sub.students?.application_id || sub.application_id || 'N/A';
                      const examTitle = sub.exams?.title || 'Exam';

                      return (
                        <tr key={sub.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-cyan-400">{studentName}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{appId}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-white">{examTitle}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-slate-500 uppercase tracking-wide">{sub.exams?.subject}</span>
                              <span className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[9px] px-1.5 py-0.2 rounded font-black uppercase tracking-wider">
                                Attempt #{sub.attempt_number || 1}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {sub.total_score !== null ? (
                              <div>
                                <p className="text-sm font-black text-white">{sub.total_score} <span className="text-slate-500 text-xs font-normal">/ {sub.total_marks}</span></p>
                                <div className="w-20 bg-white/5 rounded-full h-1 mt-1.5"><div className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-1 rounded-full" style={{ width: `${Math.min(100, Math.max(0, sub.percentage))}%` }}></div></div>
                                <p className="text-[10px] text-cyan-400 mt-1 font-bold">{sub.percentage}% Score</p>
                              </div>
                            ) : (
                              <p className="text-slate-500">Not evaluated</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-xs text-slate-300">{sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : '-'}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{sub.submitted_at ? new Date(sub.submitted_at).toLocaleTimeString() : ''}</p>
                          </td>
                          <td className="px-6 py-4">
                            {getStatusBadge(sub.status)}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <Link to={`/admin/results/${sub.id}`}>
                                <button className="bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/25 text-slate-300 hover:text-cyan-300 p-1.5 rounded-xl transition-all shadow-md" title="Review Submission">
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              </Link>
                              
                              {sub.status === 'published' && (
                                <Link to={`/admin/results/${sub.id}/scorecard`}>
                                  <button className="bg-emerald-500/5 hover:bg-emerald-500/20 border border-emerald-500/10 hover:border-emerald-500/30 text-emerald-400 p-1.5 rounded-xl transition-all shadow-md" title="View Scorecard & Response Sheet">
                                    <Award className="w-3.5 h-3.5" />
                                  </button>
                                </Link>
                              )}
                              
                              <button 
                                onClick={() => handleResetAttempt(sub.id, studentName, examTitle)}
                                className="bg-red-500/5 hover:bg-red-500/20 border border-red-500/10 hover:border-red-500/30 text-red-400 p-1.5 rounded-xl transition-all shadow-md cursor-pointer" 
                                title="Reset Attempt (Permanently Delete)"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                              
                              {sub.status === 'blocked' ? (
                                <button 
                                  onClick={() => handleToggleAccess(sub.id, sub.status, studentName, examTitle)}
                                  className="bg-green-500/10 border border-green-500/25 text-green-400 p-1.5 rounded-xl hover:bg-green-500/20 transition-all cursor-pointer shadow-md" 
                                  title="Restore Access"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleToggleAccess(sub.id, sub.status, studentName, examTitle)}
                                  className="bg-amber-500/5 border border-amber-500/15 text-amber-400 p-1.5 rounded-xl hover:bg-amber-500/20 transition-all cursor-pointer shadow-md" 
                                  title="Revoke Access (Block)"
                                >
                                  <ShieldAlert className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Quick Assign Widget (1 Col) */}
        <div className="space-y-6">
          <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl p-6 space-y-5">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-cyan-400" />
                Assign Exam Personally
              </h3>
              <p className="text-[10px] text-slate-500 mt-1">Assign an exam directly to an individual candidate. This bypasses global date restrictions and allows retakes.</p>
            </div>

            <form onSubmit={handleAssignPersonally} className="space-y-4 text-xs font-semibold">
              <div className="space-y-1.5">
                <label className="text-slate-400">Select Candidate</label>
                <select
                  required
                  value={selectedStudent}
                  onChange={(e) => setSelectedStudent(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-500/50 focus:outline-none text-slate-200"
                >
                  <option value="" className="bg-[#020205] text-slate-450">-- Choose Candidate --</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id} className="bg-[#020205] text-slate-200">
                      {s.full_name} ({s.application_id})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-400">Select Exam</label>
                <select
                  required
                  value={selectedExam}
                  onChange={(e) => setSelectedExam(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 focus:border-cyan-500/50 focus:outline-none text-slate-200"
                >
                  <option value="" className="bg-[#020205] text-slate-450">-- Choose Exam --</option>
                  {exams.map(e => (
                    <option key={e.id} value={e.id} className="bg-[#020205] text-slate-200">
                      {e.title} ({e.subject})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={assigning}
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 py-2.5 rounded-xl font-black uppercase transition-all shadow-lg active:scale-[0.98] disabled:opacity-50 text-[10px] tracking-wider cursor-pointer"
              >
                {assigning ? 'Assigning...' : 'Assign Live Access'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Personal Assignments Log (Full Width) */}
      <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden mt-8">
        <div className="bg-transparent border-b border-white/5 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="font-bold uppercase tracking-wider text-xs text-white flex items-center gap-2">
              <Play className="w-4 h-4 text-cyan-400" />
              Personalized Attempts & Early Access assignments
            </h2>
            <p className="text-[10px] text-slate-500 mt-1">Review active, revoked, or completed personalized student assignments. Revoking access blocks them instantly.</p>
          </div>
          <span className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">
            {personalAssignments.length} Assignments
          </span>
        </div>

        <div className="p-0 overflow-x-auto">
          {assignmentsError ? (
            <div className="p-12 text-center text-xs font-semibold text-amber-300">
              <p className="font-bold text-amber-400 text-sm mb-1 uppercase tracking-wider">Assignments Database Table Required</p>
              <p className="text-slate-400 mb-4">Please execute the SQL command provided in the implementation plan to create the <code>personal_assignments</code> table.</p>
            </div>
          ) : personalAssignments.length === 0 ? (
            <div className="p-12 text-center text-slate-500 font-bold">
              No personalized early access or retake attempts assigned yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="border-b border-white/5">
                <tr className="text-slate-400 uppercase tracking-wider font-bold">
                  <th className="px-6 py-4">Candidate</th>
                  <th className="px-6 py-4">Exam Assigned</th>
                  <th className="px-6 py-4">Assigned At</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-semibold text-slate-300">
                {personalAssignments.map((assignment) => {
                  const studentName = assignment.students?.full_name || 'Candidate';
                  const appId = assignment.students?.application_id || 'N/A';
                  const examTitle = assignment.exams?.title || 'Exam';

                  return (
                    <tr key={assignment.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold text-cyan-400">{studentName}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{appId}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold text-white">{examTitle}</p>
                        <p className="text-[10px] text-slate-550 mt-0.5">{assignment.exams?.subject}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs text-slate-300">{new Date(assignment.assigned_at).toLocaleDateString()}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{new Date(assignment.assigned_at).toLocaleTimeString()}</p>
                      </td>
                      <td className="px-6 py-4">
                        {assignment.status === 'active' ? (
                          <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
                            Active (Live)
                          </span>
                        ) : assignment.status === 'revoked' ? (
                          <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
                            Revoked
                          </span>
                        ) : (
                          <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
                            Completed
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex gap-2 justify-center">
                          {assignment.status === 'active' ? (
                            <button 
                              onClick={() => handleRevokePersonalAccess(assignment.id)}
                              className="bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 px-3 py-1 rounded-xl font-bold uppercase transition-all shadow-md text-[10px] tracking-wider cursor-pointer"
                            >
                              Revoke Access
                            </button>
                          ) : (
                            <button 
                              onClick={() => handleRestorePersonalAccess(assignment.id)}
                              className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1 rounded-xl font-bold uppercase transition-all shadow-md text-[10px] tracking-wider cursor-pointer"
                            >
                              Restore Access
                            </button>
                          )}
                          <button 
                            onClick={() => handleDeleteAssignment(assignment.id)}
                            className="bg-red-550/10 border border-red-500/20 text-red-400 hover:bg-red-600/25 p-1 rounded-xl transition-all shadow-md cursor-pointer"
                            title="Delete Assignment"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
