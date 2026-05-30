import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const ExamsList = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchExams();
  }, [navigate]);

  const fetchExams = async () => {
    try {
      const role = sessionStorage.getItem('role');
      if (role !== 'super_admin') {
        navigate('/');
        return;
      }

      const { data, error } = await supabase
        .from('exams')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExams(data || []);
    } catch (err) {
      console.error("Error fetching exams:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'draft' ? 'published' : 'draft';
    if (newStatus === 'published' && !window.confirm("Publishing this exam will make it visible to students immediately if the start time is valid. Proceed?")) return;
    
    try {
      const { error } = await supabase.from('exams').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      setExams(exams.map(e => e.id === id ? { ...e, status: newStatus } : e));
    } catch (err) {
      alert("Failed to update status.");
    }
  };

  const deleteExam = async (id, title) => {
    if (!window.confirm(`WARNING: Deleting "${title}" will permanently erase all associated questions and student results. This cannot be undone. Continue?`)) return;
    
    try {
      const { error } = await supabase.from('exams').delete().eq('id', id);
      if (error) throw error;
      setExams(exams.filter(e => e.id !== id));
    } catch (err) {
      alert("Failed to delete exam. Delete all dependent records first.");
    }
  };

  const filteredExams = exams.filter(e => e.title.toLowerCase().includes(searchTerm.toLowerCase()) || e.subject.toLowerCase().includes(searchTerm.toLowerCase()));

  if (loading) return <div className="p-8 text-[#005fa7] font-bold">Loading Exam Roster...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-12">
      <div className="bg-white border-b border-gray-300 shadow-sm px-8 py-6 mb-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center">
          <div>
            <Link to="/admin/dashboard" className="text-[#005fa7] hover:underline text-sm font-semibold mb-2 inline-block">&larr; Back to Dashboard</Link>
            <h1 className="text-2xl font-black text-[#005fa7] tracking-tight">Examination Roster</h1>
            <p className="text-sm font-bold text-gray-500 mt-1">Manage tests, configure schedules, and publish to students.</p>
          </div>
          <div className="mt-4 md:mt-0">
            <Link to="/admin/exams/create">
              <button className="bg-[#28a745] hover:bg-[#218838] text-white px-5 py-2.5 rounded font-bold shadow-sm transition-colors text-sm uppercase">
                + Create New Exam
              </button>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white p-4 rounded shadow-sm border border-gray-300 mb-6 flex justify-between items-center">
          <input 
            type="text" 
            placeholder="Search by Title or Subject..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full max-w-md px-4 py-2 border border-gray-300 rounded focus:outline-none focus:border-[#005fa7]"
          />
          <div className="text-sm font-bold text-gray-500">Total Exams: <span className="text-[#005fa7]">{filteredExams.length}</span></div>
        </div>

        <div className="bg-white shadow-sm border border-gray-300 rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-100 border-b border-gray-300">
                <tr>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">Exam Details</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">Schedule Bounds</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">Base Rules</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-xs font-bold text-gray-600 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredExams.length === 0 ? (
                  <tr><td colSpan="5" className="px-6 py-12 text-center text-gray-500 font-medium">No examinations found.</td></tr>
                ) : (
                  filteredExams.map((exam) => (
                    <tr key={exam.id} className="hover:bg-blue-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-[#005fa7]">{exam.title}</div>
                        <div className="text-xs text-gray-500 font-bold mt-1 bg-gray-200 inline-block px-2 py-0.5 rounded">{exam.subject}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-green-700 font-bold">Start: {exam.start_datetime ? new Date(exam.start_datetime).toLocaleString() : 'Open'}</div>
                        <div className="text-xs text-red-700 font-bold mt-1">End: {exam.end_datetime ? new Date(exam.end_datetime).toLocaleString() : 'Open'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-gray-800">{exam.duration_minutes} Mins</div>
                        <div className="text-xs text-gray-500 font-semibold mt-1">Marks: +{exam.correct_marks} / -{exam.negative_marks}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-full ${exam.status === 'published' ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-yellow-100 text-yellow-800 border border-yellow-300'}`}>
                          {exam.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-medium space-x-3">
                        <Link to={`/admin/exams/${exam.id}/questions`} className="text-[#005fa7] hover:underline font-bold text-xs uppercase tracking-wide">
                          Manage Questions
                        </Link>
                        <Link to={`/admin/exams/${exam.id}/edit`} className="text-[#005fa7] hover:underline font-bold text-xs uppercase tracking-wide">
                          Edit Settings
                        </Link>
                        <button onClick={() => toggleStatus(exam.id, exam.status)} className={`text-xs font-bold uppercase tracking-wide ${exam.status === 'draft' ? 'text-green-600' : 'text-orange-600'}`}>
                          {exam.status === 'draft' ? 'Publish' : 'Unpublish'}
                        </button>
                        <button onClick={() => deleteExam(exam.id, exam.title)} className="text-red-600 hover:text-red-900 text-xs font-bold uppercase tracking-wide">
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExamsList;
