import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const StudyMaterials = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    subject: 'Physics',
    google_drive_link: ''
  });

  useEffect(() => {
    fetchMaterials();
  }, [navigate]);

  const fetchMaterials = async () => {
    try {
      const role = sessionStorage.getItem('role');
      if (role !== 'super_admin' && role !== 'admin') {
        navigate('/');
        return;
      }

      const { data, error: fetchErr } = await supabase
        .from('study_materials')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;
      setMaterials(data || []);
    } catch (err) {
      console.error("Error fetching materials:", err);
    } finally {
      setLoading(false);
    }
  };

  // Canvas Color-Changing Particle System Effect
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    let rawLink = formData.google_drive_link.trim();
    if (!/^https?:\/\//i.test(rawLink)) {
      rawLink = `https://${rawLink}`;
    }

    try {
      new URL(rawLink);
    } catch (_) {
      setError("Please provide a valid URL link.");
      setSaving(false);
      return;
    }

    try {
      // Map google_drive_link input to the actual database column file_url
      const newMaterial = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        subject: formData.subject,
        file_url: rawLink
      };

      const { data, error: insertError } = await supabase
        .from('study_materials')
        .insert([newMaterial])
        .select()
        .single();

      if (insertError) throw insertError;

      setMaterials([data, ...materials]);
      setFormData({ title: '', description: '', subject: 'Physics', google_drive_link: '' });
      alert("Study Resource Published Successfully!");

    } catch (err) {
      if (err.message && err.message.includes('schema cache')) {
        setError('Database error: The study_materials schema table is corrupted. Verify columns.');
      } else {
        setError(err.message || 'Failed to publish resource.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, title) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"?`)) return;

    try {
      const { error: deleteErr } = await supabase.from('study_materials').delete().eq('id', id);
      if (deleteErr) throw deleteErr;
      setMaterials(materials.filter(m => m.id !== id));
    } catch (err) {
      alert("Failed to delete resource.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020205] flex items-center justify-center font-sans">
        <div className="text-cyan-400 font-bold text-xl flex items-center">
          <svg className="animate-spin h-6 w-6 mr-3 text-cyan-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading Materials Database...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020205] text-slate-100 font-sans pb-12 relative overflow-hidden">
      
      {/* COSMIC PARTICLES BACKGROUND */}
      <canvas id="cosmic-canvas" className="fixed inset-0 w-full h-full pointer-events-none z-0" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_80%,transparent_100%)] pointer-events-none z-0"></div>

      {/* Header */}
      <div className="bg-transparent border-b border-white/5 px-8 py-6 mb-8 z-10 relative">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <Link to="/admin/dashboard" className="text-cyan-400 hover:text-cyan-300 font-bold text-xs uppercase tracking-wider mb-2 inline-block">&larr; Back to Command Center</Link>
            <h1 className="text-2xl font-black text-cyan-400 tracking-tight uppercase">Study Materials Command</h1>
            <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wide">Share Google Drive resources, notes, and formula sheets with candidates.</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-3 gap-8 z-10 relative">
        
        {/* Add New Resource Form */}
        <div className="lg:col-span-1 bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden h-fit">
          <div className="bg-transparent border-b border-white/5 px-5 py-4 font-bold text-xs uppercase tracking-wider text-white">
            Publish New Resource
          </div>
          
          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {error && (
              <div className="bg-red-500/10 border-l-4 border-red-500 p-3 text-red-400 text-xs font-bold rounded-r-md">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Resource Title *</label>
              <input 
                type="text" required
                value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})}
                placeholder="e.g., Kinematics Formula Sheet"
                className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold transition-all text-sm focus:border-transparent placeholder-slate-650"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Subject *</label>
              <select 
                value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})}
                className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-slate-950 text-white font-semibold transition-all text-sm focus:border-transparent cursor-pointer"
              >
                <option value="Physics">Physics</option>
                <option value="Chemistry">Chemistry</option>
                <option value="Mathematics">Mathematics</option>
                <option value="General Aptitude">General Aptitude</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Resource / Drive Link *</label>
              <input 
                type="url" required
                value={formData.google_drive_link} onChange={e => setFormData({...formData, google_drive_link: e.target.value})}
                placeholder="https://drive.google.com/..."
                className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold transition-all text-sm focus:border-transparent placeholder-slate-650"
              />
              <p className="text-[10px] text-slate-500 mt-1.5 font-bold uppercase tracking-wide">Ensure link sharing is set to "Anyone with the link".</p>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Description (Optional)</label>
              <textarea 
                rows="2"
                value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                placeholder="Brief summary of notes..."
                className="w-full border border-white/10 px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 bg-transparent text-white font-semibold transition-all text-sm focus:border-transparent placeholder-slate-650"
              ></textarea>
            </div>

            <button 
              type="submit" disabled={saving}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 py-3.5 rounded-xl font-extrabold shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex justify-center items-center uppercase tracking-wider disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Publishing...' : 'Publish Resource'}
            </button>
          </form>
        </div>

        {/* List of Existing Materials */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-transparent border border-white/5 p-4 rounded-2xl flex justify-between items-center shadow-xl">
            <h2 className="font-bold text-white uppercase text-xs tracking-wider">Published Resources</h2>
            <span className="bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 px-3 py-1 rounded-full text-xs font-bold">{materials.length} Active</span>
          </div>

          {materials.length === 0 ? (
            <div className="bg-transparent border border-white/5 p-12 text-center text-slate-500 font-bold rounded-2xl shadow-xl">
              No study materials have been published yet.
            </div>
          ) : (
            materials.map((mat) => (
              <div key={mat.id} className="bg-transparent border border-white/5 p-6 rounded-2xl shadow-2xl flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:border-cyan-500/30 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">{mat.subject}</span>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{new Date(mat.created_at).toLocaleDateString()}</span>
                  </div>
                  <h3 className="font-black text-white text-lg">{mat.title}</h3>
                  {mat.description && <p className="text-sm text-slate-400 mt-1 font-medium">{mat.description}</p>}
                </div>
                
                <div className="flex items-center gap-3 shrink-0">
                  {(() => {
                    const link = mat.file_url || '';
                    const absoluteLink = /^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`;
                    return (
                      <a 
                        href={absoluteLink} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="bg-white/5 border border-white/10 hover:bg-white/10 text-cyan-400 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition shadow flex items-center"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Test Link
                      </a>
                    );
                  })()}
                  <button 
                    onClick={() => handleDelete(mat.id, mat.title)}
                    className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-slate-950 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default StudyMaterials;
