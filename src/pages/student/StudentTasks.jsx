import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import { Plus, Trash2, Clock, Flame, Timer, Share2, Send, CheckCircle2, ChevronRight } from 'lucide-react'

// --- Animated Cosmic Particle Wave Background Component ---
const CosmicBackground = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resizeCanvas = () => {
      if (canvas.parentElement) {
        canvas.width = canvas.parentElement.offsetWidth;
        canvas.height = canvas.parentElement.offsetHeight;
      }
    };
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let time = 0;

    const animate = () => {
      if (!canvas) return;
      
      // Dynamic height adjustment to handle layout expansions/collapses
      if (canvas.parentElement && (canvas.width !== canvas.parentElement.offsetWidth || canvas.height !== canvas.parentElement.offsetHeight)) {
        resizeCanvas();
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const numRings = 5;
      time += 0.012; // Controls speed of orbit rotation and breathe rate
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const minSize = Math.min(canvas.width, canvas.height);

      for (let r = 0; r < numRings; r++) {
        // Base horizontal and vertical radii for squashed 3D perspective ellipses
        const rx_base = (r + 1) * (minSize / (numRings + 1.2)) * 0.72;
        const ry_base = rx_base * 0.38;
        
        // Pulsing scale factor to make orbits expand/contract sequentially
        // "every second coming closer then reattain elliptical then comes near..."
        const pulse = 1.0 + Math.sin(time * 2.2 - r * 0.95) * 0.38;
        const rx = rx_base * pulse;
        const ry = ry_base * pulse;
        
        // Tilt the ellipses relative to one another to create a beautiful orbital look
        const tilt = -0.28 + r * 0.12 + Math.sin(time * 0.1) * 0.06;

        // 1. Draw faint, elegant orbital path outline
        ctx.beginPath();
        ctx.lineWidth = 0.85;
        const ringHue = (time * 16 + r * 55) % 360;
        ctx.strokeStyle = `hsla(${ringHue}, 75%, 60%, 0.055)`;
        
        for (let angle = 0; angle <= Math.PI * 2 + 0.1; angle += 0.08) {
          const x_local = rx * Math.cos(angle);
          const y_local = ry * Math.sin(angle);
          // Apply 2D rotation matrix for the ellipse tilt
          const x = cx + x_local * Math.cos(tilt) - y_local * Math.sin(tilt);
          const y = cy + x_local * Math.sin(tilt) + y_local * Math.cos(tilt);
          
          if (angle === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 2. Draw color-shifting particles orbiting along the ellipse path
        const numParticles = 12 + r * 5;
        for (let p = 0; p < numParticles; p++) {
          // Inner particles revolve faster (Keplerian orbits)
          const speedFactor = 0.32 + (numRings - r) * 0.09;
          const angle = (p / numParticles) * Math.PI * 2 + time * speedFactor;
          
          const x_local = rx * Math.cos(angle);
          const y_local = ry * Math.sin(angle);
          const x = cx + x_local * Math.cos(tilt) - y_local * Math.sin(tilt);
          const y = cy + x_local * Math.sin(tilt) + y_local * Math.cos(tilt);

          // Clip drawing outside visible canvas dimensions
          if (x < -10 || x > canvas.width + 10 || y < -10 || y > canvas.height + 10) {
            continue;
          }

          // Generate hue shifts sequentially wrapping around the ellipse ring
          const hue = (time * 18 + (p / numParticles) * 360 + r * 60) % 360;
          const size = 1.1 + r * 0.38; // Outer ring particles are larger for camera depth
          const opacity = 0.45 + r * 0.12;

          // Outer atmospheric glow
          ctx.beginPath();
          ctx.arc(x, y, size * 2.8, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, 85%, 60%, ${opacity * 0.22})`;
          ctx.fill();

          // Inner bright nucleus core
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = `hsla(${hue}, 95%, 75%, ${opacity})`;
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="absolute inset-0 w-full h-full pointer-events-none z-0 rounded-lg opacity-90"
    />
  );
};

export default function StudentTasks() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [studentInfo, setStudentInfo] = useState(null)
  
  // Pomodoro & Streak States
  const [pomodoroTime, setPomodoroTime] = useState(25 * 60)
  const [pomodoroRunning, setPomodoroRunning] = useState(false)
  const [studyStreak, setStudyStreak] = useState(0)
  
  // New Task Form
  const [newTask, setNewTask] = useState({
    title: '',
    subject: 'Physics',
    completion_percentage: 0,
    estimated_minutes: 30
  })

  // Sharing Form
  const [isShared, setIsShared] = useState(false)
  const [shareType, setShareType] = useState('all') 
  const [receiverAppId, setReceiverAppId] = useState('')
  const [shareId, setShareId] = useState(null)

  const studentId = sessionStorage.getItem('userId')

  useEffect(() => {
    if (studentId) {
      loadStudentInfo()
      loadStudyStreak()
    }
  }, [studentId])

  useEffect(() => {
    if (studentId && selectedDate) {
      loadTasks()
      loadShareStatus()
    }
  }, [selectedDate, studentId])

  useEffect(() => {
    let interval
    if (pomodoroRunning && pomodoroTime > 0) {
      interval = setInterval(() => {
        setPomodoroTime(prev => prev - 1)
      }, 1000)
    } else if (pomodoroTime === 0) {
      setPomodoroRunning(false)
      toast.success("Time's up! Take a break.")
    }
    return () => clearInterval(interval)
  }, [pomodoroRunning, pomodoroTime])

  const loadStudentInfo = async () => {
    const { data } = await supabase
      .from('students')
      .select('full_name, application_id')
      .eq('id', studentId)
      .single()
    if (data) setStudentInfo(data)
  }

  const loadStudyStreak = async () => {
    const { data: student } = await supabase
      .from('students')
      .select('study_streak')
      .eq('id', studentId)
      .single()
    setStudyStreak(student?.study_streak || 0)
  }

  const loadTasks = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('student_id', studentId)
      .eq('status', 'daily_task')
      .eq('due_date', selectedDate)
      .order('created_at', { ascending: true })
    
    setTasks(data || [])
    setLoading(false)
  }

  const loadShareStatus = async () => {
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('student_id', studentId)
      .eq('status', 'task_share')
      .eq('due_date', selectedDate)
      .maybeSingle()

    if (data) {
      setIsShared(true)
      const parsed = JSON.parse(data.title)
      setShareType(parsed.share_type || 'all')
      setReceiverAppId(parsed.receiver_app_id || '')
      setShareId(data.id)
    } else {
      setIsShared(false)
      setShareId(null)
      setReceiverAppId('')
    }
  }

  const autoUpdateShare = async (currentTasks) => {
    if (!isShared && !shareId) return

    const { data: existingShare } = await supabase
      .from('tasks')
      .select('*')
      .eq('student_id', studentId)
      .eq('status', 'task_share')
      .eq('due_date', selectedDate)
      .maybeSingle()

    if (existingShare) {
      const parsed = JSON.parse(existingShare.title)
      parsed.tasks = currentTasks.map(t => {
        const payload = JSON.parse(t.title)
        return {
          title: payload.title,
          subject: payload.subject,
          pct: payload.completion_percentage
        }
      })

      await supabase
        .from('tasks')
        .update({ title: JSON.stringify(parsed) })
        .eq('id', existingShare.id)
    }
  }

  const addTask = async () => {
    if (!newTask.title.trim()) {
      toast.error('Please enter task title')
      return
    }

    const payload = {
      title: newTask.title.trim(),
      subject: newTask.subject,
      completion_percentage: newTask.completion_percentage
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert([{
        student_id: studentId,
        title: JSON.stringify(payload),
        status: 'daily_task',
        priority: 'medium',
        due_date: selectedDate,
        estimated_minutes: newTask.estimated_minutes
      }])
      .select()

    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Task added successfully')
      setShowAddModal(false)
      setNewTask({ title: '', subject: 'Physics', completion_percentage: 0, estimated_minutes: 30 })
      
      const updatedTasks = [...tasks, data[0]]
      setTasks(updatedTasks)
      autoUpdateShare(updatedTasks)
    }
  }

  const handleUpdatePercentage = async (taskId, newPercentage) => {
    const updated = tasks.map(t => {
      if (t.id === taskId) {
        const payload = JSON.parse(t.title)
        payload.completion_percentage = newPercentage
        return { ...t, title: JSON.stringify(payload) }
      }
      return t
    })

    const targetTask = updated.find(t => t.id === taskId)
    const { error } = await supabase
      .from('tasks')
      .update({ title: targetTask.title })
      .eq('id', taskId)

    if (!error) {
      setTasks(updated)
      autoUpdateShare(updated)
    } else {
      toast.error("Failed to update progress")
    }
  }

  const deleteTask = async (taskId) => {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) {
      toast.error("Failed to delete task")
    } else {
      toast.success('Task deleted')
      const updated = tasks.filter(t => t.id !== taskId)
      setTasks(updated)
      autoUpdateShare(updated)
    }
  }

  const handleShareToggle = async () => {
    if (isShared && shareId) {
      const { error } = await supabase.from('tasks').delete().eq('id', shareId)
      if (!error) {
        setIsShared(false)
        setShareId(null)
        toast.success("Task sheet unshared successfully")
      }
    } else {
      if (shareType === 'specific' && !receiverAppId.trim()) {
        toast.error("Please enter a friend's Application ID")
        return
      }

      const parsedTasks = tasks.map(t => {
        const payload = JSON.parse(t.title)
        return {
          title: payload.title,
          subject: payload.subject,
          pct: payload.completion_percentage
        }
      })

      const sharePayload = {
        date: selectedDate,
        sender_id: studentId,
        sender_name: studentInfo?.full_name || 'Anonymous Student',
        sender_app_id: studentInfo?.application_id || 'HRTA000',
        share_type: shareType,
        receiver_app_id: shareType === 'specific' ? receiverAppId.toUpperCase().trim() : 'all',
        tasks: parsedTasks
      }

      const { data, error } = await supabase
        .from('tasks')
        .insert([{
          student_id: studentId,
          title: JSON.stringify(sharePayload),
          status: 'task_share',
          priority: 'low',
          due_date: selectedDate
        }])
        .select()

      if (error) {
        toast.error("Failed to publish share: " + error.message)
      } else {
        setIsShared(true)
        setShareId(data[0].id)
        toast.success(shareType === 'all' ? "Shared with all friends!" : `Shared with ${receiverAppId.toUpperCase()}`)
      }
    }
  }

  const calculateOverallCompletion = () => {
    if (tasks.length === 0) return 0
    const total = tasks.reduce((sum, t) => {
      try {
        const payload = JSON.parse(t.title)
        return sum + (payload.completion_percentage || 0)
      } catch (e) {
        return sum
      }
    }, 0)
    return Math.round(total / tasks.length)
  }

  const overallCompletion = calculateOverallCompletion()

  const subjectColors = {
    Physics: 'border-blue-500/20 bg-blue-500/5 text-blue-400',
    Chemistry: 'border-orange-500/20 bg-orange-500/5 text-orange-400',
    Maths: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400',
    Other: 'border-purple-500/20 bg-purple-500/5 text-purple-400'
  }

  const overallColor = (pct) => {
    if (pct >= 80) return 'text-emerald-400'
    if (pct >= 50) return 'text-yellow-400'
    return 'text-red-400'
  }



  return (
    <div className="max-w-6xl mx-auto space-y-6">
      
      {/* Header controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Daily Tasks & Subject Progress</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Log, manage, and share your subject-wise tasks daily</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white border border-gray-250 focus:outline-none focus:border-primary text-sm font-semibold shadow-xs"
          />
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition-colors shadow"
          >
            <Plus className="w-4 h-4" /> Add Task
          </button>
        </div>
      </div>

      {/* Top dashboard section with Cosmic Background */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 rounded-xl border border-white/10 overflow-hidden shadow-lg p-6 bg-slate-950 relative">
        <CosmicBackground />
        
        {/* Streak details */}
        <div className="relative z-10 bg-black/10 border border-white/10 backdrop-blur-sm rounded-lg p-5 flex items-center justify-between text-white">
          <div>
            <p className="text-[10px] text-cyan-400 font-black uppercase tracking-widest">Your Streak</p>
            <p className="text-3xl font-black mt-1 text-white">{studyStreak} Days</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center border border-orange-500/35">
            <Flame className="w-6 h-6 text-orange-400" />
          </div>
        </div>

        {/* Pomodoro timer */}
        <div className="relative z-10 bg-black/10 border border-white/10 backdrop-blur-sm rounded-lg p-5 flex items-center justify-between text-white">
          <div>
            <p className="text-[10px] text-cyan-400 font-black uppercase tracking-widest">Pomodoro Timer</p>
            <p className="text-3xl font-black font-mono mt-1 text-cyan-300">{Math.floor(pomodoroTime / 60)}:{(pomodoroTime % 60).toString().padStart(2, '0')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPomodoroRunning(!pomodoroRunning)}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-black uppercase tracking-wider transition-colors shadow"
            >
              {pomodoroRunning ? 'Pause' : 'Start'}
            </button>
            <button
              onClick={() => { setPomodoroTime(25 * 60); setPomodoroRunning(false) }}
              className="p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-cyan-400 hover:text-white"
            >
              <Timer className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Day completion rate */}
        <div className="relative z-10 bg-black/10 border border-white/10 backdrop-blur-sm rounded-lg p-5 flex items-center justify-between text-white">
          <div>
            <p className="text-[10px] text-cyan-400 font-black uppercase tracking-widest">Daily Completion</p>
            <p className={`text-3xl font-black mt-1 ${overallColor(overallCompletion)}`}>{overallCompletion}%</p>
          </div>
          <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center border border-cyan-500/35">
            <CheckCircle2 className="w-6 h-6 text-cyan-400" />
          </div>
        </div>
      </div>

      {/* Task sharing controls with Cosmic Background */}
      <div className="rounded-xl border border-white/10 overflow-hidden shadow-lg p-5 bg-slate-950 relative">
        <CosmicBackground />
        <div className="relative z-10 bg-transparent backdrop-blur-sm p-4 rounded-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-white/5">
          <div className="flex items-center gap-3 text-white">
            <Share2 className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="font-extrabold text-sm text-white">Share today's task progress</h3>
              <p className="text-xs text-gray-400 mt-0.5 font-medium">Let your friends see how hard you are studying to keep each other motivated!</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {!isShared && (
              <>
                <select
                  value={shareType}
                  onChange={(e) => setShareType(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-black/40 text-gray-300 border border-white/15 text-xs focus:outline-none focus:border-cyan-500 font-bold"
                >
                  <option value="all">Share with Everyone</option>
                  <option value="specific">Share with Specific Friend</option>
                </select>

                {shareType === 'specific' && (
                  <input
                    type="text"
                    placeholder="Friend's App ID (e.g. HRTA002)"
                    value={receiverAppId}
                    onChange={(e) => setReceiverAppId(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-black/40 text-white placeholder-gray-500 border border-white/15 text-xs focus:outline-none focus:border-cyan-500 w-full md:w-48 font-bold"
                  />
                )}
              </>
            )}

            <button
              onClick={handleShareToggle}
              className={`flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all w-full md:w-auto cursor-pointer ${
                isShared 
                  ? 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20' 
                  : 'bg-cyan-600 text-white hover:bg-cyan-700 shadow-md shadow-cyan-500/10'
              }`}
            >
              {isShared ? (
                <>Stop Sharing</>
              ) : (
                <>
                  <Send className="w-3 h-3" /> Share Now
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Task lists grouped with Cosmic Background */}
      <div className="rounded-xl border border-white/10 overflow-hidden shadow-lg p-6 bg-slate-950 relative">
        <CosmicBackground />
        <div className="relative z-10 bg-transparent backdrop-blur-md p-5 rounded-lg border border-white/5 space-y-4 text-white">
          <h2 className="font-black text-lg text-white border-b border-white/10 pb-3 tracking-wide">
            Logged Tasks ({tasks.length})
          </h2>

          {loading ? (
            <div className="text-center py-12 text-gray-500 text-xs italic">Loading tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-white/10 rounded-xl bg-transparent">
              <Clock className="w-10 h-10 text-cyan-400/30 mx-auto mb-2" />
              <p className="text-sm text-gray-400 font-medium">No tasks logged for {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-3 text-xs text-cyan-400 font-black hover:underline tracking-wider uppercase"
              >
                + Create first task
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks.map(task => {
                const payload = JSON.parse(task.title)
                return (
                  <div 
                    key={task.id} 
                    className={`flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border bg-black/10 hover:bg-black/20 hover:border-cyan-500/25 transition-all ${subjectColors[payload.subject] || 'border-white/5'}`}
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border bg-black/30 tracking-wider uppercase ${
                          payload.subject === 'Physics' ? 'text-blue-400 border-blue-500/25' :
                          payload.subject === 'Chemistry' ? 'text-orange-400 border-orange-500/25' :
                          payload.subject === 'Maths' ? 'text-emerald-400 border-emerald-500/25' : 'text-purple-400 border-purple-500/25'
                        }`}>
                          {payload.subject}
                        </span>
                        <p className="text-sm font-bold text-white">{payload.title}</p>
                      </div>
                      {task.estimated_minutes && (
                        <p className="text-xs text-gray-400 flex items-center gap-1 font-semibold">
                          ⏱️ Est. Duration: {task.estimated_minutes} minutes
                        </p>
                      )}
                    </div>

                    {/* Percentage Progress slider */}
                    <div className="flex items-center gap-4 w-full md:w-auto">
                      <div className="flex-1 md:flex-initial flex items-center gap-3">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="10"
                          value={payload.completion_percentage || 0}
                          onChange={(e) => handleUpdatePercentage(task.id, parseInt(e.target.value))}
                          className="w-full md:w-32 h-1.5 rounded-lg appearance-none cursor-pointer accent-cyan-500 bg-slate-800 border border-white/5"
                        />
                        <span className="text-xs font-black font-mono w-10 text-right text-cyan-400">
                          {payload.completion_percentage || 0}%
                        </span>
                      </div>

                      <button 
                        onClick={() => deleteTask(task.id)}
                        className="p-2 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-colors ml-auto md:ml-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4" onClick={() => setShowAddModal(false)}>
          <div className="rounded-xl border border-white/15 overflow-hidden w-full max-w-md shadow-2xl bg-slate-950 relative" onClick={(e) => e.stopPropagation()}>
            <CosmicBackground />
            <div className="relative z-10 bg-black/20 backdrop-blur-md p-6 space-y-4 text-white">
              <h2 className="text-lg font-black border-b border-white/10 pb-3 tracking-wide flex items-center gap-2">
                <Plus className="w-5 h-5 text-cyan-400" /> Add New Task
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-1.5">Subject</label>
                  <select
                    value={newTask.subject}
                    onChange={(e) => setNewTask({...newTask, subject: e.target.value})}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm focus:outline-none focus:border-cyan-500 text-white font-bold"
                  >
                    <option value="Physics">Physics</option>
                    <option value="Chemistry">Chemistry</option>
                    <option value="Maths">Mathematics</option>
                    <option value="Other">Other Subjects</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-cyan-405 uppercase tracking-widest mb-1.5">Task Description / Title</label>
                  <input
                    type="text"
                    placeholder="e.g., Read electrostatics and solve 20 HC Verma questions"
                    value={newTask.title}
                    onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                    className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm focus:outline-none focus:border-cyan-500 text-white placeholder-gray-500 font-bold"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-cyan-405 uppercase tracking-widest mb-1.5">Initial Progress</label>
                    <select
                      value={newTask.completion_percentage}
                      onChange={(e) => setNewTask({...newTask, completion_percentage: parseInt(e.target.value)})}
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm focus:outline-none focus:border-cyan-500 text-white font-bold"
                    >
                      {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(val => (
                        <option key={val} value={val}>{val}%</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-cyan-405 uppercase tracking-widest mb-1.5">Est. Duration (mins)</label>
                    <input
                      type="number"
                      min="5"
                      max="480"
                      value={newTask.estimated_minutes}
                      onChange={(e) => setNewTask({...newTask, estimated_minutes: parseInt(e.target.value) || 30})}
                      className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm focus:outline-none focus:border-cyan-500 text-white font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button 
                  onClick={() => setShowAddModal(false)} 
                  className="flex-1 py-2 rounded-lg border border-white/10 hover:bg-white/10 text-sm font-bold uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={addTask} 
                  className="flex-1 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-750 text-white text-sm font-black uppercase tracking-wider transition-colors shadow-md shadow-cyan-500/10"
                >
                  Add Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
