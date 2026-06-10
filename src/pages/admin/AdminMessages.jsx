import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const API_BASE = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';

export default function AdminMessages() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentLog, setSentLog] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [selectAll, setSelectAll] = useState(false);

  // ── Canvas Particle System ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;
    let particles = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      particles = Array.from({ length: 180 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2.5 + 0.8,
        hue: Math.random() * 360,
        hs: Math.random() * 0.5 + 0.2,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        alpha: Math.random() * 0.5 + 0.25,
        da: (Math.random() - 0.5) * 0.005,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        p.hue = (p.hue + p.hs) % 360;
        p.alpha += p.da;
        if (p.alpha < 0.15 || p.alpha > 0.75) p.da *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},95%,65%,${p.alpha})`;
        ctx.shadowBlur = p.r * 5;
        ctx.shadowColor = `hsla(${p.hue},95%,65%,0.8)`;
        ctx.fill();
      });
      animId = requestAnimationFrame(draw);
    };

    window.addEventListener('resize', resize);
    resize();
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  // ── Fetch Students ──────────────────────────────────────────────────────────
  useEffect(() => {
    const role = sessionStorage.getItem('role');
    if (role !== 'super_admin' && role !== 'admin') { navigate('/'); return; }
    loadStudents();
  }, [navigate]);

  const loadStudents = async () => {
    const { data } = await supabase
      .from('students')
      .select('id, full_name, email, application_id')
      .eq('status', 'active')
      .order('full_name');
    setStudents(data || []);
  };

  const filteredStudents = students.filter(s =>
    s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.application_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleStudent = (id) => {
    setSelectedStudents(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedStudents([]);
    } else {
      setSelectedStudents(filteredStudents.map(s => s.id));
    }
    setSelectAll(!selectAll);
  };

  // ── File Handling ───────────────────────────────────────────────────────────
  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
    } else {
      alert('Please drop a PDF file only.');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) setPdfFile(file);
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  // ── Upload PDF to Supabase Storage ──────────────────────────────────────────
  const uploadPdfToStorage = async (file) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      const fileName = `admin-messages/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      // 1. Get signed upload URL from backend
      const res = await fetch(`${API_BASE}/api/get-upload-url`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({ fileName }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to get secure upload URL');
      }

      const { token: uploadToken, path } = await res.json();

      // Simulate progress while uploading
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 90));
      }, 200);

      // 2. Upload file directly to Supabase using the signed URL/token
      const { data, error } = await supabase.storage
        .from('hrta-files')
        .uploadToSignedUrl(path, uploadToken, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'application/pdf',
        });

      clearInterval(progressInterval);

      if (error) throw error;

      // 3. Get public URL
      const { data: urlData } = supabase.storage
        .from('hrta-files')
        .getPublicUrl(path);

      setUploadProgress(100);
      return urlData.publicUrl;
    } finally {
      setUploading(false);
    }
  };

  // ── Send Message ────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (selectedStudents.length === 0) { alert('Please select at least one student.'); return; }
    if (!subject.trim()) { alert('Please enter a subject line.'); return; }
    if (!message.trim() && !pdfFile) { alert('Please enter a message or attach a PDF.'); return; }

    setSending(true);
    try {
      let pdfUrl = null;

      if (pdfFile) {
        pdfUrl = await uploadPdfToStorage(pdfFile);
      }

      // Get selected students' emails
      const { data: studentData } = await supabase
        .from('students')
        .select('id, full_name, email, application_id')
        .in('id', selectedStudents);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';

      // Send via backend
      const response = await fetch(`${API_BASE}/api/admin-message`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({
          students: studentData,
          subject: subject.trim(),
          message: message.trim(),
          pdfUrl,
          pdfFileName: pdfFile?.name || null,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to send');

      // Log the sent message
      setSentLog(prev => [{
        id: Date.now(),
        subject,
        message,
        pdfName: pdfFile?.name,
        recipients: studentData.map(s => s.full_name),
        sentAt: new Date().toLocaleString(),
        status: 'sent',
      }, ...prev]);

      // Reset form
      setSubject('');
      setMessage('');
      setPdfFile(null);
      setSelectedStudents([]);
      setSelectAll(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';

      alert(`✅ Message sent successfully to ${studentData.length} student(s)!`);
    } catch (err) {
      console.error('Send error:', err);
      alert('❌ Failed to send message: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#020205] text-slate-100 font-sans pb-12 relative overflow-x-hidden">

      {/* Particle Canvas */}
      <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none z-0" />

      {/* Grid overlay */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.012)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.012)_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none z-0" />

      {/* Header */}
      <div className="relative z-10 bg-transparent border-b border-white/5 px-8 py-6 mb-8">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-black text-cyan-400 tracking-tight uppercase flex items-center gap-3">
              <span className="text-3xl">✉️</span>
              Admin Message Center
            </h1>
            <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wide">
              Send personalized messages &amp; PDF documents directly to student Gmail accounts
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/dashboard')}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

          {/* ── LEFT: Student Selector ──────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
              {/* Rainbow top border */}
              <div className="h-0.5 bg-gradient-to-r from-cyan-500 via-purple-500 via-pink-500 to-emerald-500 animate-pulse" />

              <div className="border-b border-white/5 px-5 py-4 flex justify-between items-center">
                <div>
                  <h2 className="font-bold text-white text-xs uppercase tracking-wider">Select Recipients</h2>
                  <p className="text-[10px] text-slate-500 mt-0.5">{selectedStudents.length} of {students.length} selected</p>
                </div>
                <button
                  onClick={handleSelectAll}
                  className={`text-[10px] font-black px-3 py-1.5 rounded-lg border uppercase tracking-wider transition-all cursor-pointer ${
                    selectAll
                      ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {selectAll ? '✓ All Selected' : 'Select All'}
                </button>
              </div>

              {/* Search */}
              <div className="px-4 py-3 border-b border-white/5">
                <div className="relative">
                  <svg className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search students..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs font-semibold text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>

              {/* Student List */}
              <div className="max-h-[420px] overflow-y-auto divide-y divide-white/5">
                {filteredStudents.length === 0 ? (
                  <div className="p-8 text-center text-slate-600 font-bold text-xs">No students found</div>
                ) : (
                  filteredStudents.map(student => {
                    const isSelected = selectedStudents.includes(student.id);
                    return (
                      <div
                        key={student.id}
                        onClick={() => toggleStudent(student.id)}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-cyan-500/10 border-l-2 border-l-cyan-500'
                            : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                        }`}
                      >
                        {/* Checkbox */}
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                          isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-slate-600'
                        }`}>
                          {isSelected && (
                            <svg className="w-2.5 h-2.5 text-slate-950" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* Avatar */}
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-[10px] font-black text-white shrink-0">
                          {student.full_name?.[0]?.toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-bold truncate ${isSelected ? 'text-cyan-300' : 'text-slate-200'}`}>
                            {student.full_name}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate font-mono">{student.email}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Selected Count Badge */}
              {selectedStudents.length > 0 && (
                <div className="border-t border-white/5 px-4 py-2.5 bg-cyan-500/5 flex items-center justify-between">
                  <span className="text-[10px] font-black text-cyan-400 uppercase tracking-wider">
                    📨 {selectedStudents.length} recipient{selectedStudents.length > 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={() => { setSelectedStudents([]); setSelectAll(false); }}
                    className="text-[10px] text-slate-500 hover:text-red-400 font-bold cursor-pointer transition-colors"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Message Composer ──────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-5">
            <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-purple-500 via-pink-500 via-yellow-400 to-cyan-500 animate-pulse" />

              <div className="border-b border-white/5 px-6 py-4">
                <h2 className="font-bold text-white text-xs uppercase tracking-wider">✍️ Compose Message</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">Message will be sent to selected students' Gmail accounts via Resend</p>
              </div>

              <div className="p-6 space-y-5">

                {/* Subject */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Subject Line *</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="e.g. JEE Main 2025 — Important Notice from HRTA"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-semibold text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Message Body</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Type your message to the student(s) here...

Example:
Dear Candidate,

Please find attached your study material / notice for the upcoming examination.

Best Regards,
Harman Rathi Testing Agency"
                    rows={10}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm font-semibold text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 transition-colors resize-none leading-relaxed"
                  />
                  <p className="text-[10px] text-slate-600 text-right">{message.length} characters</p>
                </div>

                {/* PDF Upload */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    📎 Attach PDF Document
                    <span className="text-slate-600 normal-case font-semibold">(up to 500 MB)</span>
                  </label>

                  {/* Drop Zone */}
                  <div
                    onDrop={handleFileDrop}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                      dragOver
                        ? 'border-cyan-500 bg-cyan-500/10'
                        : pdfFile
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : 'border-white/10 hover:border-white/25 bg-white/[0.02] hover:bg-white/[0.04]'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={handleFileSelect}
                      className="hidden"
                    />

                    {pdfFile ? (
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center justify-center text-xl shrink-0">
                            📄
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-bold text-white truncate max-w-[240px]">{pdfFile.name}</p>
                            <p className="text-[10px] text-emerald-400 font-bold mt-0.5">
                              {formatFileSize(pdfFile.size)}
                              {pdfFile.size > 40 * 1024 * 1024 && (
                                <span className="text-amber-400 ml-2">⚡ Large file — will be sent as download link</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); setPdfFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                          className="text-slate-500 hover:text-red-400 transition-colors text-xl shrink-0"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="text-4xl mb-2">📎</div>
                        <p className="text-sm font-bold text-slate-300">Drag & Drop PDF here</p>
                        <p className="text-[10px] text-slate-600 mt-1">or click to browse — PDF only, max 500 MB</p>
                      </div>
                    )}
                  </div>

                  {/* Upload Progress */}
                  {uploading && (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] font-bold">
                        <span className="text-cyan-400">Uploading PDF to secure storage...</span>
                        <span className="text-white">{uploadProgress}%</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="bg-blue-500/5 border border-blue-500/15 rounded-xl p-3 text-[10px] font-semibold text-blue-300 leading-relaxed">
                    💡 <strong>How it works:</strong> PDF is uploaded to secure HRTA cloud storage. Students receive an email with your message + a secure download link for the PDF. Files &gt; 40MB are sent as links, smaller files are attached directly.
                  </div>
                </div>

                {/* Send Button */}
                <button
                  onClick={handleSend}
                  disabled={sending || uploading || selectedStudents.length === 0}
                  className="w-full bg-gradient-to-r from-cyan-500 via-blue-600 to-purple-600 hover:from-cyan-400 hover:via-blue-500 hover:to-purple-500 disabled:from-slate-700 disabled:via-slate-700 disabled:to-slate-700 text-white py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all shadow-2xl shadow-cyan-500/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {sending ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Sending to {selectedStudents.length} student{selectedStudents.length > 1 ? 's' : ''}...
                    </>
                  ) : (
                    <>
                      <span className="text-xl">🚀</span>
                      Send to {selectedStudents.length > 0 ? `${selectedStudents.length} Student${selectedStudents.length > 1 ? 's' : ''}` : 'Selected Students'}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* ── Sent Log ─────────────────────────────────────────────── */}
            {sentLog.length > 0 && (
              <div className="bg-transparent border border-white/5 rounded-2xl shadow-2xl overflow-hidden">
                <div className="border-b border-white/5 px-6 py-4 flex justify-between items-center">
                  <h3 className="font-bold text-white text-xs uppercase tracking-wider">📬 Sent History (This Session)</h3>
                  <button
                    onClick={() => setSentLog([])}
                    className="text-[10px] text-slate-600 hover:text-red-400 font-bold cursor-pointer transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="divide-y divide-white/5">
                  {sentLog.map(log => (
                    <div key={log.id} className="px-6 py-4 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{log.subject}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          To: {log.recipients.slice(0, 3).join(', ')}{log.recipients.length > 3 ? ` +${log.recipients.length - 3} more` : ''}
                        </p>
                        {log.pdfName && (
                          <p className="text-[10px] text-emerald-400 mt-0.5">📎 {log.pdfName}</p>
                        )}
                        <p className="text-[10px] text-slate-600 mt-0.5">{log.sentAt}</p>
                      </div>
                      <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded uppercase shrink-0">
                        ✅ Sent
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
