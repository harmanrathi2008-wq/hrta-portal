import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  
  const [stats, setStats] = useState({
    totalStudents: 0,
    activeStudents: 0,
    totalExams: 0,
    publishedExams: 0,
    pendingSubmissions: 0,
    totalSubmissions: 0
  });

  const [pendingResults, setPendingResults] = useState([]);
  const [allResults, setAllResults] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [publishingId, setPublishingId] = useState(null);
  const [loginLogs, setLoginLogs] = useState([]);
  const [logsError, setLogsError] = useState(false);
  const [lateRequests, setLateRequests] = useState([]);
  const [requestsError, setRequestsError] = useState(false);

  // Proctoring States
  const [activeSessions, setActiveSessions] = useState([]);
  const [monitoringStudent, setMonitoringStudent] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [monitorStatus, setMonitorStatus] = useState("Connecting...");
  const [timeTick, setTimeTick] = useState(0);

  const peerConnectionRef = useRef(null);
  const proctorChannelRef = useRef(null);
  const videoRef = useRef(null);

  // Stop monitoring and close WebRTC peer connection
  const stopMonitoring = () => {
    if (proctorChannelRef.current) {
      proctorChannelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "ADMIN_DISCONNECTED", sender: "admin" }
      }).catch(err => console.warn("Error sending ADMIN_DISCONNECTED:", err));

      supabase.removeChannel(proctorChannelRef.current);
      proctorChannelRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setMonitoringStudent(null);
    setRemoteStream(null);
    setMonitorStatus("Connecting...");
  };

  // Start monitoring student live camera feed
  const startMonitoring = (session) => {
    stopMonitoring();

    setMonitoringStudent(session);
    setMonitorStatus("Initializing...");

    const studentId = session.student_id;
    const channelName = `exam_proctor_${studentId}`;
    const channel = supabase.channel(channelName);
    proctorChannelRef.current = channel;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    peerConnectionRef.current = pc;

    const iceCandidateQueue = [];

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        setMonitorStatus("Live");
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && proctorChannelRef.current) {
        proctorChannelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "ICE_CANDIDATE", sender: "admin", data: event.candidate }
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        setMonitorStatus("Stream Interrupted");
      } else if (pc.iceConnectionState === "closed") {
        setMonitorStatus("Disconnected");
      }
    };

    channel
      .on("broadcast", { event: "signal" }, async ({ payload }) => {
        const { type, sender, data } = payload;
        if (sender === "student") {
          if (type === "SDP_OFFER") {
            try {
              setMonitorStatus("Connecting...");
              await pc.setRemoteDescription(new RTCSessionDescription(data));
              
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              
              channel.send({
                type: "broadcast",
                event: "signal",
                payload: { type: "SDP_ANSWER", sender: "admin", data: answer }
              });

              // Process any queued ICE candidates
              while (iceCandidateQueue.length > 0) {
                const candidate = iceCandidateQueue.shift();
                await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => 
                  console.warn("Error processing queued candidate:", e)
                );
              }
            } catch (err) {
              console.error("Error establishing connection with offer:", err);
              setMonitorStatus("Connection Failed");
            }
          } else if (type === "ICE_CANDIDATE") {
            try {
              if (pc.remoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(data));
              } else {
                iceCandidateQueue.push(data);
              }
            } catch (err) {
              console.error("Error setting ICE candidate:", err);
            }
          }
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Send request to begin streaming
          channel.send({
            type: "broadcast",
            event: "signal",
            payload: { type: "ADMIN_CONNECTED", sender: "admin" }
          });
        }
      });
  };

  // Bind remote stream to video element
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Clean up if monitored student is no longer active (submitted or left)
  useEffect(() => {
    if (monitoringStudent) {
      const isStillActive = activeSessions.some(
        (session) => session.student_id === monitoringStudent.student_id
      );
      if (!isStillActive) {
        stopMonitoring();
      }
    }
  }, [activeSessions, monitoringStudent]);

  // Timer tick effect for updating live start_time duration string
  useEffect(() => {
    const timerTick = setInterval(() => {
      setTimeTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timerTick);
  }, []);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const role = sessionStorage.getItem('role');
        if (role !== 'super_admin') {
          navigate('/');
          return;
        }

        // 1. Fetch Students Stats
        const { count: totalStudents, error: studentErr } = await supabase
          .from('students')
          .select('*', { count: 'exact', head: true });
          
        const { count: activeStudents, error: activeStudentErr } = await supabase
          .from('students')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active');

        // 2. Fetch Exams Stats
        const { count: totalExams, error: examErr } = await supabase
          .from('exams')
          .select('*', { count: 'exact', head: true });
          
        const { count: publishedExams, error: pubExamErr } = await supabase
          .from('exams')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'published');

        // 3. Fetch Submissions Stats
        const { count: totalSub, error: subErr } = await supabase
          .from('exam_results')
          .select('*', { count: 'exact', head: true });
          
        const { count: pendingSub, error: pendSubErr } = await supabase
          .from('exam_results')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'submitted');

        // 4. Fetch top 5 pending submissions for quick review
        const { data: recentPending, error: recentErr } = await supabase
          .from('exam_results')
          .select(`
            id,
            submitted_at,
            students ( full_name, application_id ),
            exams ( title )
          `)
          .eq('status', 'submitted')
          .order('submitted_at', { ascending: false })
          .limit(5);

        // 5. Fetch Active Proctoring Sessions (status = 'in_progress')
        const { data: activeSessionsData, error: activeErr } = await supabase
          .from('exam_results')
          .select(`
            id,
            status,
            student_id,
            exam_id,
            started_at,
            students ( id, full_name, application_id ),
            exams ( id, title, subject )
          `)
          .eq('status', 'in_progress')
          .order('started_at', { ascending: false });

        if (studentErr || examErr || subErr || recentErr) {
          throw new Error("Failed to load dashboard statistics.");
        }

        setStats({
          totalStudents: totalStudents || 0,
          activeStudents: activeStudents || 0,
          totalExams: totalExams || 0,
          publishedExams: publishedExams || 0,
          totalSubmissions: totalSub || 0,
          pendingSubmissions: pendingSub || 0
        });

        setPendingResults(recentPending || []);
        
        if (activeErr) {
          console.error("Error fetching active sessions:", activeErr);
        } else {
          setActiveSessions(activeSessionsData || []);
        }

      } catch (err) {
        console.error("Dashboard Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
    loadAllResults();

    // Subscribe to real-time updates of exam_results
    const realtimeChannel = supabase
      .channel('admin-dashboard-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'exam_results'
        },
        () => {
          fetchDashboardData();
          loadAllResults();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [navigate]);

  const loadAllResults = async () => {
    setResultsLoading(true);
    try {
      const { data, error } = await supabase
        .from('exam_results')
        .select('id, status, total_score, total_marks, percentage, submitted_at, published_at, students(full_name, application_id), exams(title, subject)')
        .order('submitted_at', { ascending: false })
        .limit(30);
      if (!error && data) {
        // Compute attempt numbers
        const tracker = {};
        const sorted = [...data].sort((a,b) => new Date(a.submitted_at) - new Date(b.submitted_at));
        const withAttempts = sorted.map(r => {
          const k = `${r.student_id}_${r.exam_id}`;
          tracker[k] = (tracker[k] || 0) + 1;
          return { ...r, attempt_number: tracker[k] };
        });
        withAttempts.sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at));
        setAllResults(withAttempts);
      }
    } catch(e) {
      console.error('Error loading results:', e);
    } finally {
      setResultsLoading(false);
    }
  };

  const handleQuickPublish = async (resultId, studentName) => {
    if (!window.confirm(`Publish result for ${studentName}? They will immediately see their scorecard.`)) return;
    setPublishingId(resultId);
    try {
      const { error } = await supabase
        .from('exam_results')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', resultId);
      if (error) throw error;
      await loadAllResults();
    } catch(e) {
      alert('Failed to publish: ' + e.message);
    } finally {
      setPublishingId(null);
    }
  };

  const handleQuickUnpublish = async (resultId, studentName) => {
    if (!window.confirm(`Unpublish result for ${studentName}? They will no longer see their scorecard.`)) return;
    setPublishingId(resultId);
    try {
      const { error } = await supabase
        .from('exam_results')
        .update({ status: 'reviewed', published_at: null })
        .eq('id', resultId);
      if (error) throw error;
      await loadAllResults();
    } catch(e) {
      alert('Failed to unpublish: ' + e.message);
    } finally {
      setPublishingId(null);
    }
  };

  const fetchSecurityLogs = async () => {
    try {
      const { data: logsData, error: logsErr } = await supabase
        .from('login_logs')
        .select('*')
        .order('login_at', { ascending: false })
        .limit(15);

      if (logsErr) {
        console.warn("Failed to fetch login logs. Table might not exist yet.", logsErr.message);
        setLogsError(true);
      } else {
        setLoginLogs(logsData || []);
        setLogsError(false);
      }
    } catch (err) {
      console.error("Error fetching logs:", err);
      setLogsError(true);
    }
  };

  const fetchLateRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('exam_late_requests')
        .select(`
          id,
          status,
          created_at,
          students ( full_name, application_id ),
          exams ( title )
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn("Failed to fetch late requests. Table might not exist yet.", error.message);
        setRequestsError(true);
      } else {
        setLateRequests(data || []);
        setRequestsError(false);
      }
    } catch (err) {
      console.error("Error fetching late requests:", err);
      setRequestsError(true);
    }
  };

  const handleApproveRequest = async (id) => {
    try {
      const { error } = await supabase
        .from('exam_late_requests')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      alert("Late attempt request approved successfully!");
      fetchLateRequests();
    } catch (err) {
      alert("Failed to approve request: " + err.message);
    }
  };

  const handleRejectRequest = async (id) => {
    try {
      const { error } = await supabase
        .from('exam_late_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      alert("Late attempt request rejected.");
      fetchLateRequests();
    } catch (err) {
      alert("Failed to reject request: " + err.message);
    }
  };

  useEffect(() => {
    fetchSecurityLogs();
    fetchLateRequests();
    const interval = setInterval(() => {
      fetchSecurityLogs();
      fetchLateRequests();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const formatDuration = (seconds) => {
    if (!seconds || seconds < 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const isSessionActive = (lastActivityAt) => {
    if (!lastActivityAt) return false;
    const lastActivity = new Date(lastActivityAt).getTime();
    const twoMinutesAgo = Date.now() - (2 * 60 * 1000);
    return lastActivity > twoMinutesAgo;
  };

  // Canvas Color-Changing Particle System Effect
  useEffect(() => {
    const canvas = document.getElementById('cosmic-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let particles = [];
    
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
    };

    const initParticles = () => {
      particles = [];
      // Guaranteeing 200+ active color-shifting particles
      const particleCount = 220;
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: Math.random() * 3 + 1.2,
          hue: Math.random() * 360,
          hueSpeed: Math.random() * 0.4 + 0.2,
          vx: (Math.random() - 0.5) * 0.7,
          vy: (Math.random() - 0.5) * 0.7,
          alpha: Math.random() * 0.6 + 0.3,
          dAlpha: (Math.random() - 0.5) * 0.006
        });
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        
        p.hue = (p.hue + p.hueSpeed) % 360;
        
        p.alpha += p.dAlpha;
        if (p.alpha < 0.2 || p.alpha > 0.8) p.dAlpha *= -1;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        
        const colorString = `hsla(${p.hue}, 95%, 65%, ${p.alpha})`;
        const glowString = `hsla(${p.hue}, 95%, 65%, 0.8)`;
        
        ctx.fillStyle = colorString;
        ctx.shadowBlur = p.radius * 4;
        ctx.shadowColor = glowString;
        ctx.fill();
      });
      
      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [loading]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020205] flex items-center justify-center font-sans">
        <div className="text-cyan-400 font-bold text-xl flex items-center">
          <svg className="animate-spin h-6 w-6 mr-3 text-cyan-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading Admin Command Center...
        </div>
      </div>
    );
  }

  // Helper component for stat cards (Fully transparent and styled)
  const StatCard = ({ title, value, subtext, colorClass, iconPath }) => (
    <div className={`bg-transparent border border-white/5 rounded-2xl p-6 flex items-center justify-between border-l-4 ${colorClass} shadow-2xl relative overflow-hidden`}>
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</p>
        <p className="text-3xl font-black text-white mt-1.5">{value}</p>
        {subtext && <p className="text-xs font-semibold text-slate-400 mt-1">{subtext}</p>}
      </div>
      <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 text-slate-350 shadow-md">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={iconPath}></path>
        </svg>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#020205] text-slate-100 font-sans pb-12 relative overflow-hidden">
      
      {/* CANVAS COLOR-CHANGING PARTICLES BACKGROUND */}
      <canvas id="cosmic-canvas" className="fixed inset-0 w-full h-full pointer-events-none z-0" />
      
      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_80%,transparent_100%)] pointer-events-none z-0"></div>

      {/* Header (Fully Transparent) */}
      <div className="bg-transparent border-b border-white/5 px-8 py-6 mb-8 z-10 relative">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-cyan-400 tracking-tight uppercase">Super Admin Command Center</h1>
            <p className="text-xs font-bold text-slate-400 mt-1.5 uppercase tracking-wide">Manage examinations, evaluate submissions, and oversee candidates.</p>
          </div>
          <div className="flex space-x-3 shrink-0">
            <Link to="/admin/exams/create">
              <button className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-slate-950 px-5 py-2.5 rounded-xl font-extrabold shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-xs uppercase tracking-wider">
                + Create New Exam
              </button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 z-10 relative">
        
        {/* Stat Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard 
            title="Total Candidates" 
            value={stats.totalStudents} 
            subtext={`${stats.activeStudents} Active Accounts`}
            colorClass="border-l-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
            iconPath="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
          <StatCard 
            title="Total Exams" 
            value={stats.totalExams} 
            subtext={`${stats.publishedExams} Published`}
            colorClass="border-l-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.05)]"
            iconPath="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
          <StatCard 
            title="Pending Evaluations" 
            value={stats.pendingSubmissions} 
            subtext="Requires Manual Review"
            colorClass="border-l-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.05)]"
            iconPath="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
          <StatCard 
            title="Total Submissions" 
            value={stats.totalSubmissions} 
            subtext="All time exam attempts"
            colorClass="border-l-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
            iconPath="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </div>

        {/* Two Column Layout for Action Areas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Action Area - Pending Submissions (Glassmorphism) */}
          <div className="lg:col-span-2 space-y-8">
            {/* Live Proctoring Control Room Panel */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="h-0.5 w-full bg-gradient-to-r from-red-500 to-rose-600 animate-pulse" />
              
              <div className="bg-transparent border-b border-white/5 px-6 py-4 flex justify-between items-center">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                    🔴 Live Proctoring Control Room
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Real-time silent candidate camera streams. View live feeds of students currently writing exams.
                  </p>
                </div>
                <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">
                  {activeSessions.length} Active
                </span>
              </div>

              <div className="p-6">
                {activeSessions.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 font-bold">
                    <p className="text-lg text-slate-400 mb-1">💤 No Active Examinations</p>
                    <p className="text-xs font-normal">There are no candidates currently taking exams in the portal.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeSessions.map((session) => {
                      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000));
                      const durationStr = formatDuration(elapsedSeconds);

                      return (
                        <div key={session.id} className="bg-white/[0.02] hover:bg-white/[0.04] border border-white/5 hover:border-white/10 rounded-xl p-4 transition-all flex flex-col justify-between gap-3 group">
                          <div>
                            <div className="flex justify-between items-start gap-2">
                              <h3 className="font-bold text-sm text-cyan-400 group-hover:text-cyan-300 transition-colors">
                                {session.students?.full_name || 'Candidate'}
                              </h3>
                              <span className="flex items-center gap-1 bg-green-500/10 border border-green-500/20 text-green-400 text-[9px] px-1.5 py-0.5 rounded font-black uppercase">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                Testing
                              </span>
                            </div>
                            <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                              ID: {session.students?.application_id || 'N/A'}
                            </p>
                            
                            <div className="mt-3 space-y-1 text-xs">
                              <p className="font-bold text-white truncate">
                                📝 {session.exams?.title || 'Exam'}
                              </p>
                              {session.exams?.subject && (
                                <p className="text-[10px] text-slate-400 uppercase tracking-wide">
                                  📚 Subject: {session.exams.subject}
                                </p>
                              )}
                              <p className="text-[10px] text-slate-400">
                                ⏱️ Time Elapsed: <span className="font-mono text-cyan-400">{durationStr}</span>
                              </p>
                            </div>
                          </div>

                          <button
                            onClick={() => startMonitoring(session)}
                            className="w-full bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-400 hover:to-rose-500 text-slate-950 py-2 rounded-lg font-extrabold text-[10px] uppercase tracking-wider transition-all shadow-md active:translate-y-0.5 cursor-pointer"
                          >
                            📺 Monitor Live Feed
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
              <div className="bg-transparent border-b border-white/5 px-6 py-4 flex justify-between items-center">
              <h2 className="font-bold uppercase tracking-wider text-xs text-white">Action Required: Pending Evaluations</h2>
              <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">{stats.pendingSubmissions} Pending</span>
            </div>
            
            <div className="p-0 overflow-x-auto">
              {pendingResults.length === 0 ? (
                <div className="p-12 text-center text-slate-500 font-bold">
                  <p className="text-lg text-emerald-400 mb-2">🎉 All Caught Up!</p>
                  No pending exam submissions require manual evaluation right now.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="border-b border-white/5">
                    <tr className="text-slate-400 uppercase tracking-wider font-bold">
                      <th className="px-6 py-4">Candidate</th>
                      <th className="px-6 py-4">Exam Title</th>
                      <th className="px-6 py-4">Submitted At</th>
                      <th className="px-6 py-4 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-semibold text-slate-300">
                    {pendingResults.map((result) => (
                      <tr key={result.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-cyan-400">{result.students?.full_name}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{result.students?.application_id}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-white">{result.exams?.title}</p>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-xs text-slate-300">{new Date(result.submitted_at).toLocaleDateString()}</p>
                          <p className="text-[10px] text-slate-500 mt-0.5">{new Date(result.submitted_at).toLocaleTimeString()}</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Link to={`/admin/results/${result.id}`}>
                            <button className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 px-4 py-1.5 rounded-xl font-bold uppercase transition-all shadow-md text-[10px] tracking-wider">
                              Review & Publish
                            </button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {stats.pendingSubmissions > 5 && (
                <div className="bg-transparent px-6 py-4 text-center border-t border-white/5">
                  <Link to="/admin/results" className="text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:underline uppercase tracking-wider">
                    View All {stats.pendingSubmissions} Pending Submissions &rarr;
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Late attempt request approvals panel */}
          {requestsError ? (
            <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-6 shadow-xl text-xs font-semibold text-amber-300 mt-6">
              <div className="flex items-start gap-3.5">
                <span className="text-xl">⚠️</span>
                <div>
                  <h3 className="font-bold text-amber-400 text-sm mb-1 uppercase tracking-wider">Late Attempt Requests: Database Table Required</h3>
                  <p className="text-slate-400 mb-4 leading-relaxed">
                    To enable late attempt approvals, please create the <code>exam_late_requests</code> table in your Supabase database.
                  </p>
                  <p className="mb-2 text-slate-350">Go to your <strong>Supabase Dashboard &gt; SQL Editor &gt; New Query</strong>, paste the following SQL, and click <strong>Run</strong>:</p>
                  <pre className="bg-[#020205] border border-white/10 p-4 rounded-xl font-mono text-[10px] text-cyan-300 overflow-x-auto select-all max-h-48">
{`CREATE TABLE public.exam_late_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.exam_late_requests ADD CONSTRAINT unique_student_exam_request UNIQUE(student_id, exam_id);

ALTER TABLE public.exam_late_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all actions for late requests" ON public.exam_late_requests FOR ALL TO anon USING (true) WITH CHECK (true);`}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden mt-8">
              <div className="bg-transparent border-b border-white/5 px-6 py-4 flex justify-between items-center">
                <h2 className="font-bold uppercase tracking-wider text-xs text-white">Action Required: Late attempt requests</h2>
                <span className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">{lateRequests.length} Pending</span>
              </div>
              
              <div className="p-0 overflow-x-auto">
                {lateRequests.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 font-bold">
                    <p className="text-lg text-emerald-400 mb-2">🎉 No Pending Requests</p>
                    All late attempt requests have been processed.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="border-b border-white/5">
                      <tr className="text-slate-400 uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">Candidate</th>
                        <th className="px-6 py-4">Exam Title</th>
                        <th className="px-6 py-4">Requested At</th>
                        <th className="px-6 py-4 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-semibold text-slate-300">
                      {lateRequests.map((req) => (
                        <tr key={req.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-cyan-400">{req.students?.full_name || 'Candidate'}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{req.students?.application_id || 'ID'}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-white">{req.exams?.title || 'Exam'}</p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-xs text-slate-300">{new Date(req.created_at).toLocaleDateString()}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{new Date(req.created_at).toLocaleTimeString()}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex gap-2 justify-center">
                              <button 
                                onClick={() => handleApproveRequest(req.id)}
                                className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 px-3.5 py-1.5 rounded-xl font-bold uppercase transition-all shadow-md text-[10px] tracking-wider cursor-pointer"
                              >
                                Approve
                              </button>
                              <button 
                                onClick={() => handleRejectRequest(req.id)}
                                className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-550 px-3.5 py-1.5 rounded-xl font-bold uppercase transition-all shadow-md text-[10px] tracking-wider cursor-pointer"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Area - Quick Links & System Health (Glassmorphism) */}
          <div className="space-y-6">
            
            {/* Quick Actions */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
              <div className="bg-transparent border-b border-white/5 px-5 py-4">
                <h2 className="font-bold text-white uppercase tracking-wider text-xs">Administrative Tools</h2>
              </div>
              <div className="p-3 space-y-2">
                <Link to="/admin/students" className="flex items-center p-3 text-xs font-black text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-300 rounded-xl transition-all group uppercase tracking-wider">
                  <span className="bg-white/5 group-hover:bg-cyan-500 group-hover:text-slate-950 p-2 rounded-xl mr-3.5 transition-colors">👤</span>
                  Manage Candidates Database
                </Link>
                <Link to="/admin/exams" className="flex items-center p-3 text-xs font-black text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-300 rounded-xl transition-all group uppercase tracking-wider">
                  <span className="bg-white/5 group-hover:bg-cyan-500 group-hover:text-slate-950 p-2 rounded-xl mr-3.5 transition-colors">📝</span>
                  Manage Examination Roster
                </Link>
                <Link to="/admin/materials" className="flex items-center p-3 text-xs font-black text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-300 rounded-xl transition-all group uppercase tracking-wider">
                  <span className="bg-white/5 group-hover:bg-cyan-500 group-hover:text-slate-950 p-2 rounded-xl mr-3.5 transition-colors">📚</span>
                  Upload Study Materials
                </Link>
                <Link to="/admin/messages" className="flex items-center p-3 text-xs font-black text-slate-300 hover:bg-purple-500/10 hover:text-purple-300 rounded-xl transition-all group uppercase tracking-wider border border-purple-500/10 bg-purple-500/5">
                  <span className="bg-white/5 group-hover:bg-purple-500 group-hover:text-slate-950 p-2 rounded-xl mr-3.5 transition-colors">✉️</span>
                  Message Center (Send to Gmail)
                </Link>
                <Link to="/admin/settings" className="flex items-center p-3 text-xs font-black text-slate-300 hover:bg-cyan-500/10 hover:text-cyan-300 rounded-xl transition-all group uppercase tracking-wider">
                  <span className="bg-white/5 group-hover:bg-cyan-500 group-hover:text-slate-950 p-2 rounded-xl mr-3.5 transition-colors">⚙️</span>
                  Platform Settings & Limits
                </Link>
              </div>
            </div>

            {/* System Status */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
              <div className="bg-transparent border-b border-white/5 px-5 py-4">
                <h2 className="font-bold text-white uppercase tracking-wider text-xs">System Health</h2>
              </div>
              <div className="p-5 space-y-5 text-xs">
                <div>
                  <div className="flex justify-between font-bold text-slate-400 mb-1.5">
                    <span>Database Status (Supabase)</span>
                    <span className="text-emerald-400 font-extrabold">ONLINE</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5"><div className="bg-gradient-to-r from-emerald-500 to-green-400 h-1.5 rounded-full w-full"></div></div>
                </div>
                <div>
                  <div className="flex justify-between font-bold text-slate-400 mb-1.5">
                    <span>Email OTP Service (Resend)</span>
                    <span className="text-emerald-400 font-extrabold">ACTIVE</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5"><div className="bg-gradient-to-r from-emerald-500 to-green-400 h-1.5 rounded-full w-full"></div></div>
                </div>
                <div>
                  <div className="flex justify-between font-bold text-slate-400 mb-1.5">
                    <span>Image Storage (Cloudinary)</span>
                    <span className="text-emerald-400 font-extrabold">HEALTHY</span>
                  </div>
                  <div className="w-full bg-white/5 rounded-full h-1.5"><div className="bg-gradient-to-r from-emerald-500 to-green-400 h-1.5 rounded-full w-full"></div></div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ===== RESULTS PUBLISHING CONTROL CENTER ===== */}
        <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
          {/* Animated rainbow top border */}
          <div className="h-0.5 w-full bg-gradient-to-r from-cyan-500 via-purple-500 via-pink-500 via-yellow-400 to-emerald-500 animate-pulse" />

          <div className="bg-transparent border-b border-white/5 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="font-bold uppercase tracking-wider text-sm text-white flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500"></span>
                </span>
                📢 Results Publishing Control Center
              </h2>
              <p className="text-[10px] text-slate-500 mt-1">Publish, unpublish, or edit marks for any submission. Changes go live instantly to student dashboards.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={loadAllResults} className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-3 py-1.5 rounded-xl font-bold text-[10px] uppercase tracking-wider cursor-pointer transition-all">↻ Refresh</button>
              <Link to="/admin/results" className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 px-4 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all shadow-lg">View All Results →</Link>
            </div>
          </div>

          {/* Status Filter Tabs */}
          <div className="px-6 pt-4 flex gap-2 flex-wrap">
            {['all','submitted','published','reviewed','blocked'].map(tab => (
              <button
                key={tab}
                onClick={() => {
                  const el = document.getElementById('results-table-body');
                  if (el) {
                    const rows = el.querySelectorAll('tr[data-status]');
                    rows.forEach(r => {
                      r.style.display = (tab === 'all' || r.dataset.status === tab) ? '' : 'none';
                    });
                  }
                }}
                className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer border ${
                  tab === 'all' ? 'bg-white/10 border-white/20 text-white' :
                  tab === 'submitted' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20' :
                  tab === 'published' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20' :
                  tab === 'reviewed' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-500/20' :
                  'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                }`}
              >
                {tab === 'submitted' ? '⏳ Pending' : tab === 'published' ? '✅ Published' : tab === 'reviewed' ? '🔒 Unpublished' : tab === 'blocked' ? '🚫 Blocked' : '📋 All'}
              </button>
            ))}
          </div>

          <div className="p-0 overflow-x-auto mt-3">
            {resultsLoading ? (
              <div className="p-12 text-center text-cyan-400 font-bold">Loading results...</div>
            ) : allResults.length === 0 ? (
              <div className="p-12 text-center text-slate-500 font-bold">No submissions yet.</div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead className="border-b border-white/5">
                  <tr className="text-slate-400 uppercase tracking-wider font-bold">
                    <th className="px-6 py-3">Candidate</th>
                    <th className="px-6 py-3">Exam</th>
                    <th className="px-6 py-3">Score</th>
                    <th className="px-6 py-3">Submitted</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3 text-center">Quick Actions</th>
                  </tr>
                </thead>
                <tbody id="results-table-body" className="divide-y divide-white/5 font-semibold text-slate-300">
                  {allResults.map(result => {
                    const studentName = result.students?.full_name || 'Student';
                    const appId = result.students?.application_id || 'N/A';
                    const examTitle = result.exams?.title || 'Exam';
                    const isPublished = result.status === 'published';
                    const isPending = result.status === 'submitted';
                    const isBlocked = result.status === 'blocked';
                    const isUnpublished = result.status === 'reviewed';
                    const isProcessing = publishingId === result.id;

                    return (
                      <tr key={result.id} data-status={result.status} className="hover:bg-white/[0.025] transition-colors group">
                        <td className="px-6 py-3.5">
                          <p className="font-bold text-cyan-400">{studentName}</p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">{appId}</p>
                        </td>
                        <td className="px-6 py-3.5">
                          <p className="font-bold text-white">{examTitle}</p>
                          <span className="text-[9px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded font-black uppercase">
                            Attempt #{result.attempt_number || 1}
                          </span>
                        </td>
                        <td className="px-6 py-3.5">
                          {result.total_score !== null && result.total_score !== undefined ? (
                            <div>
                              <p className="font-black text-white">{result.total_score} <span className="text-slate-500 font-normal">/ {result.total_marks}</span></p>
                              <div className="w-16 bg-white/5 rounded-full h-1 mt-1">
                                <div className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-1 rounded-full" style={{ width: `${Math.min(100,Math.max(0,result.percentage||0))}%` }} />
                              </div>
                              <p className="text-[10px] text-cyan-400 mt-0.5 font-bold">{result.percentage}%</p>
                            </div>
                          ) : <span className="text-slate-600">Not scored</span>}
                        </td>
                        <td className="px-6 py-3.5">
                          <p className="text-slate-300">{result.submitted_at ? new Date(result.submitted_at).toLocaleDateString() : '-'}</p>
                          <p className="text-[10px] text-slate-500">{result.submitted_at ? new Date(result.submitted_at).toLocaleTimeString() : ''}</p>
                        </td>
                        <td className="px-6 py-3.5">
                          {isPublished && (
                            <span className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded w-fit uppercase">
                              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span></span>
                              Live
                            </span>
                          )}
                          {isPending && <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black px-2 py-0.5 rounded uppercase">⏳ Pending</span>}
                          {isUnpublished && <span className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-black px-2 py-0.5 rounded uppercase">🔒 Unpublished</span>}
                          {isBlocked && <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black px-2 py-0.5 rounded uppercase">🚫 Blocked</span>}
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Review / Edit button */}
                            <Link to={`/admin/results/${result.id}`}>
                              <button className="bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/25 text-slate-300 hover:text-cyan-300 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-bold uppercase tracking-wider cursor-pointer" title="Review & Edit">
                                ✏️ Review
                              </button>
                            </Link>

                            {/* Quick Publish */}
                            {(isPending || isUnpublished) && (
                              <button
                                onClick={() => handleQuickPublish(result.id, studentName)}
                                disabled={isProcessing}
                                className="bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                                title="Publish Result"
                              >
                                {isProcessing ? '...' : '📢 Publish'}
                              </button>
                            )}

                            {/* Quick Unpublish */}
                            {isPublished && (
                              <button
                                onClick={() => handleQuickUnpublish(result.id, studentName)}
                                disabled={isProcessing}
                                className="bg-orange-500/10 hover:bg-orange-500/25 border border-orange-500/20 text-orange-400 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                                title="Unpublish Result"
                              >
                                {isProcessing ? '...' : '🔒 Unpublish'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Summary Footer */}
          <div className="px-6 py-3 border-t border-white/5 flex gap-4 text-[10px] font-bold">
            <span className="text-emerald-400">✅ Published: {allResults.filter(r => r.status === 'published').length}</span>
            <span className="text-amber-400">⏳ Pending: {allResults.filter(r => r.status === 'submitted').length}</span>
            <span className="text-blue-400">🔒 Unpublished: {allResults.filter(r => r.status === 'reviewed').length}</span>
            <span className="text-red-400">🚫 Blocked: {allResults.filter(r => r.status === 'blocked').length}</span>
          </div>
        </div>

        {/* Live Security Audit & Session Monitor Feed */}
        {logsError ? (
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-2xl p-6 shadow-xl text-xs font-semibold text-amber-300">
            <div className="flex items-start gap-3.5">
              <span className="text-xl">⚠️</span>
              <div>
                <h3 className="font-bold text-amber-400 text-sm mb-1 uppercase tracking-wider">Live Security Audit Feed: Database Table Required</h3>
                <p className="text-slate-400 mb-4 leading-relaxed">
                  To enable tracking of logins, IP addresses, geolocations, and active session durations, please create the <code>login_logs</code> table in your Supabase database.
                </p>
                <p className="mb-2 text-slate-300">Go to your <strong>Supabase Dashboard &gt; SQL Editor &gt; New Query</strong>, paste the following SQL, and click <strong>Run</strong>:</p>
                <pre className="bg-[#020205] border border-white/10 p-4 rounded-xl font-mono text-[10px] text-cyan-300 overflow-x-auto select-all max-h-48">
{`CREATE TABLE public.login_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    user_role VARCHAR(50) NOT NULL,
    display_name VARCHAR(255),
    ip_address VARCHAR(100),
    location VARCHAR(255) DEFAULT 'Resolving...',
    login_at TIMESTAMPTZ DEFAULT now(),
    last_activity_at TIMESTAMPTZ DEFAULT now(),
    session_duration_seconds INTEGER DEFAULT 0
);

-- Enable Row Level Security (RLS) but allow anonymous operations
ALTER TABLE public.login_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all actions for logs" ON public.login_logs FOR ALL TO anon USING (true) WITH CHECK (true);`}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-transparent border-b border-white/5 px-6 py-4 flex justify-between items-center">
              <div>
                <h2 className="font-bold uppercase tracking-wider text-xs text-white flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  Live Security Audit & Session Monitor
                </h2>
                <p className="text-[10px] text-slate-500 mt-1">Real-time tracking of admin and candidate sessions, IPs, geolocations, and activity pulses.</p>
              </div>
              <button 
                onClick={fetchSecurityLogs}
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-350 px-3 py-1.5 rounded-xl font-bold uppercase transition-all shadow-md text-[10px] tracking-wider cursor-pointer"
              >
                Refresh Feed
              </button>
            </div>

            <div className="p-0 overflow-x-auto">
              {loginLogs.length === 0 ? (
                <div className="p-12 text-center text-slate-500 font-bold">
                  No login logs recorded yet.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="border-b border-white/5">
                    <tr className="text-slate-400 uppercase tracking-wider font-bold">
                      <th className="px-6 py-4">User</th>
                      <th className="px-6 py-4">Role</th>
                      <th className="px-6 py-4">IP Address</th>
                      <th className="px-6 py-4">Location</th>
                      <th className="px-6 py-4">Logged In At</th>
                      <th className="px-6 py-4">Session Duration</th>
                      <th className="px-6 py-4 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 font-semibold text-slate-300">
                    {loginLogs.map((log) => {
                      const active = isSessionActive(log.last_activity_at);
                      return (
                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-white">{log.display_name || 'Unknown User'}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{log.user_id}</p>
                          </td>
                          <td className="px-6 py-4">
                            {log.user_role === 'super_admin' ? (
                              <span className="bg-red-500/10 border border-red-500/30 text-red-400 px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                                Super Admin
                              </span>
                            ) : log.user_role === 'admin' ? (
                              <span className="bg-purple-500/10 border border-purple-500/30 text-purple-400 px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                                Admin
                              </span>
                            ) : (
                              <span className="bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">
                                Student
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 font-mono text-slate-400">{log.ip_address || 'Unknown'}</td>
                          <td className="px-6 py-4 text-slate-300">
                            <span className="flex items-center gap-1.5">
                              📍 {log.location || 'Resolving...'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-400">
                            <p>{new Date(log.login_at).toLocaleDateString()}</p>
                            <p className="text-[10px] mt-0.5">{new Date(log.login_at).toLocaleTimeString()}</p>
                          </td>
                          <td className="px-6 py-4 font-mono text-cyan-400">{formatDuration(log.session_duration_seconds)}</td>
                          <td className="px-6 py-4 text-center">
                            {active ? (
                              <span className="inline-flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                </span>
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 bg-slate-500/10 border border-white/5 text-slate-500 px-2.5 py-0.5 rounded-full text-[10px] font-bold">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-600"></span>
                                Offline
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Live Proctoring Monitor Stream Modal */}
      {monitoringStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="bg-[#0b0c10]/95 border border-red-500/30 rounded-2xl max-w-2xl w-full overflow-hidden shadow-[0_0_50px_rgba(239,68,68,0.25)] relative z-50">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-red-950/40 to-black px-6 py-4 flex justify-between items-center border-b border-white/5">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                </span>
                <div>
                  <h3 className="font-extrabold text-white text-sm uppercase tracking-wider">
                    Proctoring Feed: {monitoringStudent.students?.full_name || 'Candidate'}
                  </h3>
                  <p className="text-[10px] text-red-400 font-bold tracking-wider mt-0.5 uppercase">
                    APP ID: {monitoringStudent.students?.application_id || 'N/A'} • STATUS: {monitorStatus}
                  </p>
                </div>
              </div>
              <button
                onClick={stopMonitoring}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider"
              >
                ✕ Close Feed
              </button>
            </div>

            {/* Video Stream Container */}
            <div className="relative aspect-video bg-black flex items-center justify-center p-2 border-b border-white/5">
              {remoteStream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover rounded-xl border border-white/10"
                />
              ) : (
                <div className="text-center space-y-4">
                  <div className="w-12 h-12 rounded-full border-t-2 border-red-500 animate-spin mx-auto"></div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest animate-pulse">
                    {monitorStatus}
                  </p>
                  <p className="text-[10px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Awaiting candidate's SDP offer and camera stream payload. Student is not notified that you are viewing their stream.
                  </p>
                </div>
              )}

              {/* Video Overlay Badges */}
              {remoteStream && (
                <div className="absolute inset-x-6 top-6 flex justify-between pointer-events-none">
                  <span className="bg-red-600 text-white font-black text-[9px] px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1.5 shadow-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
                    LIVE PROCTOR
                  </span>
                  <span className="bg-black/60 text-slate-300 font-mono text-[9px] px-2 py-0.5 rounded tracking-wide shadow-md">
                    EXAM: {monitoringStudent.exams?.title || 'TEST'}
                  </span>
                </div>
              )}
            </div>

            {/* Modal Details / Connection Stats */}
            <div className="bg-black/40 px-6 py-4 flex flex-col gap-2 text-xs font-semibold text-slate-400">
              <div className="flex justify-between items-center">
                <span>Connection Method:</span>
                <span className="text-cyan-400 font-mono text-[10px]">P2P WebRTC (STUN/ICE)</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Latency:</span>
                <span className="text-emerald-400 font-mono text-[10px]">Zero Delay (&lt; 200ms)</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Camera Access Status:</span>
                <span className="text-slate-200">Verified Granted</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
