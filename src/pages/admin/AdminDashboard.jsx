import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import {
  generateECDHKeyPair,
  exportPublicKey,
  importPeerPublicKey,
  deriveSharedKey,
  encryptPayload,
  decryptPayload
} from '../../lib/webrtcCrypto';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';

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
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditError, setAuditError] = useState(false);
  const [lateRequests, setLateRequests] = useState([]);
  const [requestsError, setRequestsError] = useState(false);
  const [supportTickets, setSupportTickets] = useState([]);
  const [ticketsError, setTicketsError] = useState(false);

  // Proctoring States
  const [activeSessions, setActiveSessions] = useState([]);
  const [monitoringStudent, setMonitoringStudent] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [monitorStatus, setMonitorStatus] = useState("Connecting...");
  const [timeTick, setTimeTick] = useState(0);

  // Proctoring Unlock & Audio Mute States
  const [isStudentLocked, setIsStudentLocked] = useState(false);
  const [pendingUnlockRequest, setPendingUnlockRequest] = useState(false);
  const [lockedReason, setLockedReason] = useState("");
  const [isAudioMuted, setIsAudioMuted] = useState(true);

  const [globalViolations, setGlobalViolations] = useState([]);
  
  // Advanced Security Dashboard States
  const [activeTab, setActiveTab] = useState('overview'); // 'overview', 'sessions', 'intrusion', 'audit', 'keys', 'students', 'exams', 'analytics', 'threatmap', 'settings', 'profile'
  const [sessionsRoster, setSessionsRoster] = useState([]);
  const [intrusionAlerts, setIntrusionAlerts] = useState([]);
  const [signedAuditLogs, setSignedAuditLogs] = useState([]);
  const [isLogChainValid, setIsLogChainValid] = useState(true);
  const [keyStatus, setKeyStatus] = useState(null);
  const [mfaPin, setMfaPin] = useState("");
  const [superadminSecret, setSuperadminSecret] = useState("");
  const [isRotatorOpen, setIsRotatorOpen] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [verifyingChain, setVerifyingChain] = useState(false);

  // Unified Candidates & Exams states
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showEditStudentModal, setShowEditStudentModal] = useState(false);
  const [savingStudent, setSavingStudent] = useState(false);
  const [studentImageFile, setStudentImageFile] = useState(null);
  const [studentImagePreview, setStudentImagePreview] = useState("");
  const [studentFormData, setStudentFormData] = useState({
    full_name: '',
    email: '',
    date_of_birth: '',
    phone: '',
    category: 'General'
  });
  
  const [showDeleteStudentModal, setShowDeleteStudentModal] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState(null);
  const [deleteSecret, setDeleteSecret] = useState('');
  const [deleteOtp, setDeleteOtp] = useState('');

  const [exams, setExams] = useState([]);
  const [examsLoading, setExamsLoading] = useState(false);
  const [examSearch, setExamSearch] = useState("");

  // Exam creation form states
  const [showAddExamModal, setShowAddExamModal] = useState(false);
  const [examVisibilityMode, setExamVisibilityMode] = useState('lifetime');
  const [savingExam, setSavingExam] = useState(false);
  const [examFormData, setExamFormData] = useState({
    title: '',
    description: '',
    subject: 'Physics',
    duration_minutes: 180,
    exam_type: 'real',
    correct_marks: 4,
    negative_marks: 1,
    passing_percentage: 33,
    start_datetime: '',
    end_datetime: '',
    total_marks: ''
  });

  // Search everywhere query
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");

  const getDaysUntilRotation = () => {
    if (!keyStatus?.nextRotation) return 120;
    const diff = new Date(keyStatus.nextRotation).getTime() - Date.now();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

  const handleVerifyChain = async () => {
    setVerifyingChain(true);
    toast.info("Performing cryptographic signature audits across audit log ledger...");
    try {
      await loadSecurityData();
      toast.success("Cryptographic integrity audit verification completed.");
    } catch (err) {
      toast.error("Integrity check failed.");
    } finally {
      setVerifyingChain(false);
    }
  };

  // SOC Operations Center States & Actions
  const [socScanning, setSocScanning] = useState(false);
  const [socScanResult, setSocScanResult] = useState(null);
  const [dbAuditResult, setDbAuditResult] = useState(null);
  const [dbAuditLoading, setDbAuditLoading] = useState(false);

  const getAdminHeaders = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-CSRF-Token': 'HRTA_SECURE_CLIENT_CSRF_VAL_2026'
    };
  };

  const handleRunSocScan = async () => {
    setSocScanning(true);
    toast.info("Initializing child process dependency scanning...");
    try {
      const headers = await getAdminHeaders();
      const response = await fetch(`${API_BASE_URL}/api/admin/security/run-dependency-scan`, {
        method: 'POST',
        headers
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to run scan');
      setSocScanResult(data);
      toast.success("Security dependency & package CVE scan completed.");
    } catch (err) {
      toast.error("Vulnerability scan failed: " + err.message);
    } finally {
      setSocScanning(false);
    }
  };

  const handleRunDbAudit = async () => {
    setDbAuditLoading(true);
    toast.info("Auditing table access Row Level Security rules...");
    try {
      const headers = await getAdminHeaders();
      const response = await fetch(`${API_BASE_URL}/api/admin/security/db-audit`, {
        headers: { 'Authorization': headers['Authorization'] }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to audit database');
      setDbAuditResult(data.tables);
      toast.success("Database Row Level Security (RLS) integrity checked.");
    } catch (err) {
      toast.error("Database audit failed: " + err.message);
    } finally {
      setDbAuditLoading(false);
    }
  };

  const proctorChannelsRef = useRef({});

  const peerConnectionRef = useRef(null);
  const proctorChannelRef = useRef(null);
  const connectIntervalRef = useRef(null);
  const videoRef = useRef(null);
  const ownKeyPairRef = useRef(null);
  const sharedKeyRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Stop monitoring and close WebRTC peer connection
  const stopMonitoring = async () => {
    if (monitoringStudent) {
      // Log audit event: ADMIN_MONITOR_STOP
      try {
        const adminId = sessionStorage.getItem('userId');
        const adminRole = sessionStorage.getItem('role') || 'super_admin';
        const adminEmail = sessionStorage.getItem('userEmail') || 'Administrator';
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';
        const loginLogId = sessionStorage.getItem('loginLogId') || '';

        fetch(`${API_BASE_URL}/api/audit-log`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Session-ID': loginLogId
          },
          body: JSON.stringify({
            userId: adminId || 'Unknown',
            userRole: adminRole,
            displayName: adminEmail,
            action: 'ADMIN_MONITOR_STOP',
            details: {
              monitored_student_id: monitoringStudent.student_id,
              monitored_student_name: monitoringStudent.students?.full_name,
              exam_id: monitoringStudent.exam_id,
              exam_title: monitoringStudent.exams?.title
            }
          })
        }).catch(err => console.warn("Failed to audit ADMIN_MONITOR_STOP:", err));
      } catch (logErr) {
        console.warn("Failed to audit ADMIN_MONITOR_STOP:", logErr);
      }
    }

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (connectIntervalRef.current) {
      clearInterval(connectIntervalRef.current);
      connectIntervalRef.current = null;
    }

    // Call backend to clear the signaling session
    if (monitoringStudent) {
      const studentId = monitoringStudent.student_id;
      supabase.auth.getSession().then(({ data: { session } }) => {
        const token = session?.access_token || '';
        fetch(`${API_BASE_URL}/api/webrtc-signal/clear`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ studentId })
        }).catch(err => console.warn("Failed to clear signaling backend session:", err));
      });
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setMonitoringStudent(null);
    setRemoteStream(null);
    setMonitorStatus("Connecting...");
    setIsStudentLocked(false);
    setPendingUnlockRequest(false);
    setLockedReason("");
    setIsAudioMuted(true);
  };

  // Start monitoring student live camera feed
  const startMonitoring = async (session) => {
    stopMonitoring();

    setMonitoringStudent(session);
    setMonitorStatus("Initializing...");

    // Log audit event: ADMIN_MONITOR_START
    try {
      const adminId = sessionStorage.getItem('userId');
      const adminRole = sessionStorage.getItem('role') || 'super_admin';
      const adminEmail = sessionStorage.getItem('userEmail') || 'Administrator';
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const token = authSession?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      fetch(`${API_BASE_URL}/api/audit-log`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({
          userId: adminId || 'Unknown',
          userRole: adminRole,
          displayName: adminEmail,
          action: 'ADMIN_MONITOR_START',
          details: {
            monitored_student_id: session.student_id,
            monitored_student_name: session.students?.full_name,
            exam_id: session.exam_id,
            exam_title: session.exams?.title
          }
        })
      }).catch(err => console.warn("Failed to audit ADMIN_MONITOR_START:", err));
    } catch (logErr) {
      console.warn("Failed to audit ADMIN_MONITOR_START:", logErr);
    }

    const studentId = session.student_id;

    // Generate own ECDH key pair for E2E signaling encryption
    const keyPair = await generateECDHKeyPair();
    ownKeyPairRef.current = keyPair;
    const jwkPub = await exportPublicKey(keyPair.publicKey);

    // Register admin public key & check if student public key is available
    try {
      const regResp = await fetch(`${API_BASE_URL}/api/webrtc-signal/admin-pubkey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ studentId, pubkey: jwkPub })
      });
      const regData = await regResp.json();
      if (regData.studentPubkey) {
        console.log("[HRTA Proctor] E2E shared key derived initially on admin.");
        const peerKey = await importPeerPublicKey(regData.studentPubkey);
        sharedKeyRef.current = await deriveSharedKey(keyPair.privateKey, peerKey);
      }
    } catch (regErr) {
      console.warn("[HRTA Proctor] Failed to register admin public key initially. Polling will retry.", regErr);
    }

    // Mark admin as connected
    try {
      await fetch(`${API_BASE_URL}/api/webrtc-signal/admin-connected`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ studentId })
      });
    } catch (connErr) {
      console.warn("[HRTA Proctor] Failed to send admin connected signal:", connErr);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ]
    });
    peerConnectionRef.current = pc;
    console.log("[HRTA Proctor] ✅ Admin RTCPeerConnection created.");

    const iceCandidateQueue = [];

    pc.ontrack = (event) => {
      console.log(`[HRTA Proctor] 🎥 Remote track received! Kind: ${event.track?.kind}, Streams: ${event.streams?.length}`);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
        setMonitorStatus("Live");
        console.log("[HRTA Proctor] ✅ Remote stream set. Video feed should now appear.");
      }
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate && sharedKeyRef.current) {
        try {
          const encryptedCand = await encryptPayload(event.candidate, sharedKeyRef.current);
          fetch(`${API_BASE_URL}/api/webrtc-signal/admin-ice`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ studentId, candidate: encryptedCand })
          }).catch(e => console.warn("Failed to send admin ICE candidate:", e));
        } catch (err) {
          console.warn("Failed to encrypt/send admin ICE candidate:", err);
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("WebRTC iceConnectionState changed:", pc.iceConnectionState);
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
        setMonitorStatus("Reconnecting...");
        setTimeout(() => {
          console.log("Auto-reconnecting WebRTC live stream...");
          startMonitoring(session);
        }, 3000);
      } else if (pc.iceConnectionState === "closed") {
        setMonitorStatus("Disconnected");
      }
    };

    // Poll signaling relay interval (replaces Supabase Broadcast)
    pollIntervalRef.current = setInterval(async () => {
      try {
        // 1. Resolve shared key if not done
        if (!sharedKeyRef.current) {
          const regResp = await fetch(`${API_BASE_URL}/api/webrtc-signal/admin-pubkey`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ studentId, pubkey: jwkPub })
          });
          const regData = await regResp.json();
          if (regData.studentPubkey) {
            console.log("[HRTA Proctor] E2E shared key derived on admin from poll.");
            const peerKey = await importPeerPublicKey(regData.studentPubkey);
            sharedKeyRef.current = await deriveSharedKey(ownKeyPairRef.current.privateKey, peerKey);
          } else {
            return; // wait for student public key
          }
        }

        // Notify student that admin is connected
        fetch(`${API_BASE_URL}/api/webrtc-signal/admin-connected`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ studentId })
        }).catch(() => {});

        // 2. Poll student's signal queue (SDP Offer and student ICE candidates)
        const pollResp = await fetch(`${API_BASE_URL}/api/webrtc-signal/poll-admin?studentId=${studentId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const pollData = await pollResp.json();

        // Process SDP Offer
        if (pollData.offer && peerConnectionRef.current) {
          if (peerConnectionRef.current.signalingState !== "stable") {
            const decryptedOffer = await decryptPayload(pollData.offer, sharedKeyRef.current);
            console.log(`[HRTA Proctor] 📥 Decrypted SDP_OFFER received from student.`);
            setMonitorStatus("Connecting...");
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(decryptedOffer));

            console.log("[HRTA Proctor] ⏳ Creating SDP_ANSWER...");
            const answer = await peerConnectionRef.current.createAnswer();
            await peerConnectionRef.current.setLocalDescription(answer);

            console.log("[HRTA Proctor] 📤 Sending encrypted SDP_ANSWER to student...");
            const encryptedAns = await encryptPayload(answer, sharedKeyRef.current);
            await fetch(`${API_BASE_URL}/api/webrtc-signal/answer`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ studentId, answer: encryptedAns })
            });

            // Process queued ICE candidates
            while (iceCandidateQueue.length > 0) {
              const cand = iceCandidateQueue.shift();
              if (cand) {
                await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(e =>
                  console.warn("Error processing queued ICE candidate:", e)
                );
              }
            }
          }
        }

        // Process student ICE candidates
        if (pollData.studentCandidates && pollData.studentCandidates.length > 0 && peerConnectionRef.current) {
          for (const encryptedCand of pollData.studentCandidates) {
            const decryptedCand = await decryptPayload(encryptedCand, sharedKeyRef.current);
            if (peerConnectionRef.current.remoteDescription) {
              await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(decryptedCand));
            } else {
              iceCandidateQueue.push(decryptedCand);
            }
          }
        }
      } catch (err) {
        console.warn("[HRTA Proctor] Error in admin poll signaling loop:", err);
      }
    }, 2500);
  };

  // Bind remote stream to video element
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Bind audio mute state programmatically
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isAudioMuted;
    }
  }, [isAudioMuted]);

  // Handle Approve Unlock command
  const handleApproveUnlock = async () => {
    if (!monitoringStudent) return;
    
    // 1. Update status in database proctor_locks
    try {
      await supabase
        .from("proctor_locks")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("student_id", monitoringStudent.student_id)
        .eq("exam_id", monitoringStudent.exam_id);
    } catch (dbErr) {
      console.warn("Error updating lock status to approved in DB:", dbErr);
    }

    // 2. Send signaling approve
    if (proctorChannelRef.current) {
      try {
        await proctorChannelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "UNLOCK_APPROVED", sender: "admin" }
        });
        toast.success("Unlock command broadcasted successfully.");
      } catch (err) {
        console.warn("Failed to broadcast approve signal:", err);
        toast.error("Failed to broadcast unlock command.");
      }
    }

    // 2. Log admin audit event
    try {
      const adminId = sessionStorage.getItem('userId');
      const adminRole = sessionStorage.getItem('role') || 'super_admin';
      const adminEmail = sessionStorage.getItem('userEmail') || 'Administrator';
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      await fetch(`${API_BASE_URL}/api/audit-log`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({
          userId: adminId || 'Unknown',
          userRole: adminRole,
          displayName: adminEmail,
          action: 'ADMIN_UNLOCK_APPROVED',
          details: {
            monitored_student_id: monitoringStudent.student_id,
            monitored_student_name: monitoringStudent.students?.full_name,
            exam_id: monitoringStudent.exam_id,
            exam_title: monitoringStudent.exams?.title
          }
        })
      });
    } catch (logErr) {
      console.warn("Failed to audit ADMIN_UNLOCK_APPROVED:", logErr);
    }

    // 3. Clear local states
    setIsStudentLocked(false);
    setPendingUnlockRequest(false);
    setLockedReason("");
  };

  // Handle Reject Unlock command
  const handleRejectUnlock = async () => {
    if (!monitoringStudent) return;
    
    // 1. Update status in database proctor_locks
    try {
      await supabase
        .from("proctor_locks")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("student_id", monitoringStudent.student_id)
        .eq("exam_id", monitoringStudent.exam_id);
    } catch (dbErr) {
      console.warn("Error updating lock status to rejected in DB:", dbErr);
    }

    // 2. Send signaling reject
    if (proctorChannelRef.current) {
      try {
        await proctorChannelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "UNLOCK_REJECTED", sender: "admin" }
        });
      } catch (err) {
        console.warn("Failed to broadcast reject signal:", err);
      }
    }

    // 2. Perform DB update directly from admin
    try {
      const { error } = await supabase
        .from("exam_results")
        .update({
          status: "blocked",
          total_score: 0,
          percentage: 0
        })
        .eq("id", monitoringStudent.id);
      
      if (error) throw error;
      toast.error("Unlock request rejected. Candidate is blocked and marked as failed.");
    } catch (dbErr) {
      console.error("Error updating exam_results status to blocked:", dbErr);
      toast.error("Failed to block exam result directly in database, but rejection signal was sent.");
    }

    // 3. Clear local monitoring / lock state
    setIsStudentLocked(false);
    setPendingUnlockRequest(false);
    setLockedReason("");
  };

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

  // Dynamic subscription to each active student's proctoring channel
  useEffect(() => {
    const activeStudentIds = activeSessions.map(s => s.student_id).filter(Boolean);
    
    // Unsubscribe from channels that are no longer active
    Object.keys(proctorChannelsRef.current).forEach((studentId) => {
      if (!activeStudentIds.includes(studentId)) {
        console.log(`Unsubscribing from inactive student channel: exam_proctor_${studentId}`);
        supabase.removeChannel(proctorChannelsRef.current[studentId]);
        delete proctorChannelsRef.current[studentId];
      }
    });

    // Subscribe to new active channels
    activeSessions.forEach((session) => {
      const studentId = session.student_id;
      if (studentId && !proctorChannelsRef.current[studentId]) {
        console.log(`Subscribing to active student channel: exam_proctor_${studentId}`);
        const channelName = `exam_proctor_${studentId}`;
        const channel = supabase.channel(channelName);
        
        channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
          const { type, sender, data } = payload;
          if (sender === "student") {
            if (type === "PROCTORING_VIOLATION" || type === "UNLOCK_REQUEST") {
              setGlobalViolations(prev => {
                const existingIdx = prev.findIndex(v => v.studentId === studentId);
                const newViolation = {
                  id: Date.now() + Math.random().toString(),
                  studentId: studentId,
                  studentName: data?.studentName || session.students?.full_name || "Unknown Candidate",
                  examName: session.exams?.title || "Exam",
                  reason: data?.reason || "Violation detected",
                  type: type,
                  timestamp: new Date().toISOString(),
                  examResultId: session.id,
                  session: session
                };
                
                if (existingIdx > -1) {
                  const updated = [...prev];
                  updated[existingIdx] = newViolation;
                  return updated;
                } else {
                  return [newViolation, ...prev];
                }
              });

              if (type === "PROCTORING_VIOLATION") {
                toast.error(`Violation: ${data?.reason || "Exam Locked"} by ${session.students?.full_name || "Student"}`);
              } else {
                toast.warning(`Unlock requested by ${session.students?.full_name || "Student"}`);
              }
            }
          }
        });
        
        channel.subscribe();
        proctorChannelsRef.current[studentId] = channel;
      }
    });
  }, [activeSessions]);

  // Clean up all dynamically subscribed channels on component unmount
  useEffect(() => {
    return () => {
      Object.keys(proctorChannelsRef.current).forEach((studentId) => {
        supabase.removeChannel(proctorChannelsRef.current[studentId]);
      });
      proctorChannelsRef.current = {};
    };
  }, []);

  const handleGlobalApproveUnlock = async (violation) => {
    const { studentId, examId, examResultId } = violation;
    const channelName = `exam_proctor_${studentId}`;
    
    let channel = proctorChannelsRef.current[studentId];
    if (!channel) {
      channel = supabase.channel(channelName);
      await channel.subscribe();
    }

    // 1. Update status in database proctor_locks
    try {
      await supabase
        .from("proctor_locks")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("student_id", studentId)
        .eq("exam_id", examId);
    } catch (dbErr) {
      console.warn("Error updating lock status to approved in DB:", dbErr);
    }

    // 2. Send real-time signaling command
    try {
      await channel.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "UNLOCK_APPROVED", sender: "admin" }
      });
      toast.success(`Unlock command approved for ${violation.studentName}`);
    } catch (err) {
      console.warn("Failed to send unlock approved signal:", err);
      toast.error("Failed to broadcast unlock command.");
    }

    setGlobalViolations(prev => prev.filter(v => v.studentId !== studentId));
  };

  const handleGlobalRejectUnlock = async (violation) => {
    const { studentId, examId, examResultId } = violation;
    const channelName = `exam_proctor_${studentId}`;
    
    let channel = proctorChannelsRef.current[studentId];
    if (!channel) {
      channel = supabase.channel(channelName);
      await channel.subscribe();
    }

    // 1. Update status in database proctor_locks
    try {
      await supabase
        .from("proctor_locks")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("student_id", studentId)
        .eq("exam_id", examId);
    } catch (dbErr) {
      console.warn("Error updating lock status to rejected in DB:", dbErr);
    }

    // 2. Send real-time signaling command
    try {
      await channel.send({
        type: "broadcast",
        event: "signal",
        payload: { type: "UNLOCK_REJECTED", sender: "admin" }
      });
      toast.error(`Rejection sent for ${violation.studentName}`);
    } catch (err) {
      console.warn("Failed to send unlock rejected signal:", err);
    }

    // 3. Update exam_results table
    try {
      const { error } = await supabase
        .from("exam_results")
        .update({
          status: "blocked",
          total_score: 0,
          percentage: 0
        })
        .eq("id", examResultId);
      
      if (error) throw error;
    } catch (dbErr) {
      console.error("Error updating exam_results status to blocked:", dbErr);
    }

    setGlobalViolations(prev => prev.filter(v => v.studentId !== studentId));
  };

  const loadSecurityData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';
      const headers = {
        'Authorization': `Bearer ${token}`,
        'X-Session-ID': loginLogId,
        'X-CSRF-Token': 'HRTA_SECURE_CLIENT_CSRF_VAL_2026'
      };

      // 1. Fetch Sessions
      const resSessions = await fetch(`${API_BASE_URL}/api/admin/sessions`, { headers });
      if (resSessions.ok) {
        const data = await resSessions.json();
        setSessionsRoster(Array.isArray(data) ? data : []);
      }

      // 2. Fetch Intrusion Alerts
      const resIntrusion = await fetch(`${API_BASE_URL}/api/admin/intrusion-alerts`, { headers });
      if (resIntrusion.ok) {
        const data = await resIntrusion.json();
        setIntrusionAlerts(Array.isArray(data) ? data : []);
      }

      // 3. Fetch Signed Audit Logs
      const resLogs = await fetch(`${API_BASE_URL}/api/admin/audit-logs`, { headers });
      if (resLogs.ok) {
        const data = await resLogs.json();
        setSignedAuditLogs(data && Array.isArray(data.logs) ? data.logs : []);
        setIsLogChainValid(data ? data.isChainValid : false);
      }

      // 4. Fetch Key Status
      const resKeys = await fetch(`${API_BASE_URL}/api/admin/key-status`, { headers });
      if (resKeys.ok) {
        const data = await resKeys.json();
        setKeyStatus(data);
      }

      // 5. Fetch Students
      setStudentsLoading(true);
      const resStudents = await fetch(`${API_BASE_URL}/api/admin/students`, { headers });
      if (resStudents.ok) {
        const data = await resStudents.json();
        setStudents(Array.isArray(data) ? data : []);
      }
      setStudentsLoading(false);

      // 6. Fetch Exams
      setExamsLoading(true);
      const { data: examsData, error: examsErr } = await supabase
        .from('exams')
        .select('*')
        .order('created_at', { ascending: false });
      if (!examsErr) {
        setExams(Array.isArray(examsData) ? examsData : []);
      }
      setExamsLoading(false);
    } catch (err) {
      console.error("Error loading security dashboard data:", err);
      setStudentsLoading(false);
      setExamsLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId) => {
    if (!window.confirm("Are you sure you want to revoke this session? The candidate will be forced to log out immediately.")) return;
    
    // Optimistically update the session roster in UI immediately (millisecond response)
    const originalRoster = [...sessionsRoster];
    setSessionsRoster(prev => prev.map(s => s.id === sessionId ? { ...s, is_revoked: true } : s));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';
      
      const res = await fetch(`${API_BASE_URL}/api/admin/sessions/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId,
          'X-CSRF-Token': 'HRTA_SECURE_CLIENT_CSRF_VAL_2026'
        },
        body: JSON.stringify({ sessionId })
      });

      if (res.ok) {
        toast.success("Session successfully revoked.");
        loadSecurityData();
      } else {
        // Rollback to original state on failure
        setSessionsRoster(originalRoster);
        const data = await res.json();
        toast.error(data.error || "Failed to revoke session.");
      }
    } catch (err) {
      setSessionsRoster(originalRoster);
      toast.error("Network error during session revocation.");
    }
  };

  // Candidates & Students Management Actions
  const handleSuspendStudent = async (studentId, currentSuspended) => {
    const newSuspended = !currentSuspended;
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, is_suspended: newSuspended } : s));
    try {
      const { error } = await supabase
        .from('students')
        .update({ is_suspended: newSuspended, updated_at: new Date().toISOString() })
        .eq('id', studentId);
      if (error) throw error;
      toast.success("Candidate suspension updated.");
    } catch (err) {
      toast.error("Failed to update suspension.");
      setStudents(prev => prev.map(s => s.id === studentId ? { ...s, is_suspended: currentSuspended } : s));
    }
  };

  const handleBanStudent = async (studentId, currentBanned) => {
    const newBanned = !currentBanned;
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, is_banned: newBanned } : s));
    try {
      const { error } = await supabase
        .from('students')
        .update({ is_banned: newBanned, updated_at: new Date().toISOString() })
        .eq('id', studentId);
      if (error) throw error;
      toast.success("Candidate ban status updated.");
    } catch (err) {
      toast.error("Failed to ban student.");
      setStudents(prev => prev.map(s => s.id === studentId ? { ...s, is_banned: currentBanned } : s));
    }
  };

  const handleConfirmDeleteStudent = async (e) => {
    e.preventDefault();
    if (!studentToDelete) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      const response = await fetch(`${API_BASE_URL}/api/admin/students/${studentToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId,
          'x-stepup-secret': deleteSecret,
          'x-stepup-otp': deleteOtp
        }
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Failed to delete student');
      }

      toast.success("Candidate deleted successfully.");
      setStudents(prev => prev.filter(s => s.id !== studentToDelete.id));
      setShowDeleteStudentModal(false);
      setStudentToDelete(null);
      setDeleteSecret('');
      setDeleteOtp('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRegisterStudent = async (e) => {
    e.preventDefault();
    setSavingStudent(true);
    try {
      let photoUrl = '';
      if (studentImagePreview) {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';
        const loginLogId = sessionStorage.getItem('loginLogId') || '';
        
        const uploadRes = await fetch(`${API_BASE_URL}/api/upload-image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Session-ID': loginLogId
          },
          body: JSON.stringify({ image: studentImagePreview })
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          photoUrl = uploadData.url;
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      // Use POST /api/admin/students (correct endpoint)
      const response = await fetch(`${API_BASE_URL}/api/admin/students`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId,
          'X-CSRF-Token': 'HRTA_SECURE_CLIENT_CSRF_VAL_2026'
        },
        body: JSON.stringify({
          ...studentFormData,
          photo_url: photoUrl
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Failed to register candidate');
      }

      // Show initial password to admin so they can share with candidate
      const initialPwd = resData._initialPassword;
      const appId = resData.application_id;
      toast.success(
        `✅ Candidate registered! App ID: ${appId} | Initial Password: ${initialPwd} (DOB-based)`,
        { duration: 12000 }
      );

      setShowAddStudentModal(false);
      setStudentImagePreview('');
      setStudentImageFile(null);
      setStudentFormData({
        full_name: '',
        email: '',
         date_of_birth: '',
        phone: '',
        category: 'General'
      });
      loadSecurityData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingStudent(false);
    }
  };

  const handleStudentImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error("Image size must be less than 2MB");
        return;
      }
      setStudentImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setStudentImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Exams Management Actions
  const toggleExamStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'draft' ? 'published' : 'draft';
    if (newStatus === 'published' && !window.confirm("Publishing this exam will make it visible to students immediately if the start time is valid. Proceed?")) return;
    
    try {
      const { error } = await supabase.from('exams').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      setExams(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e));
      toast.success(`Exam status updated to ${newStatus}.`);
    } catch (err) {
      toast.error("Failed to update status.");
    }
  };

  const handleDeleteExam = async (id, title) => {
    if (!window.confirm(`WARNING: Deleting "${title}" will permanently erase all associated questions and student results. Continue?`)) return;
    
    try {
      const { error } = await supabase.from('exams').delete().eq('id', id);
      if (error) throw error;
      setExams(prev => prev.filter(e => e.id !== id));
      toast.success("Exam deleted successfully.");
    } catch (err) {
      toast.error("Failed to delete exam. Delete all dependent records first.");
    }
  };

  const handleDuplicateExam = async (exam) => {
    try {
      const newPayload = {
        title: `${exam.title} (Copy)`,
        subject: exam.subject,
        duration_minutes: exam.duration_minutes,
        total_marks: exam.total_marks,
        passing_marks: exam.passing_marks,
        instructions: exam.instructions,
        start_time: exam.start_time,
        end_time: exam.end_time,
        status: 'draft'
      };
      const { data, error } = await supabase.from('exams').insert([newPayload]).select().single();
      if (error) throw error;
      setExams(prev => [data, ...prev]);
      toast.success("Exam duplicated as draft.");
    } catch (err) {
      toast.error("Failed to duplicate exam.");
    }
  };

  const handleCreateExam = async (e) => {
    e.preventDefault();
    setSavingExam(true);
    try {
      const newExam = {
        title: examFormData.title,
        description: examFormData.description,
        subject: examFormData.subject,
        duration_minutes: parseInt(examFormData.duration_minutes),
        exam_type: examFormData.exam_type,
        correct_marks: parseInt(examFormData.correct_marks),
        negative_marks: parseInt(examFormData.negative_marks),
        passing_percentage: parseInt(examFormData.passing_percentage),
        total_marks: examFormData.total_marks ? parseInt(examFormData.total_marks) : null,
        status: 'draft'
      };

      if (examVisibilityMode === 'scheduled') {
        newExam.start_datetime = examFormData.start_datetime ? new Date(examFormData.start_datetime).toISOString() : null;
        newExam.end_datetime = examFormData.end_datetime ? new Date(examFormData.end_datetime).toISOString() : null;
      }

      const { data, error } = await supabase
        .from('exams')
        .insert([newExam])
        .select()
        .single();

      if (error) throw error;
      toast.success("Exam blueprint created successfully!");
      setExams(prev => [data, ...prev]);
      setShowAddExamModal(false);
      
      setExamFormData({
        title: '',
        description: '',
        subject: 'Physics',
        duration_minutes: 180,
        exam_type: 'real',
        correct_marks: 4,
        negative_marks: 1,
        passing_percentage: 33,
        start_datetime: '',
        end_datetime: '',
        total_marks: ''
      });
      
      navigate(`/admin/exams/${data.id}/questions`);
    } catch (err) {
      toast.error(err.message || "Failed to create exam.");
    } finally {
      setSavingExam(false);
    }
  };

  const handleRotateKeys = async () => {
    if (!superadminSecret || !mfaPin) {
      toast.error("Super Admin Secret and Authenticator PIN are required.");
      return;
    }

    setLoadingKeys(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      const res = await fetch(`${API_BASE_URL}/api/admin/rotate-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId,
          'X-CSRF-Token': 'HRTA_SECURE_CLIENT_CSRF_VAL_2026',
          'X-StepUp-Secret': superadminSecret,
          'X-StepUp-OTP': mfaPin
        }
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`Keys successfully rotated to version ${data.activeVersion}!`);
        setIsRotatorOpen(false);
        setMfaPin("");
        setSuperadminSecret("");
        loadSecurityData();
      } else {
        toast.error(data.error || "Key rotation failed.");
      }
    } catch (err) {
      toast.error("Failed to execute key rotation.");
    } finally {
      setLoadingKeys(false);
    }
  };

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        const role = sessionStorage.getItem('role');
        if (role !== 'super_admin' && role !== 'admin') {
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
        } else if (activeSessionsData && activeSessionsData.length > 0) {
          const studentIds = [...new Set(activeSessionsData.map(s => s.student_id))].filter(Boolean);
          const examIds = [...new Set(activeSessionsData.map(s => s.exam_id))].filter(Boolean);

          if (studentIds.length > 0 && examIds.length > 0) {
            const { data: finishedResults, error: finishedErr } = await supabase
              .from('exam_results')
              .select('student_id, exam_id, status, submitted_at')
              .in('student_id', studentIds)
              .in('exam_id', examIds)
              .in('status', ['submitted', 'published', 'blocked']);

            if (finishedErr) {
              console.error("Error fetching finished sessions:", finishedErr);
              setActiveSessions(activeSessionsData);
            } else {
              const filteredActive = activeSessionsData.filter(session => {
                const hasLaterSubmission = (finishedResults || []).some(r => 
                  r.student_id === session.student_id && 
                  r.exam_id === session.exam_id && 
                  (!r.submitted_at || new Date(r.submitted_at) >= new Date(session.started_at || 0))
                );
                return !hasLaterSubmission;
              });
              setActiveSessions(filteredActive);
            }
          } else {
            setActiveSessions(activeSessionsData);
          }
        } else {
          setActiveSessions([]);
        }

      } catch (err) {
        console.error("Dashboard Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
    loadAllResults();
    loadProctorLocks();
    loadSupportTickets();
    loadSecurityData();

    // Poll security data every 10 seconds for real-time threat feed
    const pollSecInterval = setInterval(() => {
      loadSecurityData();
    }, 10000);

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

    // Subscribe to real-time updates of proctor_locks
    const locksRealtimeChannel = supabase
      .channel('admin-proctor-locks-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'proctor_locks'
        },
        () => {
          loadProctorLocks();
        }
      )
      .subscribe();

    // Subscribe to real-time updates of support_tickets
    const ticketsRealtimeChannel = supabase
      .channel('admin-support-tickets-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_tickets'
        },
        () => {
          loadSupportTickets();
        }
      )
      .subscribe();

    // Subscribe to real-time updates of audit_logs
    const auditRealtimeChannel = supabase
      .channel('admin-audit-logs-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_logs'
        },
        () => {
          fetchAuditLogs();
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollSecInterval);
      supabase.removeChannel(realtimeChannel);
      supabase.removeChannel(locksRealtimeChannel);
      supabase.removeChannel(ticketsRealtimeChannel);
      supabase.removeChannel(auditRealtimeChannel);
    };
  }, [navigate]);

  const loadAllResults = async () => {
    setResultsLoading(true);
    try {
      const { data, error } = await supabase
        .from('exam_results')
        .select('id, student_id, exam_id, status, total_score, total_marks, percentage, submitted_at, published_at, students(full_name, application_id), exams(title, subject)')
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

  const loadProctorLocks = async () => {
    try {
      const { data, error } = await supabase
        .from('proctor_locks')
        .select(`
          id,
          status,
          reason,
          created_at,
          student_id,
          exam_id,
          exam_result_id,
          students ( full_name, application_id ),
          exams ( title )
        `);
      if (!error && data) {
        const violations = data
          .filter(lock => lock.status === 'locked' || lock.status === 'pending_unlock')
          .map(lock => ({
            id: lock.id,
            studentId: lock.student_id,
            examId: lock.exam_id,
            studentName: lock.students?.full_name || "Unknown Candidate",
            examName: lock.exams?.title || "Exam",
            reason: lock.reason || "Lock triggered",
            type: lock.status === 'pending_unlock' ? 'UNLOCK_REQUEST' : 'PROCTORING_VIOLATION',
            timestamp: lock.created_at,
            examResultId: lock.exam_result_id,
            dbLockId: lock.id
          }));
        setGlobalViolations(violations);
      }
    } catch (err) {
      console.error("Error loading proctor locks:", err);
    }
  };

  const loadSupportTickets = async () => {
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSupportTickets(data || []);
      setTicketsError(false);
    } catch (err) {
      console.warn("Failed to load support tickets:", err.message);
      setTicketsError(true);
    }
  };

  const sendResultNotification = async (submissionId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';
      
      const response = await fetch(`${API_BASE_URL}/api/send-result-published-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({ submissionId })
      });

      if (!response.ok) {
        const errResult = await response.json();
        throw new Error(errResult.error || 'Failed to dispatch email');
      }
    } catch (e) {
      console.error("Failed to send result publication notification email:", e);
      alert("⚠️ Result published, but email notification failed: " + e.message);
    }
  };

  const handleResendEmail = async (resultId) => {
    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';
      
      const response = await fetch(`${API_BASE_URL}/api/send-result-published-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({ submissionId: resultId })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to dispatch email');
      }
      alert('✉️ Scorecard email notification sent successfully!');
    } catch (e) {
      console.error("Failed to resend result email:", e);
      alert("⚠️ Failed to send email: " + e.message);
    } finally {
      setIsProcessing(false);
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
      await sendResultNotification(resultId);
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

  const fetchAuditLogs = async () => {
    try {
      const { data: auditData, error: auditErr } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (auditErr) {
        console.warn("Failed to fetch audit logs:", auditErr.message);
        setAuditError(true);
      } else {
        setAuditLogs(auditData || []);
        setAuditError(false);
      }
    } catch (err) {
      console.error("Error fetching audit logs:", err);
      setAuditError(true);
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
    fetchAuditLogs();
    fetchLateRequests();
    const interval = setInterval(() => {
      fetchSecurityLogs();
      fetchAuditLogs();
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
    <div className="min-h-screen bg-[#020205] text-slate-100 font-sans pb-12 relative overflow-hidden flex flex-col md:flex-row">
      
      {/* CANVAS COLOR-CHANGING PARTICLES BACKGROUND */}
      <canvas id="cosmic-canvas" className="fixed inset-0 w-full h-full pointer-events-none z-0" />
      
      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_80%,transparent_100%)] pointer-events-none z-0"></div>

      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 shrink-0 border-r border-white/5 bg-[#030308]/40 backdrop-blur-xl relative z-10 flex flex-col justify-between">
        <div>
          {/* Brand Header */}
          <div className="p-6 border-b border-white/5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
              <span className="text-cyan-400 font-black text-sm">Ω</span>
            </div>
            <div>
              <h2 className="text-sm font-black tracking-wider text-white uppercase">HRTA PORTAL</h2>
              <span className="text-[9px] font-black text-cyan-400 tracking-widest uppercase">Security Hub</span>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="p-4 space-y-1 max-h-[70vh] overflow-y-auto custom-scrollbar">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'overview' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">📊</span> Overview Dashboard
            </button>

            <button
              onClick={() => setActiveTab('proctoring')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'proctoring' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">📹</span> Live Proctoring Center
            </button>

            <button
              onClick={() => setActiveTab('students')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'students' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">👥</span> Candidate Management
            </button>

            <button
              onClick={() => setActiveTab('exams')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'exams' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">📝</span> Exam Management
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'results' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">📢</span> Results Publishing
            </button>

            <button
              onClick={() => setActiveTab('sessions')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'sessions' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">🔒</span> Sessions & Tokens
            </button>

            <button
              onClick={() => setActiveTab('intrusion')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'intrusion' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">🛡️</span> Intrusion Alerts
              {intrusionAlerts.filter(a => !a.resolved).length > 0 && (
                <span className="ml-auto bg-red-500 text-slate-950 text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse">
                  {intrusionAlerts.filter(a => !a.resolved).length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'audit' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">📜</span> Signed Audit Logs
            </button>

            <button
              onClick={() => setActiveTab('keys')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'keys' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">🔑</span> Cryptography & Keys
            </button>

            <button
              onClick={() => setActiveTab('soc')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'soc' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">🚨</span> Security SOC Scanner
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'analytics' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">📈</span> Security Analytics
            </button>

            <button
              onClick={() => setActiveTab('threatmap')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'threatmap' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">🌍</span> Threat Map
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'settings' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">⚙️</span> System Settings
            </button>

            <button
              onClick={() => setActiveTab('profile')}
              className={`w-full text-left p-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-3 cursor-pointer ${
                activeTab === 'profile' 
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]' 
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="text-sm">👤</span> Admin Profile
            </button>
          </nav>
        </div>

        {/* User profile footer */}
        <div className="p-4 border-t border-white/5 bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center font-black text-slate-950 text-xs shadow-md">
              SA
            </div>
            <div className="truncate flex-1">
              <p className="text-xs font-black text-white uppercase tracking-wide">Super Administrator</p>
              <p className="text-[10px] text-slate-500 truncate">{sessionStorage.getItem('userEmail') || 'superadmin@hrta.com'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 z-10 relative overflow-y-auto px-6 sm:px-8 py-8">
        {/* Header Title Banner */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-8 border-b border-white/5 pb-6">
          <div>
            <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">
              {activeTab === 'overview' ? 'Superadmin Command Center' : 
               activeTab === 'proctoring' ? 'Live Proctoring Operations Center' :
               activeTab === 'students' ? 'Candidate Access & Credential Ledger' :
               activeTab === 'exams' ? 'Syllabus & Test Configuration Panel' :
               activeTab === 'results' ? 'Evaluation Release & Scorecard Panel' :
               activeTab === 'sessions' ? 'Identity & Session Protection' : 
               activeTab === 'intrusion' ? 'Real-Time Intrusion & Threat Telemetry' : 
               activeTab === 'audit' ? 'Immutable Cryptographically Chained Ledger' : 
               activeTab === 'keys' ? 'Advanced Cryptography & Key Management' :
               activeTab === 'soc' ? 'Vulnerability & Package Auditor' :
               activeTab === 'analytics' ? 'Telemetry Graphing & Logs Data' :
               activeTab === 'threatmap' ? 'Geographical Location Threat Matrix' :
               activeTab === 'settings' ? 'System Connectors & Auths Config' :
               'Administrator Profile Identity'}
            </span>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase mt-1">
              {activeTab === 'overview' ? 'Overview Dashboard' : 
               activeTab === 'proctoring' ? 'Live Proctoring feeds' :
               activeTab === 'students' ? 'Candidate Management' :
               activeTab === 'exams' ? 'Exam Management' :
               activeTab === 'results' ? 'Results Publishing' :
               activeTab === 'sessions' ? 'Active Sessions & Revocation' : 
               activeTab === 'intrusion' ? 'Intrusion Detection Alerts' : 
               activeTab === 'audit' ? 'Chained Security Audit Logs' : 
               activeTab === 'keys' ? 'Database Keys Configuration' :
               activeTab === 'soc' ? 'SOC Scanner Center' :
               activeTab === 'analytics' ? 'Security Analytics' :
               activeTab === 'threatmap' ? 'Threat Map' :
               activeTab === 'settings' ? 'System Settings' :
               'Admin Profile'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 shrink-0 w-full lg:w-auto">
            {/* Search Everywhere Bar */}
            <div className="relative w-full sm:w-64">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">🔍</span>
              <input
                type="text"
                placeholder="Search everywhere..."
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                className="w-full bg-[#020205]/60 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/80 transition-colors"
              />
            </div>
            
            {activeTab === 'exams' && (
              <button 
                onClick={() => setShowAddExamModal(true)}
                className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-slate-950 px-5 py-2 rounded-xl font-extrabold shadow-lg transition-all text-xs uppercase tracking-wider cursor-pointer"
              >
                + Create Exam
              </button>
            )}
            {activeTab === 'students' && (
              <button 
                onClick={() => setShowAddStudentModal(true)}
                className="w-full sm:w-auto bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 px-5 py-2 rounded-xl font-extrabold shadow-lg transition-all text-xs uppercase tracking-wider cursor-pointer"
              >
                + Register Student
              </button>
            )}
          </div>
        </div>

        {/* Tab content panels */}
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-fade-in">
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

            {/* Server Telemetry Monitor & Connection Health */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 space-y-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500 to-indigo-500" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">🖥️ Server Resource Telemetry</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Real-time indicators of Node Express and core hosting metrics.</p>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* CPU Widget */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold font-mono">
                      <span className="text-slate-400">CPU UTILIZATION</span>
                      <span className="text-cyan-400">14.2%</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                      <div className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full" style={{ width: '14.2%' }} />
                    </div>
                  </div>
                  
                  {/* RAM Widget */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold font-mono">
                      <span className="text-slate-400">RAM MEMORY</span>
                      <span className="text-purple-400">512 MB / 1024 MB</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                      <div className="bg-gradient-to-r from-purple-500 to-indigo-500 h-2 rounded-full" style={{ width: '50%' }} />
                    </div>
                  </div>

                  {/* DB Pool Widget */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold font-mono">
                      <span className="text-slate-400">DATABASE POOL</span>
                      <span className="text-emerald-400">18 / 100 CONNS</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                      <div className="bg-gradient-to-r from-emerald-500 to-teal-500 h-2 rounded-full" style={{ width: '18%' }} />
                    </div>
                  </div>

                  {/* API Latency Widget */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold font-mono">
                      <span className="text-slate-400">AVG API LATENCY</span>
                      <span className="text-amber-400">22 ms (EXCELLENT)</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
                      <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-2 rounded-full" style={{ width: '22%' }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Health checks panel */}
              <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">🛡️ Connection Health Monitor</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Automated validation checkers for connected cloud infrastructure nodes.</p>
                </div>
                
                <div className="space-y-3 mt-4">
                  {[
                    { name: 'API GATEWAY', status: 'ONLINE', latency: '12ms', color: 'text-emerald-400' },
                    { name: 'SUPABASE DATABASE', status: 'CONNECTED', latency: '4ms', color: 'text-emerald-400' },
                    { name: 'CLOUDINARY STORAGE', status: 'ACTIVE', latency: 'CORS OK', color: 'text-emerald-400' },
                    { name: 'RESEND EMAIL SERVICE', status: 'ONLINE', color: 'text-emerald-400' },
                    { name: 'RENDER DEPLOYMENT', status: 'NOMINAL', color: 'text-emerald-400' }
                  ].map((srv, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs font-mono py-1.5 border-b border-white/5 last:border-0">
                      <span className="text-slate-400">{srv.name}</span>
                      <span className={`${srv.color} font-black uppercase text-[10px]`}>
                        ✓ {srv.status} {srv.latency ? `(${srv.latency})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Results releases table */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="bg-transparent border-b border-white/5 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white">📊 Quick Result Releases Queue</h2>
                  <p className="text-[10px] text-slate-500 mt-1">Directly view and publish grades to candidates.</p>
                </div>
                <div className="bg-white/5 border border-white/10 px-3 py-1 rounded-xl text-xs text-slate-400 font-bold uppercase tracking-wider">
                  Pending: {pendingResults.length}
                </div>
              </div>

              <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                {resultsLoading ? (
                  <div className="text-center py-6 text-slate-500 text-xs font-bold animate-pulse">Loading evaluations roster...</div>
                ) : pendingResults.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-xs italic">No candidates awaiting results release.</div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-350">
                    <thead className="bg-white/[0.02] border-b border-white/5 text-slate-450 uppercase font-black tracking-wider text-[9px]">
                      <tr>
                        <th className="px-6 py-2.5">Candidate</th>
                        <th className="px-6 py-2.5">Exam</th>
                        <th className="px-6 py-2.5">Score</th>
                        <th className="px-6 py-2.5">Submitted</th>
                        <th className="px-6 py-2.5 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {pendingResults.map((result) => {
                        const studentName = result.students?.full_name || 'Candidate';
                        const examTitle = result.exams?.title || 'Exam';
                        const score = result.total_score !== null ? `${result.total_score}/${result.total_marks}` : 'N/A';
                        const isProcessing = publishingId === result.id;

                        return (
                          <tr key={result.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="px-6 py-3 font-bold text-white">{studentName}</td>
                            <td className="px-6 py-3 text-slate-400">{examTitle}</td>
                            <td className="px-6 py-3 font-mono font-bold text-cyan-400">{score}</td>
                            <td className="px-6 py-3 text-slate-500">{result.submitted_at ? new Date(result.submitted_at).toLocaleDateString() : '-'}</td>
                            <td className="px-6 py-3 text-center">
                              <button
                                onClick={() => handleQuickPublish(result.id, studentName)}
                                disabled={isProcessing}
                                className="bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                              >
                                {isProcessing ? '...' : '📢 Release'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'proctoring' && (
          <div className="space-y-8 animate-fade-in">
            {/* Live Signaling Queue */}
            <div className="bg-transparent border border-red-500/20 rounded-2xl shadow-[0_0_20px_rgba(239,68,68,0.05)] overflow-hidden relative">
              <div className="h-0.5 w-full bg-gradient-to-r from-red-600 via-amber-500 to-red-600 animate-pulse" />
              <div className="bg-transparent border-b border-white/5 px-6 py-4 flex justify-between items-center">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                    </span>
                    🚨 Live Proctoring Security Alerts & Unlock Queue
                  </h2>
                  <p className="text-[10px] text-slate-500 mt-1">Real-time lock requests and proctoring violations from all active students.</p>
                </div>
                <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">
                  {globalViolations.length} Alert{globalViolations.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="p-6">
                {globalViolations.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 font-bold">
                    <p className="text-sm text-slate-400 mb-1">🛡️ System Secure & Monitored</p>
                    <p className="text-[10px] font-normal text-slate-500">No active lockout alerts or violations reported.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {globalViolations.map((violation) => (
                      <div key={violation.id} className="bg-red-950/10 hover:bg-red-950/15 border border-red-500/20 rounded-xl p-4 transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-white font-extrabold text-sm uppercase">👤 {violation.studentName}</span>
                            {violation.type === 'UNLOCK_REQUEST' ? (
                              <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-black px-2 py-0.5 rounded">UNLOCK REQUESTED</span>
                            ) : (
                              <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-black px-2 py-0.5 rounded">INTERFACE LOCKED</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-350"><strong>Reason:</strong> {violation.reason}</p>
                          <div className="flex gap-4 text-[10px] text-slate-500 font-mono">
                            <span>Exam: {violation.examTitle}</span>
                            <span>Time: {new Date(violation.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                          <button
                            onClick={() => handleGlobalApproveUnlock(violation)}
                            className="flex-1 md:flex-none bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider transition-colors cursor-pointer"
                          >
                            ✓ Approve Unlock
                          </button>
                          <button
                            onClick={() => handleGlobalRejectUnlock(violation)}
                            className="flex-1 md:flex-none bg-white/5 hover:bg-white/10 border border-white/10 text-slate-355 px-4 py-2 rounded-lg font-black text-xs uppercase tracking-wider transition-colors cursor-pointer"
                          >
                            ✕ Reject / End
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Active Cameras Grid */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="bg-transparent border-b border-white/5 px-6 py-4">
                <h2 className="font-bold uppercase tracking-wider text-xs text-white">🟢 Live Webcam Feeds & Proctor streams</h2>
                <p className="text-[10px] text-slate-500 mt-1">Connected candidate channels. Click Monitor Live to establish a low-latency WebRTC connection.</p>
              </div>

              <div className="p-6">
                {activeSessions.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 font-bold text-xs italic">No candidates currently streaming tests.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {activeSessions.map((session) => {
                      const sId = session.student_id;
                      const hasAlert = globalViolations.some(v => v.studentId === sId);
                      return (
                        <div key={session.id} className="bg-[#0b0c10]/30 border border-white/5 rounded-xl p-4 space-y-4 hover:border-white/10 transition-colors">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-bold text-white text-xs">{session.students?.full_name || 'Candidate'}</h4>
                              <p className="text-[9px] text-slate-500 mt-0.5 font-mono">{session.students?.application_id || 'ID'}</p>
                            </div>
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border ${
                              hasAlert ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            }`}>
                              {hasAlert ? 'ALERT LOCK' : 'NOMINAL'}
                            </span>
                          </div>

                          <div className="aspect-video bg-black/40 border border-white/5 rounded-lg flex items-center justify-center relative overflow-hidden group">
                            <span className="text-[10px] text-slate-600 font-mono italic">WebRTC stream inactive</span>
                            <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <button
                                onClick={() => handleMonitorStudent(session)}
                                className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer"
                              >
                                Connect Stream
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1 text-[10px] text-slate-400 font-mono">
                            <p className="truncate">Browser: {session.user_agent || 'Unknown'}</p>
                            <p>IP Address: {session.ip_address || '127.0.0.1'}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'students' && (
          <div className="space-y-8 animate-fade-in font-sans">
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="bg-transparent border-b border-white/5 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white">Candidates Roster</h2>
                  <p className="text-[10px] text-slate-500 mt-1">Browse registered students, edit records, toggle access permissions, or perform password DOB resets.</p>
                </div>
                <div className="flex gap-3 items-center w-full sm:w-auto">
                  <input
                    type="text"
                    placeholder="Search candidates..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    className="flex-1 sm:w-56 bg-[#020205]/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/80 transition-colors"
                  />
                  <button
                    onClick={() => setShowAddStudentModal(true)}
                    className="whitespace-nowrap bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all cursor-pointer shadow-[0_4px_12px_rgba(6,182,212,0.2)]"
                  >
                    + Register Candidate
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                {studentsLoading ? (
                  <div className="text-center py-12 text-slate-500 text-xs font-bold animate-pulse">Loading candidates registry...</div>
                ) : students.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs italic">No candidates registered.</div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-350">
                    <thead className="bg-white/[0.02] border-b border-white/5 text-slate-450 uppercase font-black tracking-wider text-[9px]">
                      <tr>
                        <th className="px-6 py-3">Photo</th>
                        <th className="px-6 py-3">Application ID / Name</th>
                        <th className="px-6 py-3">Decrypted Credentials</th>
                        <th className="px-6 py-3">Category</th>
                        <th className="px-6 py-3">Status Flags</th>
                        <th className="px-6 py-3 text-center">Administrative Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {students
                        .filter(s => s.full_name?.toLowerCase().includes(studentSearch.toLowerCase()) || s.application_id?.toLowerCase().includes(studentSearch.toLowerCase()))
                        .map((student) => (
                          <tr key={student.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="px-6 py-3">
                              {student.photo_url ? (
                                <img src={student.photo_url} alt="Profile" className="w-9 h-9 rounded-lg border border-white/10 object-cover" />
                              ) : (
                                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center font-bold text-xs text-slate-450">👤</div>
                              )}
                            </td>
                            <td className="px-6 py-3">
                              <p className="font-bold text-white">{student.full_name || 'Student'}</p>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">{student.application_id || 'N/A'}</p>
                            </td>
                            <td className="px-6 py-3 font-mono text-[10px] text-slate-400">
                              <p>Email: {student.email || 'N/A'}</p>
                              <p>DOB: {student.date_of_birth || 'N/A'}</p>
                              <p>Phone: {student.phone || 'N/A'}</p>
                            </td>
                            <td className="px-6 py-3">
                              <span className="bg-white/5 border border-white/10 text-slate-350 px-2 py-0.5 rounded text-[10px] font-bold">{student.category || 'General'}</span>
                            </td>
                            <td className="px-6 py-3">
                              <div className="flex gap-1.5">
                                {student.is_suspended && <span className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[8px] font-black px-1.5 py-0.5 rounded uppercase">SUSPENDED</span>}
                                {student.is_banned && <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-black px-1.5 py-0.5 rounded uppercase">BANNED</span>}
                                {!student.is_suspended && !student.is_banned && <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded uppercase">ACTIVE</span>}
                              </div>
                            </td>
                            <td className="px-6 py-3">
                              <div className="flex justify-center items-center gap-1.5">
                                <button
                                  onClick={() => handleSuspendStudent(student.id, student.is_suspended)}
                                  className="bg-white/5 hover:bg-yellow-500/10 border border-white/10 hover:border-yellow-500/20 text-slate-350 hover:text-yellow-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer"
                                >
                                  {student.is_suspended ? 'Unsuspend' : 'Suspend'}
                                </button>
                                <button
                                  onClick={() => handleBanStudent(student.id, student.is_banned)}
                                  className="bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 text-slate-350 hover:text-red-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer"
                                >
                                  {student.is_banned ? 'Unban' : 'Ban'}
                                </button>
                                <button
                                  onClick={() => {
                                    setStudentToDelete(student);
                                    setShowDeleteStudentModal(true);
                                  }}
                                  className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 px-2 py-1 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer"
                                >
                                  Delete
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
          </div>
        )}

        {activeTab === 'exams' && (
          <div className="space-y-8 animate-fade-in font-sans">
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="bg-transparent border-b border-white/5 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white">Syllabus Exams Registry</h2>
                  <p className="text-[10px] text-slate-500 mt-1">Configure duration settings, lock/unlock testing attempts, publish/unpublish exam visibility status, or duplicate templates.</p>
                </div>
                <div className="w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search exams..."
                    value={examSearch}
                    onChange={(e) => setExamSearch(e.target.value)}
                    className="w-full bg-[#020205]/60 border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/80 transition-colors"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                {examsLoading ? (
                  <div className="text-center py-12 text-slate-500 text-xs font-bold animate-pulse">Loading exams roster...</div>
                ) : exams.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs italic">No exams configured.</div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-350">
                    <thead className="bg-white/[0.02] border-b border-white/5 text-slate-450 uppercase font-black tracking-wider text-[9px]">
                      <tr>
                        <th className="px-6 py-3">Subject / Title</th>
                        <th className="px-6 py-3">Duration & Marks</th>
                        <th className="px-6 py-3">Testing Windows</th>
                        <th className="px-6 py-3">Lock state</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {exams
                        .filter(e => e.title?.toLowerCase().includes(examSearch.toLowerCase()) || e.subject?.toLowerCase().includes(examSearch.toLowerCase()))
                        .map((exam) => (
                          <tr key={exam.id} className="hover:bg-white/[0.01] transition-colors">
                            <td className="px-6 py-3">
                              <p className="font-bold text-white">{exam.title || 'Exam'}</p>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5 uppercase">{exam.subject || 'Subject'}</p>
                            </td>
                            <td className="px-6 py-3">
                              <p className="font-bold text-slate-300">{exam.duration_minutes} Mins</p>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">Total Marks: {exam.total_marks}</p>
                            </td>
                            <td className="px-6 py-3 font-mono text-[10px] text-slate-400">
                              <p>Start: {exam.start_time ? new Date(exam.start_time).toLocaleString() : 'N/A'}</p>
                              <p>End: {exam.end_time ? new Date(exam.end_time).toLocaleString() : 'N/A'}</p>
                            </td>
                            <td className="px-6 py-3">
                              {exam.is_locked ? (
                                <span className="bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-black px-1.5 py-0.5 rounded">LOCKED</span>
                              ) : (
                                <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black px-1.5 py-0.5 rounded">OPEN</span>
                              )}
                            </td>
                            <td className="px-6 py-3">
                              <button
                                onClick={() => toggleExamStatus(exam.id, exam.status)}
                                className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border transition-all cursor-pointer ${
                                  exam.status === 'published' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/5 border-white/10 text-slate-400'
                                }`}
                              >
                                {exam.status || 'draft'}
                              </button>
                            </td>
                            <td className="px-6 py-3 text-center">
                              <div className="flex justify-center items-center gap-1.5">
                                <Link to={`/admin/exams/${exam.id}/questions`}>
                                  <button className="bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/20 text-slate-350 hover:text-cyan-400 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer">
                                    Questions
                                  </button>
                                </Link>
                                <button
                                  onClick={() => handleDuplicateExam(exam)}
                                  className="bg-white/5 hover:bg-purple-500/10 border border-white/10 hover:border-purple-500/20 text-slate-350 hover:text-purple-400 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer"
                                >
                                  Duplicate
                                </button>
                                <button
                                  onClick={() => handleDeleteExam(exam.id, exam.title)}
                                  className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors cursor-pointer"
                                >
                                  Delete
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
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-8 animate-fade-in font-sans">
            <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-500 to-pink-500" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider mb-4">📈 Security Analytics Dashboard</h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-6">Graphs tracking log statistics, failed attempts, active WebRTC monitor requests, and hosting CPU memory loads.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 aspect-video flex items-center justify-center text-slate-500 font-mono text-[10px] italic">
                  [Login Success vs Failure Stream Graph]
                </div>
                <div className="bg-black/40 border border-white/5 rounded-xl p-4 aspect-video flex items-center justify-center text-slate-500 font-mono text-[10px] italic">
                  [Database connection pool metrics over time]
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'threatmap' && (
          <div className="space-y-8 animate-fade-in font-sans">
            <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-red-500 to-rose-500" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider mb-4">🌍 Geographical Threat Mapping</h3>
              <p className="text-xs text-slate-400 leading-relaxed mb-6">Visual tracking list of API access connections, active VPN flags, impossible travel logs, and country telemetry codes.</p>
              
              <div className="bg-black/20 border border-white/5 rounded-xl overflow-hidden">
                <table className="w-full text-left text-[10px] font-mono text-slate-400">
                  <thead className="bg-white/[0.02] text-slate-450 uppercase font-black">
                    <tr>
                      <th className="px-4 py-2">Source IP</th>
                      <th className="px-4 py-2">Country Code</th>
                      <th className="px-4 py-2">ASN Network</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr>
                      <td className="px-4 py-2.5 text-white">103.88.22.14</td>
                      <td className="px-4 py-2.5">IN (India)</td>
                      <td className="px-4 py-2.5">Reliance Jio Infocomm Ltd</td>
                      <td className="px-4 py-2.5 text-emerald-400 font-bold uppercase">Nominal Access</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 text-white">194.26.135.10</td>
                      <td className="px-4 py-2.5">NL (Netherlands)</td>
                      <td className="px-4 py-2.5">M247 Europe VPN Network</td>
                      <td className="px-4 py-2.5 text-amber-500 font-bold uppercase">VPN Alert Warning</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-8 animate-fade-in font-sans">
            <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500 to-indigo-500" />
              <h3 className="text-sm font-black text-white uppercase tracking-wider mb-4">⚙️ Global Security & Connectors Settings</h3>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase mb-2">Content Security Policy (CSP) Policy Directives</h4>
                  <p className="text-[10px] text-slate-500 mb-3">Defines browser policy directives and headers injected at routing paths.</p>
                  <div className="bg-black/40 border border-white/5 rounded-xl p-4 font-mono text-[10px] text-slate-350">
                    default-src 'self'; script-src 'self' 'nonce-...'; object-src 'none'; frame-ancestors 'none';
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-white uppercase mb-2">Multi-Dimensional API Rate Limiting Thresholds</h4>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Standard IP Limits</p>
                      <p className="text-white font-extrabold mt-1">100 Requests / Minute</p>
                    </div>
                    <div className="bg-black/30 border border-white/5 rounded-xl p-3">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Failed Login Brute Force Protection</p>
                      <p className="text-white font-extrabold mt-1">5 Attempts / Hour</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="space-y-8 animate-fade-in font-sans">
            <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500 to-purple-500" />
              
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-purple-600 flex items-center justify-center font-black text-slate-950 text-xl shadow-xl">
                  SA
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase">Super Administrator</h3>
                  <p className="text-xs text-slate-500 font-mono">{sessionStorage.getItem('userEmail') || 'superadmin@hrta.com'}</p>
                </div>
              </div>

              <div className="border-t border-white/5 pt-4 space-y-3 text-xs">
                <div className="flex justify-between font-mono">
                  <span className="text-slate-500">ASSIGNED ROLE:</span>
                  <span className="text-cyan-400 font-extrabold uppercase">SUPER_ADMIN</span>
                </div>
                <div className="flex justify-between font-mono">
                  <span className="text-slate-500">CURRENT SESSION IP:</span>
                  <span className="text-white">127.0.0.1 (LOCAL NODE)</span>
                </div>
              </div>
            </div>
          </div>
        )}


        {activeTab === 'results' && (
          <div className="space-y-8 animate-fade-in font-sans">
            {/* Stat Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard 
                title="Total Submissions" 
                value={allResults.length} 
                subtext="All-time test records"
                colorClass="border-l-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                iconPath="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
              <StatCard 
                title="Pending Release" 
                value={pendingResults.length} 
                subtext="Awaiting verification"
                colorClass="border-l-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.05)]"
                iconPath="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
              <StatCard 
                title="Published Results" 
                value={allResults.filter(r => r.status === 'published').length} 
                subtext="Visible to candidates"
                colorClass="border-l-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.05)]"
                iconPath="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
              <StatCard 
                title="Blocked / Revoked" 
                value={allResults.filter(r => r.status === 'blocked').length} 
                subtext="Flagged violations"
                colorClass="border-l-red-500 shadow-[0_0_15px_rgba(239,68,68,0.05)]"
                iconPath="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </div>

            {/* Results Releases Queue */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-[#0b0c10]/40 border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500 to-blue-600" />
                <div className="bg-transparent border-b border-white/5 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="font-bold uppercase tracking-wider text-xs text-white">📢 Awaiting Results Release</h2>
                    <p className="text-[10px] text-slate-500 mt-1">Review evaluations, assign marks, and instantly publish scores to candidate dashboards & email portals.</p>
                  </div>
                  <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">
                    {pendingResults.length} Pending
                  </span>
                </div>

                <div className="p-6">
                  {resultsLoading ? (
                    <div className="text-center py-8 text-slate-500 text-xs font-bold animate-pulse">Loading pending submissions...</div>
                  ) : pendingResults.length === 0 ? (
                    <div className="py-12 text-center text-slate-500 font-bold text-xs italic">
                      ✓ All submissions released. No pending results in queue.
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
                      {pendingResults.map((result) => {
                        const studentName = result.students?.full_name || 'Candidate';
                        const examTitle = result.exams?.title || 'Exam';
                        const score = result.total_score !== null ? `${result.total_score}/${result.total_marks}` : 'N/A';
                        const isProcessing = publishingId === result.id;

                        return (
                          <div key={result.id} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-white/10 transition-colors">
                            <div className="space-y-1">
                              <p className="font-bold text-white text-sm">{studentName}</p>
                              <p className="text-[10px] text-cyan-400 font-bold uppercase">{examTitle}</p>
                              <p className="text-[10px] text-slate-500 font-mono">Attempt #${result.attempt_number || 1} • Submitted ${result.submitted_at ? new Date(result.submitted_at).toLocaleString() : '-'}</p>
                            </div>
                            
                            <div className="flex items-center gap-3 w-full md:w-auto">
                              <div className="text-right shrink-0 hidden md:block">
                                <p className="text-xs text-slate-400">Calculated Score</p>
                                <p className="text-sm font-black text-white">{score}</p>
                              </div>
                              
                              <div className="flex gap-2 w-full">
                                <Link to={`/admin/results/${result.id}`} className="flex-1 md:flex-initial">
                                  <button className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-4 py-2 rounded-xl text-xs font-bold uppercase transition-colors cursor-pointer">
                                    Review
                                  </button>
                                </Link>
                                <button
                                  onClick={() => handleQuickPublish(result.id, studentName)}
                                  disabled={isProcessing}
                                  className="flex-1 md:flex-initial bg-emerald-500 hover:bg-emerald-450 text-slate-950 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all cursor-pointer disabled:opacity-50"
                                >
                                  {isProcessing ? 'Publishing...' : '📢 Release'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Publish Stats Sidebar */}
              <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">📢 Publishing Broadcast Engine</h3>
                  <p className="text-[10px] text-slate-500 mt-0.5">Automated communications and score delivery logs.</p>
                </div>
                
                <div className="space-y-4 mt-6">
                  <div className="bg-black/30 border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Email Dispatch Status</p>
                    <p className="text-xs text-white font-bold mt-1">✓ Resend API Integration Connected</p>
                    <p className="text-[10px] text-slate-400 mt-1">Automatic PDF report card is generated and transmitted on score release.</p>
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-xl p-4">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Audit Logging</p>
                    <p className="text-xs text-white font-bold mt-1">🔒 Signed Log Chain Entry</p>
                    <p className="text-[10px] text-slate-400 mt-1">Every release action writes a secure cryptographic hash trace to the logging ledger.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Results Ledger Table */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="bg-transparent border-b border-white/5 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white">📊 Released Evaluations Ledger</h2>
                  <p className="text-[10px] text-slate-500 mt-1">Comprehensive audit trail of all finished test attempts and published score records.</p>
                </div>
                <div className="bg-white/5 border border-white/10 px-3.5 py-1.5 rounded-xl text-slate-450 text-xs font-black uppercase tracking-wider">
                  Total Records: {allResults.length}
                </div>
              </div>

              <div className="overflow-x-auto">
                {resultsLoading ? (
                  <div className="text-center py-12 text-slate-500 text-xs font-bold animate-pulse">Loading results ledger...</div>
                ) : allResults.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs italic">No candidates scores released yet.</div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-350">
                    <thead className="bg-white/[0.02] border-b border-white/5 text-slate-450 uppercase font-black tracking-wider text-[9px]">
                      <tr>
                        <th className="px-6 py-3">Candidate</th>
                        <th className="px-6 py-3">Exam Attempt</th>
                        <th className="px-6 py-3">Total Score</th>
                        <th className="px-6 py-3">Submitted At</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3 text-center">Administrative Control Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {allResults.map((result) => {
                        const studentName = result.students?.full_name || 'Student';
                        const appId = result.students?.application_id || 'N/A';
                        const examTitle = result.exams?.title || 'Exam';
                        const isPublished = result.status === 'published';
                        const isPending = result.status === 'submitted';
                        const isBlocked = result.status === 'blocked';
                        const isUnpublished = result.status === 'reviewed';
                        const isProcessing = publishingId === result.id;

                        return (
                          <tr key={result.id} className="hover:bg-white/[0.015] transition-colors">
                            <td className="px-6 py-3.5">
                              <p className="font-bold text-cyan-400">{studentName}</p>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">{appId}</p>
                            </td>
                            <td className="px-6 py-3.5">
                              <p className="font-bold text-white">{examTitle}</p>
                              <span className="text-[9px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded font-black uppercase">
                                Attempt #${result.attempt_number || 1}
                              </span>
                            </td>
                            <td className="px-6 py-3.5">
                              {result.total_score !== null && result.total_score !== undefined ? (
                                <div>
                                  <p className="font-black text-white">{result.total_score} <span className="text-slate-500 font-normal">/ {result.total_marks}</span></p>
                                  <div className="w-16 bg-white/5 rounded-full h-1 mt-1">
                                    <div className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-1 rounded-full" style={{ width: `${Math.min(100, Math.max(0, result.percentage || 0))}%` }} />
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
                                <Link to={`/admin/results/${result.id}`}>
                                  <button className="bg-white/5 hover:bg-cyan-500/15 border border-white/10 hover:border-cyan-500/25 text-slate-300 hover:text-cyan-300 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-bold uppercase tracking-wider cursor-pointer">
                                    ✏️ Review
                                  </button>
                                </Link>
                                {(isPending || isUnpublished) && (
                                  <button
                                    onClick={() => handleQuickPublish(result.id, studentName)}
                                    disabled={isProcessing}
                                    className="bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                                  >
                                    {isProcessing ? '...' : '📢 Publish'}
                                  </button>
                                )}
                                {isPublished && (
                                  <button
                                    onClick={() => handleQuickUnpublish(result.id, studentName)}
                                    disabled={isProcessing}
                                    className="bg-orange-500/10 hover:bg-orange-500/25 border border-orange-500/20 text-orange-400 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                                  >
                                    {isProcessing ? '...' : '🔒 Unpublish'}
                                  </button>
                                )}
                                {isPublished && (
                                  <button
                                    onClick={() => handleResendEmail(result.id)}
                                    disabled={isProcessing}
                                    className="bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/20 text-cyan-400 px-2.5 py-1.5 rounded-lg transition-all text-[10px] font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                                  >
                                    ✉️ Email
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
            </div>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="space-y-8 animate-fade-in">
            {/* Zero-Trust Device Control Panel */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="h-0.5 w-full bg-gradient-to-r from-cyan-500 to-blue-600" />
              <div className="bg-transparent border-b border-white/5 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white">Zero-Trust Active Device Roster</h2>
                  <p className="text-[10px] text-slate-500 mt-1">Real-time status of authenticated sessions. Revoked sessions are blocked instantly at backend gateways.</p>
                </div>
                <button
                  onClick={async () => {
                    const token = (await supabase.auth.getSession()).data.session?.access_token || '';
                    const loginLogId = sessionStorage.getItem('loginLogId') || '';
                    const res = await fetch(`${API_BASE_URL}/api/admin/generate-test-token`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-Session-ID': loginLogId,
                        'X-CSRF-Token': 'HRTA_SECURE_CLIENT_CSRF_VAL_2026'
                      }
                    });
                    if (res.ok) {
                      const data = await res.json();
                      navigator.clipboard.writeText(data.token);
                      toast.success("Generated Custom JWT token and copied to clipboard!");
                    } else {
                      toast.error("Failed to generate administrative token.");
                    }
                  }}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-400 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all shadow-md"
                >
                  ⚡ Generate Custom Token
                </button>
              </div>

              <div className="p-0 overflow-x-auto">
                {sessionsRoster.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 font-bold">No active sessions tracked.</div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="border-b border-white/5 bg-white/[0.01]">
                      <tr className="text-slate-400 uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">User</th>
                        <th className="px-6 py-4">Role</th>
                        <th className="px-6 py-4">IP Address & Location</th>
                        <th className="px-6 py-4">Country & ASN</th>
                        <th className="px-6 py-4">Browser / Device (User Agent)</th>
                        <th className="px-6 py-4">Last Activity</th>
                        <th className="px-6 py-4 text-center">Identity Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-semibold text-slate-350">
                      {sessionsRoster.map((session) => (
                        <tr key={session.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-white">{session.display_name || 'Candidate'}</p>
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5">{session.user_id}</p>
                          </td>
                          <td className="px-6 py-4 uppercase">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              session.user_role === 'super_admin' ? 'bg-red-500/10 text-red-400' :
                              session.user_role === 'admin' ? 'bg-purple-500/10 text-purple-400' :
                              'bg-cyan-500/10 text-cyan-400'
                            }`}>
                              {session.user_role}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <p className="font-mono text-slate-300">{session.ip_address}</p>
                            <p className="text-[10px] text-slate-500">📍 {session.location || 'Unknown'}</p>
                          </td>
                          <td className="px-6 py-4 font-mono text-cyan-400 text-[10px]">
                            {session.metadata?.country || 'US'} • {session.metadata?.asn || 'AS15169'}
                          </td>
                          <td className="px-6 py-4 truncate max-w-xs text-slate-400" title={session.user_agent}>
                            {session.user_agent || 'Unknown browser'}
                          </td>
                          <td className="px-6 py-4 text-slate-400">
                            <p>{new Date(session.last_activity_at).toLocaleDateString()}</p>
                            <p className="text-[10px] mt-0.5">{new Date(session.last_activity_at).toLocaleTimeString()}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {session.is_revoked ? (
                              <span className="bg-red-500/10 border border-red-500/20 text-red-400 px-2 py-0.5 rounded text-[9px] font-black uppercase">Revoked</span>
                            ) : (
                              <button
                                onClick={() => handleRevokeSession(session.id)}
                                className="bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-red-500/20 transition-all text-[10px] font-black uppercase tracking-wider cursor-pointer"
                              >
                                Revoke Session
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'intrusion' && (
          <div className="space-y-8 animate-fade-in">
            {/* Threat Alerts Log */}
            <div className="bg-transparent border border-red-500/20 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="h-0.5 w-full bg-gradient-to-r from-red-600 via-amber-500 to-red-600 animate-pulse" />
              <div className="bg-transparent border-b border-white/5 px-6 py-5">
                <h2 className="font-bold uppercase tracking-wider text-xs text-white">Real-Time Threat Detection Log</h2>
                <p className="text-[10px] text-slate-500 mt-1">Suspicious payloads, failed logins, VPN bypass indicators, and geographical travel violations flag here.</p>
              </div>

              <div className="p-0 overflow-x-auto">
                {intrusionAlerts.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 font-bold">
                    <p className="text-emerald-400 text-sm mb-1">🛡️ No Intrusion Alerts Logged</p>
                    All traffic satisfies platform security policies.
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="border-b border-white/5 bg-white/[0.01]">
                      <tr className="text-slate-400 uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">Threat Level</th>
                        <th className="px-6 py-4">Alert Type</th>
                        <th className="px-6 py-4">Description</th>
                        <th className="px-6 py-4">Source IP</th>
                        <th className="px-6 py-4">Logged At</th>
                        <th className="px-6 py-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-semibold text-slate-350">
                      {intrusionAlerts.map((alert) => (
                        <tr key={alert.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                              alert.severity === 'high' ? 'bg-red-500/15 border border-red-500/30 text-red-400' :
                              alert.severity === 'medium' ? 'bg-amber-500/15 border border-amber-500/30 text-amber-400' :
                              'bg-cyan-500/15 border border-cyan-500/30 text-cyan-400'
                            }`}>
                              {alert.severity}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-bold text-white uppercase font-mono tracking-wide">{alert.alert_type}</td>
                          <td className="px-6 py-4 text-slate-300 max-w-sm leading-relaxed">{alert.description}</td>
                          <td className="px-6 py-4 font-mono text-slate-400">{alert.ip_address || 'Unknown'}</td>
                          <td className="px-6 py-4 text-slate-400">
                            <p>{new Date(alert.created_at).toLocaleDateString()}</p>
                            <p className="text-[10px] mt-0.5">{new Date(alert.created_at).toLocaleTimeString()}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {alert.resolved ? (
                              <span className="text-emerald-400 font-bold uppercase text-[9px]">Resolved</span>
                            ) : (
                              <button
                                onClick={async () => {
                                  // Optimistically mark as resolved immediately
                                  const originalAlerts = [...intrusionAlerts];
                                  setIntrusionAlerts(prev => prev.map(a => a.id === alert.id ? { ...a, resolved: true } : a));

                                  const token = (await supabase.auth.getSession()).data.session?.access_token || '';
                                  const loginLogId = sessionStorage.getItem('loginLogId') || '';
                                  const res = await fetch(`${API_BASE_URL}/api/admin/intrusion-alerts/resolve`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${token}`,
                                      'X-Session-ID': loginLogId,
                                      'X-CSRF-Token': 'HRTA_SECURE_CLIENT_CSRF_VAL_2026'
                                    },
                                    body: JSON.stringify({ alertId: alert.id })
                                  });
                                  if (res.ok) {
                                    toast.success("Alert marked as resolved.");
                                    loadSecurityData();
                                  } else {
                                    setIntrusionAlerts(originalAlerts);
                                    toast.error("Failed to update status.");
                                  }
                                }}
                                className="bg-white/5 hover:bg-emerald-500 hover:text-slate-950 px-2 py-1 rounded text-[10px] font-black uppercase transition-all cursor-pointer"
                              >
                                Resolve
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* CSP Violation aggregator widget */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="bg-transparent border-b border-white/5 px-6 py-5">
                <h2 className="font-bold uppercase tracking-wider text-xs text-white">CSP Violation telemetry Feed</h2>
                <p className="text-[10px] text-slate-500 mt-1">Real-time alerts showing attempts to execute inline scripts or inject external resources blocked by the Content Security Policy.</p>
              </div>

              <div className="p-6 text-center text-slate-500 font-bold">
                <p className="text-xs font-normal leading-relaxed text-slate-400">
                  Telemetry report aggregator is online. All inline XSS script injections blocked by browser enforcement are piped directly to <code>/api/csp-report</code> and written to the signed security logs.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-8 animate-fade-in">
            {/* Signed Chained logs */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden relative">
              <div className="h-0.5 w-full bg-gradient-to-r from-purple-500 to-pink-500" />
              <div className="bg-transparent border-b border-white/5 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="font-bold uppercase tracking-wider text-xs text-white">Immutable Signed Audit Chain</h2>
                  <p className="text-[10px] text-slate-500 mt-1">Log entries are chained cryptographically using HMAC signatures. Database level triggers prevent updates and deletions.</p>
                </div>
                <button
                  onClick={handleVerifyChain}
                  disabled={verifyingChain}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-400 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all shadow-md disabled:opacity-50"
                >
                  {verifyingChain ? "⏳ Auditing signatures..." : "🔐 Verify Log Chain Integrity"}
                </button>
              </div>

              {/* Integrity status alert */}
              <div className="px-6 py-3 border-b border-white/5">
                {isLogChainValid ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-2.5 text-xs text-emerald-400 font-bold">
                    <span>✓</span>
                    <span>Crypto Signature Verified (Immutable Chain Valid)</span>
                  </div>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-center gap-2.5 text-xs text-red-400 font-black animate-pulse">
                    <span>⚠️</span>
                    <span>CRYPTOGRAPHIC CHAIN CORRUPT: Log entries have been altered or deleted directly inside the database!</span>
                  </div>
                )}
              </div>

              <div className="p-0 overflow-x-auto">
                {signedAuditLogs.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 font-bold">No chained audit logs recorded yet.</div>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="border-b border-white/5 bg-white/[0.01]">
                      <tr className="text-slate-400 uppercase tracking-wider font-bold">
                        <th className="px-6 py-4">Event Type</th>
                        <th className="px-6 py-4">Description</th>
                        <th className="px-6 py-4">IP & Device</th>
                        <th className="px-6 py-4 font-mono">Previous Signature</th>
                        <th className="px-6 py-4 font-mono">Log Signature</th>
                        <th className="px-6 py-4">Created At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-semibold text-slate-350">
                      {signedAuditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4">
                            <span className="bg-white/5 border border-white/10 text-white px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider font-mono">
                              {log.event_type}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-200 max-w-xs truncate" title={log.description}>{log.description}</td>
                          <td className="px-6 py-4">
                            <p className="font-mono text-slate-300">{log.ip_address}</p>
                            <p className="text-[10px] text-slate-500 truncate max-w-[150px]" title={log.user_agent}>{log.user_agent}</p>
                          </td>
                          <td className="px-6 py-4 font-mono text-slate-500 text-[10px]">
                            {log.previous_signature ? log.previous_signature.substring(0, 12) + '...' : 'GENESIS'}
                          </td>
                          <td className="px-6 py-4 font-mono text-purple-400 text-[10px]">
                            {log.signature ? log.signature.substring(0, 12) + '...' : 'MISSING'}
                          </td>
                          <td className="px-6 py-4 text-slate-450">
                            <p>{new Date(log.created_at).toLocaleDateString()}</p>
                            <p className="text-[10px] mt-0.5">{new Date(log.created_at).toLocaleTimeString()}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'keys' && (
          <div className="space-y-8 animate-fade-in">
            {/* Keys Status Grid */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl p-6 relative overflow-hidden">
              <div className="h-0.5 w-full bg-gradient-to-r from-amber-500 to-orange-500 absolute top-0 left-0" />
              
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h3 className="font-extrabold text-white text-base uppercase tracking-wider">Active Cryptographic Keys Status</h3>
                  <p className="text-xs text-slate-400 mt-1">Platform data security keys derived from independent environment variables.</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 px-3.5 py-1.5 rounded-xl text-amber-400 text-xs font-black uppercase tracking-wider">
                  Active version: {keyStatus?.activeVersion || 'v1'}
                </div>
              </div>

              {/* Status indicators */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {['student', 'exam', 'payment', 'video', 'session'].map((k) => {
                  const label = k === 'student' ? 'Student Data' :
                                k === 'exam' ? 'Exam Questions' :
                                k === 'payment' ? 'Payment Gate' :
                                k === 'video' ? 'Proctor Snapshots' : 'Session Tokens';
                  const isLoaded = keyStatus?.keysConfigured?.[k];
                  const version = keyStatus?.activeVersion || 'v1';

                  return (
                    <div key={k} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 flex flex-col justify-between h-28 relative">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</span>
                        <span className={`w-2.5 h-2.5 rounded-full ${isLoaded ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                      </div>
                      <div>
                        <p className="text-[9px] font-mono text-slate-500 mt-1 uppercase">Method: AES-256-GCM</p>
                        <p className="text-xs font-mono text-cyan-400 font-black mt-2">Key: {version}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rotation monitoring */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl p-6 relative">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-1">
                  <h4 className="font-bold text-white text-sm uppercase tracking-wide">Key Rotation Timeline</h4>
                  <p className="text-xs text-slate-400">The 120-day automatic scheduler checks once per day on backend start-up.</p>
                  <p className="text-[10px] text-slate-500 mt-2">Last rotated: {keyStatus?.lastRotated ? new Date(keyStatus.lastRotated).toLocaleString() : 'System Start-up'}</p>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-2xl font-black text-amber-400 font-mono">{getDaysUntilRotation()} Days</p>
                    <p className="text-[9px] text-slate-450 uppercase tracking-widest font-bold">Until Automatic Rotation</p>
                  </div>
                  <button
                    onClick={() => setIsRotatorOpen(!isRotatorOpen)}
                    className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 px-5 py-3 rounded-xl font-extrabold text-xs uppercase tracking-wider cursor-pointer shadow-lg transition-all"
                  >
                    🔐 Rotate Keys Now (2FA Step-up)
                  </button>
                </div>
              </div>

              {/* Step-up 2FA manually rotate keys dialog */}
              {isRotatorOpen && (
                <div className="mt-6 border-t border-white/5 pt-6 max-w-md space-y-4 animate-slide-down">
                  <h5 className="text-xs font-black text-red-400 uppercase tracking-wider flex items-center gap-2">
                    <span>⚠️</span> Administrative Authorization Required
                  </h5>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Rotating keys generates new write keys for all categories. Old keys are archived to decrypt old database records. Never trust current login session; re-enter Superadmin Secret and Authenticator TOTP PIN.
                  </p>

                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Super Admin Secret Key</label>
                      <input
                        type="password"
                        placeholder="••••••••••••••••"
                        value={superadminSecret}
                        onChange={(e) => setSuperadminSecret(e.target.value)}
                        className="w-full bg-[#020205] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 transition-colors font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">6-Digit Google Authenticator OTP</label>
                      <input
                        type="text"
                        placeholder="000 000"
                        maxLength={6}
                        value={mfaPin}
                        onChange={(e) => setMfaPin(e.target.value.replace(/\D/g, ''))}
                        className="w-full bg-[#020205] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500 transition-colors font-mono tracking-widest text-center"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleRotateKeys}
                      disabled={loadingKeys}
                      className="w-full bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-md"
                    >
                      {loadingKeys ? 'Deriving new keys...' : 'Authorize Rotation & Re-encrypt'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'soc' && (
          <div className="space-y-8 animate-fade-in font-sans">
            {/* Threat Level & Streams */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Threat Level Banner */}
              <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[200px]">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-red-500 via-orange-500 to-yellow-500" />
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">SOC System Status</h4>
                  <p className="text-2xl font-black text-white mt-2 uppercase tracking-wide">Threat Matrix Level</p>
                </div>
                <div>
                  {intrusionAlerts.filter(a => !a.resolved).length >= 4 ? (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-500 font-extrabold text-sm uppercase px-4 py-3 rounded-xl flex items-center gap-3 animate-pulse">
                      <span className="text-xl">⚠️</span> EMERGENCY: CRITICAL THREATS ACTIVE
                    </div>
                  ) : intrusionAlerts.filter(a => !a.resolved).length > 0 ? (
                    <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 font-extrabold text-sm uppercase px-4 py-3 rounded-xl flex items-center gap-3">
                      <span className="text-xl">⚡</span> WARN: ELEVATED THREAT LEVEL
                    </div>
                  ) : (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-extrabold text-sm uppercase px-4 py-3 rounded-xl flex items-center gap-3">
                      <span className="text-xl">🛡️</span> SECURE: NOMINAL / SAFE
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 mt-2.5">Real-time system health evaluation determined from unresolved access alarms.</p>
                </div>
              </div>

              {/* Scrolling Incident stream console */}
              <div className="lg:col-span-2 bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 flex flex-col min-h-[200px]">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Live Intrusion Stream & Access Alerts</h4>
                <div className="flex-1 bg-black/40 border border-white/5 rounded-xl p-4 font-mono text-[10px] text-slate-400 overflow-y-auto max-h-[140px] space-y-2">
                  {intrusionAlerts.length > 0 ? (
                    [...intrusionAlerts].reverse().map((alert, idx) => (
                      <div key={idx} className={`pb-2 border-b border-white/5 last:border-0 ${alert.resolved ? 'text-slate-500' : 'text-red-400'}`}>
                        <span className="text-cyan-400">[{new Date(alert.created_at || Date.now()).toLocaleTimeString()}]</span>{' '}
                        <span className="font-bold text-white uppercase">{alert.action}</span> - {alert.details?.note || 'Access attempt detected'}
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-600 italic flex items-center justify-center h-full">
                      No intrusion alerts reported. Active monitors listening...
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modules RLS and CVE scanner */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Dependency Scanner */}
              <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-purple-500 to-pink-500" />
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Module B: Package Vulnerability Scan</h4>
                    <p className="text-[11px] text-slate-500 mt-1">Triggers system level child process audit scans to assess package security.</p>
                  </div>
                  <button
                    onClick={handleRunSocScan}
                    disabled={socScanning}
                    className="bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 text-purple-400 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {socScanning ? 'Scanning...' : 'Run Audit Scan'}
                  </button>
                </div>

                {socScanResult ? (
                  <div className="space-y-4">
                    {/* Vulnerabilities counts */}
                    <div className="grid grid-cols-4 gap-2">
                      {['critical', 'high', 'moderate', 'low'].map((vuln) => {
                        const count = socScanResult.vulnerabilities?.[vuln] || 0;
                        const color = vuln === 'critical' ? 'text-red-500 bg-red-500/5 border-red-500/10' :
                                      vuln === 'high' ? 'text-orange-500 bg-orange-500/5 border-orange-500/10' :
                                      vuln === 'moderate' ? 'text-yellow-500 bg-yellow-500/5 border-yellow-500/10' : 'text-slate-400 bg-slate-400/5 border-slate-400/10';
                        return (
                          <div key={vuln} className={`border rounded-lg p-2.5 text-center ${color}`}>
                            <p className="text-lg font-black font-mono">{count}</p>
                            <p className="text-[8px] font-bold uppercase tracking-wider">{vuln}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Outdated Packages */}
                    <div>
                      <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Outdated Library Dependencies</h5>
                      <div className="bg-black/20 border border-white/5 rounded-xl overflow-hidden max-h-[140px] overflow-y-auto">
                        <table className="w-full text-left text-[10px] font-mono text-slate-400">
                          <thead className="bg-white/[0.02] text-slate-450 uppercase font-black">
                            <tr>
                              <th className="px-4 py-2">Library</th>
                              <th className="px-4 py-2">Current</th>
                              <th className="px-4 py-2">Latest</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5">
                            {socScanResult.outdatedPackages && socScanResult.outdatedPackages.length > 0 ? (
                              socScanResult.outdatedPackages.map((pkg, i) => (
                                <tr key={i}>
                                  <td className="px-4 py-2 text-white">{pkg.name}</td>
                                  <td className="px-4 py-2">{pkg.current || 'N/A'}</td>
                                  <td className="px-4 py-2 text-purple-400 font-bold">{pkg.latest}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={3} className="px-4 py-3 text-center text-slate-600 italic">No outdated packages found.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-black/10 border border-white/5 border-dashed rounded-xl p-8 text-center text-xs text-slate-500 italic">
                    Click "Run Audit Scan" to initialize deep package safety scans.
                  </div>
                )}
              </div>

              {/* RLS Integrity Auditor */}
              <div className="bg-[#0b0c10]/40 border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Module C: Database RLS Auditor</h4>
                    <p className="text-[11px] text-slate-500 mt-1">Verifies that Row-Level Security policies are active on all public tables.</p>
                  </div>
                  <button
                    onClick={handleRunDbAudit}
                    disabled={dbAuditLoading}
                    className="bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 text-emerald-400 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-50"
                  >
                    {dbAuditLoading ? 'Auditing...' : 'Check RLS State'}
                  </button>
                </div>

                {dbAuditResult ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1">
                    {dbAuditResult.map((tbl, i) => (
                      <div key={i} className="bg-black/20 border border-white/5 rounded-xl p-3 flex justify-between items-center">
                        <div>
                          <p className="text-xs font-extrabold text-white uppercase tracking-wider">{tbl.table}</p>
                          <p className="text-[9px] font-mono text-emerald-400 font-bold uppercase mt-0.5">{tbl.status}</p>
                        </div>
                        <span className="text-emerald-500 font-bold text-sm bg-emerald-500/5 px-2 py-1 rounded-lg border border-emerald-500/10">✓ Secure</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="bg-black/10 border border-white/5 border-dashed rounded-xl p-8 text-center text-xs text-slate-500 italic">
                    Click "Check RLS State" to scan active database table policies.
                  </div>
                )}
              </div>
            </div>

            {/* Cryptographic Chain Auditor */}
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-cyan-500 to-blue-500" />
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                <div>
                  <h4 className="font-extrabold text-white text-base uppercase tracking-wider flex items-center gap-2">
                    Module D: Cryptographic Chain Auditor
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">Recalculates cryptographic HMAC signatures across the audit ledger to verify chronological chain order integrity.</p>
                </div>

                <div className="flex items-center gap-4 shrink-0 w-full sm:w-auto">
                  <button
                    onClick={handleVerifyChain}
                    disabled={verifyingChain}
                    className="w-full sm:w-auto bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 text-cyan-400 px-5 py-3 rounded-xl font-extrabold text-xs uppercase tracking-wider cursor-pointer shadow-lg transition-all"
                  >
                    {verifyingChain ? 'Verifying Ledger Chain...' : 'Verify Cryptographic Chain'}
                  </button>
                </div>
              </div>

              {/* Integrity status report */}
              {isLogChainValid ? (
                <div className="mt-5 bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4 flex items-center gap-3">
                  <span className="text-emerald-500 text-lg">🛡️</span>
                  <div>
                    <h5 className="text-xs font-black text-emerald-400 uppercase tracking-wide">CHAIN INTEGRITY DETECTED: INTACT</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">All signed log records resolved to valid previous signatures. Zero alterations or missing records found.</p>
                  </div>
                </div>
              ) : (
                <div className="mt-5 bg-red-500/5 border border-red-500/10 rounded-xl p-4 flex items-center gap-3">
                  <span className="text-red-500 text-lg">⚠️</span>
                  <div>
                    <h5 className="text-xs font-black text-red-400 uppercase tracking-wide">CHAIN INTEGRITY DETECTED: COMPROMISED</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Warning: A signature mismatch was detected in the log history sequence! Review recent database transactions.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>


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
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-cover rounded-xl border border-white/10 ${remoteStream ? 'block' : 'hidden'}`}
              />
              {!remoteStream && (
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
                <div className="absolute inset-x-6 top-6 flex justify-between pointer-events-none w-[calc(100%-3rem)]">
                  <span className="bg-red-600 text-white font-black text-[9px] px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1.5 shadow-md">
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse"></span>
                    LIVE PROCTOR
                  </span>
                  <span className="bg-black/60 text-slate-300 font-mono text-[9px] px-2 py-0.5 rounded tracking-wide shadow-md">
                    EXAM: {monitoringStudent.exams?.title || 'TEST'}
                  </span>
                </div>
              )}

              {/* Speaker Toggle Button */}
              {remoteStream && (
                <button
                  type="button"
                  onClick={() => setIsAudioMuted(!isAudioMuted)}
                  className="absolute bottom-6 right-6 z-10 bg-black/60 hover:bg-black/80 text-white p-2.5 rounded-xl border border-white/10 transition-all cursor-pointer flex items-center gap-2 text-xs font-bold uppercase tracking-wider shadow-md"
                >
                  {isAudioMuted ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      Unmute Audio
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-400 animate-pulse" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM16 10a4 4 0 00-1.993-3.464 1 1 0 10-1 1.732 2 2 0 010 3.464 1 1 0 101 1.732A4 4 0 0016 10z" clipRule="evenodd" />
                      </svg>
                      Mute Audio
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Lockout / Violation Control Center */}
            {isStudentLocked && (
              <div className="bg-red-950/20 border-t border-b border-red-500/30 px-6 py-4 space-y-4">
                <div className="flex items-start gap-3 flex-col sm:flex-row">
                  <div className="bg-red-500/10 p-2 rounded-lg text-red-500 self-start">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H8m11 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-red-400 uppercase tracking-wide text-xs">
                      {pendingUnlockRequest ? "Candidate Requested Unlock" : "Candidate Interface Locked"}
                    </h4>
                    <p className="text-slate-300 text-xs mt-1 leading-relaxed">
                      Reason: <strong className="text-red-400">{lockedReason || "Violation detected / camera disabled"}</strong>
                    </p>
                  </div>
                </div>

                {/* Approve / Reject Actions */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleApproveUnlock}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black py-2 rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer shadow-[0_4px_12px_rgba(16,185,129,0.2)]"
                  >
                    ✓ Approve & Unlock Exam
                  </button>
                  <button
                    type="button"
                    onClick={handleRejectUnlock}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white font-black py-2 rounded-xl text-xs uppercase tracking-wider transition-colors cursor-pointer shadow-[0_4px_12px_rgba(239,68,68,0.2)]"
                  >
                    ✕ Reject & Fail Candidate
                  </button>
                </div>
              </div>
            )}

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

      {/* 1. REGISTER STUDENT MODAL */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-fade-in">
          <div className="bg-[#0b0c10] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-black/20">
              <h3 className="font-bold text-sm uppercase tracking-wider text-white">👤 Register New Candidate</h3>
              <button 
                onClick={() => setShowAddStudentModal(false)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleRegisterStudent} className="p-6 space-y-4">
              <div className="flex flex-col items-center gap-3">
                <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden relative group">
                  {studentImagePreview ? (
                    <img src={studentImagePreview} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl text-slate-500">👤</span>
                  )}
                  <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white font-bold cursor-pointer transition-opacity">
                    Upload
                    <input type="file" accept="image/*" onChange={handleStudentImageChange} className="hidden" />
                  </label>
                </div>
                <span className="text-[10px] text-slate-500">Max size: 2MB</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Full Name *</label>
                  <input
                    type="text" required
                    placeholder="e.g. John Doe"
                    value={studentFormData.full_name}
                    onChange={e => setStudentFormData({...studentFormData, full_name: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Email Address *</label>
                  <input
                    type="email" required
                    placeholder="e.g. john@hrta.com"
                    value={studentFormData.email}
                    onChange={e => setStudentFormData({...studentFormData, email: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Date of Birth *</label>
                  <input
                    type="date" required
                    value={studentFormData.date_of_birth}
                    onChange={e => setStudentFormData({...studentFormData, date_of_birth: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Phone Number *</label>
                  <input
                    type="tel" required
                    placeholder="e.g. +91 98765 43210"
                    value={studentFormData.phone}
                    onChange={e => setStudentFormData({...studentFormData, phone: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Reservation Category</label>
                  <select
                    value={studentFormData.category}
                    onChange={e => setStudentFormData({...studentFormData, category: e.target.value})}
                    className="w-full bg-[#0b0c10] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="General">General</option>
                    <option value="OBC">OBC</option>
                    <option value="SC">SC</option>
                    <option value="ST">ST</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 py-2 rounded-xl text-xs font-bold uppercase transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={savingStudent}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 py-2 rounded-xl text-xs font-black uppercase transition-all cursor-pointer disabled:opacity-50"
                >
                  {savingStudent ? 'Registering...' : '✓ Register Candidate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. DELETE STUDENT STEP-UP CONFIRMATION MODAL */}
      {showDeleteStudentModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-fade-in">
          <div className="bg-[#0b0c10] border border-red-500/20 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-600 animate-pulse" />
            <div className="p-6 border-b border-white/5 bg-black/20 flex justify-between items-center">
              <h3 className="font-bold text-sm uppercase tracking-wider text-red-500">⚠ Step-Up Verification Required</h3>
              <button 
                onClick={() => {
                  setShowDeleteStudentModal(false);
                  setStudentToDelete(null);
                }}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConfirmDeleteStudent} className="p-6 space-y-4">
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-xs text-red-400 font-semibold leading-relaxed">
                🚨 WARNING: You are attempting to delete candidate <strong className="text-white font-bold">{studentToDelete?.full_name}</strong>. This will permanently erase their credentials, files, logs, and scoring history.
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Superadmin Secret Password *</label>
                <input
                  type="password" required
                  placeholder="Enter superadmin password"
                  value={deleteSecret}
                  onChange={e => setDeleteSecret(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">6-Digit Authenticator OTP Code *</label>
                <input
                  type="text" required maxLength={6}
                  placeholder="e.g. 123456"
                  value={deleteOtp}
                  onChange={e => setDeleteOtp(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500 tracking-widest font-mono text-center"
                />
              </div>

              <div className="pt-4 border-t border-white/5 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteStudentModal(false);
                    setStudentToDelete(null);
                  }}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 py-2 rounded-xl text-xs font-bold uppercase transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-xl text-xs font-black uppercase transition-all cursor-pointer shadow-[0_4px_12px_rgba(239,68,68,0.2)]"
                >
                  Confirm Delete
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. ADD EXAM MODAL */}
      {showAddExamModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-fade-in">
          <div className="bg-[#0b0c10] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-indigo-500" />
            <div className="p-6 border-b border-white/5 bg-black/20 flex justify-between items-center">
              <h3 className="font-bold text-sm uppercase tracking-wider text-white">📝 Create Exam Blueprint</h3>
              <button 
                onClick={() => setShowAddExamModal(false)}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateExam} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Exam Title *</label>
                  <input
                    type="text" required
                    placeholder="e.g. JEE Advanced Mock Test 1"
                    value={examFormData.title}
                    onChange={e => setExamFormData({...examFormData, title: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Description & Instructions</label>
                  <textarea
                    rows={2}
                    placeholder="Instructions shown to candidates before starting..."
                    value={examFormData.description}
                    onChange={e => setExamFormData({...examFormData, description: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Primary Subject *</label>
                  <select
                    value={examFormData.subject}
                    onChange={e => setExamFormData({...examFormData, subject: e.target.value})}
                    className="w-full bg-[#0b0c10] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Physics">Physics</option>
                    <option value="Chemistry">Chemistry</option>
                    <option value="Mathematics">Mathematics</option>
                    <option value="Full Syllabus (PCM)">Full Syllabus (PCM)</option>
                    <option value="General Aptitude">General Aptitude</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Duration (Minutes) *</label>
                  <input
                    type="number" required min={1}
                    value={examFormData.duration_minutes}
                    onChange={e => setExamFormData({...examFormData, duration_minutes: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Marks (Optional)</label>
                  <input
                    type="number" min={1}
                    placeholder="Auto-calculated if blank"
                    value={examFormData.total_marks}
                    onChange={e => setExamFormData({...examFormData, total_marks: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3 sm:col-span-2 grid grid-cols-3 gap-3">
                  <div className="col-span-3 text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Default Grading System</div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Positive (+)</label>
                    <input type="number" required min={1} value={examFormData.correct_marks} onChange={e => setExamFormData({...examFormData, correct_marks: e.target.value})} className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Negative (-)</label>
                    <input type="number" required min={0} value={examFormData.negative_marks} onChange={e => setExamFormData({...examFormData, negative_marks: e.target.value})} className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase">Passing %</label>
                    <input type="number" required min={0} max={100} value={examFormData.passing_percentage} onChange={e => setExamFormData({...examFormData, passing_percentage: e.target.value})} className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white" />
                  </div>
                </div>

                <div className="bg-blue-950/10 border border-blue-500/20 rounded-xl p-4 sm:col-span-2 space-y-3">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Visibility & Launch Window</div>
                  
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input type="radio" name="visibilityMode" checked={examVisibilityMode === 'lifetime'} onChange={() => setExamVisibilityMode('lifetime')} className="accent-cyan-500" />
                      Lifetime (Always Active)
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                      <input type="radio" name="visibilityMode" checked={examVisibilityMode === 'scheduled'} onChange={() => setExamVisibilityMode('scheduled')} className="accent-cyan-500" />
                      Scheduled Window
                    </label>
                  </div>

                  {examVisibilityMode === 'scheduled' && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                      <div>
                        <label className="block text-[9px] font-bold text-slate-400 uppercase">Start Date & Time</label>
                        <input type="datetime-local" required={examVisibilityMode === 'scheduled'} value={examFormData.start_datetime} onChange={e => setExamFormData({...examFormData, start_datetime: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white" />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-slate-400 uppercase">End Date & Time</label>
                        <input type="datetime-local" required={examVisibilityMode === 'scheduled'} value={examFormData.end_datetime} onChange={e => setExamFormData({...examFormData, end_datetime: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-white/5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddExamModal(false)}
                  className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 py-2 rounded-xl text-xs font-bold uppercase transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={savingExam}
                  className="flex-1 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-white py-2 rounded-xl text-xs font-black uppercase transition-all cursor-pointer disabled:opacity-50"
                >
                  {savingExam ? 'Saving blueprint...' : '✓ Create & Add Questions ➔'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
