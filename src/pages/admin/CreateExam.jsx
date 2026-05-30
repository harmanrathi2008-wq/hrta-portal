import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const CreateExam = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    total_marks: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Base payload - notice we DO NOT include date columns here yet
      const newExam = {
        title: formData.title,
        description: formData.description,
        subject: formData.subject,
        duration_minutes: formData.duration_minutes,
        exam_type: formData.exam_type,
        correct_marks: formData.correct_marks,
        negative_marks: formData.negative_marks,
        passing_percentage: formData.passing_percentage,
        total_marks: formData.total_marks ? parseInt(formData.total_marks) : null,
        status: 'draft' // Always create as draft first
      };

      // ONLY append the date columns if Scheduled mode is selected.
      // This prevents the Supabase schema cache error for Lifetime exams.
      if (visibilityMode === 'scheduled') {
        newExam.start_datetime = formData.start_datetime ? new Date(formData.start_datetime).toISOString() : null;
        newExam.end_datetime = formData.end_datetime ? new Date(formData.end_datetime).toISOString() : null;
      }

      const { data, error: insertError } = await supabase
        .from('exams')
        .insert([newExam])
        .select()
        .single();

      if (insertError) {
        console.error("Supabase Insert Error:", insertError);
        throw insertError;
      }

      // Navigate straight to the question manager for this new exam
      navigate(`/admin/exams/${data.id}/questions`);

    } catch (err) {
      // Check if it's still complaining about schema
      if (err.message && err.message.includes('schema cache')) {
        setError('Database Error: Your exams table is missing the date columns. Please add start_datetime and end_datetime as timestamps in your Supabase table.');
      } else {
        setError(err.message || 'Failed to create exam.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans pb-12">
      <div className="bg-white border-b border-gray-300 shadow-sm px-8 py-6 mb-8">
        <div className="max-w-4xl mx-auto">
          <Link to="/admin/exams" className="text-[#005fa7] hover:underline text-sm font-semibold mb-2 inline-block">&larr; Back to Roster</Link>
          <h1 className="text-2xl font-black text-[#005fa7] tracking-tight">Exam Blueprint Generator</h1>
          <p className="text-sm font-bold text-gray-500 mt-1">Configure global settings, scoring rules, and lifetime visibility parameters.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded shadow-sm border border-gray-300 overflow-hidden">
          <div className="bg-[#005fa7] text-white px-6 py-4 font-bold tracking-wide uppercase text-sm">
            Primary Configuration
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && <div className="bg-red-50 text-red-700 p-3 rounded font-bold border border-red-200 text-sm">{error}</div>}

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
                type="submit" disabled={loading}
                className="bg-[#005fa7] hover:bg-[#004b87] text-white px-8 py-3 rounded font-bold uppercase tracking-wider text-sm shadow-sm transition-colors disabled:opacity-50"
              >
                {loading ? 'Initializing Blueprint...' : 'Save & Add Questions ➔'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateExam;
