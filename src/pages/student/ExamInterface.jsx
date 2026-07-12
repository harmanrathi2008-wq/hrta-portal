import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { toast } from "sonner";
import {
  generateECDHKeyPair,
  exportPublicKey,
  importPeerPublicKey,
  deriveSharedKey,
  encryptPayload,
  decryptPayload
} from "../../lib/webrtcCrypto";

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';

const parseOption = (opt) => {
  if (opt === null || opt === undefined) return { text: '', image_url: '', image_public_id: '' };
  if (typeof opt !== 'string') {
    return { text: String(opt), image_url: '', image_public_id: '' };
  }
  const trimmed = opt.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        text: parsed.text !== undefined && parsed.text !== null ? String(parsed.text) : '',
        image_url: parsed.image_url || '',
        image_public_id: parsed.image_public_id || ''
      };
    } catch (e) {}
  }
  return { text: opt, image_url: '', image_public_id: '' };
};

const normalizeOptionForComparison = (opt) => {
  const parsed = parseOption(opt);
  const val = parsed.text.trim() || parsed.image_url.trim();
  return val.toLowerCase();
};

const areOptionsEqual = (optA, optB) => {
  if (optA === optB) return true;
  return normalizeOptionForComparison(optA) === normalizeOptionForComparison(optB);
};

export default function ExamInterface() {
  const { examId } = useParams();
  const navigate = useNavigate();

  // Proctoring Refs
  const localStreamRef = React.useRef(null);
  const peerConnectionRef = React.useRef(null);
  const proctorChannelRef = React.useRef(null);
  const studentIceQueueRef = React.useRef([]);
  const maxWarningsRef = React.useRef(5);
  const isConnectingRef = React.useRef(false);
  const offerIntervalRef = React.useRef(null);
  const lockChannelRef = React.useRef(null);
  const isSubmittedRef = React.useRef(false);
  const isSubmittingRef = React.useRef(false);
  const ownKeyPairRef = React.useRef(null);
  const sharedKeyRef = React.useRef(null);
  const pollIntervalRef = React.useRef(null);
  const [cameraAccessLost, setCameraAccessLost] = useState(false);
  const [cameraRetryLoading, setCameraRetryLoading] = useState(false);
  const cameraAccessLostRef = React.useRef(false);
  const tabSwitchCountRef = React.useRef(0);

  // Proctoring Violation Lock States
  const [isProctorLocked, setIsProctorLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [unlockRequestSent, setUnlockRequestSent] = useState(false);
  const [isRejected, setIsRejected] = useState(false);

  const sessionTokenRef = React.useRef(sessionStorage.getItem('studentSessionToken') || '');
  React.useEffect(() => {
    const localToken = sessionStorage.getItem('studentSessionToken');
    if (localToken) {
      sessionTokenRef.current = localToken;
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) sessionTokenRef.current = session.access_token || '';
      });
    }
  }, []);

  // App & Exam States
  const [student, setStudent] = useState(null);
  const studentRef = React.useRef(null);
  useEffect(() => {
    studentRef.current = student;
  }, [student]);
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [timeSpent, setTimeSpent] = useState({});
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [responses, setResponses] = useState({});
  const [committedResponses, setCommittedResponses] = useState({});
  const [status, setStatus] = useState({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 768);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomLastDist, setZoomLastDist] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Connection & Auto-save states
  const [draftId, setDraftId] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  // Section Tracking States
  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState("");

  // Security Locking States
  const [hasFocus, setHasFocus] = useState(true);

  const [imageError, setImageError] = useState(false);

  function getHeaders() {
    const loginLogId = sessionStorage.getItem('loginLogId') || '';
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionTokenRef.current}`,
      'X-Session-ID': loginLogId
    };
  }

  async function logViolation(action, details = {}) {
    try {
      const userId = sessionStorage.getItem("userId");
      await fetch(`${API_BASE_URL}/api/audit-log`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          userId: userId || 'Unknown',
          userRole: 'student',
          displayName: studentRef.current?.full_name || 'Student',
          action,
          details: {
            exam_id: examId,
            exam_title: exam?.title,
            ...details
          }
        })
      });
    } catch (e) {
      console.warn("Failed to log violation to audit-log:", e);
    }
  }

  async function triggerExamLock(reason) {
    setIsProctorLocked(true);
    setLockReason(reason);
    logViolation('PROCTORING_VIOLATION_LOCK', { reason });

    if (proctorChannelRef.current) {
      proctorChannelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: { 
          type: "PROCTORING_VIOLATION", 
          sender: "student", 
          data: { reason } 
        }
      }).catch(err => console.warn("Failed to send PROCTORING_VIOLATION signal:", err));
    }

    try {
      const userId = sessionStorage.getItem("userId");
      if (userId) {
        const token = sessionTokenRef.current || sessionStorage.getItem('studentSessionToken') || '';
        await fetch(`${API_BASE_URL}/api/student/exams/${examId}/lock`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            draftId: draftId || null,
            reason: reason,
            status: "locked"
          })
        });
      }
    } catch (dbErr) {
      console.warn("Failed to record proctor lock to DB:", dbErr);
    }
  }

  async function executeBlockSubmission() {
    if (isSubmittingRef.current || isSubmittedRef.current) return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      const userId = sessionStorage.getItem("userId");
      if (!userId) throw new Error("No student session found.");

      const timerKey = `exam_start_time_${examId}`;
      const startTime = sessionStorage.getItem(timerKey) || Date.now().toString();

      const token = sessionTokenRef.current || sessionStorage.getItem('studentSessionToken') || '';
      const res = await fetch(`${API_BASE_URL}/api/student/exams/${examId}/save-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          draftId: draftId,
          answers: {},
          status: "blocked"
        })
      });

      if (!res.ok) {
        throw new Error("Failed to save blocked attempt via backend proxy.");
      }

      isSubmittedRef.current = true;

      // Log audit event
      try {
        await fetch(`${API_BASE_URL}/api/audit-log`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            userId: userId || 'Unknown',
            userRole: 'student',
            displayName: studentRef.current?.full_name || 'Student',
            action: 'EXAM_TERMINATED_FOR_CHEATING',
            details: {
              exam_id: examId,
              exam_title: exam?.title,
              attempt_number: attemptNumber
            }
          })
        });
      } catch (logErr) {
        console.warn("Failed to audit EXAM_TERMINATED_FOR_CHEATING:", logErr);
      }

    } catch (err) {
      console.error("Error submitting blocked attempt:", err);
    } finally {
      setSubmitting(false);
    }
  }

  // Preload upcoming question images in the background to ensure instantaneous display
  useEffect(() => {
    if (!questions || questions.length === 0) return;
    
    // Preload next 3 questions
    const preloadRange = 3;
    for (let i = 1; i <= preloadRange; i++) {
      const nextIdx = currentIdx + i;
      if (nextIdx < questions.length) {
        const nextQ = questions[nextIdx];
        if (nextQ && nextQ.image_url && nextQ.image_url.trim() !== "" && nextQ.image_url !== "null") {
          const img = new Image();
          img.src = nextQ.image_url;
        }
        
        // Also preload option images if they exist in options
        if (nextQ && nextQ.options) {
          let parsedOptions = [];
          try {
            parsedOptions = typeof nextQ.options === 'string' ? JSON.parse(nextQ.options) : nextQ.options;
          } catch (e) {}
          
          if (Array.isArray(parsedOptions)) {
            parsedOptions.forEach(opt => {
              if (opt && typeof opt === 'object') {
                if (opt.image_url && opt.image_url.trim() !== "") {
                  const img = new Image();
                  img.src = opt.image_url;
                }
              } else if (typeof opt === 'string' && opt.trim() !== "") {
                try {
                  const parsed = JSON.parse(opt);
                  if (parsed.image_url && parsed.image_url.trim() !== "") {
                    const img = new Image();
                    img.src = parsed.image_url;
                  }
                } catch (e) {}
              }
            });
          }
        }
      }
    }
  }, [currentIdx, questions]);


  // Fetch Data: Student, Exam, Questions
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const userId = sessionStorage.getItem("userId");
        const role = sessionStorage.getItem("role");

        if (!userId || role !== "student") {
          navigate("/");
          return;
        }

        // Self-healing fallback: if studentSessionToken is missing, attempt to recover from Supabase session
        let token = sessionStorage.getItem("studentSessionToken") || '';
        if (!token) {
          const { data: { session } } = await supabase.auth.getSession();
          token = session?.access_token || '';
        }
        const [studentRes, examRes, questionsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/student/profile?studentId=${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
          fetch(`${API_BASE_URL}/api/student/exams/${examId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }).then(r => { if (!r.ok) throw new Error(); return r.json(); }),
          fetch(`${API_BASE_URL}/api/student/exams/${examId}/questions`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
        ]);

        setStudent(studentRes);
        setExam(examRes);
        setQuestions(questionsRes);

        // Group questions into sections based on 'topic' or fallback to 'subject'
        const secs = [];
        questionsRes.forEach((q) => {
          const secName = (q.topic || examRes.subject || "Section A").toUpperCase().trim();
          if (!secs.includes(secName)) {
            secs.push(secName);
          }
        });
        setSections(secs);
        if (secs.length > 0) {
          setActiveSection(secs[0]);
        }

        // Fetch or create database-level in-progress attempt row (draft)
        const draftData = await fetch(`${API_BASE_URL}/api/student/exams/${examId}/draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            startTime: sessionStorage.getItem(`exam_start_time_${examId}`) || Date.now().toString()
          })
        }).then(r => { if (!r.ok) throw new Error('Failed to load/create exam attempt'); return r.json(); });

        const currentDraft = draftData.draft;
        setDraftId(draftData.draft.id);

        // Log audit event: Start Exam
        try {
          await fetch(`${API_BASE_URL}/api/audit-log`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              userId: userId,
              userRole: 'student',
              displayName: studentRes.full_name || 'Student',
              action: 'START_EXAM',
              details: {
                exam_id: examId,
                exam_title: examRes.title,
                draft_id: currentDraft?.id
              }
            })
          });
        } catch (auditErr) {
          console.error("Failed to write audit log for start exam:", auditErr);
        }

        // Initialize responses and status tracker from local cache or draft
        const cacheKeyResponses = `exam_responses_${examId}_${userId}`;
        const cacheKeyStatus = `exam_status_${examId}_${userId}`;

        const localResponsesStr = localStorage.getItem(cacheKeyResponses);
        let loadedResponses = {};
        if (localResponsesStr) {
          loadedResponses = JSON.parse(localResponsesStr);
        } else if (currentDraft && currentDraft.answers) {
          loadedResponses = currentDraft.answers;
          localStorage.setItem(cacheKeyResponses, JSON.stringify(currentDraft.answers));
        }
        setResponses(loadedResponses);
        setCommittedResponses(loadedResponses);

        const localStatusStr = localStorage.getItem(cacheKeyStatus);
        if (localStatusStr) {
          setStatus(JSON.parse(localStatusStr));
        } else {
          const initialStatus = {};
          questionsRes.forEach((q) => {
            const hasAns = loadedResponses[q.id] !== undefined && loadedResponses[q.id] !== null && loadedResponses[q.id] !== "";
            initialStatus[q.id] = hasAns ? "answered" : "notVisited";
          });
          if (questionsRes.length > 0 && initialStatus[questionsRes[0].id] === "notVisited") {
            initialStatus[questionsRes[0].id] = "notAnswered";
          }
          setStatus(initialStatus);
          localStorage.setItem(cacheKeyStatus, JSON.stringify(initialStatus));
        }

      } catch (err) {
        console.error("Error loading exam data:", err);
        setLoadError(err.message || "Failed to load exam data. Please check your connection and try again.");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [examId, navigate]);

  // Camera & Microphone Capture & Live WebRTC Proctoring Signaling System
  useEffect(() => {
    const userId = sessionStorage.getItem("userId");
    if (!userId || !exam) return;

    let stream = null;
    let pollingInterval = null;
    const channelName = `exam_proctor_${userId}`;
    console.log(`[HRTA Proctor] 📡 Student joining signaling channel: "${channelName}"`);
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: '' }
      }
    });
    proctorChannelRef.current = channel;

    function getActiveStream() {
      return new Promise((resolve) => {
        if (localStreamRef.current) {
          resolve(localStreamRef.current);
          return;
        }
        const checkInterval = setInterval(() => {
          if (localStreamRef.current) {
            clearInterval(checkInterval);
            resolve(localStreamRef.current);
          }
        }, 200);
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(null);
        }, 10000);
      });
    }

    function setupTrackListeners(activeStream) {
      if (!activeStream) return;
      activeStream.getTracks().forEach((track) => {
        track.onended = () => {
          if (!isSubmittedRef.current) {
            setCameraAccessLost(true);
            cameraAccessLostRef.current = true;
            logViolation('DEVICE_LOST', { track_label: track.label, kind: track.kind });
          }
        };
        track.onmute = () => {
          if (!isSubmittedRef.current) {
            setCameraAccessLost(true);
            cameraAccessLostRef.current = true;
            logViolation('DEVICE_MUTED', { track_label: track.label, kind: track.kind });
          }
        };
        track.onunmute = () => {
          const allHealthy = activeStream.getTracks().every(t => t.readyState === 'live' && t.enabled && !t.muted);
          if (allHealthy) {
            setCameraAccessLost(false);
            cameraAccessLostRef.current = false;
          }
        };
      });
    }

    async function setupPeerConnection() {
      if (peerConnectionRef.current) return;
      const activeStream = await getActiveStream();
      if (!activeStream) {
        isConnectingRef.current = false;
        return;
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" }
        ]
      });
      peerConnectionRef.current = pc;
      console.log("[HRTA Proctor] ✅ RTCPeerConnection created.");

      pc.onconnectionstatechange = () => {
        console.log("[HRTA Proctor] WebRTC Connection State Changed:", pc.connectionState);
        if (pc.connectionState === "connected") {
          fetch(`${API_BASE_URL}/api/audit-log`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              userId: userId || 'Unknown',
              userRole: 'student',
              displayName: studentRef.current?.full_name || 'Student',
              action: 'SIGNALING_ESTABLISHED',
              details: { exam_id: examId, connection_state: pc.connectionState }
            })
          }).catch(err => console.warn("Failed to audit SIGNALING_ESTABLISHED:", err));
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          if (!isSubmittedRef.current) {
            fetch(`${API_BASE_URL}/api/audit-log`, {
              method: 'POST',
              headers: getHeaders(),
              body: JSON.stringify({
                userId: userId || 'Unknown',
                userRole: 'student',
                displayName: studentRef.current?.full_name || 'Student',
                action: 'STREAM_DISCONNECTED',
                details: { exam_id: examId, connection_state: pc.connectionState }
              })
            }).catch(err => console.warn("Failed to audit STREAM_DISCONNECTED:", err));
          }
        }
      };

      activeStream.getTracks().forEach((track) => {
        pc.addTrack(track, activeStream);
      });

      pc.onicecandidate = async (event) => {
        if (event.candidate && sharedKeyRef.current) {
          const encryptedCand = await encryptPayload(event.candidate, sharedKeyRef.current);
          fetch(`${API_BASE_URL}/api/webrtc-signal/student-ice`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ candidate: encryptedCand })
          }).catch(e => console.warn("Failed to send student ICE candidate:", e));
        }
      };

      console.log("[HRTA Proctor] ⏳ Creating SDP offer...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Encrypt offer E2E
      const encryptedOffer = await encryptPayload(offer, sharedKeyRef.current);
      await fetch(`${API_BASE_URL}/api/webrtc-signal/offer`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ offer: encryptedOffer })
      });
      console.log("[HRTA Proctor] ✅ E2E Encrypted SDP offer sent to backend.");
      isConnectingRef.current = false;
    }

    // Offscreen elements for pixel brightness analysis
    const offscreenVideo = document.createElement('video');
    offscreenVideo.muted = true;
    offscreenVideo.playsInline = true;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 64;
    offscreenCanvas.height = 48;
    const canvasCtx = offscreenCanvas.getContext('2d');

    async function startCameraAndProctoring() {
      try {
        // Capture video and audio stream silently with fallback to video-only if microphone is missing/denied
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, frameRate: 15 },
            audio: { echoCancellation: true, noiseSuppression: true }
          });
        } catch (audioErr) {
          console.warn("Failing back to video-only capture:", audioErr);
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, frameRate: 15 }
          });
        }
        localStreamRef.current = stream;

        // Bind stream to offscreen video element for frame analysis
        offscreenVideo.srcObject = stream;
        offscreenVideo.play().catch(e => console.warn("Offscreen video play failed:", e));

        setupTrackListeners(stream);

        // Security Polling Loop (Muted Sensors, Black Screens, Frozen Virtual Cameras)
        let consecutiveBlackFrames = 0;
        let prevFramesSent = null;
        let consecutiveFrozenChecks = 0;

        pollingInterval = setInterval(async () => {
          if (isSubmittedRef.current || cameraAccessLostRef.current || isProctorLocked || isRejected) {
            return;
          }

          const activeStream = localStreamRef.current || stream;
          if (!activeStream) return;

          // 1. Property checks (Hardware/OS mute sliders, console hacks)
          const tracks = activeStream.getTracks();
          if (tracks.length === 0) {
            setCameraAccessLost(true);
            cameraAccessLostRef.current = true;
            logViolation('DEVICE_LOST', { reason: 'No media tracks found' });
            return;
          }

          for (const track of tracks) {
            if (track.readyState !== 'live' || !track.enabled || track.muted) {
              setCameraAccessLost(true);
              cameraAccessLostRef.current = true;
              logViolation('DEVICE_LOST', { 
                reason: `Track ${track.kind} inactive`, 
                readyState: track.readyState, 
                enabled: track.enabled, 
                muted: track.muted 
              });
              return;
            }
          }

          // 2. Pixel/Brightness analysis (Anti-Black Screen / Covered Lens Shutter)
          const videoTrack = activeStream.getVideoTracks()[0];
          if (videoTrack && offscreenVideo.readyState >= 2) {
            try {
              canvasCtx.drawImage(offscreenVideo, 0, 0, 64, 48);
              const imgData = canvasCtx.getImageData(0, 0, 64, 48);
              const data = imgData.data;

              let totalBrightness = 0;
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                totalBrightness += (r + g + b) / 3;
              }
              const averageBrightness = totalBrightness / (64 * 48);

              if (averageBrightness < 8) {
                consecutiveBlackFrames++;
                if (consecutiveBlackFrames >= 4) {
                  logViolation('BLACK_SCREEN_DETECTED', { average_brightness: averageBrightness });
                  consecutiveBlackFrames = 0;
                }
              } else {
                consecutiveBlackFrames = 0;
              }
            } catch (e) {
              console.warn("Frame analysis error:", e);
            }
          }

          // 3. Frozen Frame analysis (Anti-Still Photo / Virtual Camera Bypass loops)
          if (peerConnectionRef.current && peerConnectionRef.current.connectionState === "connected") {
            try {
              const statsReport = await peerConnectionRef.current.getStats();
              let foundVideoStats = false;
              statsReport.forEach((report) => {
                if (report.type === "outbound-rtp" && report.kind === "video") {
                  foundVideoStats = true;
                  const currentFramesSent = report.framesSent || 0;
                  if (prevFramesSent !== null && currentFramesSent === prevFramesSent) {
                    consecutiveFrozenChecks++;
                    if (consecutiveFrozenChecks >= 4) {
                      logViolation('FROZEN_VIDEO_FEED', { note: 'Outbound video framesSent frozen for 12s+' });
                      consecutiveFrozenChecks = 0;
                    }
                  } else {
                    consecutiveFrozenChecks = 0;
                  }
                  prevFramesSent = currentFramesSent;
                }
              });
              if (!foundVideoStats) {
                prevFramesSent = null;
              }
            } catch (statsErr) {
              console.warn("Error reading WebRTC stats:", statsErr);
            }
          } else {
            prevFramesSent = null;
            consecutiveFrozenChecks = 0;
          }

        }, 3000);

        // Generate own ECDH key pair for E2E signaling encryption
        const keyPair = await generateECDHKeyPair();
        ownKeyPairRef.current = keyPair;
        const jwkPub = await exportPublicKey(keyPair.publicKey);

        // Register student public key
        try {
          const regResp = await fetch(`${API_BASE_URL}/api/webrtc-signal/student-pubkey`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ pubkey: jwkPub })
          });
          const regData = await regResp.json();
          if (regData.adminPubkey) {
            console.log("[HRTA Proctor] E2E shared key derived initially.");
            const peerKey = await importPeerPublicKey(regData.adminPubkey);
            sharedKeyRef.current = await deriveSharedKey(keyPair.privateKey, peerKey);
          }
        } catch (regErr) {
          console.warn("[HRTA Proctor] Failed to register public key initially. Polling will retry.", regErr);
        }

        // Poll signaling relay interval (replaces Supabase Broadcast)
        pollIntervalRef.current = setInterval(async () => {
          try {
            if (isSubmittedRef.current || isRejected) return;

            // 1. Resolve shared key if not done
            if (!sharedKeyRef.current) {
              const pResp = await fetch(`${API_BASE_URL}/api/webrtc-signal/admin-pubkey`, {
                headers: getHeaders()
              });
              const pData = await pResp.json();
              if (pData.adminPubkey) {
                console.log("[HRTA Proctor] E2E shared key derived from poll.");
                const peerKey = await importPeerPublicKey(pData.adminPubkey);
                sharedKeyRef.current = await deriveSharedKey(ownKeyPairRef.current.privateKey, peerKey);
              } else {
                return; // wait for admin public key
              }
            }

            // 2. Poll student signal queue (SDP Answer, admin ICE candidates, adminConnected flag)
            const pollResp = await fetch(`${API_BASE_URL}/api/webrtc-signal/poll-student`, {
              headers: getHeaders()
            });
            const pollData = await pollResp.json();

            // Admin requested connection
            if (pollData.adminConnected && !peerConnectionRef.current && !isConnectingRef.current) {
              isConnectingRef.current = true;
              console.log("[HRTA Proctor] Admin connected signal received. Starting WebRTC connection...");
              await setupPeerConnection();
            }

            // Process SDP Answer
            if (pollData.answer && peerConnectionRef.current) {
              if (peerConnectionRef.current.signalingState !== "stable") {
                const decryptedAns = await decryptPayload(pollData.answer, sharedKeyRef.current);
                console.log("[HRTA Proctor] 📥 Decrypted SDP_ANSWER received from admin.");
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(decryptedAns));
                
                // Flush queued student candidates
                while (studentIceQueueRef.current.length > 0) {
                  const cand = studentIceQueueRef.current.shift();
                  if (cand && peerConnectionRef.current.remoteDescription) {
                    await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(e =>
                      console.warn("Error processing queued candidate:", e)
                    );
                  }
                }
              }
            }

            // Process admin ICE candidates
            if (pollData.candidates && Array.isArray(pollData.candidates) && peerConnectionRef.current) {
              for (const candItem of pollData.candidates) {
                const decryptedCand = await decryptPayload(candItem, sharedKeyRef.current);
                if (peerConnectionRef.current.remoteDescription) {
                  await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(decryptedCand));
                } else {
                  studentIceQueueRef.current.push(decryptedCand);
                }
              }
            }
          } catch (err) {
            console.warn("[HRTA Proctor] Error in poll signaling loop:", err);
          }
        }, 2500);

        // Database-backed real-time watch on proctor_locks
        const lockChannel = supabase
          .channel(`proctor_lock_watch_${userId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'proctor_locks',
              filter: `student_id=eq.${userId}`
            },
            (payload) => {
              console.log("Proctor lock DB event received:", payload);
              const newLockData = payload.new;
              if (newLockData && newLockData.exam_id === examId) {
                if (newLockData.status === 'approved') {
                  console.log("DB Lock approved. Restoring exam state...");
                  setIsProctorLocked(false);
                  setLockReason("");
                  setUnlockRequestSent(false);
                  tabSwitchCountRef.current = 0;
                  maxWarningsRef.current = 3;
                  logViolation('PROCTORING_UNLOCK_GRANTED', { note: 'Lock cleared via DB approval' });
                  
                  // Clean up DB row
                  supabase
                    .from("proctor_locks")
                    .delete()
                    .eq("id", newLockData.id)
                    .then(() => console.log("Cleaned up lock record."));
                } else if (newLockData.status === 'rejected') {
                  console.log("DB Lock rejected. Failing candidate...");
                  setIsRejected(true);
                  setIsProctorLocked(false);
                  executeBlockSubmission();
                }
              }
            }
          )
          .subscribe();
        lockChannelRef.current = lockChannel;

      } catch (err) {
        console.error("Proctoring Media stream Initialization failed:", err);
        setCameraAccessLost(true);
        cameraAccessLostRef.current = true;
        
        try {
          fetch(`${API_BASE_URL}/api/audit-log`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              userId: userId || 'Unknown',
              userRole: 'student',
              displayName: studentRef.current?.full_name || sessionStorage.getItem('userEmail') || 'Student',
              action: 'PERMISSION_REVOKED',
              details: { exam_id: examId, reason: 'initialization_failed', error: err.message }
            })
          }).catch(e => console.warn("Failed to audit initial camera failure:", e));
        } catch (logErr) {}
      }
    }

    startCameraAndProctoring();

    // Clean up on component unmount
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      const activeStream = localStreamRef.current || stream;
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
      if (offerIntervalRef.current) {
        clearInterval(offerIntervalRef.current);
        offerIntervalRef.current = null;
      }
      if (lockChannelRef.current) {
        supabase.removeChannel(lockChannelRef.current);
      }
      sessionStorage.removeItem("cameraGranted");
    };
  }, [examId, exam?.id]);

  // Backup polling for proctor lock status (self-healing if realtime is disabled)
  useEffect(() => {
    if (!isProctorLocked) return;
    const userId = sessionStorage.getItem("userId");
    if (!userId) return;

    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('proctor_locks')
          .select('id, status')
          .eq('student_id', userId)
          .eq('exam_id', examId)
          .maybeSingle();

        if (error) {
          console.warn("Backup lock polling error:", error.message);
          return;
        }

        // If the record was deleted or approved, unlock the student
        if (!data || data.status === 'approved') {
          console.log("Backup poll detected unlock. Restoring exam state...");
          setIsProctorLocked(false);
          setLockReason("");
          setUnlockRequestSent(false);
          tabSwitchCountRef.current = 0;
          maxWarningsRef.current = 3;
          
          if (data) {
            // Clean up DB row if it exists
            await supabase.from("proctor_locks").delete().eq("id", data.id);
          }
        } else if (data.status === 'rejected') {
          console.log("Backup poll detected rejection. Blocking candidate...");
          setIsRejected(true);
          setIsProctorLocked(false);
          executeBlockSubmission();
        }
      } catch (err) {
        console.warn("Backup lock polling exception:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isProctorLocked, examId]);

  // Listen to browser lifecycle termination (Unexpected Tab Close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!isSubmittedRef.current) {
        const userId = sessionStorage.getItem("userId");
        
        const payload = JSON.stringify({
          userId: userId || 'Unknown',
          userRole: 'student',
          displayName: student?.full_name || 'Student',
          action: 'UNEXPECTED_TAB_CLOSE',
          details: {
            exam_id: examId,
            exam_title: exam?.title,
            current_time_left: timeLeft
          }
        });

        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(`${API_BASE_URL}/api/audit-log?token=${sessionTokenRef.current}&sessionId=${sessionStorage.getItem('loginLogId') || ''}`, blob);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [student, exam, examId, timeLeft]);

  const restoreCameraAccess = async () => {
    setCameraRetryLoading(true);
    try {
      const userId = sessionStorage.getItem("userId");
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 15 },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      localStreamRef.current = stream;

      // Log CAMERA_GRANTED recovery event
      try {
        await fetch(`${API_BASE_URL}/api/audit-log`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            userId: userId || 'Unknown',
            userRole: 'student',
            displayName: student?.full_name || 'Student',
            action: 'CAMERA_GRANTED',
            details: { exam_id: examId, note: 'Camera and microphone recovered mid-exam' }
          })
        });
      } catch (logErr) {
        console.warn("Failed to audit CAMERA_GRANTED recovery:", logErr);
      }

      // Attach track ended and mute listeners to the new tracks
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (!isSubmittedRef.current) {
            setCameraAccessLost(true);
            cameraAccessLostRef.current = true;
            logViolation('DEVICE_LOST', { track_label: track.label, kind: track.kind });
          }
        };
        track.onmute = () => {
          if (!isSubmittedRef.current) {
            setCameraAccessLost(true);
            cameraAccessLostRef.current = true;
            logViolation('DEVICE_MUTED', { track_label: track.label, kind: track.kind });
          }
        };
        track.onunmute = () => {
          const allHealthy = stream.getTracks().every(t => t.readyState === 'live' && t.enabled && !t.muted);
          if (allHealthy) {
            setCameraAccessLost(false);
            cameraAccessLostRef.current = false;
          }
        };
      });

      // If WebRTC peer connection was active, renegotiate by replacing track
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        senders.forEach((sender) => {
          if (sender.track) {
            if (sender.track.kind === "video") {
              const newVideoTrack = stream.getVideoTracks()[0];
              if (newVideoTrack) sender.replaceTrack(newVideoTrack).catch(e => console.warn("Error replacing WebRTC video track:", e));
            } else if (sender.track.kind === "audio") {
              const newAudioTrack = stream.getAudioTracks()[0];
              if (newAudioTrack) sender.replaceTrack(newAudioTrack).catch(e => console.warn("Error replacing WebRTC audio track:", e));
            }
          }
        });
      }

      setCameraAccessLost(false);
      cameraAccessLostRef.current = false;

      // Notify admin that camera is restored so they can re-initialize the proctor feed
      if (proctorChannelRef.current) {
        proctorChannelRef.current.send({
          type: "broadcast",
          event: "signal",
          payload: { type: "STUDENT_CAMERA_RECOVERED", sender: "student" }
        }).catch(err => console.warn("Failed to send STUDENT_CAMERA_RECOVERED:", err));
      }
    } catch (err) {
      console.warn("Failed to restore camera/microphone access:", err);
      alert("Camera or microphone access denied. Please grant both permissions in browser site settings to resume your exam.");
    } finally {
      setCameraRetryLoading(false);
    }
  };

  // Timer Initialization & Countdown Hook (Backed up to localStorage for disconnection safety)
  useEffect(() => {
    if (!exam) return;

    const timerKey = `exam_start_time_${examId}`;
    let startTime = sessionStorage.getItem(timerKey) || localStorage.getItem(timerKey);
    if (!startTime) {
      startTime = Date.now().toString();
      sessionStorage.setItem(timerKey, startTime);
      localStorage.setItem(timerKey, startTime);
    } else {
      sessionStorage.setItem(timerKey, startTime);
      localStorage.setItem(timerKey, startTime);
    }

    const startTimestamp = parseInt(startTime, 10);
    const durationSeconds = (exam.duration_minutes || 180) * 60;

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
      const remaining = Math.max(0, durationSeconds - elapsed);
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(timerInterval);
        handleAutoSubmit();
      }
    };

    updateTimer();
    const timerInterval = setInterval(updateTimer, 1000);

    return () => clearInterval(timerInterval);
  }, [exam]);

  // Listen to network status change
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Save changes to localStorage immediately on mutations
  useEffect(() => {
    if (examId && student?.id) {
      localStorage.setItem(`exam_responses_${examId}_${student.id}`, JSON.stringify(committedResponses));
    }
  }, [committedResponses, examId, student]);

  useEffect(() => {
    if (examId && student?.id) {
      localStorage.setItem(`exam_status_${examId}_${student.id}`, JSON.stringify(status));
    }
  }, [status, examId, student]);

  // Sync state to Supabase draft in background when online (debounced)
  useEffect(() => {
    if (!draftId || !isOnline) return;

    const syncDraft = async () => {
      setSyncing(true);
      try {
        const token = sessionTokenRef.current || sessionStorage.getItem('studentSessionToken') || '';
        const res = await fetch(`${API_BASE_URL}/api/student/exams/${examId}/save-draft`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            draftId: draftId,
            answers: committedResponses,
            currentIndex: currentIdx,
            timeLeft: timeLeft
          })
        });

        if (!res.ok) throw new Error("Draft save response not OK");
        setSyncError(false);
      } catch (err) {
        console.warn("Background draft sync failed:", err.message);
        setSyncError(true);
      } finally {
        setSyncing(false);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      syncDraft();
    }, 2000); // 2 second debounce

    return () => clearTimeout(delayDebounceFn);
  }, [committedResponses, draftId, isOnline, currentIdx, timeLeft]);

  // Active Question Time Tracker
  useEffect(() => {
    const currentQ = questions[currentIdx];
    if (!loading && currentQ && currentQ.id) {
      const interval = setInterval(() => {
        setTimeSpent((prev) => ({
          ...prev,
          [currentQ.id]: (prev[currentQ.id] || 0) + 1,
        }));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [currentIdx, loading, questions]);

  // Security Focus, Key Intercepts, & Clipboard Violations Hook
  useEffect(() => {
    const handleBlur = () => {
      if (!isSubmittedRef.current && !cameraAccessLostRef.current && !isProctorLocked && !isRejected) {
        tabSwitchCountRef.current += 1;
        const count = tabSwitchCountRef.current;
        const maxWarn = maxWarningsRef.current || 5;
        
        logViolation('TAB_SWITCH_OR_FOCUS_LOST', { 
          note: `Window focus lost. Count: ${count}/${maxWarn}`, 
          tab_switch_count: count 
        });

        if (count > maxWarn) {
          triggerExamLock(`Focus Lost (Tab Switch Limit Exceeded - ${maxWarn} Times)`);
        } else {
          toast.error(`Warning: Tab switch or focus lost detected! (${count}/${maxWarn}). The exam will lock permanently if you exceed ${maxWarn} warnings.`, {
            duration: 5000,
            position: 'top-center'
          });
        }
      }
    };

    const handleKeyDown = (e) => {
      if (cameraAccessLostRef.current || isProctorLocked || isRejected) {
        e.preventDefault();
        return;
      }
      // Intercept PrintScreen
      if (e.key === "PrintScreen" || e.keyCode === 44) {
        e.preventDefault();
        try {
          navigator.clipboard.writeText(""); // Clear clipboard to prevent pasting
        } catch (err) {}
        logViolation('SCREENSHOT_ATTEMPT', { key: e.key });
        alert("Screenshots are strictly prohibited during the examination!");
      }
      // Intercept dev tools (F12) and print/save keys
      if (
        (e.ctrlKey && ["p", "c", "v", "u", "s"].includes(e.key.toLowerCase())) ||
        e.key === "F12"
      ) {
        e.preventDefault();
        logViolation('SECURITY_KEY_INTERCEPT', { key: e.key, combination: e.ctrlKey ? 'CTRL + ' + e.key : 'F12' });
        if (e.key === "F12") {
          triggerExamLock("Developer Tools Opened (F12 Key Pressed)");
        }
      }
    };

    const handleCopy = (e) => {
      e.preventDefault();
      logViolation('COPY_ATTEMPT', { text: window.getSelection()?.toString() || 'Selected Text' });
    };

    const handleCut = (e) => {
      e.preventDefault();
      logViolation('CUT_ATTEMPT', { text: window.getSelection()?.toString() || 'Selected Text' });
    };

    const handlePaste = (e) => {
      e.preventDefault();
      logViolation('PASTE_ATTEMPT', {});
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      logViolation('RIGHT_CLICK_ATTEMPT', {});
    };

    window.addEventListener("blur", handleBlur);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("cut", handleCut);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("cut", handleCut);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProctorLocked, isRejected]);

  const current = questions[currentIdx] || {};

  // Sync active section when question index changes
  useEffect(() => {
    if (current && exam) {
      const qSec = (current.topic || exam.subject || "Section A").toUpperCase().trim();
      if (qSec !== activeSection) {
        setActiveSection(qSec);
      }
      setImageError(false); // Reset image load error state for the new question
    }
  }, [currentIdx, questions, exam]);

  // Formats seconds into HH:MM:SS
  const formatTime = (totalSeconds) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Reverts unsaved answers to the last committed response
  const revertUnsavedChanges = (qId) => {
    setResponses((prev) => {
      const committedVal = committedResponses[qId];
      if (committedVal === undefined || committedVal === null || committedVal === "") {
        const { [qId]: _, ...rest } = prev;
        return rest;
      } else {
        return { ...prev, [qId]: committedVal };
      }
    });
  };

  // Navigates to a specific question safely
  const handleQuestionSelect = (idx) => {
    if (idx < 0 || idx >= questions.length) return;
    setCurrentIdx(idx);
    const targetQId = questions[idx].id;
    if (status[targetQId] === "notVisited") {
      setStatus((prev) => ({ ...prev, [targetQId]: "notAnswered" }));
    }
  };

  // Internal section selector used for auto-advancing (does not revert answers)
  const advanceSectionSelect = (secName) => {
    setActiveSection(secName);
    const firstQIdx = questions.findIndex(
      (q) => (q.topic || exam.subject || "Section A").toUpperCase().trim() === secName
    );
    if (firstQIdx !== -1) {
      handleQuestionSelect(firstQIdx);
    }
  };

  // Handles clicking a Section Tab manually (reverts unsaved answers first)
  const handleSectionSelect = (secName) => {
    revertUnsavedChanges(current.id);
    advanceSectionSelect(secName);
  };

  // Actions
  const handleSaveNext = () => {
    const ans = responses[current.id];
    const isAnswered =
      ans !== undefined &&
      ans !== null &&
      ans !== "" &&
      (!Array.isArray(ans) || ans.length > 0);

    setStatus((prev) => ({
      ...prev,
      [current.id]: isAnswered ? "answered" : "notAnswered",
    }));

    setCommittedResponses((prev) => {
      if (isAnswered) {
        return { ...prev, [current.id]: ans };
      } else {
        const { [current.id]: _, ...rest } = prev;
        return rest;
      }
    });

    advanceNext();
  };

  const advanceNext = () => {
    const currentQSec = (current.topic || exam.subject || "Section A").toUpperCase().trim();
    const currentSecQs = questions.filter(
      (q) => (q.topic || exam.subject || "Section A").toUpperCase().trim() === currentQSec
    );
    const isLastInSec = currentSecQs[currentSecQs.length - 1].id === current.id;

    if (isLastInSec) {
      // Last question in this section - check if there is a next section
      const curSecIdx = sections.indexOf(currentQSec);
      if (curSecIdx !== -1 && curSecIdx < sections.length - 1) {
        const nextSec = sections[curSecIdx + 1];
        alert(`You have completed the [${currentQSec}] section. Moving to the next section: [${nextSec}]`);
        advanceSectionSelect(nextSec);
      }
    } else {
      // Standard next question in same section
      const curIdxInSec = currentSecQs.findIndex((q) => q.id === current.id);
      const nextQInSec = currentSecQs[curIdxInSec + 1];
      const nextGlobalIdx = questions.findIndex((q) => q.id === nextQInSec.id);
      handleQuestionSelect(nextGlobalIdx);
    }
  };

  const handleClear = () => {
    setResponses((prev) => ({ ...prev, [current.id]: null }));
    setCommittedResponses((prev) => {
      const { [current.id]: _, ...rest } = prev;
      return rest;
    });
    setStatus((prev) => ({ ...prev, [current.id]: "notAnswered" }));
  };

  const handleSaveMarkReview = () => {
    const ans = responses[current.id];
    const isAnswered =
      ans !== undefined &&
      ans !== null &&
      ans !== "" &&
      (!Array.isArray(ans) || ans.length > 0);

    setStatus((prev) => ({
      ...prev,
      [current.id]: isAnswered ? "answeredAndMarkedForReview" : "markedForReview",
    }));

    setCommittedResponses((prev) => {
      if (isAnswered) {
        return { ...prev, [current.id]: ans };
      } else {
        const { [current.id]: _, ...rest } = prev;
        return rest;
      }
    });

    advanceNext();
  };

  const handleMarkReviewNext = () => {
    const ans = responses[current.id];
    const isAnswered =
      ans !== undefined &&
      ans !== null &&
      ans !== "" &&
      (!Array.isArray(ans) || ans.length > 0);

    setStatus((prev) => ({
      ...prev,
      [current.id]: isAnswered ? "answeredAndMarkedForReview" : "markedForReview",
    }));

    setCommittedResponses((prev) => {
      if (isAnswered) {
        return { ...prev, [current.id]: ans };
      } else {
        const { [current.id]: _, ...rest } = prev;
        return rest;
      }
    });

    advanceNext();
  };

  const handleBack = () => {
    if (currentIdx > 0) {
      revertUnsavedChanges(current.id);
      handleQuestionSelect(currentIdx - 1);
    }
  };

  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      revertUnsavedChanges(current.id);
      handleQuestionSelect(currentIdx + 1);
    }
  };

  // Evaluation & Final Submission
  const getSubmissionStats = () => {
    const counts = {
      notVisited: 0,
      notAnswered: 0,
      answered: 0,
      markedForReview: 0,
      answeredAndMarkedForReview: 0,
    };
    questions.forEach((q) => {
      const s = status[q.id] || "notVisited";
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  };

  const counts = getSubmissionStats();

  const parseNumericalRange = (answerStr) => {
    if (!answerStr) return null;
    const clean = String(answerStr).trim();

    if (/\s+to\s+/i.test(clean)) {
      const parts = clean.split(/\s+to\s+/i);
      const min = parseFloat(parts[0]);
      const max = parseFloat(parts[1]);
      if (!isNaN(min) && !isNaN(max)) {
        return { min: Math.min(min, max), max: Math.max(min, max), isRange: true };
      }
    }

    const rangeMatch = clean.match(/^(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (!isNaN(min) && !isNaN(max)) {
        return { min: Math.min(min, max), max: Math.max(min, max), isRange: true };
      }
    }

    const val = parseFloat(clean);
    if (!isNaN(val)) {
      return { min: val, max: val, isRange: false };
    }

    return null;
  };

  const executeSubmission = async (isAuto = false) => {
    if (isSubmittingRef.current || isSubmittedRef.current) return;
    isSubmittingRef.current = true;
    setSubmitting(true);
    try {
      const userId = sessionStorage.getItem("userId");
      if (!userId) throw new Error("No student session found.");
      const timerKey = `exam_start_time_${examId}`;

      // Automatically commit the current question's active selection if it exists in responses but not yet committed
      const finalCommittedResponses = { ...committedResponses };
      const currentQ = questions[currentIdx];
      if (currentQ && currentQ.id && responses[currentQ.id] !== undefined && responses[currentQ.id] !== null && responses[currentQ.id] !== "") {
        finalCommittedResponses[currentQ.id] = responses[currentQ.id];
      }

      // Call secure server-side scoring API
      const token = sessionTokenRef.current || sessionStorage.getItem('studentSessionToken') || '';

      const response = await fetch(`${API_BASE_URL}/api/submit-exam`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          draftId: draftId,
          answers: finalCommittedResponses
        })
      });

      const resData = await response.json();
      if (!response.ok) {
        throw new Error(resData.error || 'Failed to submit exam.');
      }

      // Mark as submitted to prevent UNEXPECTED_TAB_CLOSE logging
      isSubmittedRef.current = true;

      // Complete active personal assignment if it exists
      try {
        await fetch(`${API_BASE_URL}/api/student/exams/${examId}/complete-assignment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });
      } catch (e) {
        console.error("Error completing personal assignment:", e);
      }

      // Clear local auto-save cache and timers
      sessionStorage.removeItem(timerKey);
      localStorage.removeItem(timerKey);
      localStorage.removeItem(`exam_responses_${examId}_${userId}`);
      localStorage.removeItem(`exam_status_${examId}_${userId}`);

      // Stop proctoring camera stream immediately
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (proctorChannelRef.current) {
        supabase.removeChannel(proctorChannelRef.current);
        proctorChannelRef.current = null;
      }
      sessionStorage.removeItem("cameraGranted");

      if (!isAuto) alert("Examination responses saved and submitted successfully!");
      
      // Attempt exiting fullscreen when done
      try {
        if (document.exitFullscreen) document.exitFullscreen();
      } catch (e) {}

      navigate("/student/dashboard");
    } catch (err) {
      console.error("Submission failed:", err);
      isSubmittingRef.current = false;
      alert("Failed to submit exam: " + err.message);
    } finally {
      setSubmitting(false);
      setSubmitModalOpen(false);
    }
  };

  const handleAutoSubmit = () => {
    executeSubmission(true);
  };

  const renderOptions = () => {
    const qType = current.question_type || current.type;

    if (qType === "numerical_integer" || qType === "numerical_decimal") {
      return (
        <div className="mt-4">
          <label className="block text-xs font-bold text-gray-500 uppercase mb-2">
            Your Answer ({qType === "numerical_decimal" ? "Decimal value" : "Integer value"}):
          </label>
          <input
            type="number"
            step={qType === "numerical_decimal" ? "any" : "1"}
            className="border-2 border-gray-300 p-2.5 w-64 text-sm font-semibold rounded shadow-inner focus:outline-none focus:border-[#1f497d]"
            placeholder="Type numerical value"
            value={responses[current.id] || ""}
            onChange={(e) => setResponses({ ...responses, [current.id]: e.target.value })}
            disabled={cameraAccessLost}
          />
        </div>
      );
    }

    if (!current.options || !Array.isArray(current.options)) return null;

    if (qType === "single" || qType === "mcq_single" || qType === "true_false") {
      return current.options.map((opt, i) => {
        const parsed = parseOption(opt);
        return (
          <label key={i} className="flex flex-col gap-2 my-2 md:my-3 p-2.5 md:p-3 bg-gray-55 hover:bg-blue-50 rounded border border-gray-300 cursor-pointer transition-colors">
            <div className="flex items-center gap-2.5 md:gap-3 text-xs md:text-sm font-semibold">
              <input
                type="radio"
                name={`q-${current.id}`}
                checked={areOptionsEqual(responses[current.id], opt)}
                onChange={() => setResponses({ ...responses, [current.id]: opt })}
                className="w-4 md:w-4.5 h-4 md:h-4.5 text-[#1f497d] cursor-pointer"
                disabled={cameraAccessLost}
              />
              <span className="text-gray-800">{parsed.text}</span>
            </div>
            {parsed.image_url && (
              <div style={{ paddingLeft: '28px' }} className="mt-1">
                <div 
                  className="relative inline-block cursor-zoom-in group border rounded bg-white p-1 shadow-sm overflow-hidden"
                  onClick={(e) => {
                    if (cameraAccessLost) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setZoomedImage(parsed.image_url);
                    setZoomScale(1);
                  }}
                  title="Click to zoom option image"
                >
                  <img src={parsed.image_url} alt={`Option ${i+1} Visual`} className="max-w-full md:max-w-2xl h-auto rounded block object-contain" style={{ imageRendering: 'auto' }} />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all duration-200 rounded flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black bg-opacity-65 text-white text-[10px] font-bold px-2 py-1 rounded shadow flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                      Click to Zoom
                    </span>
                  </div>
                </div>
              </div>
            )}
          </label>
        );
      });
    }

    if (qType === "multiple" || qType === "mcq_multiple" || qType === "subjective") {
      return current.options.map((opt, i) => {
        const parsed = parseOption(opt);
        return (
          <label key={i} className="flex flex-col gap-2 my-2 md:my-3 p-2.5 md:p-3 bg-gray-55 hover:bg-blue-50 rounded border border-gray-300 cursor-pointer transition-colors">
            <div className="flex items-center gap-2.5 md:gap-3 text-xs md:text-sm font-semibold">
              <input
                type="checkbox"
                checked={Array.isArray(responses[current.id]) ? responses[current.id].some(a => areOptionsEqual(a, opt)) : areOptionsEqual(responses[current.id], opt)}
                onChange={() => {
                  let arr = responses[current.id] || [];
                  if (!Array.isArray(arr)) {
                    arr = arr ? [arr] : [];
                  }
                  const alreadySelected = arr.some(a => areOptionsEqual(a, opt));
                  arr = alreadySelected ? arr.filter((o) => !areOptionsEqual(o, opt)) : [...arr, opt];
                  setResponses({ ...responses, [current.id]: arr });
                }}
                className="w-4 md:w-4.5 h-4 md:h-4.5 text-[#1f497d] cursor-pointer rounded"
                disabled={cameraAccessLost}
              />
              <span className="text-gray-800">{parsed.text}</span>
            </div>
            {parsed.image_url && (
              <div style={{ paddingLeft: '28px' }} className="mt-1">
                <div 
                  className="relative inline-block cursor-zoom-in group border rounded bg-white p-1 shadow-sm overflow-hidden"
                  onClick={(e) => {
                    if (cameraAccessLost) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setZoomedImage(parsed.image_url);
                    setZoomScale(1);
                  }}
                  title="Click to zoom option image"
                >
                  <img src={parsed.image_url} alt={`Option ${i+1} Visual`} className="max-w-full md:max-w-2xl h-auto rounded block object-contain" style={{ imageRendering: 'auto' }} />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all duration-200 rounded flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black bg-opacity-65 text-white text-[10px] font-bold px-2 py-1 rounded shadow flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                      Click to Zoom
                    </span>
                  </div>
                </div>
              </div>
            )}
          </label>
        );
      });
    }

    return (
      <input
        type="text"
        className="border p-2.5 w-full text-sm font-semibold rounded shadow-inner"
        placeholder="Type answer here"
        value={responses[current.id] || ""}
        onChange={(e) => setResponses({ ...responses, [current.id]: e.target.value })}
        disabled={cameraAccessLost}
      />
    );
  };

  const getButtonClass = (qId, idx) => {
    const s = status[qId] || "notVisited";
    let base = "w-9 h-8 flex items-center justify-center text-xs font-bold border transition-all cursor-pointer ";

    if (currentIdx === idx) {
      base += "ring-2 ring-[#1f497d] ring-offset-1 ";
    }

    if (s === "notVisited") {
      return base + "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 rounded";
    }
    if (s === "notAnswered") {
      return base + "bg-[#e0533c] border-[#d0432c] text-white rounded-t-md rounded-bl-md hover:opacity-90";
    }
    if (s === "answered") {
      return base + "bg-[#4caf50] border-[#3e9e42] text-white rounded-t-md rounded-br-md hover:opacity-90";
    }
    if (s === "markedForReview") {
      return base + "bg-[#5e35b1] border-[#4e25a1] text-white rounded-full hover:opacity-90";
    }
    if (s === "answeredAndMarkedForReview") {
      return base + "bg-[#5e35b1] border-[#4e25a1] text-white rounded-full relative hover:opacity-90";
    }
    return base;
  };

  // ── RENDER GUARDS (loading FIRST so blockers never fire during data fetch) ──

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center font-bold bg-[#f1f4f9] text-[#1f497d]">
        <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        LOADING HARMAN RATHI TESTING AGENCY EXAMINATION SYSTEM...
      </div>
    );
  }

  // Error screen — shown if data failed to load (network issue, RLS error, etc.)
  if (loadError) {
    return (
      <div className="h-screen flex flex-col items-center justify-center font-bold bg-[#f1f4f9] text-[#1f497d] p-8 text-center">
        <svg className="w-16 h-16 text-red-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        <h2 className="text-xl font-black text-red-600 mb-2">Unable to Load Examination</h2>
        <p className="text-sm text-gray-600 font-semibold mb-6 max-w-md leading-relaxed">{loadError}</p>
        <div className="flex gap-3">
          <button
            onClick={() => { setLoadError(null); setLoading(true); window.location.reload(); }}
            className="bg-[#1f497d] hover:bg-[#15345a] text-white px-8 py-2.5 rounded font-bold uppercase transition-colors shadow cursor-pointer"
          >
            Retry
          </button>
          <button
            onClick={() => navigate("/student/dashboard")}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-8 py-2.5 rounded font-bold uppercase transition-colors cursor-pointer"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }




  if (questions.length === 0) {
    return (
      <div className="h-screen flex flex-col items-center justify-center font-bold bg-[#f1f4f9] p-8 text-center">
        <p className="text-xl text-red-600 mb-4">No questions have been configured for this exam yet.</p>
        <button onClick={() => navigate("/student/dashboard")} className="bg-[#1f497d] text-white px-6 py-2.5 rounded font-bold hover:bg-[#15345a]">
          Return to Dashboard
        </button>
      </div>
    );
  }

  const activeSectionQs = questions.filter(
    (q) => (q.topic || exam.subject || "Section A").toUpperCase().trim() === activeSection
  );

  return (
    <div className="h-screen flex flex-col bg-[#e6e6e6] font-sans select-none">
      
      {!isOnline && (
        <div className="bg-red-600 text-white font-bold px-4 py-2 text-center text-xs tracking-wider animate-pulse flex items-center justify-center gap-2 z-50 shrink-0 shadow-lg border-b border-red-700">
          <span className="h-2.5 w-2.5 rounded-full bg-white animate-ping"></span>
          CONNECTION LOST. YOUR PROGRESS IS SAVED LOCALLY. RECONNECTING...
        </div>
      )}

      {isOnline && syncError && (
        <div className="bg-amber-600 text-white font-bold px-4 py-1.5 text-center text-[10px] tracking-wider flex items-center justify-center gap-2 z-50 shrink-0 shadow-md">
          ⚠️ BACKGROUND SYNC DELAYED. RETRYING AUTOMATICALLY...
        </div>
      )}
      
      {/* 1. TOP NAV BAR */}
      <div className="bg-[#1f497d] text-white py-1 px-6 flex justify-between items-center text-[11px] font-bold border-b border-[#143256] shrink-0">
        <span className="tracking-wide uppercase">Harman Rathi Testing Agency - Candidate Terminal</span>
        <button
          onClick={() => {
            if (cameraAccessLost) return;
            if (window.confirm("Return to student dashboard? Your current responses will NOT be saved unless submitted.")) {
              sessionStorage.removeItem(`exam_start_time_${examId}`);
              try {
                if (document.exitFullscreen) document.exitFullscreen();
              } catch (e) {}
              navigate("/student/dashboard");
            }
          }}
          disabled={cameraAccessLost}
          className="bg-[#28a745] hover:bg-[#218838] px-3.5 py-1 text-white font-bold flex items-center gap-1 rounded transition-colors text-[10px] uppercase shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path>
          </svg>
          Home
        </button>
      </div>

      {/* 2. MAIN LOGO HEADER BANNER */}
      <div className="bg-white px-4 md:px-6 py-2 flex justify-between items-center border-b border-gray-300 shadow-sm shrink-0">
        {/* Left: Mahatma Gandhi Logo */}
        <div className="hidden md:flex items-center">
          <img src="/assets/gandhi.png" alt="Gandhi 150 Years" className="h-12 w-auto object-contain" />
        </div>

        {/* Center-Left: Branding */}
        <div className="flex-1 px-1 md:px-6 flex flex-col items-start leading-none justify-center">
          <span className="text-[8px] md:text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-0.5">राष्ट्रीय परीक्षा एजेंसी</span>
          <span className="text-[#1f497d] text-base md:text-lg font-extrabold tracking-tight">Harman Rathi Testing Agency</span>
          <span className="text-[7px] md:text-[8px] font-bold text-white bg-[#28a745] px-1.5 py-0.5 rounded tracking-widest uppercase inline-block mt-1">
            Excellence in Assessment
          </span>
        </div>


      </div>

      {/* 3. CANDIDATE PROFILE & EXAM SPEC DETAILS BAR */}
      <div className="bg-[#f9f9f9] border border-gray-300 m-2 p-3 rounded flex flex-col sm:flex-row justify-between gap-4 shadow-sm items-center shrink-0">
        {/* Profile photo and specs */}
        <div className="flex items-center gap-4 w-full sm:w-auto flex-1">
          <div className="w-12 h-16 sm:w-16 sm:h-20 bg-white border border-gray-400 p-0.5 rounded shadow-sm overflow-hidden flex items-center justify-center shrink-0">
            {student?.photo_url ? (
              <img src={student.photo_url} alt="Candidate" className="w-full h-full object-cover" />
            ) : (
              <svg className="w-8 h-10 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            )}
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:text-xs font-semibold text-gray-700 flex-1">
            <div>
              <span className="text-gray-500">Candidate Name :</span>{" "}
              <span className="text-[#e0533c] font-bold uppercase">{student?.full_name || "STUDENT NAME"}</span>
            </div>
            <div>
              <span className="text-gray-500">Exam Name :</span>{" "}
              <span className="text-gray-900 font-bold">{exam?.title || "JEE-Main"}</span>
            </div>
            <div>
              <span className="text-gray-500">Subject Name :</span>{" "}
              <span className="text-gray-900 font-bold">{exam?.subject || "Core Course"}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 sm:mt-0">
              <span className="text-gray-500">Remaining Time :</span>{" "}
              <span className="bg-[#029bc4] text-white font-mono font-bold px-2.5 py-0.5 rounded text-[11px] sm:text-xs tracking-widest shadow-sm">
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>
        </div>

        {/* Language select dropdown */}
        <div className="flex items-center gap-2 text-xs font-bold text-gray-700 border-t sm:border-t-0 sm:border-l border-gray-300 pt-2.5 sm:pt-0 pl-0 sm:pl-4 w-full sm:w-auto shrink-0">
          <span>View In:</span>
          <select 
            disabled={cameraAccessLost}
            className="border border-gray-400 rounded px-3 py-1 bg-white text-xs font-bold outline-none focus:border-[#1f497d] shadow-sm flex-1 sm:flex-none disabled:opacity-50"
          >
            <option value="english">English</option>
          </select>
        </div>
      </div>

      {/* 4. SPLIT GRID INTERFACE */}
      <div className="flex flex-1 overflow-hidden px-2 pb-2 gap-2 relative">
        
        {/* Left Column: Question Area */}
        <div className={`bg-white border border-gray-400 flex flex-col rounded shadow-sm overflow-hidden transition-all duration-300 w-full ${
          isSidebarOpen ? "md:w-2/3 lg:w-3/4" : ""
        }`}>
          
          {/* Section Selector Tabs - NTA style */}
          {sections.length > 1 && (
            <div className="flex bg-gray-100 border-b border-gray-300 text-[10px] md:text-xs font-bold shrink-0 overflow-x-auto">
              {sections.map((sec) => (
                <button
                  key={sec}
                  onClick={() => {
                    if (cameraAccessLost) return;
                    handleSectionSelect(sec);
                  }}
                  disabled={cameraAccessLost}
                  className={`px-3.5 md:px-5 py-2 md:py-2.5 border-r border-gray-300 transition-colors uppercase tracking-wider cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${
                    activeSection === sec
                      ? "bg-[#1f497d] text-white border-b-2 border-b-yellow-500"
                      : "bg-gray-55 hover:bg-gray-200 text-gray-700"
                  }`}
                >
                  {sec}
                </button>
              ))}
            </div>
          )}

          <div className="bg-[#1f497d] text-white p-2.5 font-bold text-[10px] md:text-xs uppercase flex justify-between items-center shrink-0">
            <span>Section: <span className="text-yellow-400">{activeSection}</span></span>
            <div className="flex items-center gap-2">
              <span className="bg-yellow-500 text-gray-900 text-[9px] md:text-[10px] px-2 py-0.5 rounded font-black">
                Q. {currentIdx + 1} of {questions.length}
              </span>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="block md:hidden bg-white/10 hover:bg-white/20 border border-white/20 px-2 py-0.5 rounded text-[9px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                {isSidebarOpen ? "Close Grid" : "Open Grid"}
              </button>
            </div>
          </div>

          {/* Question Text Area */}
          <div className="flex-1 p-6 overflow-y-auto">
            <h3 className="font-bold text-base text-gray-800 border-b border-gray-250 pb-3 mb-4">
              Question {currentIdx + 1}:
            </h3>
            
            <div className="text-sm font-semibold text-gray-800 mb-6 whitespace-pre-wrap leading-relaxed select-none">
              {current.question_text}
            </div>

            {/* Attached Graphic Image - Full original quality, no compression */}
            {current.image_url && current.image_url !== "null" && current.image_url.trim() !== "" && !imageError && (
              <div className="my-6 text-center border p-2 bg-gray-50 mx-auto shadow-sm rounded overflow-auto">
                <div
                  className="relative inline-block cursor-zoom-in group"
                  onClick={() => { setZoomedImage(current.image_url); setZoomScale(1); }}
                  title="Click to zoom"
                >
                  <img
                    src={current.image_url}
                    alt="Question Graphic"
                    className="max-w-full h-auto mx-auto rounded block"
                    style={{ display: 'block', imageRendering: 'auto' }}
                    onError={() => setImageError(true)}
                  />
                  {/* Zoom hint overlay */}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-all duration-200 rounded flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black bg-opacity-60 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                      Click to Zoom
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 font-semibold mt-1">🔍 Click image to zoom in | Pinch or scroll to zoom in lightbox</p>
              </div>
            )}

            {/* Image Zoom Lightbox Modal - supports pinch zoom + mouse wheel zoom */}
            {zoomedImage && (
              <div
                className="fixed inset-0 z-[9999] bg-black bg-opacity-95 flex items-center justify-center"
                onClick={() => { setZoomedImage(null); setZoomScale(1); }}
                onWheel={(e) => {
                  e.preventDefault();
                  setZoomScale(prev => Math.min(Math.max(prev - e.deltaY * 0.002, 0.5), 5));
                }}
              >
                {/* Zoom controls */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20" onClick={e => e.stopPropagation()}>
                  <button onClick={() => setZoomScale(p => Math.max(p - 0.25, 0.5))} className="bg-white bg-opacity-20 hover:bg-opacity-40 text-white font-black w-9 h-9 rounded-full text-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg">−</button>
                  <span className="text-white text-xs font-bold bg-black bg-opacity-50 px-3 py-1 rounded-full">{Math.round(zoomScale * 100)}%</span>
                  <button onClick={() => setZoomScale(p => Math.min(p + 0.25, 5))} className="bg-white bg-opacity-20 hover:bg-opacity-40 text-white font-black w-9 h-9 rounded-full text-xl flex items-center justify-center cursor-pointer transition-colors shadow-lg">+</button>
                  <button onClick={() => setZoomScale(1)} className="bg-white bg-opacity-20 hover:bg-opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-full cursor-pointer transition-colors shadow-lg">Reset</button>
                </div>

                {/* Close button */}
                <button
                  onClick={() => { setZoomedImage(null); setZoomScale(1); }}
                  className="absolute top-4 right-4 text-white bg-red-600 hover:bg-red-700 rounded-full w-10 h-10 flex items-center justify-center font-black text-xl shadow-lg z-20 cursor-pointer transition-colors"
                  title="Close"
                >
                  ✕
                </button>

                {/* Scrollable image container for pinch/zoom */}
                <div
                  className="overflow-auto w-full h-full flex items-center justify-center"
                  style={{ touchAction: 'pinch-zoom' }}
                  onClick={e => e.stopPropagation()}
                  onTouchStart={e => {
                    if (e.touches.length === 2) {
                      const dist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                      );
                      setZoomLastDist(dist);
                    }
                  }}
                  onTouchMove={e => {
                    if (e.touches.length === 2 && zoomLastDist !== null) {
                      const dist = Math.hypot(
                        e.touches[0].clientX - e.touches[1].clientX,
                        e.touches[0].clientY - e.touches[1].clientY
                      );
                      const delta = dist - zoomLastDist;
                      setZoomScale(prev => Math.min(Math.max(prev + delta * 0.005, 0.5), 5));
                      setZoomLastDist(dist);
                    }
                  }}
                  onTouchEnd={() => setZoomLastDist(null)}
                >
                  <img
                    src={zoomedImage}
                    alt="Zoomed Question Graphic"
                    style={{
                      transform: `scale(${zoomScale})`,
                      transformOrigin: 'center center',
                      transition: 'transform 0.1s ease',
                      imageRendering: 'auto',
                      maxWidth: 'none',
                      display: 'block',
                      margin: 'auto',
                    }}
                    draggable={false}
                  />
                </div>

                <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-xs font-semibold opacity-50 pointer-events-none">
                  Pinch / Scroll to zoom • Use +/− buttons • Click outside to close
                </p>
              </div>
            )}

            {/* Answer Options Inputs */}
            <div className="border-t border-gray-200 pt-4 mt-6">
              {renderOptions()}
            </div>

            {/* Last Question Warning Notice */}
            {currentIdx === questions.length - 1 && (
              <div className="mt-6 bg-orange-50 border-l-4 border-orange-500 p-3 text-orange-850 text-xs font-bold rounded shadow-inner">
                ⚠️ You are on the last question of this exam. Please review your answers and click "Save & Submit Exam" below to complete.
              </div>
            )}
          </div>

          {/* Bottom Action Button Matrix */}
          <div className="bg-gray-100 p-3 md:p-4 border-t border-gray-300 flex flex-col gap-2.5 md:gap-3 shrink-0">
            {/* Row 1: Save & Mark Options */}
            <div className="flex flex-wrap gap-1.5 md:gap-2">
              {currentIdx === questions.length - 1 ? (
                <button
                  onClick={() => {
                    // Update status for the final question
                    const ans = responses[current.id];
                    const isAnswered = ans !== undefined && ans !== null && ans !== "" && (!Array.isArray(ans) || ans.length > 0);
                    setStatus((prev) => ({ ...prev, [current.id]: isAnswered ? "answered" : "notAnswered" }));
                    setCommittedResponses((prev) => {
                      if (isAnswered) {
                        return { ...prev, [current.id]: ans };
                      } else {
                        const { [current.id]: _, ...rest } = prev;
                        return rest;
                      }
                    });
                    setSubmitModalOpen(true);
                  }}
                  disabled={cameraAccessLost}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 md:px-6 py-2 text-[10px] md:text-xs font-black rounded shadow-md uppercase transition-all animate-pulse cursor-pointer tracking-wide flex-1 sm:flex-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="hidden sm:inline">Save & Submit Exam</span>
                  <span className="inline sm:hidden">Save & Submit</span>
                </button>
              ) : (
                <button
                  onClick={handleSaveNext}
                  disabled={cameraAccessLost}
                  className="bg-[#28a745] hover:bg-[#218838] text-white px-4 md:px-5 py-2 text-[10px] md:text-xs font-bold rounded shadow-sm uppercase transition-colors cursor-pointer flex-1 sm:flex-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save & Next
                </button>
              )}
              <button
                onClick={handleClear}
                disabled={cameraAccessLost}
                className="bg-white hover:bg-gray-50 border border-gray-400 text-gray-700 px-4 md:px-5 py-2 text-[10px] md:text-xs font-bold rounded shadow-sm uppercase transition-colors cursor-pointer flex-1 sm:flex-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
              <button
                onClick={handleSaveMarkReview}
                disabled={cameraAccessLost}
                className="bg-[#f0ad4e] hover:bg-[#ec971f] text-white px-4 md:px-5 py-2 text-[10px] md:text-xs font-bold rounded shadow-sm uppercase transition-colors cursor-pointer flex-1 sm:flex-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Save & Mark For Review</span>
                <span className="inline sm:hidden">Save & Review</span>
              </button>
              <button
                onClick={handleMarkReviewNext}
                disabled={cameraAccessLost}
                className="bg-[#0275d8] hover:bg-[#025aa5] text-white px-4 md:px-5 py-2 text-[10px] md:text-xs font-bold rounded shadow-sm uppercase transition-colors cursor-pointer flex-1 sm:flex-none text-center disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Mark For Review & Next</span>
                <span className="inline sm:hidden">Review & Next</span>
              </button>
            </div>

            {/* Row 2: Standard Navigation + Submit */}
            <div className="flex justify-between items-center border-t border-gray-300 pt-2.5 md:pt-3">
              <div className="flex gap-1.5 md:gap-2 flex-1 sm:flex-none">
                <button
                  onClick={handleBack}
                  disabled={currentIdx === 0 || cameraAccessLost}
                  className="bg-white border border-gray-400 text-gray-700 px-4 md:px-5 py-2 text-[10px] md:text-xs font-bold rounded shadow-sm uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex-1 sm:flex-none text-center"
                >
                  &lt;&lt; Back
                </button>
                <button
                  onClick={handleNext}
                  disabled={currentIdx === questions.length - 1 || cameraAccessLost}
                  className="bg-white border border-gray-400 text-gray-700 px-4 md:px-5 py-2 text-[10px] md:text-xs font-bold rounded shadow-sm uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex-1 sm:flex-none text-center"
                >
                  Next &gt;&gt;
                </button>
              </div>
              
              <button
                onClick={() => setSubmitModalOpen(true)}
                disabled={cameraAccessLost}
                className="bg-[#5cb85c] hover:bg-[#4cae4c] text-white px-4 md:px-8 py-2 md:py-2.5 text-[10px] md:text-xs font-black rounded shadow transition-all uppercase cursor-pointer tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="hidden sm:inline">Submit Exam</span>
                <span className="inline sm:hidden">Submit</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Sidebar Backdrop Overlay */}
        {isSidebarOpen && (
          <div 
            className="block md:hidden fixed inset-0 bg-black/50 z-30 transition-opacity"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Collapsible Sidebar Toggle handle (Desktop only) */}
        <div className="hidden md:flex items-center justify-center shrink-0 z-10">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="bg-[#333] hover:bg-black text-white w-5 h-16 rounded flex items-center justify-center shadow-md cursor-pointer transition-colors"
            title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
          >
            {isSidebarOpen ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1-1.414l-4-4a1 1 0 010-1.414l-4-4a1 1 0 011.414 0z" clipRule="evenodd"></path>
              </svg>
            )}
          </button>
        </div>

        {/* Right Column: Legend counts & Questions Palette Grid (Overlay on mobile, sidebar on desktop) */}
        <div className={`bg-white border-l border-gray-400 md:rounded p-4 flex flex-col shrink-0 transition-all duration-300 fixed md:relative top-0 right-0 bottom-0 z-40 md:z-auto shadow-2xl md:shadow-none h-full md:h-auto ${
          isSidebarOpen 
            ? "w-80 translate-x-0 opacity-100" 
            : "w-0 translate-x-full opacity-0 pointer-events-none md:hidden"
        }`}>
          
          <div className="flex justify-between items-center border-b pb-2 mb-3">
            <h4 className="font-bold text-xs uppercase text-gray-700 tracking-wide">
              Question Palette
            </h4>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="block md:hidden text-gray-400 hover:text-red-500 text-sm font-black p-1 cursor-pointer"
              title="Close Panel"
            >
              ✕
            </button>
          </div>

          {/* NTA Status Legend Grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 border border-gray-300 border-dashed p-2.5 rounded mb-4 text-[10px] font-bold text-gray-650 bg-gray-50">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-6 bg-gray-200 border border-gray-400 rounded flex items-center justify-center font-bold text-gray-700">{counts.notVisited}</div>
              <span>Not Visited</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-7 h-6 bg-[#e0533c] border-[#d0432c] text-white rounded-t-md rounded-bl-md flex items-center justify-center font-bold">{counts.notAnswered}</div>
              <span>Not Answered</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-7 h-6 bg-[#4caf50] border-[#3e9e42] text-white rounded-t-md rounded-br-md flex items-center justify-center font-bold">{counts.answered}</div>
              <span>Answered</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-7 h-6 bg-[#5e35b1] border-[#4e25a1] text-white rounded-full flex items-center justify-center font-bold">{counts.markedForReview}</div>
              <span>Marked for Review</span>
            </div>
            <div className="flex items-center space-x-2 col-span-2 border-t pt-1.5 mt-1 border-gray-250">
              <div className="w-7 h-6 bg-[#5e35b1] border-[#4e25a1] text-white rounded-full flex items-center justify-center font-bold relative shrink-0">
                {counts.answeredAndMarkedForReview}
                <span className="absolute bottom-0.5 right-0.5 w-2 h-2 bg-green-400 rounded-full border border-white"></span>
              </div>
              <span className="leading-tight text-[9px] text-gray-550">Answered & Marked for Review (will be evaluated)</span>
            </div>
          </div>

          <h5 className="font-bold text-[10px] uppercase text-[#1f497d] mb-2 tracking-wider flex justify-between">
            <span>Grid ({activeSection}):</span>
            <span className="text-[#e0533c] font-black">{activeSectionQs.length} Qs</span>
          </h5>

          {/* Question Grid Buttons Palette - Filtered to Active Section */}
          <div className="flex-1 overflow-y-auto border border-gray-300 p-2.5 bg-gray-50 rounded shadow-inner max-h-[350px]">
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, i) => {
                const qSec = (q.topic || exam.subject || "Section A").toUpperCase().trim();
                // Filter buttons to only display questions from the active tab section
                if (qSec !== activeSection) return null;

                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      if (cameraAccessLost) return;
                      revertUnsavedChanges(current.id);
                      handleQuestionSelect(i);
                    }}
                    disabled={cameraAccessLost}
                    className={`${getButtonClass(q.id, i)} disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {String(i + 1).padStart(2, "0")}
                    {status[q.id] === "answeredAndMarkedForReview" && (
                      <span className="absolute bottom-0.5 right-0.5 w-2 h-2 bg-green-400 rounded-full border border-white"></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 5. BACKDROP CONFIRMATION MODAL ON SUBMIT */}
      {submitModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-[#1f497d] rounded-lg shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#1f497d] text-white px-5 py-3 font-bold text-sm uppercase flex justify-between items-center">
              <span>Exam Submission Confirmation</span>
              <button
                onClick={() => setSubmitModalOpen(false)}
                className="text-white hover:text-gray-300 text-lg font-bold outline-none cursor-pointer"
              >
                &times;
              </button>
            </div>
            
            <div className="p-5 text-xs text-gray-700 leading-relaxed font-sans">
              <p className="font-bold text-gray-800 text-sm mb-3">
                Here is a summary of your attempt counts:
              </p>
              
              <table className="w-full border-collapse border border-gray-300 mb-5 text-left font-semibold">
                <tbody>
                  <tr className="border-b border-gray-250 bg-gray-50">
                    <td className="p-2 border-r border-gray-250 text-gray-500">Total Questions:</td>
                    <td className="p-2 text-gray-850 font-black">{questions.length}</td>
                  </tr>
                  <tr className="border-b border-gray-250 bg-green-50">
                    <td className="p-2 border-r border-gray-250 text-green-700">Answered:</td>
                    <td className="p-2 text-green-800 font-black">{counts.answered}</td>
                  </tr>
                  <tr className="border-b border-gray-250 bg-red-50">
                    <td className="p-2 border-r border-gray-250 text-red-700">Not Answered:</td>
                    <td className="p-2 text-red-800 font-black">{counts.notAnswered}</td>
                  </tr>
                  <tr className="border-b border-gray-250 bg-purple-50">
                    <td className="p-2 border-r border-gray-250 text-purple-700">Marked for Review:</td>
                    <td className="p-2 text-purple-800 font-black">{counts.markedForReview}</td>
                  </tr>
                  <tr className="border-b border-gray-250 bg-indigo-50">
                    <td className="p-2 border-r border-gray-250 text-indigo-700">Answered & Marked for Review:</td>
                    <td className="p-2 text-indigo-800 font-black">{counts.answeredAndMarkedForReview}</td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="p-2 border-r border-gray-250 text-gray-400">Not Visited:</td>
                    <td className="p-2 text-gray-600 font-black">{counts.notVisited}</td>
                  </tr>
                </tbody>
              </table>
              
              <p className="font-bold text-red-600 text-center text-sm border-t pt-3">
                Are you sure you want to submit your final responses?
              </p>
              <p className="text-center text-gray-500 text-[10px] mt-1">
                You will not be able to modify your answers after this action.
              </p>
            </div>
            
            <div className="bg-gray-100 px-5 py-3 border-t border-gray-300 flex justify-end gap-3.5">
              <button
                onClick={() => setSubmitModalOpen(false)}
                className="px-5 py-1.5 bg-white border border-gray-400 text-gray-700 rounded font-bold hover:bg-gray-50 text-xs shadow-sm uppercase cursor-pointer"
              >
                No, Go Back
              </button>
              <button
                onClick={() => executeSubmission(false)}
                disabled={submitting}
                className="px-6 py-1.5 bg-[#28a745] hover:bg-[#218838] text-white rounded font-black shadow-sm text-xs uppercase disabled:opacity-50 cursor-pointer"
              >
                {submitting ? "Submitting..." : "Yes, Submit Exam"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. CAMERA LOSS LOCKOUT MODAL */}
      {cameraAccessLost && (
        <div className="fixed inset-0 bg-slate-950/80 z-[10000] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white border-2 border-red-600 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center font-sans">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 text-red-600 mb-4 text-3xl">
                📷
              </div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-2">Camera or Microphone Lost</h3>
              <div className="text-sm text-slate-600 font-semibold leading-relaxed mb-6">
                Proctoring is active for this examination. Your exam has been temporarily locked because camera or microphone access was interrupted.
                <p className="mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 p-2.5 rounded-xl font-bold">
                  ⚠️ Please check your webcam and microphone connections, ensure both are enabled in your browser settings, then click "Restore Access" to resume.
                </p>
              </div>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={restoreCameraAccess}
                  disabled={cameraRetryLoading}
                  className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded-xl shadow-md transition-colors text-sm uppercase tracking-wide flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {cameraRetryLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Restoring Access...
                    </>
                  ) : (
                    "Restore Access"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. PROCTOR LOCKOUT MODAL (For tab switches, covers, freezes) */}
      {isProctorLocked && !isRejected && (
        <div className="fixed inset-0 bg-slate-950/90 z-[10000] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white border-2 border-amber-500 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden p-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center font-sans">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-amber-100 text-amber-600 mb-4 text-3xl">
                ⚠️
              </div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-2">Exam Locked</h3>
              <div className="text-sm text-slate-650 font-bold leading-relaxed mb-6">
                You have been flagged for a proctoring violation:
                <p className="mt-2 text-xs bg-red-50 text-red-800 border border-red-205 p-2.5 rounded-xl font-black uppercase tracking-wide">
                  {lockReason || "Tab Switch Detected"}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  Please request your Superadmin to review your feed and unlock your exam interface. You cannot view questions or write answers until unlocked.
                </p>
              </div>
              <div className="flex justify-center">
                {unlockRequestSent ? (
                  <div className="w-full bg-slate-100 text-slate-600 font-bold py-2.5 px-4 rounded-xl text-sm uppercase flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Waiting for Superadmin Approval...
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const userId = sessionStorage.getItem("userId");
                        if (userId) {
                          const token = sessionTokenRef.current || sessionStorage.getItem('studentSessionToken') || '';
                          await fetch(`${API_BASE_URL}/api/student/exams/${examId}/lock`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({
                              draftId: draftId || null,
                              reason: lockReason,
                              status: "pending_unlock"
                            })
                          });
                        }
                      } catch (dbErr) {
                        console.warn("Failed to update lock row to pending_unlock:", dbErr);
                      }

                      if (proctorChannelRef.current) {
                        try {
                          await proctorChannelRef.current.send({
                            type: "broadcast",
                            event: "signal",
                            payload: {
                              type: "UNLOCK_REQUEST",
                              sender: "student",
                              data: { studentName: student?.full_name, studentId: student?.id, reason: lockReason }
                            }
                          });
                        } catch (err) {
                          console.warn("Failed to broadcast unlock request:", err);
                        }
                      }
                      setUnlockRequestSent(true);
                      logViolation('PROCTORING_UNLOCK_REQUESTED', { reason: lockReason });
                    }}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-gray-950 font-black py-2.5 px-4 rounded-xl shadow-md transition-colors text-sm uppercase tracking-wide cursor-pointer"
                  >
                    Request Unlock
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8. PERMANENT CHEATING FAILURE MODAL */}
      {isRejected && (
        <div className="fixed inset-0 bg-slate-950 z-[10001] flex items-center justify-center p-4">
          <div className="bg-red-50 border-2 border-red-600 rounded-2xl max-w-md w-full shadow-2xl p-8 text-center font-sans animate-in fade-in duration-300">
            <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-red-100 text-red-650 mb-6 text-4xl">
              🚫
            </div>
            <h3 className="text-2xl font-black text-red-700 uppercase tracking-tight mb-4">Exam Terminated</h3>
            <h4 className="text-md font-bold text-slate-800 uppercase mb-3">Status: FAILED & CHEATER FLAGGED</h4>
            <div className="text-sm text-slate-650 font-semibold leading-relaxed mb-6">
              You have failed this exam. The Superadmin has permanently blocked your interface and terminated your session due to cheating violations.
              <p className="mt-3 text-xs bg-red-100/50 text-red-800 border border-red-200/60 p-3 rounded-xl font-bold uppercase">
                Cheater Flagged. No further access is allowed.
              </p>
            </div>
            <button
              onClick={() => navigate("/")}
              className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider"
            >
              Exit to Portal
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
