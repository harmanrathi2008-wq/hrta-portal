import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { 
  FileText, Award, Target, Flame, Clock, Trash2, PlusCircle, BarChart3, 
  LineChart as ChartIcon, Users, RefreshCw, Calendar, BarChart as BarChartIcon 
} from 'lucide-react';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer, ReferenceLine 
} from 'recharts';

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

const ExamCountdown = ({ startDatetime, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const target = new Date(startDatetime).getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = target - now;

      if (diff <= 0) {
        setTimeLeft('Active');
        if (onComplete) onComplete();
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(`${days}d ${hours}h ${mins}m ${secs}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startDatetime, onComplete]);

  return <span className="font-mono text-amber-600 font-bold">{timeLeft}</span>;
};

export default function StudentDashboard() {
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [stats, setStats] = useState({
    totalExams: 0,
    averageScore: 0,
    bestScore: 0,
    rank: 0,
  });
  const [activeExams, setActiveExams] = useState([]);
  
  // Graph States (Exams & Mocks)
  const [customTests, setCustomTests] = useState([]); 
  const [officialTests, setOfficialTests] = useState([]); 
  const [chartMode, setChartMode] = useState('official'); 
  const [targetMargin, setTargetMargin] = useState(150);
  const [addingTest, setAddingTest] = useState(false);
  const [newTest, setNewTest] = useState({
    date: '',
    testName: '',
    physics: '',
    chemistry: '',
    maths: ''
  });

  // Journey Tracker States
  const [journeyLogs, setJourneyLogs] = useState([]);
  const [journeyDate, setJourneyDate] = useState(new Date().toISOString().split('T')[0]);
  const [journeyDesc, setJourneyDesc] = useState('');
  const [journeyProd, setJourneyProd] = useState('green');
  const [isEditingJourney, setIsEditingJourney] = useState(false);
  const [journeyStats, setJourneyStats] = useState({ total: 0, green: 0, yellow: 0, red: 0 });
  const [journeyChartData, setJourneyChartData] = useState([]);

  // Daily Tasks Chart State
  const [dailyTasksData, setDailyTasksData] = useState([]);

  // Friends Feed State
  const [friendsFeed, setFriendsFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(false);

  const studentId = sessionStorage.getItem('userId');

  useEffect(() => {
    const checkAuth = () => {
      const role = sessionStorage.getItem('role');
      if (!studentId || role !== 'student') {
        navigate('/');
      }
    };
    checkAuth();
  }, [studentId, navigate]);

  useEffect(() => {
    if (studentId) {
      loadStudentData();
      loadDashboardData();
      loadMockTestData();
      loadJourneyData();
      loadDailyTasksChartData();
      loadFriendsFeed();
    }
  }, [studentId]);

  useEffect(() => {
    if (studentId && journeyDate) {
      loadJourneyLogForDate(journeyDate);
    }
  }, [journeyDate, studentId]);

  const loadStudentData = async () => {
    const { data } = await supabase.from('students').select('*').eq('id', studentId).single();
    setStudent(data);
  };

  const loadDashboardData = async () => {
    try {
      const [examsRes, resultsRes] = await Promise.all([
        supabase.from('exams').select('*').eq('status', 'published').order('created_at', { ascending: false }),
        supabase.from('exam_results').select('*, exams(title, subject)').eq('student_id', studentId)
      ]);

      const allExams = examsRes.data || [];
      const allResults = resultsRes.data || [];
      const completed = allResults.filter(r => r.status === 'published');

      // Calculate stats
      const avgScore = completed.length > 0 ? Math.round(completed.reduce((sum, r) => sum + (r.percentage || 0), 0) / completed.length) : 0;
      const bestScore = completed.length > 0 ? Math.max(...completed.map(r => r.percentage || 0)) : 0;
      setStats({ totalExams: completed.length, averageScore: avgScore, bestScore: bestScore, rank: 0 });

      // Fetch personal assignments
      let personalMap = new Map();
      try {
        const { data: pData } = await supabase
          .from('personal_assignments')
          .select('*')
          .eq('student_id', studentId)
          .eq('status', 'active');
        if (pData) {
          personalMap = new Map(pData.map(a => [a.exam_id, a]));
        }
      } catch (err) {
        console.warn("personal_assignments table not ready:", err.message);
      }

      // Fetch late attempt requests
      let requestsMap = new Map();
      try {
        const { data: requestsData, error: requestsError } = await supabase
          .from('exam_late_requests')
          .select('*')
          .eq('student_id', studentId);
        
        if (!requestsError && requestsData) {
          requestsMap = new Map(requestsData.map(r => [r.exam_id, r]));
        }
      } catch (err) {
        console.warn("exam_late_requests table might not exist yet:", err.message);
      }

      // Group results by exam_id to count previous attempts
      const attemptsCountMap = new Map();
      allResults.forEach(r => {
        attemptsCountMap.set(r.exam_id, (attemptsCountMap.get(r.exam_id) || 0) + 1);
      });

      // Active & Scheduled Exams
      const active = allExams
        .filter(exam => {
          const attemptedCount = attemptsCountMap.get(exam.id) || 0;
          const hasPersonal = personalMap.has(exam.id);
          return attemptedCount === 0 || hasPersonal;
        })
        .map(exam => {
          const req = requestsMap.get(exam.id);
          const hasPersonal = personalMap.has(exam.id);
          const prevAttempts = attemptsCountMap.get(exam.id) || 0;
          return {
            ...exam,
            lateRequest: req ? req.status : null,
            personalAssignment: hasPersonal ? 'active' : null,
            nextAttemptNumber: prevAttempts + 1
          };
        });
      setActiveExams(active);

      // Map official exam results for chart plotting
      const mappedOfficial = completed
        .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))
        .map(r => ({
          id: r.id,
          date: new Date(r.submitted_at).toLocaleDateString(),
          testName: r.exams?.title || 'Exam',
          percentage: r.percentage || 0,
          totalScore: r.total_score || 0,
          totalMarks: r.total_marks || 0,
          subject: r.exams?.subject || 'PCM'
        }));
      setOfficialTests(mappedOfficial);

    } catch (err) {
      console.error("Error loading stats:", err);
    }
  };

  const handleRequestLateAttempt = async (examId) => {
    try {
      const { error } = await supabase
        .from('exam_late_requests')
        .insert({
          student_id: studentId,
          exam_id: examId,
          status: 'pending'
        });

      if (error) throw error;
      alert("Late attempt request submitted successfully to administrator.");
      loadDashboardData();
    } catch (err) {
      alert("Failed to submit request: " + err.message);
    }
  };

  const loadMockTestData = async () => {
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'mock_test')
        .order('created_at', { ascending: true });

      if (error) throw error;

      let mocksList = [];
      if (data) {
        mocksList = data.map(item => {
          try {
            const parsed = JSON.parse(item.title);
            return {
              id: item.id,
              date: parsed.date,
              testName: parsed.testName,
              physics: parsed.physics,
              chemistry: parsed.chemistry,
              maths: parsed.maths,
              total: parsed.total
            };
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      setCustomTests(mocksList);
    } catch (e) {
      console.error("Error loading mock tests:", e);
    }
  };

  const handleAddCustomTest = async (e) => {
    e.preventDefault();
    setAddingTest(true);
    
    const p = parseInt(newTest.physics) || 0;
    const c = parseInt(newTest.chemistry) || 0;
    const m = parseInt(newTest.maths) || 0;
    const total = p + c + m;

    const mockPayload = {
      testName: newTest.testName,
      date: newTest.date,
      physics: p,
      chemistry: c,
      maths: m,
      total: total
    };

    try {
      const { error } = await supabase.from('tasks').insert([{
        student_id: studentId,
        title: JSON.stringify(mockPayload),
        status: 'mock_test',
        priority: 'low'
      }]);

      if (error) throw error;
      loadMockTestData();
      setNewTest({ date: '', testName: '', physics: '', chemistry: '', maths: '' });
    } catch (err) {
      alert("Failed to save mock test scores: " + err.message);
    } finally {
      setAddingTest(false);
    }
  };

  const handleDeleteCustomTest = async (id) => {
    if (!window.confirm("Delete this mock test record permanently?")) return;
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
      setCustomTests(customTests.filter(t => t.id !== id));
    } catch (err) {
      alert("Failed to delete record: " + err.message);
    }
  };

  // --- Journey Tracker & Productivity Logic ---
  const loadJourneyLogForDate = async (date) => {
    try {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'journey_log')
        .eq('due_date', date)
        .maybeSingle();

      if (data) {
        const parsed = JSON.parse(data.title);
        setJourneyDesc(parsed.description || '');
        setJourneyProd(parsed.productivity || 'green');
        setIsEditingJourney(true);
      } else {
        setJourneyDesc('');
        setJourneyProd('green');
        setIsEditingJourney(false);
      }
    } catch (e) {
      console.error("Error loading journey log:", e);
    }
  };

  const loadJourneyData = async () => {
    try {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'journey_log')
        .order('due_date', { ascending: true });

      if (data) {
        setJourneyLogs(data);

        let green = 0, yellow = 0, red = 0;
        const chartData = data.map(item => {
          try {
            const parsed = JSON.parse(item.title);
            if (parsed.productivity === 'green') green++;
            else if (parsed.productivity === 'yellow') yellow++;
            else if (parsed.productivity === 'red') red++;

            return {
              date: item.due_date,
              rating: parsed.productivity === 'green' ? 3 : parsed.productivity === 'yellow' ? 2 : 1,
              ratingLabel: parsed.productivity === 'green' ? '🟢 Highly Productive' : parsed.productivity === 'yellow' ? '🟡 Medium' : '🔴 Unproductive',
              description: parsed.description
            };
          } catch (e) {
            return null;
          }
        }).filter(Boolean);

        setJourneyStats({ total: data.length, green, yellow, red });
        setJourneyChartData(chartData);
      }
    } catch (e) {
      console.error("Error loading journey stats:", e);
    }
  };

  const handleSaveJourneyLog = async (e) => {
    e.preventDefault();
    if (!journeyDesc.trim()) {
      alert("Please enter a brief description of your day");
      return;
    }

    const payload = {
      description: journeyDesc.trim(),
      productivity: journeyProd
    };

    try {
      if (isEditingJourney) {
        const { error } = await supabase
          .from('tasks')
          .update({ title: JSON.stringify(payload) })
          .eq('student_id', studentId)
          .eq('status', 'journey_log')
          .eq('due_date', journeyDate);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tasks')
          .insert([{
            student_id: studentId,
            title: JSON.stringify(payload),
            status: 'journey_log',
            priority: 'low',
            due_date: journeyDate
          }]);

        if (error) throw error;
      }

      loadJourneyData();
      loadJourneyLogForDate(journeyDate);
      alert("Daily log saved successfully!");
    } catch (err) {
      alert("Failed to save daily log: " + err.message);
    }
  };

  const handleDeleteJourneyLog = async () => {
    if (!window.confirm(`Delete the log for ${journeyDate}?`)) return;
    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('student_id', studentId)
        .eq('status', 'journey_log')
        .eq('due_date', journeyDate);

      if (error) throw error;
      loadJourneyData();
      loadJourneyLogForDate(journeyDate);
      alert("Daily log deleted.");
    } catch (err) {
      alert("Failed to delete log: " + err.message);
    }
  };

  // --- Yearly Tasks Completion Bar Chart Logic ---
  const loadDailyTasksChartData = async () => {
    try {
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'daily_task')
        .order('due_date', { ascending: true });

      if (data) {
        const groups = {};
        data.forEach(item => {
          const date = item.due_date;
          if (!groups[date]) groups[date] = [];
          groups[date].push(item);
        });

        const chartData = Object.keys(groups).map(date => {
          const dayTasks = groups[date];
          let totalCompletion = 0;
          let count = 0;
          
          const subjectScores = { Physics: [], Chemistry: [], Maths: [], Other: [] };
          
          dayTasks.forEach(task => {
            try {
              const parsed = JSON.parse(task.title);
              const pct = parsed.completion_percentage || 0;
              const sub = parsed.subject || 'Other';
              
              totalCompletion += pct;
              count++;
              
              if (subjectScores[sub]) {
                subjectScores[sub].push(pct);
              } else {
                subjectScores['Other'].push(pct);
              }
            } catch(e) {}
          });

          const getAvg = (arr) => arr.length > 0 ? Math.round(arr.reduce((sum, v) => sum + v, 0) / arr.length) : 0;

          return {
            date: date,
            completion: count > 0 ? Math.round(totalCompletion / count) : 0,
            Physics: getAvg(subjectScores.Physics),
            Chemistry: getAvg(subjectScores.Chemistry),
            Maths: getAvg(subjectScores.Maths),
            Other: getAvg(subjectScores.Other)
          };
        }).sort((a, b) => new Date(a.date) - new Date(b.date));

        setDailyTasksData(chartData);
      }
    } catch (e) {
      console.error("Error loading task chart data:", e);
    }
  };

  // --- Friends Shared Feed Activity Logic ---
  const loadFriendsFeed = async () => {
    setLoadingFeed(true);
    try {
      const { data: profile } = await supabase
        .from('students')
        .select('application_id')
        .eq('id', studentId)
        .single();
      
      const myAppId = profile?.application_id || '';

      const { data } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'task_share')
        .order('created_at', { ascending: false });

      if (data) {
        const feed = data.map(item => {
          try {
            const parsed = JSON.parse(item.title);
            if (parsed.sender_id !== studentId && 
               (parsed.share_type === 'all' || (parsed.receiver_app_id && parsed.receiver_app_id.toUpperCase().trim() === myAppId.toUpperCase().trim()))) {
              return {
                id: item.id,
                date: item.date,
                senderName: parsed.sender_name,
                senderAppId: parsed.sender_app_id,
                shareType: parsed.share_type,
                tasks: parsed.tasks || []
              };
            }
          } catch (e) {}
          return null;
        }).filter(Boolean);

        setFriendsFeed(feed);
      }
    } catch (e) {
      console.error("Error loading feed:", e);
    } finally {
      setLoadingFeed(false);
    }
  };

  // --- Recharts Custom Tooltips ---
  const CustomJourneyTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#090b11]/95 border border-cyan-500/35 p-3 rounded-lg text-white text-xs space-y-1 max-w-[250px] shadow-[0_0_15px_rgba(6,182,212,0.15)] relative z-50">
          <p className="font-extrabold text-cyan-400 border-b border-white/10 pb-1">{data.date}</p>
          <p className="font-bold text-yellow-400 mt-1">{data.ratingLabel}</p>
          <p className="text-gray-300 italic font-medium mt-1">"{data.description}"</p>
        </div>
      );
    }
    return null;
  };

  const CustomBarTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#090b11]/95 border border-cyan-500/35 p-3 rounded-lg text-white text-xs space-y-1 shadow-[0_0_15px_rgba(6,182,212,0.15)] relative z-50">
          <p className="font-extrabold text-cyan-400 border-b border-white/10 pb-1">{data.date}</p>
          <p className="text-yellow-500 font-extrabold mt-1">Overall Completion: {data.completion}%</p>
          {data.Physics > 0 && <p className="text-blue-400 font-bold">Physics: {data.Physics}%</p>}
          {data.Chemistry > 0 && <p className="text-orange-400 font-bold">Chemistry: {data.Chemistry}%</p>}
          {data.Maths > 0 && <p className="text-emerald-400 font-bold">Maths: {data.Maths}%</p>}
          {data.Other > 0 && <p className="text-purple-400 font-bold">Other: {data.Other}%</p>}
        </div>
      );
    }
    return null;
  };

  const StatCard = ({ title, value, icon: Icon, colorClass }) => (
    <div className="bg-white rounded-md shadow-sm border border-gray-200 p-5 flex items-center justify-between">
      <div>
        <p className="text-sm font-bold text-gray-500 uppercase">{title}</p>
        <p className={`text-2xl font-black mt-1 ${colorClass}`}>{value}</p>
      </div>
      <div className={`w-12 h-12 rounded-full flex items-center justify-center bg-gray-50 border border-gray-200`}>
        <Icon className={`w-6 h-6 ${colorClass}`} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f1f4f9] font-sans pb-12 select-none">
      
      {/* NTA Header */}
      <div className="bg-[#1f497d] text-white py-4 px-6 shadow-md border-b-4 border-yellow-500">
        <div className="max-w-7xl mx-auto flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wider">Candidate Dashboard</h1>
            <p className="text-sm font-medium opacity-90">{student?.full_name} | {student?.application_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/student/tasks">
              <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-xs font-bold uppercase transition-colors shadow">
                Daily Tasks & Planner
              </button>
            </Link>
            <button
              onClick={() => {
                sessionStorage.clear();
                navigate('/');
              }}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded text-xs font-bold uppercase transition-colors shadow"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 space-y-6">
        
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard title="Total Exams Taken" value={stats.totalExams} icon={FileText} colorClass="text-[#1f497d]" />
          <StatCard title="Average Score" value={`${stats.averageScore}%`} icon={Target} colorClass="text-blue-600" />
          <StatCard title="Best Score" value={`${stats.bestScore}%`} icon={Award} colorClass="text-green-600" />
        </div>

        {/* Active Official Exams */}
        {activeExams.length > 0 && (
          <div className="bg-white rounded-md shadow-sm border border-gray-300 overflow-hidden">
            <div className="bg-[#e24a4a] text-white px-4 py-3 font-bold flex items-center gap-2">
              <Clock size={18} /> Active Examinations
            </div>
            <div className="p-4 space-y-3">
              {activeExams.map(exam => {
                const now = new Date();
                const startDate = exam.start_datetime ? new Date(exam.start_datetime) : null;
                const endDate = exam.end_datetime ? new Date(exam.end_datetime) : null;

                const hasPersonal = exam.personalAssignment === 'active';
                const isEarly = startDate && startDate > now && !hasPersonal;
                const isLate = endDate && endDate < now && !hasPersonal;
                const isApproved = exam.lateRequest === 'approved';
                const isPending = exam.lateRequest === 'pending';
                const isRejected = exam.lateRequest === 'rejected';

                const canStart = hasPersonal || (!isEarly && !isLate) || (isLate && isApproved);

                return (
                  <div key={exam.id} className="flex flex-col md:flex-row items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded gap-4">
                    <div>
                      <h4 className="font-bold text-[#1f497d] text-lg flex items-center gap-2 flex-wrap">
                        {exam.title}
                        {hasPersonal && (
                          <span className="bg-cyan-100 text-cyan-800 border border-cyan-300 text-[10px] px-2 py-0.5 rounded font-extrabold uppercase">
                            Personal Access Assigned
                          </span>
                        )}
                        {isLate && isApproved && (
                          <span className="bg-green-100 text-green-800 border border-green-300 text-[10px] px-2 py-0.5 rounded font-extrabold uppercase">
                            Late Access Approved
                          </span>
                        )}
                        {isEarly && !hasPersonal && (
                          <span className="bg-yellow-100 text-yellow-800 border border-yellow-300 text-[10px] px-2 py-0.5 rounded font-extrabold uppercase">
                            Scheduled
                          </span>
                        )}
                        {isLate && !isApproved && !hasPersonal && (
                          <span className="bg-red-100 text-red-800 border border-red-300 text-[10px] px-2 py-0.5 rounded font-extrabold uppercase">
                            Expired
                          </span>
                        )}
                      </h4>
                      <div className="flex flex-wrap gap-4 mt-1.5 text-xs text-gray-655 font-bold uppercase tracking-wider">
                        <span>Subject: {exam.subject}</span>
                        <span>Duration: {exam.duration_minutes} min</span>
                        {isEarly && !hasPersonal && (
                          <span className="text-yellow-600">
                            Starts In: <ExamCountdown startDatetime={exam.start_datetime} onComplete={loadDashboardData} />
                          </span>
                        )}
                        {isLate && !isApproved && !hasPersonal && (
                          <span className="text-red-650">
                            Ended: {new Date(exam.end_datetime).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {exam.description && <p className="text-xs text-gray-500 mt-2 font-semibold italic">"{exam.description}"</p>}
                    </div>

                    <div className="shrink-0 flex items-center">
                      {canStart ? (
                        <Link to={`/student/exam/${exam.id}/login`}>
                          <button className="bg-[#1f497d] hover:bg-[#15345a] text-white px-8 py-2.5 rounded-xl font-black uppercase transition-colors shadow text-xs tracking-wider">
                            {exam.nextAttemptNumber > 1 ? `START EXAM (Attempt #${exam.nextAttemptNumber})` : 'START EXAM'}
                          </button>
                        </Link>
                      ) : isEarly ? (
                        <button disabled className="bg-gray-250 text-gray-500 border border-gray-300 px-8 py-2.5 rounded-xl font-black uppercase text-xs tracking-wider cursor-not-allowed">
                          Exam Not Active
                        </button>
                      ) : isPending ? (
                        <button disabled className="bg-amber-100 border border-amber-300 text-amber-700 px-6 py-2.5 rounded-xl font-black uppercase text-xs tracking-wider cursor-not-allowed">
                          Request Pending...
                        </button>
                      ) : isRejected ? (
                        <div className="text-right">
                          <span className="text-red-600 font-extrabold text-xs block mb-1 uppercase tracking-wider">Request Rejected</span>
                          <span className="text-[10px] text-gray-500 font-bold uppercase block">Late entries are closed.</span>
                        </div>
                      ) : (
                        <button 
                          onClick={() => handleRequestLateAttempt(exam.id)}
                          className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 px-6 py-2.5 rounded-xl font-black uppercase transition-colors shadow text-xs tracking-wider cursor-pointer"
                        >
                          Request Late Attempt
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* JEE JOURNEY & PRODUCTIVITY TRACKER LOGS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Logger Panel */}
          <div className="rounded-xl border border-white/10 overflow-hidden lg:col-span-1 flex flex-col justify-between shadow-lg relative bg-[#0b0f19] min-h-[350px]">
            <CosmicBackground />
            <div className="relative z-10 flex flex-col justify-between h-full bg-transparent backdrop-blur-xs flex-1">
              <div>
                <div className="bg-transparent border-b border-white/10 text-white px-4 py-3.5 font-black flex items-center gap-2 tracking-wider">
                  <Calendar size={18} className="text-cyan-400" /> Daily JEE Journey Log
                </div>
                <div className="p-5 space-y-4">
                  
                  {/* Date Picker */}
                  <div>
                    <label className="block text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-1.5">Selected Date</label>
                    <input 
                      type="date" 
                      value={journeyDate} 
                      onChange={e => setJourneyDate(e.target.value)} 
                      className="w-full px-3 py-2 border border-white/15 rounded-lg outline-none text-sm font-bold text-white bg-black/40 focus:border-cyan-500 transition-colors" 
                    />
                  </div>

                  {/* Productivity Rating Buttons */}
                  <div>
                    <label className="block text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-2">Productivity Rating</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        onClick={() => setJourneyProd('red')}
                        type="button"
                        className={`py-2 text-[10px] font-bold rounded-lg border transition-all flex items-center justify-center gap-1 ${
                          journeyProd === 'red' 
                            ? 'bg-red-500/35 text-white border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]' 
                            : 'bg-black/40 text-red-400 border-red-500/20 hover:bg-red-500/10'
                        }`}
                      >
                        🔴 Bad Day
                      </button>
                      <button
                        onClick={() => setJourneyProd('yellow')}
                        type="button"
                        className={`py-2 text-[10px] font-bold rounded-lg border transition-all flex items-center justify-center gap-1 ${
                          journeyProd === 'yellow' 
                            ? 'bg-yellow-500/30 text-white border-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.3)]' 
                            : 'bg-black/40 text-yellow-400 border-yellow-500/20 hover:bg-yellow-500/10'
                        }`}
                      >
                        🟡 Medium
                      </button>
                      <button
                        onClick={() => setJourneyProd('green')}
                        type="button"
                        className={`py-2 text-[10px] font-bold rounded-lg border transition-all flex items-center justify-center gap-1 ${
                          journeyProd === 'green' 
                            ? 'bg-green-500/30 text-white border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]' 
                            : 'bg-black/40 text-green-400 border-green-500/20 hover:bg-green-500/10'
                        }`}
                      >
                        🟢 Best Day
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-1.5">What did you study / do?</label>
                    <textarea
                      rows="3"
                      value={journeyDesc}
                      onChange={e => setJourneyDesc(e.target.value)}
                      placeholder="Briefly describe what you studied..."
                      className="w-full px-3 py-2 border border-white/15 rounded-lg outline-none text-xs font-semibold text-white bg-black/40 focus:border-cyan-500 placeholder-gray-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="p-5 bg-transparent border-t border-white/10 flex gap-2">
                <button 
                  onClick={handleSaveJourneyLog} 
                  className="flex-1 bg-cyan-600 hover:bg-cyan-700 text-white py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-colors shadow-md shadow-cyan-500/10 cursor-pointer"
                >
                  {isEditingJourney ? 'Update Log' : 'Save Daily Log'}
                </button>
                {isEditingJourney && (
                  <button 
                    onClick={handleDeleteJourneyLog} 
                    className="bg-red-500/10 hover:bg-red-500/20 text-red-400 p-2.5 rounded-lg border border-red-500/30 transition-colors cursor-pointer"
                    title="Delete log for this day"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Productivity Stats & History Chart */}
          <div className="rounded-xl border border-white/10 overflow-hidden lg:col-span-2 shadow-lg relative bg-[#0b0f19]">
            <CosmicBackground />
            <div className="relative z-10 bg-transparent backdrop-blur-xs h-full flex flex-col justify-between">
              <div>
                <div className="bg-transparent text-white px-4 py-3.5 border-b border-white/10 font-black flex justify-between items-center tracking-wider">
                  <div className="flex items-center gap-2">
                    <Flame size={18} className="text-orange-400" /> Journey Tracker Statistics & Trend
                  </div>
                  <div className="text-[10px] font-black text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-500/20 uppercase tracking-widest">
                    Logged: {journeyStats.total} Days
                  </div>
                </div>
                
                <div className="p-5 space-y-4">
                  
                  {/* Stats Counters */}
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2.5 shadow-sm shadow-green-500/5 backdrop-blur-xs">
                      <p className="text-[9px] text-green-400 uppercase font-black tracking-widest">Productive Days</p>
                      <p className="text-2xl font-black text-green-400 mt-0.5">{journeyStats.green}</p>
                    </div>
                    <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-2.5 shadow-sm shadow-yellow-500/5 backdrop-blur-xs">
                      <p className="text-[9px] text-yellow-400 uppercase font-black tracking-widest">Medium Days</p>
                      <p className="text-2xl font-black text-yellow-400 mt-0.5">{journeyStats.yellow}</p>
                    </div>
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2.5 shadow-sm shadow-red-500/5 backdrop-blur-xs">
                      <p className="text-[9px] text-red-400 uppercase font-black tracking-widest">Unproductive</p>
                      <p className="text-2xl font-black text-red-400 mt-0.5">{journeyStats.red}</p>
                    </div>
                  </div>

                  {/* Productivity Trend Chart */}
                  <div className="bg-black/20 border border-white/5 rounded-lg p-4 shadow-inner">
                    <h4 className="text-white text-xs font-black mb-3 flex items-center gap-1.5 tracking-wide">
                      <ChartIcon size={14} className="text-cyan-400" /> Chronological JEE Journey Scatter (DB Logged)
                    </h4>
                    <div className="h-[210px] w-full">
                      {journeyChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={journeyChartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                            <XAxis dataKey="date" stroke="#9CA3AF" tick={{fill: '#9CA3AF', fontSize: 10}} />
                            <YAxis 
                              stroke="#9CA3AF" 
                              tick={{fill: '#9CA3AF', fontSize: 10}} 
                              domain={[1, 3]} 
                              ticks={[1, 2, 3]} 
                              tickFormatter={(val) => val === 3 ? '🟢 Good' : val === 2 ? '🟡 Med' : '🔴 Bad'} 
                            />
                            <Tooltip content={<CustomJourneyTooltip />} />
                            <Line type="monotone" dataKey="rating" name="Productivity" stroke="#06b6d4" strokeWidth={3} dot={{r: 4, strokeWidth: 1, fill: '#090b11', stroke: '#06b6d4'}} activeDot={{r: 6}} />
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-gray-500 text-xs italic">
                          No Daily logs recorded. Select a date on the left panel to save your first JEE journey diary entry!
                        </div>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>

        {/* YEARLY TASK COMPLETION BAR CHART */}
        <div className="rounded-xl border border-white/10 overflow-hidden shadow-lg relative bg-[#0b0f19]">
          <CosmicBackground />
          <div className="relative z-10 bg-transparent backdrop-blur-xs h-full flex flex-col justify-between">
            <div className="bg-transparent text-white px-4 py-3.5 border-b border-white/10 font-black flex justify-between items-center tracking-wider">
              <div className="flex items-center gap-2">
                <BarChartIcon size={18} className="text-cyan-400" /> Yearly Task Completion & Subject Breakdown
              </div>
              <Link to="/student/tasks" className="text-xs text-yellow-300 hover:text-yellow-400 font-extrabold uppercase tracking-widest">
                Manage Tasks
              </Link>
            </div>
            <div className="p-5">
              <div className="bg-black/20 border border-white/5 rounded-lg p-4 shadow-inner">
                <h4 className="text-white text-xs font-black mb-3 flex items-center gap-1.5 tracking-wide">
                  <BarChartIcon size={14} className="text-cyan-400" /> Daily Planner Completion Rates (Physics, Chemistry, Maths, Other)
                </h4>
                <div className="h-[250px] w-full">
                  {dailyTasksData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dailyTasksData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                        <XAxis dataKey="date" stroke="#9CA3AF" tick={{fill: '#9CA3AF', fontSize: 10}} />
                        <YAxis stroke="#9CA3AF" tick={{fill: '#9CA3AF', fontSize: 10}} domain={[0, 100]} />
                        <Tooltip content={<CustomBarTooltip />} />
                        <Legend wrapperStyle={{fontSize: 11, color: '#9CA3AF', paddingTop: 10}} />
                        <Bar dataKey="completion" name="Overall Progress (%)" fill="#00f2fe" radius={[4, 4, 0, 0]} maxBarSize={45} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-500 text-xs italic">
                      No task completions logged yet. Go to "Daily Tasks & Planner" to log tasks by subject and adjust percentages!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* DB-BACKED PERFORMANCE ANALYTICS GRAPH */}
        <div className="rounded-xl border border-white/10 overflow-hidden shadow-lg relative bg-[#0b0f19]">
          <CosmicBackground />
          <div className="relative z-10 bg-transparent backdrop-blur-xs h-full flex flex-col justify-between">
            <div className="bg-transparent text-white px-4 py-3 border-b border-white/10 font-black flex justify-between items-center tracking-wider">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} className="text-cyan-400" /> Performance Analytics & Score Journey
              </div>
              <div className="flex gap-1.5 bg-black/40 p-0.5 rounded border border-white/10">
                <button
                  onClick={() => setChartMode('official')}
                  className={`px-3 py-1.5 rounded text-xs font-black transition-colors uppercase tracking-wider ${chartMode === 'official' ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                >
                  Official Exam Scores
                </button>
                <button
                  onClick={() => setChartMode('mock')}
                  className={`px-3 py-1.5 rounded text-xs font-black transition-colors uppercase tracking-wider ${chartMode === 'mock' ? 'bg-cyan-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                >
                  Mock Test Tracker
                </button>
              </div>
            </div>
            
            <div className="p-6">
              
              {/* Graph Card */}
              <div className="bg-black/20 border border-white/5 rounded-lg p-4 mb-6 shadow-inner">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-white font-black text-sm flex items-center gap-2 tracking-wide">
                    <ChartIcon size={16} className="text-cyan-400" />
                    {chartMode === 'official' ? 'Official Agency Exam Scores (DB Permanent)' : 'Self-Logged Mock Test Trend (DB Permanent)'}
                  </h3>
                  {chartMode === 'mock' && (
                    <div className="flex items-center gap-2">
                      <label className="text-gray-300 text-xs font-bold uppercase tracking-wider">Target Margin:</label>
                      <input 
                        type="number" 
                        value={targetMargin} 
                        onChange={(e) => setTargetMargin(e.target.value)}
                        className="w-16 px-2 py-0.5 bg-slate-900 border border-white/10 text-white rounded-lg outline-none focus:border-cyan-500 text-xs text-center font-mono font-bold"
                      />
                    </div>
                  )}
                </div>
                
                <div className="h-[300px] w-full">
                  {chartMode === 'official' ? (
                    officialTests.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={officialTests} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                          <XAxis dataKey="testName" stroke="#9CA3AF" tick={{fill: '#9CA3AF', fontSize: 11}} />
                          <YAxis stroke="#9CA3AF" tick={{fill: '#9CA3AF'}} domain={[0, 100]} />
                          <Tooltip contentStyle={{backgroundColor: '#090b11', border: '1px solid rgba(6,182,212,0.3)', color: '#fff', borderRadius: '8px'}} />
                          <Legend />
                          <Line type="monotone" dataKey="percentage" name="Percentage Scored" stroke="#10B981" strokeWidth={3} dot={{r: 4, fill: '#090b11', stroke: '#10B981'}} activeDot={{r: 6}} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-500 text-xs">
                        No official evaluated exam results found in the database.
                      </div>
                    )
                  ) : (
                    customTests.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={customTests} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                          <XAxis dataKey="testName" stroke="#9CA3AF" tick={{fill: '#9CA3AF', fontSize: 11}} />
                          <YAxis stroke="#9CA3AF" tick={{fill: '#9CA3AF'}} domain={[0, 'auto']} />
                          <Tooltip contentStyle={{backgroundColor: '#090b11', border: '1px solid rgba(6,182,212,0.3)', color: '#fff', borderRadius: '8px'}} />
                          <Legend />
                          
                          {targetMargin > 0 && (
                            <ReferenceLine y={targetMargin} stroke="#EF4444" strokeDasharray="5 5" label={{ position: 'top', value: 'Target', fill: '#EF4444', fontSize: 10 }} />
                          )}
                          
                          <Line type="monotone" dataKey="total" name="Total Score" stroke="#00f2fe" strokeWidth={3} dot={{r: 4, fill: '#090b11', stroke: '#00f2fe'}} activeDot={{r: 6}} />
                          <Line type="monotone" dataKey="physics" name="Physics" stroke="#8B5CF6" strokeWidth={2} />
                          <Line type="monotone" dataKey="chemistry" name="Chemistry" stroke="#ff9100" strokeWidth={2} />
                          <Line type="monotone" dataKey="maths" name="Maths" stroke="#10B981" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-500 text-xs">
                        No mock test data logged. Use the form below to register mock scores.
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Mock Test Log Form (Shown only in Mock Mode) */}
              {chartMode === 'mock' && (
                <>
                  <div className="bg-transparent border border-white/10 rounded-lg p-5 mb-6 shadow-sm">
                    <h4 className="font-black text-cyan-400 text-xs uppercase tracking-widest mb-3">Log New Mock Test Result</h4>
                    <form onSubmit={handleAddCustomTest} className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-8 gap-3 items-end">
                      <div className="lg:col-span-2">
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Date</label>
                        <input type="date" required value={newTest.date} onChange={e => setNewTest({...newTest, date: e.target.value})} className="w-full px-3 py-2 border border-white/10 rounded-lg outline-none text-xs font-bold text-white bg-black/40 focus:border-cyan-500" />
                      </div>
                      <div className="lg:col-span-2">
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Test Name</label>
                        <input type="text" required placeholder="e.g. Mock Test 1" value={newTest.testName} onChange={e => setNewTest({...newTest, testName: e.target.value})} className="w-full px-3 py-2 border border-white/10 rounded-lg outline-none text-xs font-bold text-white bg-black/40 focus:border-cyan-500 placeholder-gray-500" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Physics</label>
                        <input type="number" required max="100" min="-25" value={newTest.physics} onChange={e => setNewTest({...newTest, physics: e.target.value})} className="w-full px-3 py-2 border border-white/10 rounded-lg outline-none text-xs font-bold text-white bg-black/40 focus:border-cyan-500 font-mono" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Chemistry</label>
                        <input type="number" required max="100" min="-25" value={newTest.chemistry} onChange={e => setNewTest({...newTest, chemistry: e.target.value})} className="w-full px-3 py-2 border border-white/10 rounded-lg outline-none text-xs font-bold text-white bg-black/40 focus:border-cyan-500 font-mono" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Maths</label>
                        <input type="number" required max="100" min="-25" value={newTest.maths} onChange={e => setNewTest({...newTest, maths: e.target.value})} className="w-full px-3 py-2 border border-white/10 rounded-lg outline-none text-xs font-bold text-white bg-black/40 focus:border-cyan-500 font-mono" />
                      </div>
                      
                      <div className="lg:col-span-1">
                        <button type="submit" disabled={addingTest} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg font-black uppercase tracking-wider transition-colors text-xs flex items-center justify-center shadow-md disabled:opacity-50 cursor-pointer">
                          {addingTest ? 'Saving...' : <PlusCircle size={18} />}
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Mock Test History Table */}
                  <div className="overflow-x-auto border border-white/10 rounded-lg shadow-md bg-transparent">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-black/40 text-cyan-400 text-[9px] uppercase tracking-widest font-black border-b border-white/10">
                          <th className="p-3 text-left">Date</th>
                          <th className="p-3 text-left">Test Name</th>
                          <th className="p-3 text-center">Physics</th>
                          <th className="p-3 text-center">Chemistry</th>
                          <th className="p-3 text-center">Maths</th>
                          <th className="p-3 text-center font-black">Total Score</th>
                          <th className="p-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="text-xs font-bold text-gray-300">
                        {customTests.length === 0 ? (
                          <tr><td colSpan="7" className="text-center p-6 text-gray-550 italic bg-transparent">No history available in database. Add a mock test above.</td></tr>
                        ) : (
                          customTests.map(test => (
                            <tr key={test.id} className="hover:bg-white/5 border-b border-white/5">
                              <td className="p-3">{test.date}</td>
                              <td className="p-3 text-cyan-400 font-black">{test.testName}</td>
                              <td className="p-3 text-center text-purple-400 font-bold">{test.physics}</td>
                              <td className="p-3 text-center text-orange-400 font-bold">{test.chemistry}</td>
                              <td className="p-3 text-center text-emerald-400 font-bold">{test.maths}</td>
                              <td className="p-3 text-center font-black text-cyan-300">{test.total}/300</td>
                              <td className="p-3 text-center">
                                <button onClick={() => handleDeleteCustomTest(test.id)} className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/20 transition-colors cursor-pointer" title="Delete record">
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Official Exam History Table (Shown in Official Mode) */}
              {chartMode === 'official' && (
                <div className="overflow-x-auto border border-white/10 rounded-lg shadow-md bg-transparent">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-black/40 text-cyan-400 text-[9px] uppercase tracking-widest font-black border-b border-white/10">
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-left">Official Exam Title</th>
                        <th className="p-3 text-center">Subject</th>
                        <th className="p-3 text-center">Score Obtained</th>
                        <th className="p-3 text-center">Maximum Marks</th>
                        <th className="p-3 text-center font-black">Percentile</th>
                      </tr>
                    </thead>
                    <tbody className="text-xs font-bold text-gray-300">
                      {officialTests.length === 0 ? (
                        <tr><td colSpan="6" className="text-center p-6 text-gray-550 italic">No official completed exam records found.</td></tr>
                      ) : (
                        officialTests.map(test => (
                          <tr key={test.id} className="hover:bg-white/5 border-b border-white/5">
                            <td className="p-3">{test.date}</td>
                            <td className="p-3 text-cyan-400 font-black">{test.testName}</td>
                            <td className="p-3 text-center text-gray-400 font-bold">{test.subject}</td>
                            <td className="p-3 text-center text-blue-400 font-bold">{test.totalScore}</td>
                            <td className="p-3 text-center text-gray-400 font-bold">{test.totalMarks}</td>
                            <td className="p-3 text-center font-black text-emerald-400 bg-emerald-500/5">{test.percentage}%</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          </div>
        </div>

        {/* SOCIAL ACTIVITY & FRIENDS shared task feed */}
        <div className="rounded-xl border border-white/10 overflow-hidden shadow-lg relative bg-[#0b0f19]">
          <CosmicBackground />
          <div className="relative z-10 bg-transparent backdrop-blur-xs h-full flex flex-col justify-between">
            <div className="bg-transparent text-white px-4 py-3.5 border-b border-white/10 font-black flex justify-between items-center tracking-wider">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-cyan-400" /> Social Motivation - Friends' Active Planners
              </div>
              <button 
                onClick={loadFriendsFeed} 
                className="text-[10px] bg-cyan-950/50 hover:bg-cyan-900/50 border border-cyan-500/30 p-1.5 rounded-lg transition-all text-cyan-400 font-black uppercase tracking-widest flex items-center gap-1.5"
                title="Refresh Activity Feed"
                disabled={loadingFeed}
              >
                <RefreshCw size={12} className={loadingFeed ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            
            <div className="p-5 max-h-[400px] overflow-y-auto space-y-4">
              {loadingFeed ? (
                <div className="text-center py-6 text-gray-550 text-xs italic">Loading social feed...</div>
              ) : friendsFeed.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-xs italic bg-transparent border border-dashed border-white/10 rounded-lg">
                  No active shared task sheets from your peers today. 
                  Encourage them to click "Share Now" inside their planners!
                </div>
              ) : (
                friendsFeed.map(feedItem => (
                  <div key={feedItem.id} className="p-4 border rounded-xl bg-black/15 hover:bg-black/25 border-white/5 hover:border-cyan-500/20 transition-all shadow-md">
                    <div className="flex justify-between items-start gap-2 border-b border-white/10 pb-2 mb-2 flex-wrap">
                      <div>
                        <span className="font-black text-sm text-cyan-400">{feedItem.senderName}</span>
                        <span className="text-[9px] font-black text-cyan-300 bg-cyan-950 border border-cyan-500/30 px-1.5 py-0.5 rounded ml-2 uppercase tracking-widest">
                          {feedItem.senderAppId}
                        </span>
                      </div>
                      <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-2 py-0.5">
                        📅 Date: {feedItem.date}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {feedItem.tasks.map((task, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs font-semibold text-gray-300 bg-black/10 p-2 rounded-lg border border-white/5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              task.subject === 'Physics' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/20' :
                              task.subject === 'Chemistry' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/20' :
                              task.subject === 'Maths' ? 'bg-green-500/20 text-green-400 border border-green-500/20' : 
                              'bg-purple-500/20 text-purple-400 border border-purple-500/20'
                            }`}>
                              {task.subject}
                            </span>
                            <span className="truncate max-w-[200px] sm:max-w-xs">{task.title}</span>
                          </div>
                          <span className={`font-black font-mono ${
                            task.pct >= 85 ? 'text-emerald-400' : task.pct >= 50 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {task.pct}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
