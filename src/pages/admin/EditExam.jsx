import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const EditExam = () => {
  const { examId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Local UI state for visibility toggle
  const [visibilityMode, setVisibilityMode] = useState('lifetime'); 

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    subject: 'Physics',
    duration_minutes: 180,
    exam_type: 'real',
    correct_marks: 4,
    negative_marks: 1,
    passing_percentage: 33,
    start_datetime: '',
    end_datetime: '',
    status: 'draft',
    total_marks: ''
  });

  // Helper to format ISO String to YYYY-MM-DDTHH:MM for datetime-local inputs
  const formatDateTimeLocal = (isoString) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '';
      const tzOffset = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
    } catch (e) {
      return '';
    }
  };

  useEffect(() => {
    const fetchExamDetails = async () => {
      try {
        const role = sessionStorage.getItem('role');
        if (role !== 'super_admin' && role !== 'admin') {
          navigate('/');
          return;
        }

        const { data, error: fetchError } = await supabase
          .from('exams')
          .select('*')
          .eq('id', examId)
          .single();

        if (fetchError) throw fetchError;
        if (!data) throw new Error("Exam not found.");

        setFormData({
          title: data.title || '',
          description: data.description || '',
          subject: data.subject || 'Physics',
          duration_minutes: data.duration_minutes || 180,
          exam_type: data.exam_type || 'real',
          correct_marks: data.correct_marks || 4,
          negative_marks: data.negative_marks || 1,
          passing_percentage: data.passing_percentage || 33,
          start_datetime: formatDateTimeLocal(data.start_datetime),
          end_datetime: formatDateTimeLocal(data.end_datetime),
          status: data.status || 'draft',
          total_marks: data.total_marks || ''
        });

        if (data.start_datetime || data.end_datetime) {
          setVisibilityMode('scheduled');
        } else {
          setVisibilityMode('lifetime');
        }

      } catch (err) {
        console.error("Error loading exam settings:", err);
        setError(err.message || "Failed to load exam data.");
      } finally {
        setLoading(false);
      }
    };

    fetchExamDetails();
  }, [examId, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updatedExam = {
        title: formData.title,
        description: formData.description,
        subject: formData.subject,
        duration_minutes: parseInt(formData.duration_minutes) || 180,
        exam_type: formData.exam_type,
        correct_marks: parseFloat(formData.correct_marks) || 4,
        negative_marks: parseFloat(formData.negative_marks) || 1,
        passing_percentage: parseFloat(formData.passing_percentage) || 33,
        status: formData.status,
        total_marks: formData.total_marks ? parseInt(formData.total_marks) : null
      };

      if (visibilityMode === 'scheduled') {
        updatedExam.start_datetime = formData.start_datetime ? new Date(formData.start_datetime).toISOString() : null;
        updatedExam.end_datetime = formData.end_datetime ? new Date(formData.end_datetime).toISOString() : null;
      } else {
        updatedExam.start_datetime = null;
        updatedExam.end_datetime = null;
      }

      const { error: updateError } = await supabase
        .from('exams')
        .update(updatedExam)
        .eq('id', examId);

      if (updateError) throw updateError;

      setSuccess('Exam blueprint updated successfully! All changes are now live.');
      
      // Auto-navigate back after a short delay
      setTimeout(() => {
        navigate('/admin/exams');
      }, 1500);

    } catch (err) {
      console.error("Update error:", err);
      setError(err.message || 'Failed to save exam details.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-[#005fa7] font-bold">Loading Exam Details...</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-12">
      <div className="bg-white border-b border-gray-300 shadow-sm px-8 py-6 mb-8">
        <div className="max-w-4xl mx-auto">
          <Link to="/admin/exams" className="text-[#005fa7] hover:underline text-sm font-semibold mb-2 inline-block">&larr; Back to Roster</Link>
          <h1 className="text-2xl font-black text-[#005fa7] tracking-tight">Edit Exam Configuration</h1>
          <p className="text-sm font-bold text-gray-500 mt-1">Modify test timings, details, active state, and scheduled window bounds.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded shadow-sm border border-gray-300 overflow-hidden">
          <div className="bg-[#005fa7] text-white px-6 py-4 font-bold tracking-wide uppercase text-sm flex justify-between items-center">
            <span>Modify Settings</span>
            <span className={`px-2 py-0.5 rounded text-xs uppercase font-extrabold ${formData.status === 'published' ? 'bg-green-600 text-white' : 'bg-yellow-500 text-black'}`}>
              Current Status: {formData.status}
            </span>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && <div className="bg-red-50 text-red-700 p-3 rounded font-bold border border-red-200 text-sm">{error}</div>}
            {success && <div className="bg-green-50 text-green-700 p-3 rounded font-bold border border-green-200 text-sm">{success}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 mb-1">Exam Title *</label>
                <input 
                  type="text" required
                  placeholder="e.g., JEE Advanced Mock Test 1"
                  value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 mb-1">Description / Syllabus Instructions</label>
                <textarea 
                  rows="3"
                  placeholder="Brief instructions or syllabus covered..."
                  value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                ></textarea>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Primary Subject *</label>
                <select 
                  value={formData.subject} onChange={e => setFormData({...formData, subject: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none bg-white"
                >
                  <option value="Physics">Physics</option>
                  <option value="Chemistry">Chemistry</option>
                  <option value="Mathematics">Mathematics</option>
                  <option value="Full Syllabus (PCM)">Full Syllabus (PCM)</option>
                  <option value="General Aptitude">General Aptitude</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Duration (Minutes) *</label>
                <input 
                  type="number" required min="1"
                  value={formData.duration_minutes} onChange={e => setFormData({...formData, duration_minutes: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Target Total Marks (Optional)</label>
                <input 
                  type="number" min="1"
                  placeholder="e.g. 300"
                  value={formData.total_marks} onChange={e => setFormData({...formData, total_marks: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none"
                />
                <span className="text-[10px] text-gray-400 font-bold block mt-1">If blank, total marks will dynamically sum up question points.</span>
              </div>

              {/* Status / Activation controls */}
              <div className="p-4 bg-orange-50 border border-orange-200 rounded md:col-span-2">
                <div className="text-sm font-bold text-orange-800 border-b border-orange-200 pb-2 mb-3">Exam Activation Control</div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Activation Status *</label>
                  <select 
                    value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}
                    className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded focus:border-[#005fa7] outline-none bg-white font-bold text-gray-800"
                  >
                    <option value="draft">🔴 DEACTIVATED / DRAFT (Hidden from Students)</option>
                    <option value="published">🟢 ACTIVATED / PUBLISHED (Visible to Students)</option>
                  </select>
                  <p className="text-xs text-gray-500 font-medium mt-1.5">
                    Switching to deactivated/draft immediately removes this exam from the student dashboards.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-gray-50 border border-gray-200 rounded md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="col-span-3 text-sm font-bold text-[#005fa7] border-b border-gray-300 pb-2">Global Default Marking Scheme (Can be overridden per question)</div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Positive Marks (+)</label>
                  <input type="number" required min="1" value={formData.correct_marks} onChange={e => setFormData({...formData, correct_marks: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Negative Marks (-)</label>
                  <input type="number" required min="0" value={formData.negative_marks} onChange={e => setFormData({...formData, negative_marks: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Passing %</label>
                  <input type="number" required min="0" max="100" value={formData.passing_percentage} onChange={e => setFormData({...formData, passing_percentage: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded" />
                </div>
              </div>

              {/* VISIBILITY & ACCESS MODE */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded md:col-span-2">
                <div className="text-sm font-bold text-[#005fa7] border-b border-blue-200 pb-2 mb-4">Availability & Visibility Rules</div>
                
                <div className="flex gap-6 mb-5">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="visibilityMode"
                      value="lifetime"
                      checked={visibilityMode === 'lifetime'}
                      onChange={() => setVisibilityMode('lifetime')}
                      className="w-4 h-4 text-[#005fa7] focus:ring-[#005fa7]"
                    />
                    <span className="font-bold text-gray-800 text-sm">Lifetime (One-Time Attempt)</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="visibilityMode"
                      value="scheduled"
                      checked={visibilityMode === 'scheduled'}
                      onChange={() => setVisibilityMode('scheduled')}
                      className="w-4 h-4 text-[#005fa7] focus:ring-[#005fa7]"
                    />
                    <span className="font-bold text-gray-800 text-sm">Scheduled Window</span>
                  </label>
                </div>

                {visibilityMode === 'lifetime' ? (
                  <div className="bg-white p-3 border border-blue-100 rounded text-sm text-gray-600 font-medium leading-relaxed">
                    <span className="text-[#005fa7] font-bold">ℹ️ Lifetime Mode Active:</span> This exam will remain visible on the student's dashboard permanently. Once the student completes their first and only attempt, the system will automatically hide it from the active list and move it to their lifetime history.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white p-4 border border-blue-100 rounded">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Start Date & Time *</label>
                      <input 
                        type="datetime-local" required={visibilityMode === 'scheduled'}
                        value={formData.start_datetime} onChange={e => setFormData({...formData, start_datetime: e.target.value})} 
                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">End Date & Time *</label>
                      <input 
                        type="datetime-local" required={visibilityMode === 'scheduled'}
                        value={formData.end_datetime} onChange={e => setFormData({...formData, end_datetime: e.target.value})} 
                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white" 
                      />
                    </div>
                    <div className="col-span-2 text-xs text-gray-500 font-medium">
                      Exams are strictly single-attempt. If the student does not attempt the exam within this window, it will expire.
                    </div>
                  </div>
                )}
              </div>

            </div>

            <div className="pt-4 border-t border-gray-200 flex justify-end">
              <button 
                type="submit" disabled={saving}
                className="bg-[#005fa7] hover:bg-[#004b87] text-white px-8 py-3 rounded font-bold uppercase tracking-wider text-sm shadow-sm transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving Configuration...' : 'Save Configuration Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditExam;
