import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  ShieldAlert,
  FileText,
  HelpCircle,
  Activity,
  ArrowLeft,
  Mail,
  Search,
  CheckCircle,
  XCircle,
  ChevronDown,
  Info,
  Clock,
  Video,
  AlertTriangle,
  Globe,
  Settings,
  PhoneCall,
  UserCheck
} from 'lucide-react';

export default function InfoHelpCenter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentTab = searchParams.get('tab') || 'guidelines';
  const [searchQuery, setSearchQuery] = useState('');
  
  // Status state
  const [backendStatus, setBackendStatus] = useState('checking');
  const [dbStatus, setDbStatus] = useState('checking');
  
  // Form State
  const [contactForm, setContactForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Accordion active sections
  const [activeAccordion, setActiveAccordion] = useState({});

  const toggleAccordion = (id) => {
    setActiveAccordion(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Run status pinger on mount / Tab selection
  useEffect(() => {
    if (currentTab === 'status') {
      checkSystemHealth();
    }
  }, [currentTab]);

  const checkSystemHealth = async () => {
    setBackendStatus('checking');
    setDbStatus('checking');

    // 1. Check Supabase
    try {
      const start = Date.now();
      const { data, error } = await supabase.auth.getSession();
      const latency = Date.now() - start;
      if (error) throw error;
      setDbStatus(`online (${latency}ms)`);
    } catch (e) {
      setDbStatus('offline');
    }

    // 2. Check Backend API
    try {
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
      const start = Date.now();
      const res = await fetch(`${apiBaseUrl}/`, { method: 'HEAD', mode: 'cors' }).catch(() => null);
      const latency = Date.now() - start;
      if (res) {
        setBackendStatus(`online (${latency}ms)`);
      } else {
        // Fallback fetch check
        const res2 = await fetch(apiBaseUrl).catch(() => null);
        if (res2) {
          setBackendStatus(`online (${Date.now() - start}ms)`);
        } else {
          setBackendStatus('offline');
        }
      }
    } catch (e) {
      setBackendStatus('offline');
    }
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setFormSubmitting(true);
    try {
      const { error } = await supabase
        .from('support_tickets')
        .insert([{
          name: contactForm.name,
          email: contactForm.email,
          subject: contactForm.subject,
          message: contactForm.message
        }]);

      if (error) throw error;
      setFormSubmitted(true);
      setContactForm({ name: '', email: '', subject: '', message: '' });
    } catch (err) {
      console.error("Error submitting support ticket:", err.message);
      alert("Failed to submit support ticket. Please try again. Error: " + err.message);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleTabChange = (tabId) => {
    setSearchParams({ tab: tabId });
  };

  // Content Filter based on Search
  const filterMatches = (title, content) => {
    if (!searchQuery) return true;
    const cleanQuery = searchQuery.toLowerCase();
    return title.toLowerCase().includes(cleanQuery) || content.toLowerCase().includes(cleanQuery);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* HEADER BANNER */}
      <header className="relative overflow-hidden bg-slate-900/60 border-b border-white/5 py-12 px-6">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-blue-600/10 opacity-30 pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
          <div>
            <button 
              onClick={() => navigate(-1)} 
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-cyan-400 transition-colors mb-4 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back
            </button>
            <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">HRTA Portal</span>
              <span className="text-slate-500 font-light text-2xl">|</span>
              <span className="text-slate-300 text-2xl font-semibold">Info & Help Center</span>
            </h1>
            <p className="text-xs text-slate-400 mt-2 max-w-xl leading-relaxed">
              Find technical instructions, exam policies, legal declarations, and run network connectivity diagnostics for the Harman Rathi Testing Agency examination portal.
            </p>
          </div>
          
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search policies or guidelines..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900/90 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 transition-all text-white placeholder:text-slate-500"
            />
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 grid grid-cols-1 lg:grid-cols-4 gap-8 w-full">
        
        {/* VERTICAL SIDEBAR NAVIGATION */}
        <aside className="lg:col-span-1 space-y-2">
          <div className="glass border border-white/5 rounded-2xl p-4 sticky top-6 space-y-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-3 mb-3">Navigation Menu</p>
            
            <button
              onClick={() => handleTabChange('guidelines')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                currentTab === 'guidelines'
                  ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white border border-transparent'
              }`}
            >
              <Video className="w-4 h-4" /> Exam & Anti-Cheating
            </button>

            <button
              onClick={() => handleTabChange('support')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                currentTab === 'support'
                  ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white border border-transparent'
              }`}
            >
              <HelpCircle className="w-4 h-4" /> Support & FAQ
            </button>

            <button
              onClick={() => handleTabChange('legal')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                currentTab === 'legal'
                  ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white border border-transparent'
              }`}
            >
              <FileText className="w-4 h-4" /> Legal & Policies
            </button>

            <button
              onClick={() => handleTabChange('status')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                currentTab === 'status'
                  ? 'bg-gradient-to-r from-cyan-500/10 to-blue-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white border border-transparent'
              }`}
            >
              <Activity className="w-4 h-4" /> Live System Status
            </button>

            <div className="pt-4 border-t border-white/5 mt-4 px-3">
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Emergency Support Email:
                <a href="mailto:superadmin@harmanrathiportal.dpdns.org" className="block text-cyan-400 hover:underline font-mono mt-1 select-all break-all">
                  superadmin@harmanrathiportal.dpdns.org
                </a>
              </p>
            </div>
          </div>
        </aside>

        {/* TAB CONTENTS PANEL */}
        <section className="lg:col-span-3 space-y-6">
          
          {/* TAB 1: EXAM & ANTI-CHEATING */}
          {currentTab === 'guidelines' && (
            <div className="space-y-6">
              
              {/* Card 1: Exam Guidelines */}
              {filterMatches("Exam Guidelines & System Requirements", "hardware checklist camera microphone browsers upload download speed portal setup") && (
                <div className="glass border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl" />
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2 mb-4">
                    <Video className="w-5 h-5 text-cyan-400" /> Exam Guidelines & System Requirements
                  </h2>
                  <div className="text-sm text-slate-300 space-y-4 leading-relaxed">
                    <p>
                      To ensure a smooth exam experience on the HRTA Proctored Portal, candidates must satisfy the following hardware and software requirements before starting:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <h4 className="font-bold text-white mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-cyan-400">
                          <Video className="w-4 h-4" /> Hardware Checklist
                        </h4>
                        <ul className="list-disc pl-4 space-y-1.5 text-xs text-slate-400">
                          <li>Webcam: Minimum 720p resolution, aligned directly with face.</li>
                          <li>Microphone: Integrated or external, capturing ambient audio.</li>
                          <li>Connection: Stable internet with min 2 Mbps upload/download speed.</li>
                          <li>Power: Laptop charger plugged in, or desktop with UPS backup.</li>
                        </ul>
                      </div>
                      
                      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                        <h4 className="font-bold text-white mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-cyan-400">
                          <Settings className="w-4 h-4" /> Software Setup
                        </h4>
                        <ul className="list-disc pl-4 space-y-1.5 text-xs text-slate-400">
                          <li>Operating System: Windows 10/11, macOS, Linux, ChromeOS, or iPadOS.</li>
                          <li>Browser: Latest version of Google Chrome, Microsoft Edge, or Safari.</li>
                          <li>Permissions: Enable Camera & Mic access when prompted by the portal.</li>
                          <li>Popups: Disable popup blockers and close notification banners.</li>
                        </ul>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400 bg-white/5 border border-white/5 rounded-lg p-3">
                      💡 <strong>Note:</strong> Smartphones (iPhone/Android) are not recommended for taking exams due to screen layout constraints, though the proctoring engine automatically bypasses fullscreen locks for devices that physically lack document-level fullscreen APIs (like iPhones).
                    </p>
                  </div>
                </div>
              )}

              {/* Card 2: Anti-Cheating Policy */}
              {filterMatches("Anti-Cheating Policy & Real-time Proctoring", "cheating window blur focus switches luminance analysis OBS virtual camera proctor locks approved rejected") && (
                <div className="glass border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-2xl" />
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2 mb-4">
                    <ShieldAlert className="w-5 h-5 text-rose-400" /> Anti-Cheating Policy & Proctoring Controls
                  </h2>
                  <div className="text-sm text-slate-300 space-y-4 leading-relaxed">
                    <p>
                      HRTA enforces strict real-time AI-assisted and human-supervised proctoring. By launching an exam attempt, you agree to comply with all proctoring criteria:
                    </p>
                    <div className="space-y-3 bg-rose-500/5 border border-rose-500/10 rounded-xl p-4 text-xs">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-rose-300">Tab Switching Limit:</strong> Moving focus away from the exam tab (tab switching, opening devtools, switching windows) triggers an alert. You are permitted at most <strong>5 warnings</strong>. Exceeding this limit immediately freezes your exam.
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-rose-300">Luminance Threshold Check:</strong> The portal programmatically monitors webcam feed lighting. If average pixel luminance drops below 8 (indicating a covered camera or pitch-black room), the system triggers an immediate freeze.
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-rose-300">Frozen Stream / Virtual Input:</strong> Checking outbound WebRTC frame streams prevents frozen loops (like OBS virtual inputs). If frame count increments stop for 3 seconds, the exam locks.
                        </div>
                      </div>
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-rose-300">Keyboard & Mouse Blocks:</strong> Copy-pasting, right-clicking, and administrative shortcuts (F12, PrintScreen) are blocked. Violations log audit records on the server.
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">
                      If frozen due to a violation, candidates are locked out until the Superadmin reviews their alert and clicks **Approve Unlock** (restoring the exam) or **Reject & Fail** (terminating the attempt with a score of 0).
                    </p>
                  </div>
                </div>
              )}

              {/* Card 3: Grievance Policy */}
              {filterMatches("Grievance Policy & Lock Appeals", "grievance appeal locking dispute grading discrepancy superadmin") && (
                <div className="glass border border-white/5 rounded-2xl p-6">
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2 mb-4">
                    <UserCheck className="w-5 h-5 text-emerald-400" /> Grievance Policy & Lock Appeals
                  </h2>
                  <div className="text-sm text-slate-300 space-y-3 leading-relaxed">
                    <p>
                      If your exam was frozen due to false proctoring flags (e.g. ambient lighting fluctuations or accidental mouse slip-outs), or if you disagree with grading metrics:
                    </p>
                    <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-400">
                      <li><strong>Immediate Appeal:</strong> Click "Request Unlock" on the blocked exam screen to notify live proctors immediately.</li>
                      <li><strong>Email Grievance:</strong> For disputes after exam completion, submit a formal appeal stating your candidate ID, exam ID, and reason within 48 hours to <a href="mailto:superadmin@harmanrathiportal.dpdns.org" className="text-cyan-400 hover:underline">superadmin@harmanrathiportal.dpdns.org</a>.</li>
                      <li><strong>Audit Verification:</strong> Grievance staff will inspect WebRTC logs, tab-switch timelines, and audit records to verify your appeal. Decision outcomes are typically dispatched within 3 business days.</li>
                    </ol>
                  </div>
                </div>
              )}
              
            </div>
          )}

          {/* TAB 2: SUPPORT & FAQ */}
          {currentTab === 'support' && (
            <div className="space-y-6">
              
              {/* FAQ Accordions */}
              <div className="glass border border-white/5 rounded-2xl p-6">
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2 mb-6">
                  <HelpCircle className="w-5 h-5 text-cyan-400" /> Frequently Asked Questions
                </h2>
                
                <div className="space-y-3">
                  {[
                    {
                      id: 'faq1',
                      q: 'How do I resolve "Webcam/Microphone Permission Denied" error?',
                      a: 'Click the camera lock icon in your browser URL bar, change the permission from Block to Allow, and reload the page. Ensure no other applications (like Zoom, Teams, or Skype) are running and using your camera in the background.'
                    },
                    {
                      id: 'faq2',
                      q: 'My exam was frozen mid-session. How do I unlock it?',
                      a: 'If you exceed the 5 tab-switching limit or if your environment is flagged as too dark, the interface locks. Keep the page open and do not reload. The superadmin dashboard has been alerted; they will review your stream and issue an unlock signal in real-time.'
                    },
                    {
                      id: 'faq3',
                      q: 'Are my exam answers saved if my internet connection drops?',
                      a: 'Yes. The portal automatically runs a background save of your selections every 30 seconds. Additionally, when you click Submit, the portal merges your local selections with the database backups to prevent last-second sync loss.'
                    },
                    {
                      id: 'faq4',
                      q: 'Can I log in on another device or tab if my browser crashes?',
                      a: 'Yes. We have deactivated concurrent device locking, meaning you can open a new browser window or device to re-log in. Your exam progress is restored from the database draft.'
                    },
                    {
                      id: 'faq5',
                      q: 'How do I receive my exam scorecard after finishing?',
                      a: 'When results are published by the admin, an automated scorecard link is generated and sent to your registered email address. This link uses a secure cryptographic HMAC token allowing you to view your results instantly without logging in.'
                    }
                  ].map((item) => (
                    <div key={item.id} className="border-b border-white/5 pb-3">
                      {filterMatches(item.q, item.a) && (
                        <>
                          <button
                            onClick={() => toggleAccordion(item.id)}
                            className="w-full flex justify-between items-center text-left py-2.5 text-sm font-semibold text-slate-200 hover:text-cyan-400 transition-colors"
                          >
                            <span>{item.q}</span>
                            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${activeAccordion[item.id] ? 'rotate-180' : ''}`} />
                          </button>
                          {activeAccordion[item.id] && (
                            <div className="text-xs text-slate-400 mt-2 pl-1 leading-relaxed bg-white/5 p-3 rounded-lg border border-white/5">
                              {item.a}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Contact Us Form */}
              {filterMatches("Contact Us Support Form", "submit message email harmanrathiportal helpdesk feedback") && (
                <div className="glass border border-white/5 rounded-2xl p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl" />
                  <h2 className="text-xl font-extrabold text-white flex items-center gap-2 mb-4">
                    <Mail className="w-5 h-5 text-cyan-400" /> Contact Support
                  </h2>
                  <div className="text-sm text-slate-300 mb-6">
                    Have any technical queries or administrative issues? Send us a message or contact us directly at <a href="mailto:superadmin@harmanrathiportal.dpdns.org" className="text-cyan-400 hover:underline">superadmin@harmanrathiportal.dpdns.org</a>.
                  </div>

                  {formSubmitted ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl p-4 flex items-center gap-3">
                      <CheckCircle className="w-5 h-5" />
                      <div>
                        <strong className="block text-emerald-300 font-bold mb-0.5">Message Sent Successfully!</strong>
                        Our support team will review your ticket and contact you at your email address shortly.
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleContactSubmit} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Your Name</label>
                          <input
                            type="text"
                            required
                            value={contactForm.name}
                            onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                            className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-white"
                            placeholder="e.g. John Doe"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Your Email</label>
                          <input
                            type="email"
                            required
                            value={contactForm.email}
                            onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                            className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-white"
                            placeholder="e.g. john@example.com"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Subject</label>
                        <input
                          type="text"
                          required
                          value={contactForm.subject}
                          onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                          className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-white"
                          placeholder="e.g. Camera connection error during exam"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Message / Details</label>
                        <textarea
                          required
                          rows={4}
                          value={contactForm.message}
                          onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                          className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 text-white resize-none"
                          placeholder="Please provide full details including your candidate ID and exam details if applicable..."
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={formSubmitting}
                        className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold py-3 rounded-xl transition-all shadow-md text-xs uppercase"
                      >
                        {formSubmitting ? 'Sending...' : 'Send Message'}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Accessibility & Security Policy Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filterMatches("Accessibility Statement", "standard accessibility web content guidelines compatible screen readers keyboard navigation") && (
                  <div className="glass border border-white/5 rounded-2xl p-6">
                    <h3 className="font-extrabold text-white flex items-center gap-1.5 mb-2 text-sm uppercase tracking-wider text-cyan-400">
                      <Globe className="w-4.5 h-4.5" /> Accessibility Statement
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      We aim to ensure the exam portal complies with the Web Content Accessibility Guidelines (WCAG 2.1). Features include keyboard navigation support, high contrast dark theme options, and compatibility with leading screen readers. If you require special testing arrangements, please contact the Superadmin.
                    </p>
                  </div>
                )}

                {filterMatches("Security Policy & Responsible Disclosure", "security vulnerability reporting policy disclosure bug bounty superadmin") && (
                  <div className="glass border border-white/5 rounded-2xl p-6">
                    <h3 className="font-extrabold text-white flex items-center gap-1.5 mb-2 text-sm uppercase tracking-wider text-cyan-400">
                      <ShieldAlert className="w-4.5 h-4.5" /> Security Policy
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      We take platform security seriously. If you discover a security vulnerability in the exam portal or APIs, please report it privately via email to <a href="mailto:superadmin@harmanrathiportal.dpdns.org" className="text-cyan-400 hover:underline">superadmin@harmanrathiportal.dpdns.org</a>. Do not disclose the issue publicly until a fix is deployed.
                    </p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: LEGAL & POLICIES */}
          {currentTab === 'legal' && (
            <div className="space-y-6">
              
              {/* Terms and Conditions */}
              {filterMatches("Terms & Conditions of Use", "terms conditions obligations license intellectual property cheating hacking code") && (
                <div className="glass border border-white/5 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                    <FileText className="w-4.5 h-4.5 text-cyan-400" /> Terms & Conditions
                  </h2>
                  <div className="text-xs text-slate-400 space-y-2 leading-relaxed">
                    <p>
                      Welcome to the HARMAN RATHI TESTING AGENCY (HRTA) Portal. By creating an account or accessing the exams, you agree to these Terms and Conditions:
                    </p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li><strong>Account Use:</strong> Only the registered candidate is permitted to log in and use their credential credentials. Sharing access is strictly prohibited.</li>
                      <li><strong>Intellectual Property:</strong> All exams, questions, graphics, stylesheets, and proctoring algorithms are the intellectual property of HRTA. Re-publishing or sharing questions is illegal.</li>
                      <li><strong>System Misuse:</strong> Attempting to reverse engineer backend scoring systems, bypass WebRTC streams, or scrape correct answers will lead to immediate account suspension and legal action.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Privacy Policy */}
              {filterMatches("Privacy Policy & Data Consent", "privacy data encryption camera logs audio sessions retention GDRP") && (
                <div className="glass border border-white/5 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                    <FileText className="w-4.5 h-4.5 text-cyan-400" /> Privacy Policy & Consent
                  </h2>
                  <div className="text-xs text-slate-400 space-y-2 leading-relaxed">
                    <p>
                      Your privacy is essential. We collect data solely to verify candidate identity and ensure exam integrity:
                    </p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li><strong>Authentication Info:</strong> Name, Email, DOB, and device metadata.</li>
                      <li><strong>Proctoring Stream:</strong> During active tests, we request access to your camera and microphone. Outbound streams are encrypted and transmitted to verified administrators in real-time.</li>
                      <li><strong>Audit Records:</strong> We record logs of browser focus losses, window blur timings, keyboard shortcuts, and IP addresses during the exam.</li>
                      <li><strong>Retention:</strong> Proctoring streams and results logs are stored securely in database systems and deleted automatically after 90 days.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Cookie Policy */}
              {filterMatches("Cookie Policy", "cookies tracking analytics sessions reCAPTCHA localstorage") && (
                <div className="glass border border-white/5 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                    <FileText className="w-4.5 h-4.5 text-cyan-400" /> Cookie Policy
                  </h2>
                  <div className="text-xs text-slate-400 space-y-2 leading-relaxed">
                    <p>
                      The HRTA Portal uses essential cookies and local storage tokens to manage candidate sessions. We do not use third-party marketing or tracking cookies. Cookies used include:
                    </p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li><strong>Session Cookies:</strong> Keep you logged into your profile dashboard during a browser session.</li>
                      <li><strong>Exam Progress State:</strong> Save local answers to localStorage to secure your response state against browser crashes.</li>
                      <li><strong>reCAPTCHA:</strong> Set by Google to verify that your login attempt is human.</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              {filterMatches("Disclaimer Notice", "disclaimer mock exam results scores representations liabilities") && (
                <div className="glass border border-white/5 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                    <FileText className="w-4.5 h-4.5 text-cyan-400" /> Disclaimer
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    The examinations hosted on the HRTA portal are intended to evaluate candidates under strict academic testing parameters. HRTA makes no representations or warranties regarding career outcomes or external examination scores based on portal performance. HRTA is not liable for technical drops, connectivity failures, or power failures on the candidate's device during exam sessions.
                  </p>
                </div>
              )}

              {/* Refund Policy */}
              {filterMatches("Refund & Cancellation Policy", "refund cancel purchase exam test series fee") && (
                <div className="glass border border-white/5 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                    <FileText className="w-4.5 h-4.5 text-cyan-400" /> Refund & Cancellation Policy
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Registrations, test series purchases, and exam fees processed through the HRTA portal are completely non-refundable and non-transferable under any circumstances once the candidate is assigned to a schedule. In cases of technical platform outages verified by our servers, candidate attempts may be rescheduled without charge.
                  </p>
                </div>
              )}

              {/* Copyright Notice */}
              {filterMatches("Copyright Notice", "copyright intellectual property rights harman rathi agency reserved") && (
                <div className="glass border border-white/5 rounded-2xl p-6">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-3">
                    <FileText className="w-4.5 h-4.5 text-cyan-400" /> Copyright Notice
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    © {new Date().getFullYear()} HARMAN RATHI TESTING AGENCY. All rights reserved. The website design, codebase, examination questions, proctoring scripts, and structural layouts are protected by international copyright laws. Unauthorized reproduction, modification, or distribution is punishable by law.
                  </p>
                </div>
              )}

            </div>
          )}

          {/* TAB 4: LIVE SYSTEM STATUS */}
          {currentTab === 'status' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="glass border border-white/5 rounded-2xl p-6">
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2 mb-3">
                  <Activity className="w-5 h-5 text-cyan-400" /> Live System Status
                </h2>
                <p className="text-sm text-slate-300 mb-6">
                  Run a real-time connectivity diagnostic to verify that your browser can communicate with HRTA's backend systems and database.
                </p>

                <div className="space-y-4">
                  {/* Backend API Connection status */}
                  <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl">
                    <div className="flex items-center gap-3">
                      <Settings className={`w-5 h-5 ${backendStatus.startsWith('online') ? 'text-emerald-400' : backendStatus === 'offline' ? 'text-rose-400' : 'text-slate-400 animate-spin'}`} />
                      <div>
                        <strong className="block text-sm text-white">HRTA Backend API</strong>
                        <span className="text-xs text-slate-400">Verifies grading endpoints, token validations, and email delivery service.</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {backendStatus.startsWith('online') ? (
                        <>
                          <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">{backendStatus}</span>
                          <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
                        </>
                      ) : backendStatus === 'offline' ? (
                        <>
                          <span className="text-xs font-mono text-rose-400 uppercase tracking-wider">OFFLINE</span>
                          <span className="w-2.5 h-2.5 bg-rose-500 rounded-full" />
                        </>
                      ) : (
                        <span className="text-xs text-slate-500 italic">Pinging...</span>
                      )}
                    </div>
                  </div>

                  {/* Supabase connection status */}
                  <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl">
                    <div className="flex items-center gap-3">
                      <UserCheck className={`w-5 h-5 ${dbStatus.startsWith('online') ? 'text-emerald-400' : dbStatus === 'offline' ? 'text-rose-400' : 'text-slate-400 animate-spin'}`} />
                      <div>
                        <strong className="block text-sm text-white">Supabase Core Database</strong>
                        <span className="text-xs text-slate-400">Stores active student accounts, exam structures, and candidate answers.</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {dbStatus.startsWith('online') ? (
                        <>
                          <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">{dbStatus}</span>
                          <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
                        </>
                      ) : dbStatus === 'offline' ? (
                        <>
                          <span className="text-xs font-mono text-rose-400 uppercase tracking-wider">OFFLINE</span>
                          <span className="w-2.5 h-2.5 bg-rose-500 rounded-full" />
                        </>
                      ) : (
                        <span className="text-xs text-slate-500 italic">Pinging...</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={checkSystemHealth}
                    className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/30 text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all text-slate-300 hover:text-cyan-400 flex items-center gap-2"
                  >
                    <Activity className="w-4 h-4" /> Run Network Diagnostics
                  </button>
                </div>
              </div>

              {/* Troubleshooting connection */}
              <div className="glass border border-white/5 rounded-2xl p-6">
                <h3 className="font-extrabold text-white flex items-center gap-1.5 mb-2 text-sm uppercase tracking-wider text-rose-400">
                  <AlertTriangle className="w-4.5 h-4.5" /> Troubleshooting Connection Issues
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  If the diagnostic tool shows offline flags, please check your local internet router setup. If you are behind a corporate or institutional school firewall, it may be blocking port connections to Supabase (Port 443 / SSL) or WebSockets. Try connecting through a personal mobile data hotspot to check connectivity.
                </p>
              </div>
            </div>
          )}

        </section>

      </main>

      {/* FOOTER */}
      <footer className="bg-slate-950 border-t border-white/5 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} HARMAN RATHI TESTING AGENCY (HRTA). All Rights Reserved.
          </p>
          <div className="flex justify-center gap-4 mt-3 text-[10px] text-slate-400">
            <Link to="/login" className="hover:text-cyan-400 transition-colors">Return to Login</Link>
            <span>•</span>
            <a href="mailto:superadmin@harmanrathiportal.dpdns.org" className="hover:text-cyan-400 transition-colors">Emergency Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
