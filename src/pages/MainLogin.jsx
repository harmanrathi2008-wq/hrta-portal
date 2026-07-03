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


  // 3D Particle Morphing Animation Effect (PCM Topics: Math, Physics, Chemistry, and HRTA Logo)
  useEffect(() => {
    const canvas = document.getElementById('cosmic-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let particles = []; // Pool for falling sparks during dissolve phase
    let sparksPopulated = false;
    const startTime = Date.now();
    
    // Rotation angles for auto sway & mouse hover
    let angleX = 0;
    let angleY = 0;
    
    // Mouse coords
    let mouseX = -1000;
    let mouseY = -1000;
    let currentRotX = 0;
    let currentRotY = 0;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const drawBenzene = (tempCtx, cx, cy, r, groupText = 'H') => {
      // Draw hexagon
      tempCtx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 2;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) tempCtx.moveTo(x, y);
        else tempCtx.lineTo(x, y);
      }
      tempCtx.closePath();
      tempCtx.stroke();

      // Draw inner alternating double bonds
      for (let i = 0; i < 6; i += 2) {
        const angle1 = (i * Math.PI) / 3 - Math.PI / 2;
        const angle2 = ((i + 1) * Math.PI) / 3 - Math.PI / 2;
        tempCtx.beginPath();
        tempCtx.moveTo(cx + r * 0.82 * Math.cos(angle1), cy + r * 0.82 * Math.sin(angle1));
        tempCtx.lineTo(cx + r * 0.82 * Math.cos(angle2), cy + r * 0.82 * Math.sin(angle2));
        tempCtx.stroke();
      }

      // Draw outer hydrogen links (5 corners)
      for (let i = 1; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 2;
        tempCtx.beginPath();
        tempCtx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
        tempCtx.lineTo(cx + r * 1.25 * Math.cos(angle), cy + r * 1.25 * Math.sin(angle));
        tempCtx.stroke();
      }

      // Draw functional group bond at top corner (angle -PI/2)
      const topAngle = -Math.PI / 2;
      const tx = cx + r * Math.cos(topAngle);
      const ty = cy + r * Math.sin(topAngle);
      tempCtx.beginPath();
      tempCtx.moveTo(tx, ty);
      tempCtx.lineTo(cx + r * 1.25 * Math.cos(topAngle), cy + r * 1.25 * Math.sin(topAngle));
      tempCtx.stroke();

      // Render functional group text
      tempCtx.font = 'bold 20px "Courier New", monospace';
      tempCtx.fillText(groupText, cx + r * 1.45 * Math.cos(topAngle), cy + r * 1.45 * Math.sin(topAngle));
    };

    const generateTextCoords = (textList) => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 1000;
      tempCanvas.height = 600;
      const tempCtx = tempCanvas.getContext('2d');
      const coords = [];
      
      textList.forEach(t => {
        // Clear offscreen canvas
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, 1000, 600);
        
        // Draw single text item in the center
        tempCtx.fillStyle = '#ffffff';
        tempCtx.font = t.font || 'bold 36px "Courier New", monospace';
        tempCtx.textAlign = t.align || 'center';
        tempCtx.textBaseline = 'middle';
        tempCtx.fillText(t.text, t.x, t.y);
        
        // Scan active coordinates for this text item
        const imgData = tempCtx.getImageData(0, 0, 1000, 600);
        const step = 4;
        for (let y = 0; y < 600; y += step) {
          for (let x = 0; x < 1000; x += step) {
            const index = (y * 1000 + x) * 4;
            if (imgData.data[index] > 128) {
              coords.push({
                x: (x - 500) * 0.6,
                y: (y - 300) * 0.6,
                z: 0
              });
            }
          }
        }
      });
      
      return coords;
    };

    const generateMathTargets = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 1000;
      tempCanvas.height = 600;
      const tempCtx = tempCanvas.getContext('2d');
      const coords = [];

      const drawers = [
        // 1. Top Left: ∫ sin(x) dx = -cos(x) + C
        (ctx) => {
          ctx.font = 'bold 22px "Courier New", monospace';
          ctx.fillText('∫ sin(x) dx = -cos(x) + C', 280, 100);
        },
        // 2. Top Right: ∫ e^x dx = e^x + C
        (ctx) => {
          ctx.font = 'bold 22px "Courier New", monospace';
          ctx.fillText('∫ e^x dx = e^x + C', 720, 100);
        },
        // 3. Top Center: ∫ 1/x dx = ln|x| + C
        (ctx) => {
          ctx.font = 'bold 32px "Courier New", monospace';
          ctx.fillText('∫', 430, 100);
          ctx.font = 'bold 16px "Courier New", monospace';
          ctx.fillText('1', 465, 87);
          ctx.beginPath();
          ctx.moveTo(455, 100);
          ctx.lineTo(475, 100);
          ctx.stroke();
          ctx.fillText('x', 465, 113);
          ctx.font = 'bold 22px "Courier New", monospace';
          ctx.fillText('dx = ln|x| + C', 550, 100);
        },
        // 4. Main Antiderivative Formula (Middle): ∫ 1/(x²-a²) dx = 1/2a ln|(x-a)/(x+a)| + C
        (ctx) => {
          ctx.font = 'bold 55px "Courier New", monospace';
          ctx.fillText('∫', 280, 230);
          ctx.font = 'bold 24px "Courier New", monospace';
          ctx.fillText('1', 345, 200);
          ctx.beginPath();
          ctx.moveTo(315, 230);
          ctx.lineTo(375, 230);
          ctx.stroke();
          ctx.fillText('x² - a²', 345, 260);
          ctx.font = 'bold 30px "Courier New", monospace';
          ctx.fillText('dx  =', 435, 230);
          ctx.fillText('1', 510, 200);
          ctx.beginPath();
          ctx.moveTo(490, 230);
          ctx.lineTo(530, 230);
          ctx.stroke();
          ctx.fillText('2a', 510, 260);
          ctx.fillText('ln', 570, 230);
          ctx.beginPath();
          ctx.moveTo(605, 175);
          ctx.lineTo(605, 285);
          ctx.stroke();
          ctx.fillText('x - a', 660, 200);
          ctx.beginPath();
          ctx.moveTo(620, 230);
          ctx.lineTo(700, 230);
          ctx.stroke();
          ctx.fillText('x + a', 660, 260);
          ctx.beginPath();
          ctx.moveTo(715, 175);
          ctx.lineTo(715, 285);
          ctx.stroke();
          ctx.fillText('+ C', 765, 230);
        },
        // 5. Bottom Formula (Derivative)
        (ctx) => {
          ctx.font = 'bold 30px "Courier New", monospace';
          ctx.fillText('d', 240, 390);
          ctx.beginPath();
          ctx.moveTo(220, 420);
          ctx.lineTo(260, 420);
          ctx.stroke();
          ctx.fillText('dx', 240, 450);
          ctx.font = 'bold 50px "Courier New", monospace';
          ctx.fillText('[', 285, 415);
          ctx.font = 'bold 30px "Courier New", monospace';
          ctx.fillText('ln', 320, 420);
          ctx.beginPath();
          ctx.moveTo(350, 365);
          ctx.lineTo(350, 475);
          ctx.stroke();
          ctx.fillText('x - a', 400, 390);
          ctx.beginPath();
          ctx.moveTo(365, 420);
          ctx.lineTo(435, 420);
          ctx.stroke();
          ctx.fillText('x + a', 400, 450);
          ctx.beginPath();
          ctx.moveTo(450, 365);
          ctx.lineTo(450, 475);
          ctx.stroke();
          ctx.font = 'bold 50px "Courier New", monospace';
          ctx.fillText(']', 480, 415);
          ctx.font = 'bold 30px "Courier New", monospace';
          ctx.fillText('=', 525, 420);
          ctx.fillText('2a', 605, 390);
          ctx.beginPath();
          ctx.moveTo(565, 420);
          ctx.lineTo(645, 420);
          ctx.stroke();
          ctx.fillText('x² - a²', 605, 450);
        }
      ];

      drawers.forEach(drawer => {
        tempCtx.fillStyle = '#000000';
        tempCtx.fillRect(0, 0, 1000, 600);
        tempCtx.strokeStyle = '#ffffff';
        tempCtx.fillStyle = '#ffffff';
        tempCtx.lineWidth = 2.5;
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';

        drawer(tempCtx);

        const imgData = tempCtx.getImageData(0, 0, 1000, 600);
        const step = 4;
        for (let y = 0; y < 600; y += step) {
          for (let x = 0; x < 1000; x += step) {
            const index = (y * 1000 + x) * 4;
            if (imgData.data[index] > 128) {
              coords.push({
                x: (x - 500) * 0.6,
                y: (y - 300) * 0.6,
                z: 0
              });
            }
          }
        }
      });

      return coords;
    };

    const generateAnalyticalBenzene = (cx, cy, r, groupText = 'H') => {
      const coords = [];
      const segments = [];
      
      const vertices = [];
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 2;
        vertices.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      }
      
      for (let i = 0; i < 6; i++) {
        segments.push({ p1: vertices[i], p2: vertices[(i + 1) % 6] });
      }
      
      for (let i = 0; i < 6; i += 2) {
        const angle1 = (i * Math.PI) / 3 - Math.PI / 2;
        const angle2 = ((i + 1) * Math.PI) / 3 - Math.PI / 2;
        const d1 = { x: cx + r * 0.82 * Math.cos(angle1), y: cy + r * 0.82 * Math.sin(angle1) };
        const d2 = { x: cx + r * 0.82 * Math.cos(angle2), y: cy + r * 0.82 * Math.sin(angle2) };
        segments.push({ p1: d1, p2: d2 });
      }
      
      for (let i = 1; i < 6; i++) {
        const angle = (i * Math.PI) / 3 - Math.PI / 2;
        const p1 = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
        const p2 = { x: cx + r * 1.25 * Math.cos(angle), y: cy + r * 1.25 * Math.sin(angle) };
        segments.push({ p1, p2 });
      }
      
      const topAngle = -Math.PI / 2;
      const p1 = { x: cx + r * Math.cos(topAngle), y: cy + r * Math.sin(topAngle) };
      const p2 = { x: cx + r * 1.25 * Math.cos(topAngle), y: cy + r * 1.25 * Math.sin(topAngle) };
      segments.push({ p1, p2 });

      const ptsPerSegment = 20;
      segments.forEach(seg => {
        for (let j = 0; j <= ptsPerSegment; j++) {
          const t = j / ptsPerSegment;
          coords.push({
            x: seg.p1.x + (seg.p2.x - seg.p1.x) * t,
            y: seg.p1.y + (seg.p2.y - seg.p1.y) * t,
            z: 0
          });
        }
      });

      const textCanvas = document.createElement('canvas');
      textCanvas.width = 1100;
      textCanvas.height = 600;
      const textCtx = textCanvas.getContext('2d');
      textCtx.fillStyle = '#000000';
      textCtx.fillRect(0, 0, 1100, 600);
      textCtx.fillStyle = '#ffffff';
      textCtx.font = 'bold 20px "Courier New", monospace';
      textCtx.textAlign = 'center';
      textCtx.textBaseline = 'middle';
      
      const tx = cx + r * 1.45 * Math.cos(topAngle);
      const ty = cy + r * 1.45 * Math.sin(topAngle);
      textCtx.fillText(groupText, tx, ty);
      
      const imgData = textCtx.getImageData(0, 0, 1100, 600);
      const step = 4;
      for (let y = 0; y < 600; y += step) {
        for (let x = 0; x < 1100; x += step) {
          const index = (y * 1100 + x) * 4;
          if (imgData.data[index] > 128) {
            coords.push({ x: x, y: y, z: 0 });
          }
        }
      }

      return coords;
    };

    const generateChemCoords = (subPhase) => {
      let leftGroup = 'H';
      let rightGroup = 'NO₂';
      let reagent = 'HNO₃ + H₂SO₄';
      let label = 'BENZENE  ⎯→  NITROBENZENE';
      
      if (subPhase === 1) {
        leftGroup = 'NO₂';
        rightGroup = 'NH₂';
        reagent = 'Fe + HCl';
        label = 'NITROBENZENE  ⎯→  ANILINE';
      } else if (subPhase === 2) {
        leftGroup = 'NH₂';
        rightGroup = 'OH';
        reagent = 'NaNO₂/HCl, H₂O';
        label = 'ANILINE  ⎯→  PHENOL';
      } else if (subPhase === 3) {
        leftGroup = 'OH';
        rightGroup = 'H';
        reagent = 'Reaction Complete';
        label = 'PHENOL SYNTHESIS';
      }

      const coords = [];

      const leftBenz = generateAnalyticalBenzene(260, 300, 85, leftGroup);
      leftBenz.forEach(pt => coords.push({ x: (pt.x - 550) * 0.58, y: (pt.y - 300) * 0.58, z: 0 }));

      const rightBenz = generateAnalyticalBenzene(840, 300, 85, rightGroup);
      rightBenz.forEach(pt => coords.push({ x: (pt.x - 550) * 0.58, y: (pt.y - 300) * 0.58, z: 0 }));

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 1100;
      tempCanvas.height = 600;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.fillStyle = '#000000';
      tempCtx.fillRect(0, 0, 1100, 600);
      
      tempCtx.strokeStyle = '#ffffff';
      tempCtx.fillStyle = '#ffffff';
      tempCtx.lineWidth = 3.5;
      tempCtx.textAlign = 'center';
      tempCtx.textBaseline = 'middle';
      
      tempCtx.beginPath();
      tempCtx.moveTo(480, 300);
      tempCtx.lineTo(620, 300);
      tempCtx.lineTo(600, 288);
      tempCtx.moveTo(620, 300);
      tempCtx.lineTo(600, 312);
      tempCtx.stroke();

      tempCtx.font = 'bold 20px "Courier New", monospace';
      tempCtx.fillText(reagent, 550, 260);
      
      tempCtx.font = 'bold 26px "Courier New", monospace';
      tempCtx.fillText(label, 550, 480);

      const imgData = tempCtx.getImageData(0, 0, 1100, 600);
      const step = 4;
      for (let y = 0; y < 600; y += step) {
        for (let x = 0; x < 1100; x += step) {
          const index = (y * 1100 + x) * 4;
          if (imgData.data[index] > 128) {
            coords.push({ x: (x - 550) * 0.58, y: (y - 300) * 0.58, z: 0 });
          }
        }
      }

      return coords;
    };

    const mathTargets = generateMathTargets();

    const physText = [
      { text: 'τ = I α', x: 220, y: 140, font: 'bold 42px "Courier New", monospace' },
      { text: 'L = I ω', x: 780, y: 140, font: 'bold 42px "Courier New", monospace' },
      { text: 'ROTATING DISC', x: 500, y: 480, font: 'bold 28px "Courier New", monospace' }
    ];
    const physTextCoords = generateTextCoords(physText);
    const discCoords = [];
    const rings = [
      { r: 40, pts: 100 },
      { r: 65, pts: 150 },
      { r: 90, pts: 200 },
      { r: 115, pts: 250 },
      { r: 140, pts: 300 }
    ];
    rings.forEach(ring => {
      for (let j = 0; j < ring.pts; j++) {
        const theta = (j / ring.pts) * Math.PI * 2;
        discCoords.push({ x: ring.r * Math.cos(theta), y: 30, z: ring.r * Math.sin(theta) });
      }
    });
    for (let j = 0; j < 150; j++) {
      discCoords.push({ x: 0, y: -130 + j * 1.8, z: 0 });
    }
    for (let j = 0; j < 40; j++) {
      const phi = (j / 40) * Math.PI * 2;
      discCoords.push({ x: 10 * Math.cos(phi), y: -120, z: 10 * Math.sin(phi) });
    }
    const physTargets = [...physTextCoords, ...discCoords];

    const chemTargets0 = generateChemCoords(0);
    const chemTargets1 = generateChemCoords(1);
    const chemTargets2 = generateChemCoords(2);
    const chemTargets3 = generateChemCoords(3);

    // HRTA Logo targets
    const logoTargets = [];
    const hexRadius = 145;
    const hexHeight = 65;
    const topVerts = [];
    const bottomVerts = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      topVerts.push({ x: hexRadius * Math.cos(angle), y: -hexHeight, z: hexRadius * Math.sin(angle) });
      bottomVerts.push({ x: hexRadius * Math.cos(angle), y: hexHeight, z: hexRadius * Math.sin(angle) });
    }
    const pointsPerEdge = 40;
    for (let i = 0; i < 6; i++) {
      const t1 = topVerts[i], t2 = topVerts[(i + 1) % 6];
      const b1 = bottomVerts[i], b2 = bottomVerts[(i + 1) % 6];
      for (let j = 0; j < pointsPerEdge; j++) {
        const r = j / pointsPerEdge;
        logoTargets.push({ x: t1.x + (t2.x - t1.x) * r, y: t1.y, z: t1.z + (t2.z - t1.z) * r });
        logoTargets.push({ x: b1.x + (b2.x - b1.x) * r, y: b1.y, z: b1.z + (b2.z - b1.z) * r });
      }
    }
    for (let i = 0; i < 6; i++) {
      const t = topVerts[i], b = bottomVerts[i];
      for (let j = 0; j < pointsPerEdge; j++) {
        logoTargets.push({ x: t.x, y: t.y + (b.y - t.y) * (j / pointsPerEdge), z: t.z });
      }
    }
    const coreCount = 800;
    for (let i = 0; i < coreCount; i++) {
      const phi = Math.acos(Math.random() * 2 - 1);
      const theta = Math.random() * Math.PI * 2;
      logoTargets.push({ x: 60 * Math.sin(phi) * Math.cos(theta), y: 60 * Math.sin(phi) * Math.sin(theta), z: 60 * Math.cos(phi) });
    }

    const handleMouseMove = (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const cycleTime = (Date.now() - startTime) % 44000;
      const phaseTime = cycleTime % 11000;
      
      // Calculate drawing progress:
      // - 0s to 2.5s: drawing in progress (progress goes 0 -> 1)
      // - 2.5s to 9.5s: fully drawn (stable hold, progress = 1)
      // - 9.5s to 11s: dissolve/explode phase
      let progress = 0;
      let isDissolve = false;
      if (phaseTime < 2500) {
        progress = phaseTime / 2500;
      } else if (phaseTime < 9500) {
        progress = 1.0;
      } else {
        isDissolve = true;
        progress = 1.0;
      }

      const timeFactor = (Date.now() - startTime) * 0.0018;

      // Camera sway/tilt rotations
      const maxTilt = 0.22;
      const targetRotX = (mouseX === -1000) ? 0 : Math.max(-maxTilt, Math.min(maxTilt, (mouseY - canvas.height / 2) * 0.0006));
      const targetRotY = (mouseX === -1000) ? 0 : Math.max(-maxTilt, Math.min(maxTilt, (mouseX - canvas.width / 2) * 0.0006));
      currentRotX += (targetRotX - currentRotX) * 0.05;
      currentRotY += (targetRotY - currentRotY) * 0.05;

      let rx = currentRotX;
      let ry = currentRotY;

      if (cycleTime >= 33000) {
        // HRTA Logo: full spinning 3D logo
        angleY += 0.005;
        angleX += 0.002;
        rx += angleX;
        ry += angleY;
      } else {
        // Subtle sway for math, physics, chemistry
        rx += Math.sin(timeFactor * 0.4) * 0.06;
        ry += Math.cos(timeFactor * 0.4) * 0.06;
      }

      // Choose active coordinate set
      let activeCoords = [];
      if (cycleTime < 11000) {
        activeCoords = mathTargets;
      } else if (cycleTime < 22000) {
        activeCoords = physTargets;
      } else if (cycleTime < 33000) {
        const holdElapsed = Math.max(0, phaseTime - 2500);
        let subPhase = 0;
        if (phaseTime < 2500) subPhase = 0;
        else if (phaseTime >= 9500) subPhase = 3;
        else subPhase = Math.min(3, Math.floor(holdElapsed / 1750));
        
        if (subPhase === 0) activeCoords = chemTargets0;
        else if (subPhase === 1) activeCoords = chemTargets1;
        else if (subPhase === 2) activeCoords = chemTargets2;
        else activeCoords = chemTargets3;
      } else {
        activeCoords = logoTargets;
      }

      const N = activeCoords.length;
      if (N === 0) {
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      // Project all active coordinates into 2D screen space
      const projected = [];
      const sizeFactor = canvas.width < 768 ? canvas.width / 800 : 1.0;
      const scaleMultiplier = 2.45 * sizeFactor;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      activeCoords.forEach((pt) => {
        // Apply 3D Rotation (Y rotation then X rotation)
        let x1 = pt.x * Math.cos(ry) - pt.z * Math.sin(ry);
        let z1 = pt.x * Math.sin(ry) + pt.z * Math.cos(ry);
        let y2 = pt.y * Math.cos(rx) - z1 * Math.sin(rx);
        let z2 = pt.y * Math.sin(rx) + z1 * Math.cos(rx);

        const fov = 400;
        const distance = 280;
        const scale = fov / (fov + z2 + distance);
        if (scale <= 0 || isNaN(scale)) {
          projected.push(null);
          return;
        }

        let projX = centerX + x1 * scale * scaleMultiplier;
        let projY = centerY + y2 * scale * scaleMultiplier;

        // Fluid Cursor Repulsion
        const dx = projX - mouseX;
        const dy = projY - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 110) {
          const force = (110 - dist) / 110 * 18;
          projX += (dx / dist) * force;
          projY += (dy / dist) * force;
        }

        projected.push({ x: projX, y: projY, z: z2, scale });
      });

      // Define HSL colors per phase
      let hue = 217, sat = 89, light = 61;
      if (cycleTime < 11000) {
        hue = 188; sat = 95; light = 58; // Math: Cyan
      } else if (cycleTime < 22000) {
        hue = 32; sat = 95; light = 55; // Physics: Gold
      } else if (cycleTime < 33000) {
        hue = 135; sat = 85; light = 52; // Chemistry: Green
      } else {
        hue = 217; sat = 89; light = 61; // HRTA: Blue
      }

      // Draw Logic
      if (!isDissolve) {
        // Reset spark particles array for next transition
        sparksPopulated = false;
        particles = [];

        // Progressively draw the vector lines (one-to-one drawing sequence)
        const currentLimit = Math.floor(progress * N);
        
        // 1. Draw Neon Glow Bloom Line (Thick & Faded)
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowBlur = 10;
        ctx.shadowColor = `hsla(${hue}, ${sat}%, ${light}%, 0.4)`;
        
        ctx.beginPath();
        let firstPoint = true;
        for (let i = 0; i < currentLimit - 1; i++) {
          const p1 = projected[i];
          const p2 = projected[i + 1];
          if (!p1 || !p2) { firstPoint = true; continue; }

          const dx = activeCoords[i].x - activeCoords[i+1].x;
          const dy = activeCoords[i].y - activeCoords[i+1].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < 15) {
            if (firstPoint) {
              ctx.moveTo(p1.x, p1.y);
              firstPoint = false;
            }
            ctx.lineTo(p2.x, p2.y);
          } else {
            firstPoint = true;
          }
        }
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light}%, 0.28)`;
        ctx.lineWidth = 5.0;
        ctx.stroke();

        // 2. Draw Core Laser Line (Thin & Bright)
        ctx.beginPath();
        firstPoint = true;
        for (let i = 0; i < currentLimit - 1; i++) {
          const p1 = projected[i];
          const p2 = projected[i + 1];
          if (!p1 || !p2) { firstPoint = true; continue; }

          const dx = activeCoords[i].x - activeCoords[i+1].x;
          const dy = activeCoords[i].y - activeCoords[i+1].y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < 15) {
            if (firstPoint) {
              ctx.moveTo(p1.x, p1.y);
              firstPoint = false;
            }
            ctx.lineTo(p2.x, p2.y);
          } else {
            firstPoint = true;
          }
        }
        ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light + 12}%, 0.95)`;
        ctx.lineWidth = 1.85;
        ctx.stroke();
        
        // Reset shadows to preserve performance
        ctx.shadowBlur = 0;

        // 3. Draw the drawing tip tracer cursor (pulse neon spark)
        if (currentLimit > 0 && currentLimit < N) {
          const tip = projected[currentLimit - 1];
          if (tip) {
            // Radial glowing gradient for tracer
            const grad = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 14);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.2, `hsla(${(hue + 60) % 360}, 100%, 70%, 1)`); // Multicolor gradient tip
            grad.addColorStop(0.5, `hsla(${hue}, ${sat}%, ${light}%, 0.8)`);
            grad.addColorStop(1, `hsla(${hue}, ${sat}%, ${light}%, 0)`);
            
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, 14, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();

            // Add core bright tracer particle dot
            ctx.beginPath();
            ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
          }
        }
      } else {
        // Sparks Rain Dissolve Phase (shatters into particles)
        if (!sparksPopulated) {
          particles = [];
          projected.forEach((p, idx) => {
            if (!p) return;
            particles.push({
              x: p.x,
              y: p.y,
              vx: (Math.random() - 0.5) * 3,
              vy: Math.random() * 2 + 0.8, // gravity fall speed
              alpha: Math.random() * 0.4 + 0.6,
              size: Math.random() * 1.5 + 0.8,
              hue,
              sat,
              light
            });
          });
          sparksPopulated = true;
        }

        // Animate & draw falling sparks
        particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.08; // gravity acceleration
          p.alpha -= 0.016; // fade out
          
          if (p.alpha > 0) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${p.hue}, ${p.sat}%, ${p.light}%, ${p.alpha * 0.28})`;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${p.hue}, ${p.sat}%, ${p.light + 10}%, ${p.alpha * 0.85})`;
            ctx.fill();
          }
        });
      }
      
      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('mousemove', handleMouseMove);
    
    resizeCanvas();
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
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
      // Ensure reCAPTCHA Enterprise is loaded and ready
      if (!window.grecaptcha || !window.grecaptcha.enterprise || !window.grecaptcha.enterprise.execute) {
        throw new Error('Security service is loading. Please try again in a few seconds.');
      }

      // Generate the Enterprise verification token at the moment of submission
      const token = await new Promise((resolve, reject) => {
        window.grecaptcha.enterprise.ready(async () => {
          try {
            const t = await window.grecaptcha.enterprise.execute(siteKey, { action: 'LOGIN' });
            resolve(t);
          } catch (err) {
            reject(err);
          }
        });
      });
      if (!token) {
        throw new Error('Failed to generate security verification token. Please try again.');
      }
      console.log('TOKEN:', token);

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
