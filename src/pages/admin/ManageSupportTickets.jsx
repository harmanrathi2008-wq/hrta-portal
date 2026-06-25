import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { toast } from 'sonner';
import {
  ClipboardList,
  Search,
  CheckCircle,
  Clock,
  Mail,
  Send,
  Trash2,
  Filter,
  CheckSquare,
  AlertCircle,
  User,
  Calendar,
  MessageSquare,
  X
} from 'lucide-react';

export default function ManageSupportTickets() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all', 'pending', 'completed'
  const [search, setSearch] = useState('');
  
  // Selected ticket for side-drawer details
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Statistics
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    completed: 0
  });

  useEffect(() => {
    // Role check
    const role = sessionStorage.getItem('role');
    if (role !== 'super_admin' && role !== 'admin') {
      navigate('/');
      return;
    }

    fetchTickets();

    // Subscribe to real-time support_tickets PostgreSQL changes
    const ticketsChannel = supabase
      .channel('admin-support-tickets-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'support_tickets' },
        () => {
          fetchTickets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ticketsChannel);
    };
  }, [navigate]);

  const fetchTickets = async () => {
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const ticketsList = data || [];
      setTickets(ticketsList);

      // Compute statistics
      const total = ticketsList.length;
      const pending = ticketsList.filter(t => t.status === 'pending').length;
      const completed = ticketsList.filter(t => t.status === 'completed').length;
      setStats({ total, pending, completed });

    } catch (err) {
      console.error('Error fetching support tickets:', err);
      toast.error('Failed to load support tickets: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Toggle status manually without sending email
  const handleToggleStatus = async (ticket) => {
    setActionLoading(true);
    const nextStatus = ticket.status === 'pending' ? 'completed' : 'pending';
    const resolvedAt = nextStatus === 'completed' ? new Date().toISOString() : null;

    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({
          status: nextStatus,
          resolved_at: resolvedAt
        })
        .eq('id', ticket.id);

      if (error) throw error;
      
      toast.success(`Ticket marked as ${nextStatus === 'completed' ? 'Completed' : 'Pending'}`);
      if (selectedTicket && selectedTicket.id === ticket.id) {
        setSelectedTicket(prev => ({ ...prev, status: nextStatus, resolved_at: resolvedAt }));
      }
    } catch (err) {
      console.error('Error updating ticket status:', err);
      toast.error('Failed to update ticket: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Delete support ticket
  const handleDeleteTicket = async (ticketId) => {
    if (!window.confirm("Are you sure you want to delete this ticket? This action is irreversible.")) return;
    
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('support_tickets')
        .delete()
        .eq('id', ticketId);

      if (error) throw error;

      toast.success("Support ticket deleted successfully.");
      if (selectedTicket && selectedTicket.id === ticketId) {
        setSelectedTicket(null);
      }
    } catch (err) {
      console.error('Error deleting ticket:', err);
      toast.error('Failed to delete ticket: ' + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Send email response and resolve ticket
  const handleSendEmailReply = async (e) => {
    e.preventDefault();
    if (!replyMessage.trim()) {
      toast.error("Please enter a reply message.");
      return;
    }

    setSendingReply(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const loginLogId = sessionStorage.getItem('loginLogId') || '';
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';

      const response = await fetch(`${apiBaseUrl}/api/reply-support-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': loginLogId
        },
        body: JSON.stringify({
          ticketId: selectedTicket.id,
          replyMessage: replyMessage
        })
      });

      let resData = {};
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        resData = await response.json();
      } else {
        const errText = await response.text();
        throw new Error(errText || `Server returned non-JSON response (Status: ${response.status})`);
      }

      if (!response.ok) {
        throw new Error(resData.error || 'Failed to send support email reply.');
      }

      toast.success("Reply dispatched successfully! Ticket resolved.");
      setReplyMessage('');
      
      // Refresh details
      const { data: updatedTicket } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('id', selectedTicket.id)
        .single();
      
      if (updatedTicket) {
        setSelectedTicket(updatedTicket);
      }
    } catch (err) {
      console.error('Error sending reply:', err);
      toast.error(err.message || 'Failed to resolve ticket.');
    } finally {
      setSendingReply(false);
    }
  };

  // Filtered tickets
  const filteredTickets = tickets.filter(ticket => {
    const matchesFilter = 
      filter === 'all' || 
      (filter === 'pending' && ticket.status === 'pending') || 
      (filter === 'completed' && ticket.status === 'completed');

    const matchesSearch = 
      search === '' ||
      ticket.name.toLowerCase().includes(search.toLowerCase()) ||
      ticket.email.toLowerCase().includes(search.toLowerCase()) ||
      ticket.subject.toLowerCase().includes(search.toLowerCase()) ||
      ticket.message.toLowerCase().includes(search.toLowerCase());

    return matchesFilter && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 flex flex-col font-sans">
      <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col gap-6">
        
        {/* HEADER BAR */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-cyan-400" /> Support Tickets & Inquiries
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Manage student concerns, mark ticket status, and reply using your official domain email: <span className="text-cyan-400 font-mono">response@harmanrathiportal.dpdns.org</span>.
            </p>
          </div>
        </div>

        {/* METRICS / STATS CARD */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass border border-white/5 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Tickets</p>
              <h3 className="text-2xl font-black text-white mt-1">{stats.total}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center text-slate-400">
              <ClipboardList className="w-5 h-5" />
            </div>
          </div>

          <div className="glass border border-white/5 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pending Concerns</p>
              <h3 className="text-2xl font-black text-amber-400 mt-1">{stats.pending}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Clock className="w-5 h-5 animate-pulse" />
            </div>
          </div>

          <div className="glass border border-white/5 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Resolved Tickets</p>
              <h3 className="text-2xl font-black text-emerald-400 mt-1">{stats.completed}</h3>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* SEARCH, FILTER & DATA PANEL */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* TICKETS LIST TABLE CARD */}
          <div className={`glass border border-white/5 rounded-2xl p-6 ${selectedTicket ? 'lg:col-span-7' : 'lg:col-span-12'} flex flex-col gap-4 transition-all duration-300`}>
            
            {/* Filters Bar */}
            <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
              <div className="flex bg-slate-900/80 rounded-xl p-1 border border-white/5 self-start">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                    filter === 'all' ? 'bg-cyan-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter('pending')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                    filter === 'pending' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setFilter('completed')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                    filter === 'completed' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Resolved
                </button>
              </div>

              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search tickets..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-slate-900/60 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-xs focus:outline-none focus:border-cyan-500 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* List Table */}
            {loading ? (
              <div className="py-20 text-center text-xs text-slate-500">Loading support tickets...</div>
            ) : filteredTickets.length === 0 ? (
              <div className="py-20 text-center text-xs text-slate-500 border border-dashed border-white/5 rounded-xl">
                No support tickets found matching criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-500 font-bold uppercase tracking-wider">
                      <th className="py-3 px-2">Subject / Ticket</th>
                      <th className="py-3 px-2">Sender</th>
                      <th className="py-3 px-2">Submitted</th>
                      <th className="py-3 px-2 text-center">Status</th>
                      <th className="py-3 px-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredTickets.map((ticket) => (
                      <tr 
                        key={ticket.id} 
                        onClick={() => setSelectedTicket(ticket)}
                        className={`hover:bg-white/5 transition-colors cursor-pointer ${selectedTicket?.id === ticket.id ? 'bg-cyan-500/5 border-l-2 border-l-cyan-400' : ''}`}
                      >
                        <td className="py-4 px-2">
                          <strong className="block text-white font-bold text-sm leading-snug">{ticket.subject}</strong>
                          <span className="text-[10px] text-slate-500 truncate max-w-[200px] block mt-0.5">{ticket.message}</span>
                        </td>
                        <td className="py-4 px-2">
                          <span className="block font-medium text-slate-300">{ticket.name}</span>
                          <span className="text-[10px] text-slate-500 font-mono select-all">{ticket.email}</span>
                        </td>
                        <td className="py-4 px-2 text-slate-400">
                          {new Date(ticket.created_at).toLocaleDateString()}<br/>
                          <span className="text-[10px] text-slate-500">{new Date(ticket.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </td>
                        <td className="py-4 px-2 text-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                            ticket.status === 'pending'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ticket.status === 'pending' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                            {ticket.status}
                          </span>
                        </td>
                        <td className="py-4 px-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleToggleStatus(ticket)}
                              title={ticket.status === 'pending' ? 'Mark Completed' : 'Reopen Ticket'}
                              disabled={actionLoading}
                              className={`p-1.5 rounded-lg border transition-all ${
                                ticket.status === 'pending'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                              }`}
                            >
                              <CheckSquare className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteTicket(ticket.id)}
                              title="Delete Ticket"
                              disabled={actionLoading}
                              className="p-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 rounded-lg transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* TICKET DETAILS INSPECTOR PANEL */}
          {selectedTicket && (
            <div className="lg:col-span-5 glass border border-white/5 rounded-2xl p-6 flex flex-col gap-5 sticky top-6 animate-fadeIn">
              
              {/* Header Details */}
              <div className="flex justify-between items-start border-b border-white/5 pb-4">
                <div>
                  <h3 className="font-extrabold text-white text-base leading-snug">{selectedTicket.subject}</h3>
                  <span className="text-[10px] text-slate-500 mt-1 block">Ticket ID: {selectedTicket.id}</span>
                </div>
                <button 
                  onClick={() => setSelectedTicket(null)}
                  className="p-1 text-slate-500 hover:text-white bg-slate-900 border border-white/10 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Sender Details Cards */}
              <div className="bg-slate-900/60 border border-white/5 rounded-xl p-4 space-y-3">
                <div className="flex gap-3 items-center">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-xs text-slate-400">Sender Name</span>
                    <strong className="text-white text-xs font-bold">{selectedTicket.name}</strong>
                  </div>
                </div>

                <div className="flex gap-3 items-center">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-xs text-slate-400">Sender Email</span>
                    <a href={`mailto:${selectedTicket.email}`} className="text-cyan-400 text-xs font-mono hover:underline">{selectedTicket.email}</a>
                  </div>
                </div>

                <div className="flex gap-3 items-center">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block text-xs text-slate-400">Date & Time Submitted</span>
                    <span className="text-slate-300 text-xs">{new Date(selectedTicket.created_at).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Message Box */}
              <div>
                <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Candidate Concern Message</span>
                <div className="bg-slate-900 border border-white/5 rounded-xl p-4 text-xs text-slate-300 leading-relaxed font-sans whitespace-pre-wrap max-h-40 overflow-y-auto select-text">
                  {selectedTicket.message}
                </div>
              </div>

              {/* Reply / Resolution Details */}
              {selectedTicket.status === 'completed' ? (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-xs text-emerald-400 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    <strong>Ticket Resolved</strong>
                  </div>
                  {selectedTicket.resolved_at && (
                    <span className="block text-[10px] text-emerald-500 font-medium">Completed on: {new Date(selectedTicket.resolved_at).toLocaleString()}</span>
                  )}
                  {selectedTicket.admin_notes && (
                    <div className="mt-2 border-t border-emerald-500/10 pt-2">
                      <span className="block text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">Response Dispatched:</span>
                      <p className="text-slate-300 leading-relaxed italic whitespace-pre-wrap">"{selectedTicket.admin_notes}"</p>
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSendEmailReply} className="space-y-3">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                    <Send className="w-3.5 h-3.5 text-cyan-400" /> Dispatch Response Email
                  </label>
                  <span className="text-[10px] text-slate-400 block -mt-1 leading-normal">
                    This message will be styled professionally and sent to <span className="font-mono text-cyan-400">{selectedTicket.email}</span> from <span className="font-mono text-cyan-400">response@harmanrathiportal.dpdns.org</span>.
                  </span>
                  
                  <textarea
                    required
                    rows={4}
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-white resize-none"
                    placeholder="Type support response to be emailed..."
                  />
                  
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={sendingReply}
                      className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-extrabold py-2.5 rounded-xl transition-all shadow-md text-xs uppercase flex justify-center items-center gap-1.5 disabled:opacity-60"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {sendingReply ? 'Sending Reply...' : 'Send Reply & Resolve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(selectedTicket)}
                      className="bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold uppercase px-3 py-2.5 rounded-xl text-slate-300 transition-colors"
                      title="Mark resolved without emailing"
                    >
                      <CheckCircle className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

        </div>
        
      </div>
    </div>
  );
}
