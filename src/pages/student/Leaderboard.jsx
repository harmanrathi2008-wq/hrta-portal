import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Trophy, Medal, Award, Crown, TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState([])
  const [selectedExam, setSelectedExam] = useState(null)
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentStudentRank, setCurrentStudentRank] = useState(null)

  const studentId = sessionStorage.getItem('userId')

  useEffect(() => {
    loadExams()
  }, [])

  useEffect(() => {
    if (selectedExam) {
      loadLeaderboard()
    }
  }, [selectedExam])

  const loadExams = async () => {
    const { data } = await supabase
      .from('exams')
      .select('id, title, subject')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
    
    setExams(data || [])
    if (data && data.length > 0) {
      setSelectedExam(data[0].id)
    } else {
      setLoading(false)
    }
  }

  const loadLeaderboard = async () => {
    setLoading(true)
    
    // Get all published results for selected exam
    const { data: results } = await supabase
      .from('exam_results')
      .select(`
        id,
        student_id,
        total_score,
        percentage,
        rank,
        students!exam_results_student_id_fkey (
          full_name,
          application_id
        )
      `)
      .eq('exam_id', selectedExam)
      .eq('status', 'published')
      .order('percentage', { ascending: false })

    if (results) {
      const rankedResults = results.map((item, index) => ({
        ...item,
        rank: index + 1
      }))
      setLeaderboard(rankedResults)
      
      // Find current student's rank
      const currentStudent = rankedResults.find(r => r.student_id === studentId)
      setCurrentStudentRank(currentStudent?.rank || null)
    }
    
    setLoading(false)
  }

  const getRankIcon = (rank) => {
    switch(rank) {
      case 1: return <Crown className="w-6 h-6 text-yellow-400" />
      case 2: return <Medal className="w-6 h-6 text-gray-400" />
      case 3: return <Medal className="w-6 h-6 text-orange-400" />
      default: return <span className="text-sm font-bold w-6 text-center">{rank}</span>
    }
  }

  const getRankBg = (rank) => {
    switch(rank) {
      case 1: return 'bg-yellow-500/20 border-yellow-500/30'
      case 2: return 'bg-gray-500/20 border-gray-500/30'
      case 3: return 'bg-orange-500/20 border-orange-500/30'
      default: return ''
    }
  }

  const top3 = leaderboard.slice(0, 3)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary">Leaderboard</h1>
        <p className="text-sm text-muted-foreground">Top performers across exams</p>
      </div>

      {/* Exam Selector */}
      <div className="flex justify-center">
        <select
          value={selectedExam || ''}
          onChange={(e) => setSelectedExam(e.target.value)}
          className="px-4 py-2 rounded-lg bg-secondary/30 border border-border/50 focus:border-primary focus:outline-none"
        >
          <option value="">Select an exam</option>
          {exams.map(exam => (
            <option key={exam.id} value={exam.id}>{exam.title} ({exam.subject})</option>
          ))}
        </select>
      </div>

      {selectedExam && (
        <>
          {/* Current Student Rank Card */}
          {currentStudentRank && (
            <div className="glass-card rounded-xl p-4 text-center border border-primary/30">
              <p className="text-xs text-muted-foreground mb-1">Your Rank in this Exam</p>
              <p className="text-3xl font-bold text-primary">#{currentStudentRank}</p>
              <p className="text-xs text-muted-foreground mt-1">Out of {leaderboard.length} students</p>
            </div>
          )}

          {/* Podium (Top 3) */}
          {top3.length >= 3 && (
            <div className="flex items-end justify-center gap-4 mb-8">
              {/* 2nd Place */}
              <div className="text-center">
                <div className="mb-2">
                  <Medal className="w-8 h-8 mx-auto text-gray-400" />
                  <p className="text-sm font-bold mt-1">{top3[1]?.students?.full_name?.split(' ')[0]}</p>
                  <p className="text-xs text-muted-foreground">{top3[1]?.percentage}%</p>
                </div>
                <div className="w-20 h-24 rounded-t-lg bg-gray-500/20 border border-gray-500/30 flex items-center justify-center">
                  <span className="text-2xl font-bold text-gray-400">2</span>
                </div>
              </div>

              {/* 1st Place */}
              <div className="text-center">
                <div className="mb-2">
                  <Crown className="w-10 h-10 mx-auto text-yellow-400" />
                  <p className="text-sm font-bold mt-1">{top3[0]?.students?.full_name?.split(' ')[0]}</p>
                  <p className="text-xs text-muted-foreground">{top3[0]?.percentage}%</p>
                </div>
                <div className="w-24 h-32 rounded-t-lg bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center">
                  <span className="text-3xl font-bold text-yellow-400">1</span>
                </div>
              </div>

              {/* 3rd Place */}
              <div className="text-center">
                <div className="mb-2">
                  <Medal className="w-8 h-8 mx-auto text-orange-400" />
                  <p className="text-sm font-bold mt-1">{top3[2]?.students?.full_name?.split(' ')[0]}</p>
                  <p className="text-xs text-muted-foreground">{top3[2]?.percentage}%</p>
                </div>
                <div className="w-20 h-20 rounded-t-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
                  <span className="text-2xl font-bold text-orange-400">3</span>
                </div>
              </div>
            </div>
          )}

          {/* Full Leaderboard Table */}
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border/50">
                  <tr>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground">Rank</th>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground">Student</th>
                    <th className="text-left p-4 text-xs font-medium text-muted-foreground">App ID</th>
                    <th className="text-right p-4 text-xs font-medium text-muted-foreground">Score</th>
                    <th className="text-right p-4 text-xs font-medium text-muted-foreground">Percentage</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="5" className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                  ) : leaderboard.length === 0 ? (
                    <tr><td colSpan="5" className="text-center py-8 text-muted-foreground">No results yet for this exam</td></tr>
                  ) : (
                    leaderboard.map((item) => (
                      <tr
                        key={item.id}
                        className={cn(
                          "border-b border-border/30 hover:bg-secondary/20 transition-colors",
                          item.student_id === studentId && "bg-primary/5 border-l-2 border-l-primary"
                        )}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            {getRankIcon(item.rank)}
                          </div>
                        </td>
                        <td className="p-4">
                          <p className="text-sm font-medium">{item.students?.full_name}</p>
                        </td>
                        <td className="p-4">
                          <p className="text-xs font-mono text-primary">{item.students?.application_id}</p>
                        </td>
                        <td className="p-4 text-right">
                          <p className="text-sm">{item.total_score}</p>
                        </td>
                        <td className="p-4 text-right">
                          <p className="text-sm font-bold text-green-400">{item.percentage}%</p>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Note */}
          <p className="text-center text-xs text-muted-foreground">
            Rankings are updated in real-time based on exam performance
          </p>
        </>
      )}
    </div>
  )
}
