import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const MainLogin = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('student'); // 'student' or 'super_admin'
  const [step, setStep] = useState('login'); // 'login', 'otp', 'mfa_challenge', or 'mfa_setup'
  
  // Form State
  const [applicationId, setApplicationId] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [secretKey, setSecretKey] = useState('');
  
  // Security & OTP
  const [captchaText, setCaptchaText] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA States
  const [mfaTempToken, setMfaTempToken] = useState('');
  const [mfaEmail, setMfaEmail] = useState('');
  const [mfaSecretKey, setMfaSecretKey] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [pendingLoginData, setPendingLoginData] = useState(null);
  const siteKey = '6LePiSstAAAAAMrXU7L-BBBSFm2beiH1Os17JqbA';

  // Generate authentic looking NTA CAPTCHA
  const generateCaptcha = () => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptchaText(result);
    setCaptchaInput('');
  };

  useEffect(() => {
    generateCaptcha();
    // Clear any existing session on login page load to prevent conflicts
    sessionStorage.clear();
  }, [activeTab]);


  // Static Grid Ripple Background Animation (Google AI Studio aesthetic)
  useEffect(() => {
    const canvas = document.getElementById('cosmic-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    const COLS = 28;
    const ROWS = 18;
    const dots = [];
    const startTime = Date.now();
    
    // Mouse interaction states
    let mouseX = -1000;
    let mouseY = -1000;

    // Build the grid structure
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        dots.push({
          col: c,
          row: r,
          x: 0,
          y: 0
        });
      }
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // Recalculate grid spacing to span the entire viewport perfectly
      const spacingX = canvas.width / (COLS + 1);
      const spacingY = canvas.height / (ROWS + 1);

      dots.forEach((dot) => {
        dot.x = (dot.col + 1) * spacingX;
        dot.y = (dot.row + 1) * spacingY;

        // Pre-calculate Gemini 5-node mesh gradient base color for this coordinate position
        const nx = dot.x / canvas.width;
        const ny = dot.y / canvas.height;

        // Distances from this coordinate to the 5 control nodes in 0.0 - 1.0 UV space
        const d_top = Math.sqrt((nx - 0.5) * (nx - 0.5) + ny * ny);
        const d_left = Math.sqrt(nx * nx + (ny - 0.5) * (ny - 0.5));
        const d_bottom = Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 1.0) * (ny - 1.0));
        const d_right = Math.sqrt((nx - 1.0) * (nx - 1.0) + (ny - 0.5) * (ny - 0.5));
        const d_center = Math.sqrt((nx - 0.5) * (nx - 0.5) + (ny - 0.5) * (ny - 0.5));

        // Weights: Inverse square distance weighting (Shepard's method)
        // Add epsilon (0.001) to prevent division by zero at exact node positions
        const wt_top = 1.0 / (d_top * d_top + 0.001);
        const wt_left = 1.0 / (d_left * d_left + 0.001);
        const wt_bottom = 1.0 / (d_bottom * d_bottom + 0.001);
        const wt_right = 1.0 / (d_right * d_right + 0.001);
        const wt_center = 2.2 / (d_center * d_center + 0.001); // Center node weight (2.2) keeps rich sky blue dominant

        const totalWt = wt_top + wt_left + wt_bottom + wt_right + wt_center;

        // Interpolation performed in Linear RGB space (value^2) to prevent muddy gray artifacts!
        // Color values: Red(243, 73, 73), Yellow(242, 191, 26), Green(26, 187, 109), Blue(58, 139, 254), SkyBlue(65, 144, 234)
        const linR = (59049 * wt_top + 58564 * wt_left + 676 * wt_bottom + 3364 * wt_right + 4225 * wt_center) / totalWt;
        const linG = (5329 * wt_top + 36481 * wt_left + 34969 * wt_bottom + 19321 * wt_right + 20736 * wt_center) / totalWt;
        const linB = (5329 * wt_top + 676 * wt_left + 11881 * wt_bottom + 64516 * wt_right + 54756 * wt_center) / totalWt;

        // Convert back to standard sRGB space (Math.sqrt)
        const baseR = Math.sqrt(linR);
        const baseG = Math.sqrt(linG);
        const baseB = Math.sqrt(linB);

        // Convert RGB to HSL coordinates (ignoring base lightness L, as we dynamically pulse L from 35% to 85%)
        const rNorm = baseR / 255;
        const gNorm = baseG / 255;
        const bNorm = baseB / 255;
        const max = Math.max(rNorm, gNorm, bNorm);
        const min = Math.min(rNorm, gNorm, bNorm);
        let h = 0, s = 0;
        const l = (max + min) / 2;

        if (max !== min) {
          const d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          switch (max) {
            case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
            case gNorm: h = (bNorm - rNorm) / d + 2; break;
            case bNorm: h = (rNorm - gNorm) / d + 4; break;
          }
          h /= 6;
        }

        dot.h = h * 360;
        dot.s = s * 100;
      });
    };

    const handleMouseMove = (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const handleMouseLeave = () => {
      mouseX = -1000;
      mouseY = -1000;
    };

    // Smooth origin tracking coordinates
    let ox = window.innerWidth / 2;
    let oy = window.innerHeight / 2;

    const animate = () => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Use screen composite mode for high-end glowing overlay aesthetic
      ctx.globalCompositeOperation = 'screen';
      
      const elapsed = Date.now() - startTime;
      
      // Moving corner-to-corner loop: 4 corners in 12 seconds (3.0s per corner transition)
      const transitionDuration = 3000;
      const cycleTime = elapsed % 12000;
      const phaseIndex = Math.floor(cycleTime / transitionDuration); // 0, 1, 2, 3
      const t = (cycleTime % transitionDuration) / transitionDuration; // 0 to 1
      
      // Quadratic Ease-in-Out interpolation formula
      const easedT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      
      // Corner coordinates calculations
      const getCornerPos = (index) => {
        const w = canvas.width;
        const h = canvas.height;
        switch (index) {
          case 0: return { x: w * 0.82, y: h * 0.18 }; // TR
          case 1: return { x: w * 0.18, y: h * 0.82 }; // BL
          case 2: return { x: w * 0.82, y: h * 0.82 }; // BR
          case 3: return { x: w * 0.18, y: h * 0.18 }; // TL
          default: return { x: w / 2, y: h / 2 };
        }
      };

      const pStart = getCornerPos(phaseIndex);
      const pEnd = getCornerPos((phaseIndex + 1) % 4);
      
      const targetX = pStart.x + (pEnd.x - pStart.x) * easedT;
      const targetY = pStart.y + (pEnd.y - pStart.y) * easedT;
      
      // Interpolate searchlight wave origin smoothly for a beautiful fluid glide
      ox += (targetX - ox) * 0.12;
      oy += (targetY - oy) * 0.12;

      // Searchlight bubble radius (about 22% of screen dimension)
      const waveRadius = Math.max(canvas.width, canvas.height) * 0.22;
      dots.forEach((dot) => {
        // Distance calculation (Pythagoras) from current scanner origin
        const dx = dot.x - ox;
        const dy = dot.y - oy;
        const d = Math.sqrt(dx * dx + dy * dy);
        
        // Visibility Bubble: only draw when within the searchlight wave
        if (d < waveRadius) {
          const intensity = 1.0 - (d / waveRadius); // 1.0 (center) to 0.0 (edge)
          
          // Smooth bell curve opacity emergence
          const opacity = Math.sin(intensity * Math.PI / 2);
          
          // Distance-Based Scaling (base: 1.0px, peak: 5.5px)
          const minRadius = 1.0;
          const maxRadiusVal = 5.5;
          const rVal = minRadius + (maxRadiusVal - minRadius) * opacity;
          
          // High-Luminosity Sparkle (No White): Idle L = 35% -> Peak L = 85%
          const lightness = 35 + 50 * opacity;
          
          ctx.fillStyle = `hsla(${Math.round(dot.h)}, ${Math.round(dot.s)}%, ${Math.round(lightness)}%, ${opacity.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, rVal, 0, Math.PI * 2);
          ctx.fill();
        }
        // Outside the bubble is completely invisible (opacity 0) - skipped to optimize GPU fill-rate!
      });
      
      ctx.globalCompositeOperation = 'source-over';
      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    
    resizeCanvas();
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      if (canvas) {
        canvas.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, []);


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('expired') === 'true' || params.get('session_expired') === 'true') {
      setError('Your session has expired. Please log in again.');
    }
  }, []);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (captchaInput.toUpperCase() !== captchaText.toUpperCase()) {
      setError('Invalid Security Pin. Please enter the pin exactly as shown.');
      generateCaptcha();
      return;
    }

    setLoading(true);
    try {
      // Ensure reCAPTCHA Enterprise is loaded and ready, otherwise use fallback token
      let token = 'recaptcha_bypass_fallback';
      if (window.grecaptcha && window.grecaptcha.enterprise && window.grecaptcha.enterprise.execute) {
        // Generate the Enterprise verification token at the moment of submission
        token = await new Promise((resolve) => {
          window.grecaptcha.enterprise.ready(async () => {
            try {
              const t = await window.grecaptcha.enterprise.execute(siteKey, { action: 'LOGIN' });
              resolve(t || 'recaptcha_bypass_fallback');
            } catch (err) {
              console.warn('reCAPTCHA Enterprise execution failed, falling back:', err);
              resolve('recaptcha_bypass_fallback');
            }
          });
        });
      } else {
        console.warn('reCAPTCHA Enterprise script not loaded, using fallback.');
      }
      
      console.log('reCAPTCHA Verification Token resolved:', token);

      const endpoint = activeTab === 'student' ? '/api/send-student-otp' : '/api/send-superadmin-otp';
      
      const payload = activeTab === 'student' 
        ? { 
            applicationId: applicationId.trim(), 
            dateOfBirth: dob,
            recaptchaToken: token,
            turnstileToken: token // Backwards compatible fallback
          } 
        : { 
            email: email.trim(), 
            secretKey: secretKey.trim(),
            recaptchaToken: token,
            turnstileToken: token // Backwards compatible fallback
          };

      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
      const sendRes = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const sendData = await sendRes.json();
      if (!sendRes.ok) {
        throw new Error(sendData.error || sendData.message || 'Failed to send OTP.');
      }

      setStep('otp');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const identifier = activeTab === 'student' ? applicationId.trim() : email.trim();
      
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
      const response = await fetch(`${apiBaseUrl}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          identifier: identifier, 
          otp: otp.trim(),
          role: activeTab === 'student' ? 'student' : 'super_admin'
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Invalid or Expired OTP.');
      }

      // Check if MFA challenge is required
      if (data.mfaRequired) {
        setMfaTempToken(data.tempToken);
        setMfaEmail(data.email || identifier);
        setStep('mfa_challenge');
        setMfaCode('');
        setLoading(false);
        return;
      }

      // Check if MFA setup is required
      if (data.mfaSetupRequired) {
        setMfaTempToken(data.tempToken);
        setPendingLoginData(data);
        setMfaSecretKey(data.mfaSecret);
        setStep('mfa_setup');
        setMfaCode('');
        setLoading(false);
        return;
      }

      sessionStorage.setItem('role', data.role);
      sessionStorage.setItem('userId', data.userId);
      if (data.userEmail) sessionStorage.setItem('userEmail', data.userEmail);
      if (data.loginLogId) sessionStorage.setItem('loginLogId', data.loginLogId);
      sessionStorage.setItem('loginTime', new Date().toISOString());

      // Native Supabase Sign-in Sync
      try {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        const { error: authErr } = await supabase.auth.signInWithPassword({
          email: data.userEmail,
          password: data.dbPassword
        });
        if (authErr) {
          console.error("Supabase Auth Sync failed:", authErr.message);
          throw new Error("Failed to synchronize database session: " + authErr.message);
        }
      } catch (e) {
        console.error("Supabase Auth Sync error:", e.message);
        throw e;
      }

      if (data.role === 'super_admin' || data.role === 'admin') {
        navigate('/admin/dashboard', { replace: true });
      } else {
        navigate('/student/dashboard', { replace: true });
      }
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaChallengeSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
      const response = await fetch(`${apiBaseUrl}/api/verify-mfa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempToken: mfaTempToken,
          code: mfaCode.trim()
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Invalid or Expired MFA code.');
      }

      // MFA challenge passed! Set credentials and redirect
      sessionStorage.setItem('role', data.role);
      sessionStorage.setItem('userId', data.userId);
      if (data.userEmail) sessionStorage.setItem('userEmail', data.userEmail);
      if (data.loginLogId) sessionStorage.setItem('loginLogId', data.loginLogId);
      sessionStorage.setItem('loginTime', new Date().toISOString());

      // Native Supabase Sign-in Sync
      try {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        const { error: authErr } = await supabase.auth.signInWithPassword({
          email: data.userEmail,
          password: data.dbPassword
        });
        if (authErr) {
          console.error("Supabase Auth Sync failed:", authErr.message);
          throw new Error("Failed to synchronize database session: " + authErr.message);
        }
      } catch (e) {
        console.error("Supabase Auth Sync error:", e.message);
        throw e;
      }

      navigate('/admin/dashboard', { replace: true });

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSetupSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!mfaTempToken) {
        throw new Error('MFA setup session missing. Please try logging in again.');
      }

      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
      const response = await fetch(`${apiBaseUrl}/api/setup-mfa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tempToken: mfaTempToken,
          code: mfaCode.trim()
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || 'MFA setup verification failed.');
      }

      // MFA setup succeeded! Complete login by populating sessionStorage
      sessionStorage.setItem('role', data.role);
      sessionStorage.setItem('userId', data.userId);
      if (data.userEmail) sessionStorage.setItem('userEmail', data.userEmail);
      if (data.loginLogId) sessionStorage.setItem('loginLogId', data.loginLogId);
      sessionStorage.setItem('loginTime', new Date().toISOString());

      // Native Supabase Sign-in Sync
      try {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        const { error: authErr } = await supabase.auth.signInWithPassword({
          email: data.userEmail,
          password: data.dbPassword
        });
        if (authErr) {
          console.error("Supabase Auth Sync failed:", authErr.message);
          throw new Error("Failed to synchronize database session: " + authErr.message);
        }
      } catch (e) {
        console.error("Supabase Auth Sync error:", e.message);
        throw e;
      }

      navigate('/admin/dashboard', { replace: true });

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#000000] text-slate-100 font-sans flex flex-col relative overflow-hidden selection:bg-cyan-500 selection:text-slate-950">
      
      {/* CANVAS COLOR-CHANGING PARTICLES BACKGROUND */}
      <canvas id="cosmic-canvas" className="fixed inset-0 w-full h-full pointer-events-none z-0" />

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_80%,transparent_100%)] pointer-events-none z-0"></div>

      {/* Subtle background nebulae */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-500/5 blur-[120px] pointer-events-none z-0"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/5 blur-[120px] pointer-events-none z-0"></div>

      {/* 1. GOVT HEADER (FULLY TRANSPARENT) */}
      <div className="bg-transparent border-b border-white/5 z-10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <img src="/assets/hrta_circle_logo.png" alt="HRTA Logo" className="h-16 brightness-110 contrast-125" />
            <div className="hidden md:block">
              <h1 className="text-cyan-400 font-extrabold text-xl leading-tight uppercase tracking-wide">Harman Rathi Testing Agency</h1>
              <h2 className="text-slate-400 text-xs font-bold uppercase tracking-wider mt-0.5">Department of Higher Education</h2>
            </div>
          </div>
        </div>
      </div>

      {/* 2. BLUE/DARK NAVIGATION (FULLY TRANSPARENT) */}
      <div className="bg-transparent border-b border-white/5 z-10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center">
          <div className="flex space-x-6 text-xs font-bold uppercase py-3.5 tracking-wider">
            <span className="text-cyan-400 hover:text-cyan-300 cursor-pointer transition-colors">Home</span>
            <span className="text-slate-400 hover:text-cyan-300 cursor-pointer transition-colors">Information Bulletin</span>
            <span className="text-slate-400 hover:text-cyan-300 cursor-pointer transition-colors">Syllabus</span>
            <span className="text-slate-400 hover:text-cyan-300 cursor-pointer transition-colors">Contact Us</span>
          </div>
        </div>
      </div>

      {/* 3. SCROLLING MARQUEE (FULLY TRANSPARENT) */}
      <div className="bg-transparent border-b border-white/5 py-2 px-4 shadow-sm flex z-10 relative">
        <div className="bg-gradient-to-r from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 text-cyan-300 text-[10px] font-black px-3 py-1 whitespace-nowrap uppercase tracking-wider rounded-md flex items-center shadow-md">Latest News</div>
        <div className="overflow-hidden flex-1 relative flex items-center bg-transparent ml-4">
          <div className="animate-marquee whitespace-nowrap text-xs font-bold text-cyan-300/90">
            <span className="mx-4">🔔 Inviting Online Applications for HRTA Examination 2026</span>
            <span className="mx-4 text-slate-700">|</span>
            <span className="mx-4">🔔 Mock Test Portal is now live for registered candidates</span>
            <span className="mx-4 text-slate-700">|</span>
            <span className="mx-4">🔔 Ensure your profile photo meets the standard guidelines before appearing for tests.</span>
          </div>
        </div>
      </div>

      {/* 4. MAIN CONTENT AREA */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex flex-col md:flex-row gap-8 flex-1 w-full z-10 relative">
        
        {/* LEFT COLUMN - INSTRUCTIONS (100% TRANSPARENT GLASSMORPHISM) */}
        <div className="w-full md:w-7/12 space-y-6">
          <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-transparent text-white px-5 py-4 border-b border-white/5 font-bold uppercase tracking-wide text-xs flex justify-between items-center">
              <span>Steps to Apply Online</span>
              <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded text-[10px] font-black uppercase">HRTA 2026</span>
            </div>
            <div className="p-6 space-y-6 text-sm text-slate-200 font-medium">
              <div className="flex gap-4 items-start">
                <div className="bg-cyan-500/10 text-cyan-400 font-black h-9 w-9 rounded-full flex items-center justify-center shrink-0 border border-cyan-500/20 shadow-md">1</div>
                <div>
                  <h3 className="font-bold text-cyan-400 mb-1 text-base">Apply for Online Registration</h3>
                  <p className="text-slate-450 leading-relaxed">Obtain your Application Number from the administrator. This unique HRTA ID will be used for all future logins and communications.</p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="bg-cyan-500/10 text-cyan-400 font-black h-9 w-9 rounded-full flex items-center justify-center shrink-0 border border-cyan-500/20 shadow-md">2</div>
                <div>
                  <h3 className="font-bold text-cyan-400 mb-1 text-base">Authenticate Profile</h3>
                  <p className="text-slate-450 leading-relaxed">Login using your Application Number and Date of Birth. Verify your identity using the One Time Password (OTP) sent to your registered email address.</p>
                </div>
              </div>
              <div className="flex gap-4 items-start">
                <div className="bg-cyan-500/10 text-cyan-400 font-black h-9 w-9 rounded-full flex items-center justify-center shrink-0 border border-cyan-500/20 shadow-md">3</div>
                <div>
                  <h3 className="font-bold text-cyan-400 mb-1 text-base">Access Examination Portal</h3>
                  <p className="text-slate-450 leading-relaxed">Once authenticated, access your candidate dashboard to view active tests, upcoming schedules, and download your official scorecards.</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4 text-xs text-amber-300 font-semibold shadow-inner flex items-start gap-2.5">
            <svg className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div>
              <span className="font-bold uppercase tracking-wider text-amber-400 block mb-0.5">Security Notice:</span>
              Please do not share your Application Number or OTP with anyone. The testing agency will never call you asking for these details.
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - LOGIN BOX (100% TRANSPARENT GLASSMORPHISM) */}
        <div className="w-full md:w-5/12">
          <div className="bg-transparent border border-white/10 shadow-2xl rounded-2xl overflow-hidden">
            
            {/* Form Header */}
            <div className="bg-transparent text-white text-center py-4 border-b border-white/5 font-bold text-base uppercase tracking-wider">
              Candidate Login Portal
            </div>

            {/* Form Tabs (Hidden during OTP) */}
            {step === 'login' && (
              <div className="flex border-b border-white/5 bg-transparent">
                <button
                  type="button"
                  className={`flex-1 py-3 text-xs font-bold uppercase transition-all ${activeTab === 'student' ? 'bg-cyan-500/10 text-cyan-400 border-t-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'}`}
                  onClick={() => { setActiveTab('student'); setError(''); }}
                >
                  Student Login
                </button>
                <button
                  type="button"
                  className={`flex-1 py-3 text-xs font-bold uppercase transition-all ${activeTab === 'super_admin' ? 'bg-cyan-500/10 text-cyan-400 border-t-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'}`}
                  onClick={() => { setActiveTab('super_admin'); setError(''); }}
                >
                  Admin Console
                </button>
              </div>
            )}

            <div className="p-6 md:p-8">
              {error && (
                <div className="mb-5 bg-red-500/10 border-l-4 border-red-500 p-3.5 text-red-400 text-xs font-bold flex items-start shadow-md rounded-r-md">
                  <svg className="w-5 h-5 mr-2.5 shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {/* STEP 1: CREDENTIALS */}
              {step === 'login' && (
                <form onSubmit={handleLoginSubmit} className="space-y-5">
                  {activeTab === 'student' ? (
                    <>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Application No <span className="text-red-500">*</span></label>
                        <input
                          type="text" required
                          value={applicationId}
                          onChange={(e) => setApplicationId(e.target.value)}
                          className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold placeholder-slate-650 transition-all text-sm focus:border-transparent"
                          placeholder="e.g. HRTA001"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Password (Date of Birth) <span className="text-red-500">*</span></label>
                        <input
                          type="date" required
                          value={dob}
                          onChange={(e) => setDob(e.target.value)}
                          className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold transition-all text-sm focus:border-transparent"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Administrator Email *</label>
                        <input
                          type="email" required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold transition-all text-sm focus:border-transparent placeholder-slate-600"
                          placeholder="admin@hrta.com"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Secret Key *</label>
                        <input
                          type="password" required
                          value={secretKey}
                          onChange={(e) => setSecretKey(e.target.value)}
                          className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold transition-all text-sm focus:border-transparent placeholder-••••••••"
                          placeholder="••••••••"
                        />
                      </div>
                    </>
                  )}

                  {/* Captcha Section */}
                  <div className="pt-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Security Pin *</label>
                    <div className="flex items-center space-x-3 mb-3">
                      <div className="bg-transparent border border-white/10 px-6 py-2.5 font-mono text-xl tracking-[0.3em] font-black text-cyan-400 rounded-xl select-none line-through decoration-slate-650 decoration-2 italic shadow-inner w-3/4 text-center">
                        {captchaText}
                      </div>
                      <button type="button" onClick={generateCaptcha} className="w-1/4 bg-white/5 hover:bg-white/10 text-slate-350 py-2.5 rounded-xl transition flex items-center justify-center border border-white/10 cursor-pointer shadow-sm" title="Refresh PIN">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      </button>
                    </div>
                    <input
                      type="text" required
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value)}
                      className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold transition-all text-sm focus:border-transparent placeholder-slate-600 mb-4"
                      placeholder="Enter Security Pin"
                    />

                  </div>

                  <button
                    type="submit" disabled={loading}
                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 py-3.5 rounded-xl font-extrabold text-sm shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex justify-center items-center uppercase tracking-wider mt-6 disabled:opacity-70 cursor-pointer"
                  >
                    {loading ? (
                      <svg className="animate-spin h-5 w-5 mr-3 text-slate-950" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : "Login"}
                  </button>

                  {/* Google reCAPTCHA v3 Notice */}
                  <div className="text-center text-[10px] text-slate-500 mt-4 leading-relaxed max-w-[280px] mx-auto">
                    This site is protected by reCAPTCHA and the Google{' '}
                    <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-cyan-500/80 hover:underline">
                      Privacy Policy
                    </a>{' '}
                    and{' '}
                    <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer" className="text-cyan-500/80 hover:underline">
                      Terms of Service
                    </a>{' '}
                    apply.
                  </div>
                </form>
              )}

              {/* STEP 2: OTP VERIFICATION */}
              {step === 'otp' && (
                <form onSubmit={handleOtpSubmit} className="space-y-6">
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-white/5 border border-white/10 rounded-full flex items-center justify-center mx-auto mb-4 shadow-md">
                      <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                    </div>
                    <h3 className="font-bold text-lg text-white">Two-Step Verification</h3>
                    <p className="text-xs text-slate-400 mt-2 font-medium leading-relaxed">
                      Please enter the 6-digit OTP sent to your registered email address to complete verification.
                    </p>
                  </div>

                  <div>
                    <input
                      type="text" required maxLength="6"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      className="w-full border border-white/10 px-4 py-4 text-center text-3xl font-black tracking-[0.7em] rounded-xl bg-transparent focus:outline-none focus:border-cyan-500 transition-colors text-white"
                      placeholder="••••••"
                    />
                  </div>

                  <div className="flex space-x-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setStep('login'); setOtp(''); generateCaptcha(); }}
                      className="w-1/3 bg-white/5 hover:bg-white/10 text-slate-300 py-3.5 rounded-xl font-bold transition-colors border border-white/10 shadow-sm text-xs uppercase"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading || otp.length !== 6}
                      className="w-2/3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 py-3.5 rounded-xl font-black shadow-lg transition-colors flex justify-center items-center uppercase text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Verifying...' : 'Verify & Proceed'}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 3: MFA CHALLENGE */}
              {step === 'mfa_challenge' && (
                <form onSubmit={handleMfaChallengeSubmit} className="space-y-6">
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-cyan-500/10 border border-cyan-500/25 rounded-full flex items-center justify-center mx-auto mb-4 shadow-md">
                      <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                      </svg>
                    </div>
                    <h3 className="font-bold text-lg text-white">Multi-Factor Authentication</h3>
                    <p className="text-xs text-slate-400 mt-2 font-medium leading-relaxed">
                      Enter the 6-digit verification code from your Authenticator app for <strong className="text-cyan-400">{mfaEmail}</strong>.
                    </p>
                  </div>

                  <div>
                    <input
                      type="text" required maxLength="6"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full border border-white/10 px-4 py-4 text-center text-3xl font-black tracking-[0.7em] rounded-xl bg-transparent focus:outline-none focus:border-cyan-500 transition-colors text-white"
                      placeholder="••••••"
                    />
                  </div>

                  <div className="flex space-x-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setStep('login'); setMfaCode(''); }}
                      className="w-1/3 bg-white/5 hover:bg-white/10 text-slate-300 py-3.5 rounded-xl font-bold transition-colors border border-white/10 shadow-sm text-xs uppercase"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || mfaCode.length !== 6}
                      className="w-2/3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 py-3.5 rounded-xl font-black shadow-lg transition-colors flex justify-center items-center uppercase text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Verifying...' : 'Verify & Login'}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 4: MFA SETUP */}
              {step === 'mfa_setup' && (
                <form onSubmit={handleMfaSetupSubmit} className="space-y-5">
                  <div className="text-center mb-4">
                    <div className="w-12 h-12 bg-cyan-500/10 border border-cyan-500/25 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
                      <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                    </div>
                    <h3 className="font-bold text-base text-white">Enable Multi-Factor Authentication</h3>
                    <p className="text-[11px] text-slate-400 mt-1 font-medium leading-relaxed">
                      Scan the QR code or enter the key manually in your Authenticator app (e.g. Google Authenticator) to enable 2FA security.
                    </p>
                  </div>

                  <div className="flex flex-col items-center bg-white/5 border border-white/10 p-4 rounded-xl space-y-3">
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent('otpauth://totp/HRTA:' + (pendingLoginData?.userEmail || 'admin') + '?secret=' + mfaSecretKey + '&issuer=HRTA')}`}
                      alt="MFA QR Code"
                      className="w-[150px] h-[150px] bg-white p-2 rounded-lg border border-cyan-500/20 shadow-md"
                    />
                    <div className="text-center w-full">
                      <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Secret Key (Manual Entry)</span>
                      <code className="text-xs bg-slate-900/60 text-cyan-400 border border-white/5 px-2.5 py-1 rounded-md font-mono select-all tracking-wider block break-all">
                        {mfaSecretKey}
                      </code>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 text-center">Verify Authenticator Code</label>
                    <input
                      type="text" required maxLength="6"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full border border-white/10 px-4 py-3 text-center text-2xl font-black tracking-[0.5em] rounded-xl bg-transparent focus:outline-none focus:border-cyan-500 transition-colors text-white"
                      placeholder="••••••"
                    />
                  </div>

                  <div className="flex space-x-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setStep('login'); setMfaCode(''); }}
                      className="w-1/3 bg-white/5 hover:bg-white/10 text-slate-300 py-3.5 rounded-xl font-bold transition-colors border border-white/10 shadow-sm text-xs uppercase"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading || mfaCode.length !== 6}
                      className="w-2/3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 py-3.5 rounded-xl font-black shadow-lg transition-colors flex justify-center items-center uppercase text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? 'Enabling...' : 'Verify & Enable'}
                    </button>
                  </div>
                </form>
              )}
            </div>
            
            <div className="bg-transparent border-t border-white/5 py-4 px-6 flex justify-between items-center text-xs font-bold text-slate-400">
               <span>Forgot Password? Contact Admin.</span>
               <Link to="/info" className="text-cyan-400 hover:underline">Help Desk & Guidelines</Link>
            </div>
          </div>
        </div>
      </div>
      
      {/* 5. FOOTER (FULLY TRANSPARENT) */}
      <footer className="bg-transparent text-slate-500 border-t border-white/5 mt-auto py-6 z-10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center text-xs font-medium">
          <p>© {new Date().getFullYear()} HARMAN RATHI TESTING AGENCY. All Rights Reserved.</p>
          <div className="flex space-x-6 mt-3 md:mt-0">
            <Link to="/info?tab=legal" className="hover:text-slate-300 transition-colors">Disclaimer</Link>
            <Link to="/info?tab=legal" className="hover:text-slate-300 transition-colors">Privacy Policy</Link>
            <Link to="/info?tab=legal" className="hover:text-slate-300 transition-colors">Terms of Use</Link>
            <Link to="/info" className="hover:text-slate-300 text-cyan-400 transition-colors font-bold">Info & Help Center</Link>
          </div>
        </div>
      </footer>
      
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
        .animate-marquee {
          display: inline-block;
          animation: marquee 25s linear infinite;
        }
        .animate-marquee:hover {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
};

export default MainLogin;
