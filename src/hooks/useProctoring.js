import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { apiClient } from '../lib/api';
import {
  generateECDHKeyPair,
  exportPublicKey,
  importPeerPublicKey,
  deriveSharedKey,
  encryptPayload,
  decryptPayload
} from '../lib/webrtcCrypto';

export function useProctoring({
  examId,
  student,
  isSubmittedRef,
  executeBlockSubmission
}) {
  const [cameraAccessLost, setCameraAccessLost] = useState(false);
  const [cameraRetryLoading, setCameraRetryLoading] = useState(false);
  const [isProctorLocked, setIsProctorLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [unlockRequestSent, setUnlockRequestSent] = useState(false);
  const [isRejected, setIsRejected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const proctorChannelRef = useRef(null);
  const studentIceQueueRef = useRef([]);
  const ownKeyPairRef = useRef(null);
  const sharedKeyRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const offerIntervalRef = useRef(null);
  const lockChannelRef = useRef(null);
  const maxWarningsRef = useRef(15); // Increased default limit to 15!
  const tabSwitchCountRef = useRef(0);
  const cameraAccessLostRef = useRef(false);

  // Helper to log violations
  async function logViolation(action, details = {}) {
    try {
      const userId = sessionStorage.getItem("userId");
      await apiClient('/api/audit-log', {
        method: 'POST',
        body: JSON.stringify({
          userId: userId || 'Unknown',
          userRole: 'student',
          displayName: student?.full_name || 'Student',
          action,
          details: {
            exam_id: examId,
            exam_title: details.exam_title || '',
            ...details
          }
        })
      });
    } catch (e) {
      console.warn("Failed to log violation to audit-log:", e);
    }
  }

  // Trigger exam warning log (decoupled non-blocking)
  async function triggerExamLock(reason) {
    // Under decoupled architecture, this NEVER blocks/locks the exam automatically.
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
      const draftId = sessionStorage.getItem(`exam_draft_id_${examId}`);
      if (userId) {
        await apiClient(`/api/student/exams/${examId}/lock`, {
          method: 'POST',
          body: JSON.stringify({
            draftId: draftId || null,
            reason: reason,
            status: "warning_triggered"
          })
        });
      }
    } catch (dbErr) {
      console.warn("Failed to record proctor warning status to DB:", dbErr);
    }
  }

  // Set up camera & WebRTC proctoring
  useEffect(() => {
    const userId = sessionStorage.getItem("userId");
    if (!userId || !examId || !student) return;

    let stream = null;
    let pollingInterval = null;
    const channelName = `exam_proctor_${userId}`;
    console.log(`[useProctoring] 📡 Student joining signaling channel: "${channelName}"`);
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
        setIsConnecting(false);
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
      console.log("[useProctoring] ✅ RTCPeerConnection created.");

      pc.onconnectionstatechange = () => {
        console.log("[useProctoring] WebRTC Connection State Changed:", pc.connectionState);
        if (pc.connectionState === "connected") {
          logViolation('SIGNALING_ESTABLISHED', { connection_state: pc.connectionState });
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          if (!isSubmittedRef.current) {
            logViolation('STREAM_DISCONNECTED', { connection_state: pc.connectionState });
          }
        }
      };

      activeStream.getTracks().forEach((track) => {
        pc.addTrack(track, activeStream);
      });

      pc.onicecandidate = async (event) => {
        if (event.candidate && sharedKeyRef.current) {
          const encryptedCand = await encryptPayload(event.candidate, sharedKeyRef.current);
          apiClient('/api/webrtc-signal/student-ice', {
            method: 'POST',
            body: JSON.stringify({ candidate: encryptedCand })
          }).catch(e => console.warn("Failed to send student ICE candidate:", e));
        }
      };

      console.log("[useProctoring] ⏳ Creating SDP offer...");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const encryptedOffer = await encryptPayload(offer, sharedKeyRef.current);
      await apiClient('/api/webrtc-signal/offer', {
        method: 'POST',
        body: JSON.stringify({ offer: encryptedOffer })
      });
      console.log("[useProctoring] ✅ E2E Encrypted SDP offer sent.");
      setIsConnecting(false);
    }

    const offscreenVideo = document.createElement('video');
    offscreenVideo.muted = true;
    offscreenVideo.playsInline = true;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 64;
    offscreenCanvas.height = 48;
    const canvasCtx = offscreenCanvas.getContext('2d');

    async function startCameraAndProctoring() {
      try {
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
        offscreenVideo.srcObject = stream;
        offscreenVideo.play().catch(e => console.warn("Offscreen video play failed:", e));

        setupTrackListeners(stream);

        let consecutiveBlackFrames = 0;
        let prevFramesSent = null;
        let consecutiveFrozenChecks = 0;

        pollingInterval = setInterval(async () => {
          if (isSubmittedRef.current || cameraAccessLostRef.current || isProctorLocked || isRejected) {
            return;
          }

          const activeStream = localStreamRef.current || stream;
          if (!activeStream) return;

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

        const keyPair = await generateECDHKeyPair();
        ownKeyPairRef.current = keyPair;
        const jwkPub = await exportPublicKey(keyPair.publicKey);

        try {
          const regResp = await apiClient('/api/webrtc-signal/student-pubkey', {
            method: 'POST',
            body: JSON.stringify({ pubkey: jwkPub })
          });
          const regData = await regResp.json();
          if (regData.adminPubkey) {
            console.log("[useProctoring] E2E shared key derived initially.");
            const peerKey = await importPeerPublicKey(regData.adminPubkey);
            sharedKeyRef.current = await deriveSharedKey(keyPair.privateKey, peerKey);
          }
        } catch (regErr) {
          console.warn("[useProctoring] Failed to register public key initially. Polling will retry.", regErr);
        }

        pollIntervalRef.current = setInterval(async () => {
          try {
            if (isSubmittedRef.current || isRejected) return;

            if (!sharedKeyRef.current) {
              const pResp = await apiClient('/api/webrtc-signal/admin-pubkey');
              const pData = await pResp.json();
              if (pData.adminPubkey) {
                console.log("[useProctoring] E2E shared key derived from poll.");
                const peerKey = await importPeerPublicKey(pData.adminPubkey);
                sharedKeyRef.current = await deriveSharedKey(ownKeyPairRef.current.privateKey, peerKey);
              } else {
                return;
              }
            }

            const pollResp = await apiClient('/api/webrtc-signal/poll-student');
            const pollData = await pollResp.json();

            if (pollData.adminConnected && !peerConnectionRef.current && !isConnecting) {
              setIsConnecting(true);
              console.log("[useProctoring] Admin connected signal received. Starting WebRTC connection...");
              await setupPeerConnection();
            }

            if (pollData.answer && peerConnectionRef.current) {
              if (peerConnectionRef.current.signalingState !== "stable") {
                const decryptedAns = await decryptPayload(pollData.answer, sharedKeyRef.current);
                console.log("[useProctoring] 📥 Decrypted SDP_ANSWER received from admin.");
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(decryptedAns));
                
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
            console.warn("[useProctoring] Error in poll signaling loop:", err);
          }
        }, 2500);

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
                  maxWarningsRef.current = 15; // Set back to 15!
                  logViolation('PROCTORING_UNLOCK_GRANTED', { note: 'Lock cleared via DB approval' });
                  
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
          apiClient('/api/audit-log', {
            method: 'POST',
            body: JSON.stringify({
              userId: userId || 'Unknown',
              userRole: 'student',
              displayName: student?.full_name || 'Student',
              action: 'PERMISSION_REVOKED',
              details: { exam_id: examId, reason: 'initialization_failed', error: err.message }
            })
          }).catch(e => console.warn("Failed to audit initial camera failure:", e));
        } catch (logErr) {}
      }
    }

    startCameraAndProctoring();

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
    };
  }, [examId, student?.id]);

  // Backup polling for proctor lock status
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

        if (!data || data.status === 'approved') {
          console.log("Backup poll detected unlock. Restoring exam state...");
          setIsProctorLocked(false);
          setLockReason("");
          setUnlockRequestSent(false);
          tabSwitchCountRef.current = 0;
          maxWarningsRef.current = 15; // Set to 15!
          
          if (data) {
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
        await apiClient('/api/audit-log', {
          method: 'POST',
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

  const stopProctoring = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (offerIntervalRef.current) clearInterval(offerIntervalRef.current);
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (proctorChannelRef.current) {
      supabase.removeChannel(proctorChannelRef.current);
      proctorChannelRef.current = null;
    }
    if (lockChannelRef.current) {
      supabase.removeChannel(lockChannelRef.current);
      lockChannelRef.current = null;
    }
    sessionStorage.removeItem("cameraGranted");
  };

  return {
    cameraAccessLost,
    cameraRetryLoading,
    restoreCameraAccess,
    stopProctoring,
    isProctorLocked,
    setIsProctorLocked,
    lockReason,
    setLockReason,
    unlockRequestSent,
    setUnlockRequestSent,
    isRejected,
    setIsRejected,
    tabSwitchCountRef,
    maxWarningsRef,
    triggerExamLock,
    logViolation,
    cameraAccessLostRef
  };
}
