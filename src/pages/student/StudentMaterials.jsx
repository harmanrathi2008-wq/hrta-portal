import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { Folder, File, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function StudentMaterials() {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMaterials()
  }, [])

  const loadMaterials = async () => {
    try {
      const { data } = await supabase
        .from('study_materials')
        .select('*')
        .order('created_at', { ascending: false })
      
      setMaterials(data || [])
    } catch (err) {
      console.error("Error loading study materials:", err)
    } finally {
      setLoading(false)
    }
  }

  // Cosmic Background Canvas Particle Effect
  useEffect(() => {
    if (loading) return;
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
      const particleCount = 200;
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: Math.random() * 2.8 + 1.0,
          hue: Math.random() * 360,
          hueSpeed: Math.random() * 0.3 + 0.15,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.6,
          alpha: Math.random() * 0.5 + 0.25,
          dAlpha: (Math.random() - 0.5) * 0.005
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
        if (p.alpha < 0.15 || p.alpha > 0.75) p.dAlpha *= -1;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        
        const colorString = `hsla(${p.hue}, 95%, 65%, ${p.alpha})`;
        const glowString = `hsla(${p.hue}, 95%, 65%, 0.7)`;
        
        ctx.fillStyle = colorString;
        ctx.shadowBlur = p.radius * 3.5;
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
          Loading Study Materials...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020205] text-slate-100 font-sans pb-12 relative overflow-hidden">
      
      {/* COSMIC BACKGROUND PARTICLES */}
      <canvas id="cosmic-canvas" className="fixed inset-0 w-full h-full pointer-events-none z-0" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_80%,transparent_100%)] pointer-events-none z-0"></div>

      {/* Header */}
      <div className="bg-transparent border-b border-white/5 px-8 py-6 mb-8 z-10 relative">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <Link to="/student/dashboard" className="text-cyan-400 hover:text-cyan-300 font-bold text-xs uppercase tracking-wider mb-2 inline-block">&larr; Back to Dashboard</Link>
            <h1 className="text-2xl font-black text-cyan-400 tracking-tight uppercase">Study Materials Database</h1>
            <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wide">Access formula sheets, practice files, and study notes shared by administrators.</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 z-10 relative">
        {materials.length === 0 ? (
          <div className="bg-transparent border border-white/5 rounded-2xl p-12 text-center shadow-xl">
            <Folder className="w-12 h-12 mx-auto mb-4 text-slate-550" />
            <p className="text-slate-400 font-bold uppercase tracking-wider text-sm">No study materials available yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {materials.map((material) => {
              const link = material.file_url || '';
              const absoluteLink = /^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`;
              return (
                <a
                  key={material.id}
                  href={absoluteLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-transparent border border-white/5 rounded-2xl p-5 text-center hover:border-cyan-500/35 hover:shadow-[0_0_15px_rgba(6,182,212,0.1)] transition-all cursor-pointer block group"
                >
                  <div className="w-14 h-14 bg-cyan-500/5 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-cyan-500/10 group-hover:scale-105 transition-transform">
                    <File className="w-7 h-7 text-cyan-400" />
                  </div>
                  <p className="text-sm font-extrabold text-white truncate uppercase tracking-wide">{material.title}</p>
                  <p className="text-[10px] text-cyan-400 font-black tracking-wider uppercase mt-1.5">{material.subject}</p>
                  {material.description && <p className="text-[11px] text-slate-450 mt-2 font-semibold line-clamp-2">{material.description}</p>}
                  <span className="inline-flex items-center gap-1.5 text-xs font-black text-cyan-400 hover:text-cyan-300 mt-4 uppercase tracking-wider">
                    Open File <ExternalLink size={12} />
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  )
}
