import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const parseOption = (opt) => {
  if (typeof opt !== 'string') return { text: '', image_url: '', image_public_id: '' };
  const trimmed = opt.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        text: parsed.text || '',
        image_url: parsed.image_url || '',
        image_public_id: parsed.image_public_id || ''
      };
    } catch (e) {}
  }
  return { text: opt, image_url: '', image_public_id: '' };
};

const normalizeOptionForComparison = (opt) => {
  const parsed = parseOption(opt);
  const val = parsed.text.trim() || parsed.image_url.trim();
  return val.toLowerCase();
};

const areOptionsEqual = (optA, optB) => {
  return normalizeOptionForComparison(optA) === normalizeOptionForComparison(optB);
};

const formatResponse = (ans, options) => {
  if (!ans) return 'Not Attempted';
  const list = Array.isArray(ans) ? ans : [ans];
  
  if (options && Array.isArray(options)) {
    const labels = [];
    list.forEach(item => {
      const idx = options.findIndex(opt => areOptionsEqual(opt, item));
      if (idx !== -1) {
        labels.push(String.fromCharCode(65 + idx)); // 'A', 'B', etc.
      } else {
        const text = parseOption(item).text;
        if (text) labels.push(text);
      }
    });
    if (labels.length > 0) return labels.join(', ');
  }

  return list.map(item => {
    const parsed = parseOption(item);
    return parsed.text || (parsed.image_url ? '[Image]' : '');
  }).filter(Boolean).join(', ') || 'Attempted';
};

const formatKey = (keyStr, options) => {
  if (!keyStr) return 'N/A';
  let list = [];
  try {
    const parsed = JSON.parse(keyStr);
    list = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    list = [keyStr];
  }

  if (options && Array.isArray(options)) {
    const labels = [];
    list.forEach(item => {
      const idx = options.findIndex(opt => areOptionsEqual(opt, item));
      if (idx !== -1) {
        labels.push(String.fromCharCode(65 + idx)); // 'A', 'B', etc.
      } else {
        const text = parseOption(item).text;
        if (text) labels.push(text);
      }
    });
    if (labels.length > 0) return labels.join(', ');
  }

  return list.map(item => {
    const parsed = parseOption(item);
    return parsed.text || (parsed.image_url ? '[Image]' : '');
  }).filter(Boolean).join(', ') || 'N/A';
};

const AdminScorecard = () => {
  const { submissionId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [submission, setSubmission] = useState(null);
  const [student, setStudent] = useState(null);
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [subjectStats, setSubjectStats] = useState({});
  const [attemptNumber, setAttemptNumber] = useState(1);

  useEffect(() => {
    const fetchScorecardData = async () => {
      try {
        const role = sessionStorage.getItem('role');
        if (role !== 'super_admin') {
          navigate('/');
          return;
        }

        // 1. Fetch result submission
        const { data: subData, error: subErr } = await supabase
          .from('exam_results')
          .select('*')
          .eq('id', submissionId)
          .single();

        if (subErr) throw subErr;
        setSubmission(subData);

        // Fetch all attempts to count attempt number
        try {
          const { data: allAttempts } = await supabase
            .from('exam_results')
            .select('id, submitted_at')
            .eq('student_id', subData.student_id)
            .eq('exam_id', subData.exam_id)
            .order('submitted_at', { ascending: true });
          
          if (allAttempts) {
            const idx = allAttempts.findIndex(a => a.id === subData.id);
            setAttemptNumber(idx !== -1 ? idx + 1 : 1);
          }
        } catch (err) {
          console.error("Error calculating attempt number:", err);
        }

        // 2. Fetch student, exam, and questions concurrently
        const [studentRes, examRes, questionsRes] = await Promise.all([
          supabase.from('students').select('*').eq('id', subData.student_id).single(),
          supabase.from('exams').select('*').eq('id', subData.exam_id).single(),
          supabase.from('questions').select('*').eq('exam_id', subData.exam_id).order('order_index', { ascending: true })
        ]);

        if (studentRes.error) throw studentRes.error;
        if (examRes.error) throw examRes.error;
        if (questionsRes.error) throw questionsRes.error;

        setStudent(studentRes.data);
        setExam(examRes.data);
        
        const qList = questionsRes.data || [];
        setQuestions(qList);

        // 3. Compute subject statistics
        const stats = {};
        const answers = subData.answers || {};
        const timeSpentObj = subData.question_statuses || {};
        const overrides = subData.marks_adjustments || {};

        qList.forEach(q => {
          const rawTopic = q.topic || examRes.data.subject || 'Other';
          let subject = 'Other';
          if (rawTopic.toLowerCase().includes('phys')) subject = 'Physics';
          else if (rawTopic.toLowerCase().includes('chem')) subject = 'Chemistry';
          else if (rawTopic.toLowerCase().includes('math')) subject = 'Mathematics';
          else subject = rawTopic;

          if (!stats[subject]) {
            stats[subject] = {
              total_marks: 0,
              gained_marks: 0,
              correct: 0,
              incorrect: 0,
              unattempted: 0,
              partial: 0,
              time_spent: 0
            };
          }

          const studentAnswer = answers[q.id];
          const hasAnswered = studentAnswer !== undefined && studentAnswer !== null && studentAnswer !== "" && (!Array.isArray(studentAnswer) || studentAnswer.length > 0);

          const posMarks = parseFloat(q.positive_marks) || 4;
          const negMarks = parseFloat(q.negative_marks) || 0;
          stats[subject].total_marks += posMarks;

          // Time spent
          const timeSecs = parseInt(timeSpentObj[q.id]) || 0;
          stats[subject].time_spent += timeSecs;

          // Score evaluation
          const autoMark = calculateAutoMarkForQuestion(q, studentAnswer, posMarks, negMarks, examRes.data);
          const finalMark = overrides[q.id] !== undefined ? parseFloat(overrides[q.id]) : autoMark;
          stats[subject].gained_marks += finalMark;

          if (!hasAnswered) {
            stats[subject].unattempted++;
          } else if (finalMark > 0) {
            // For multiple choice, check if they got partial marks
            if ((q.question_type === 'mcq_multiple' || q.type === 'multiple' || q.question_type === 'subjective') && finalMark < posMarks) {
              stats[subject].partial++;
            } else {
              stats[subject].correct++;
            }
          } else {
            stats[subject].incorrect++;
          }
        });

        setSubjectStats(stats);

      } catch (err) {
        console.error("Error loading scorecard:", err);
        setError(err.message || "Failed to load scorecard details.");
      } finally {
        setLoading(false);
      }
    };

    fetchScorecardData();
  }, [submissionId, navigate]);

  const parseNumericalRange = (answerStr) => {
    if (!answerStr) return null;
    const clean = String(answerStr).trim();

    if (/\s+to\s+/i.test(clean)) {
      const parts = clean.split(/\s+to\s+/i);
      const min = parseFloat(parts[0]);
      const max = parseFloat(parts[1]);
      if (!isNaN(min) && !isNaN(max)) {
        return { min: Math.min(min, max), max: Math.max(min, max), isRange: true };
      }
    }

    const rangeMatch = clean.match(/^(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)$/);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (!isNaN(min) && !isNaN(max)) {
        return { min: Math.min(min, max), max: Math.max(min, max), isRange: true };
      }
    }

    const val = parseFloat(clean);
    if (!isNaN(val)) {
      return { min: val, max: val, isRange: false };
    }

    return null;
  };

  // Helper to calculate auto-marks for a single question (duplicated from backend logic for display accuracy)
  const calculateAutoMarkForQuestion = (q, studentAnswer, posMarks, negMarks, examData) => {
    if (studentAnswer === undefined || studentAnswer === null || studentAnswer === '' || (Array.isArray(studentAnswer) && studentAnswer.length === 0)) {
      return 0;
    }

    const qType = q.question_type || q.type;
    const policy = q.scoring_policy || 'exact_match';

    // Parse correct answers
    let correctList = [];
    try {
      correctList = JSON.parse(q.correct_answer);
      if (!Array.isArray(correctList)) correctList = [correctList];
    } catch (e) {
      if (q.correct_answer) correctList = [q.correct_answer];
    }
    correctList = correctList.map(item => normalizeOptionForComparison(item));

    // Parse student answers
    let selectedList = [];
    if (Array.isArray(studentAnswer)) {
      selectedList = studentAnswer.map(item => normalizeOptionForComparison(item));
    } else {
      selectedList = [normalizeOptionForComparison(studentAnswer)];
    }

    // 1. Numerical evaluation (NAT Marking Scheme with Range Support)
    if (qType === 'numerical_integer' || qType === 'numerical_decimal') {
      const sNum = parseFloat(studentAnswer);
      const penalty = negMarks > 0 ? negMarks : 1;
      
      if (isNaN(sNum)) return -penalty;
      
      const parsedRange = parseNumericalRange(q.correct_answer);
      if (parsedRange) {
        const eps = 1e-9;
        return (sNum >= parsedRange.min - eps && sNum <= parsedRange.max + eps) ? posMarks : -penalty;
      } else {
        const cNum = parseFloat(q.correct_answer);
        if (!isNaN(cNum) && Math.abs(sNum - cNum) < 0.0101) {
          return posMarks;
        }
        return -penalty;
      }
    }

    // 2. MCQ Single & True/False
    if (qType === 'mcq_single' || qType === 'true_false' || qType === 'single') {
      return correctList.includes(selectedList[0]) ? posMarks : -negMarks;
    }

    // 3. MCQ Multiple Correct (JEE Advanced Marking Scheme)
    if (qType === 'mcq_multiple' || qType === 'multiple' || qType === 'subjective') {
      const hasIncorrectSelected = selectedList.some(item => !correctList.includes(item));
      if (hasIncorrectSelected) {
        const penalty = negMarks > 0 ? negMarks : 2;
        return -penalty;
      }

      const numSelected = selectedList.length;
      const numCorrect = correctList.length;

      if (numSelected === numCorrect) {
        return posMarks;
      } else if (numSelected < numCorrect && numSelected > 0) {
        let partialScore = 0;
        if (numCorrect === 2) {
          if (numSelected === 1) partialScore = 2;
        } else if (numCorrect === 3) {
          if (numSelected === 1) partialScore = 1;
          if (numSelected === 2) partialScore = 3;
        } else if (numCorrect === 4) {
          if (numSelected === 1) partialScore = 1;
          if (numSelected === 2) partialScore = 2;
          if (numSelected === 3) partialScore = 3;
        } else {
          partialScore = numSelected;
        }
        return partialScore;
      }
      return 0;
    }

    return String(studentAnswer).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase() ? posMarks : -negMarks;
  };

  const formatSubjectTime = (secs) => {
    if (!secs) return '00:00';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div className="p-8 text-center text-lg font-bold text-[#005fa7]">Generating Report Card...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-600 font-bold">{error}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 font-sans pb-12 print:bg-white print:pb-0">
      
      {/* Action Bar (Hidden on print) */}
      <div className="max-w-4xl mx-auto mb-6 flex justify-between items-center print:hidden">
        <Link to="/admin/dashboard" className="text-[#005fa7] hover:underline font-semibold">
          &larr; Back to Results Management
        </Link>
        <button 
          onClick={handlePrint}
          className="bg-[#005fa7] hover:bg-[#004e8a] text-white px-5 py-2.5 rounded font-bold shadow transition-colors flex items-center cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          Print Scorecard & Report
        </button>
      </div>

      {/* Printable Scorecard Layout */}
      <div className="max-w-4xl mx-auto bg-white border border-gray-300 rounded shadow-lg p-8 print:shadow-none print:border-none print:p-0">
        
        {/* NTA Scorecard Header */}
        <div className="border-b-2 border-[#005fa7] pb-4 mb-6 text-center flex justify-between items-center">
          <img src="/assets/emblem.png" alt="Emblem" className="h-20 w-12 object-contain" />
          <div className="flex-1 px-4">
            <h2 className="text-[#005fa7] text-2xl font-black uppercase tracking-wide">Harman Rathi Testing Agency</h2>
            <p className="text-gray-700 font-bold text-xs mt-0.5 uppercase">Excellence in Assessment</p>
            <p className="text-gray-800 font-bold text-base mt-2.5 bg-gray-150 py-1 border border-gray-300 inline-block px-5 rounded-full">
              {exam?.title} (Attempt #{attemptNumber}) - OFFICIAL SCORECARD
            </p>
          </div>
          <img src="/assets/nta_logo.png" alt="Logo" className="h-16 w-auto object-contain" />
        </div>

        {/* Candidate Details */}
        <div className="border border-gray-400 mb-6 rounded overflow-hidden text-xs">
          <table className="w-full text-left">
            <tbody>
              <tr className="border-b border-gray-300">
                <td className="w-1/4 bg-gray-100 p-2.5 font-bold text-gray-700 border-r border-gray-300">Application Number:</td>
                <td className="w-1/4 p-2.5 font-bold border-r border-gray-300">{student?.application_id}</td>
                <td className="w-1/4 bg-gray-100 p-2.5 font-bold text-gray-700 border-r border-gray-300">Roll Number:</td>
                <td className="w-1/4 p-2.5 font-bold">{student?.application_id.replace('HRTA', 'RL')}</td>
              </tr>
              <tr className="border-b border-gray-300">
                <td className="bg-gray-100 p-2.5 font-bold text-gray-700 border-r border-gray-300">Candidate's Name:</td>
                <td className="p-2.5 font-bold uppercase text-[#1f497d] border-r border-gray-300">{student?.full_name}</td>
                <td className="bg-gray-100 p-2.5 font-bold text-gray-700 border-r border-gray-300">Date of Birth:</td>
                <td className="p-2.5 font-bold">{student?.date_of_birth}</td>
              </tr>
              <tr>
                <td className="bg-gray-100 p-2.5 font-bold text-gray-700 border-r border-gray-300">Test Date & Time:</td>
                <td className="p-2.5 font-bold border-r border-gray-300" colSpan="3">
                  {new Date(submission?.started_at).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Subject wise table */}
        <div className="mb-6">
          <div className="bg-[#1f497d] text-white font-bold px-4 py-2 text-center uppercase tracking-wider mb-3 rounded-t text-xs">
            Subject-wise Performance Breakdown
          </div>
          <table className="w-full border-collapse border border-gray-300 text-xs text-center">
            <thead>
              <tr className="bg-gray-100 border-b border-gray-300 font-bold text-gray-700">
                <th className="p-2.5 text-left w-1/4">Subject</th>
                <th className="p-2.5">Total Qs</th>
                <th className="p-2.5 text-green-700">Correct</th>
                <th className="p-2.5 text-red-650">Incorrect</th>
                <th className="p-2.5 text-gray-500">Unattempted</th>
                <th className="p-2.5 text-purple-750">Partial</th>
                <th className="p-2.5 text-blue-600">Time Spent</th>
                <th className="p-2.5 bg-gray-150 font-black">Marks Gained</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-250 font-semibold text-gray-700">
              {Object.keys(subjectStats).map(sub => {
                const s = subjectStats[sub];
                return (
                  <tr key={sub}>
                    <td className="p-2.5 text-left font-bold text-[#1f497d]">{sub}</td>
                    <td className="p-2.5">{s.correct + s.incorrect + s.unattempted + s.partial}</td>
                    <td className="p-2.5 text-green-600">{s.correct}</td>
                    <td className="p-2.5 text-red-600">{s.incorrect}</td>
                    <td className="p-2.5 text-gray-550">{s.unattempted}</td>
                    <td className="p-2.5 text-purple-650">{s.partial}</td>
                    <td className="p-2.5 text-blue-600 font-mono">{formatSubjectTime(s.time_spent)}</td>
                    <td className="p-2.5 bg-gray-50 font-black text-gray-800">{s.gained_marks} / {s.total_marks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Recharts chart (Hidden on print) */}
        {Object.keys(subjectStats).length > 0 && (
          <div className="bg-slate-950 border border-slate-800 p-6 rounded-xl shadow-inner mb-6 relative overflow-hidden print:hidden">
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:2rem_2rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-35"></div>
            <div className="relative z-10">
              <h4 className="text-white text-xs font-black uppercase tracking-wider mb-4">
                🌌 Cosmic Score Profile
              </h4>
              <div className="w-full h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={
                    Object.keys(subjectStats).map(sub => ({
                      name: sub,
                      "Total Marks": subjectStats[sub].total_marks,
                      "Obtained Marks": subjectStats[sub].gained_marks
                    }))
                  } margin={{ top: 15, right: 10, left: -20, bottom: 5 }}>
                    <defs>
                      <linearGradient id="cosmicTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00f2fe" stopOpacity={0.88}/>
                        <stop offset="95%" stopColor="#4facfe" stopOpacity={0.88}/>
                      </linearGradient>
                      <linearGradient id="cosmicGained" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.88}/>
                        <stop offset="95%" stopColor="#059669" stopOpacity={0.88}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} />
                    <YAxis stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', color: '#fff', borderRadius: '8px' }} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 10 }} />
                    <Bar dataKey="Total Marks" fill="url(#cosmicTotal)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="Obtained Marks" fill="url(#cosmicGained)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* Accuracy Analytics */}
        <div className="flex justify-between gap-3 mb-6 text-center text-xs">
          <div className="flex-1 bg-gray-50 border border-gray-300 p-3.5 rounded">
            <p className="font-bold text-gray-500 uppercase text-[10px] mb-1">Correct Answers</p>
            <p className="font-black text-xl text-green-600">{submission?.correct_count}</p>
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-300 p-3.5 rounded">
            <p className="font-bold text-gray-500 uppercase text-[10px] mb-1">Incorrect Answers</p>
            <p className="font-black text-xl text-red-600">{submission?.wrong_count}</p>
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-300 p-3.5 rounded">
            <p className="font-bold text-gray-500 uppercase text-[10px] mb-1">Unattempted</p>
            <p className="font-black text-xl text-gray-600">{submission?.unattempted_count}</p>
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-300 p-3.5 rounded">
            <p className="font-bold text-gray-500 uppercase text-[10px] mb-1">Accuracy / Grade</p>
            <p className="font-black text-xl text-[#1f497d]">{submission?.percentage}%</p>
          </div>
        </div>

        {/* Candidate Response Sheet & Marks Audit (TRANS-PARENCY SECTION) */}
        <div className="mt-8 border-t border-gray-300 pt-6">
          <div className="bg-[#1f497d] text-white font-bold px-4 py-2 text-center uppercase tracking-wider mb-4 rounded-t text-xs">
            Candidate Response Sheet & Marks Audit
          </div>
          
          <div className="space-y-4">
            {questions.map((q, idx) => {
              const studentAnswer = submission?.answers?.[q.id];
              const overrides = submission?.marks_adjustments || {};
              
              const posMarks = parseFloat(q.positive_marks) || 4;
              const negMarks = parseFloat(q.negative_marks) || 0;
              
              const autoMark = calculateAutoMarkForQuestion(q, studentAnswer, posMarks, negMarks, exam);
              const finalMark = overrides[q.id] !== undefined ? parseFloat(overrides[q.id]) : autoMark;
              const hasAnswered = studentAnswer !== undefined && studentAnswer !== null && studentAnswer !== '';

              return (
                <div key={q.id} className="border border-gray-300 rounded p-4 text-xs font-semibold hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-center mb-2 border-b pb-1.5">
                    <span className="text-gray-700 font-bold">Question {idx + 1} ({q.question_type})</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      finalMark > 0 
                        ? 'bg-green-100 text-green-700 border border-green-200' 
                        : finalMark < 0 
                        ? 'bg-red-100 text-red-700 border border-red-200' 
                        : 'bg-gray-100 text-gray-600 border border-gray-200'
                    }`}>
                      Marks Awarded: {finalMark} {overrides[q.id] !== undefined && '(Manual Override)'}
                    </span>
                  </div>
                  
                  <p className="text-gray-800 font-medium mb-3 whitespace-pre-wrap leading-relaxed">
                    {q.question_text}
                  </p>

                  {/* Render question image if it exists */}
                  {q.image_url && (
                    <img src={q.image_url} alt={`Question ${idx + 1} Visual`} className="max-w-md h-auto mb-3 border rounded shadow-sm" />
                  )}

                  {q.options && Array.isArray(q.options) && (q.question_type === 'subjective' || q.question_type === 'mcq_single' || q.question_type === 'mcq_multiple') && (
                    <div className="mb-4 space-y-2">
                      <span className="text-gray-500 block text-[9px] uppercase font-bold tracking-wide">Options & Selected Choices:</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {q.options.map((opt, i) => {
                          const parsed = parseOption(opt);
                          const isSelected = hasAnswered && (
                            Array.isArray(studentAnswer)
                              ? studentAnswer.some(ans => areOptionsEqual(ans, opt))
                              : areOptionsEqual(studentAnswer, opt)
                          );
                          
                          let correctList = [];
                          try {
                            correctList = JSON.parse(q.correct_answer);
                            if (!Array.isArray(correctList)) correctList = [correctList];
                          } catch (e) {
                            if (q.correct_answer) correctList = [q.correct_answer];
                          }
                          const isCorrect = correctList.some(c => areOptionsEqual(c, opt));

                          return (
                            <div 
                              key={i} 
                              className={`p-3 rounded border flex flex-col gap-2 transition-all ${
                                isCorrect && isSelected
                                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950 font-bold ring-2 ring-emerald-300'
                                  : isCorrect
                                  ? 'bg-green-50/50 border-green-200 text-green-700/85 border-dashed'
                                  : isSelected
                                  ? 'bg-red-50 border-red-300 text-red-900 font-bold'
                                  : 'bg-gray-50 border-gray-200 text-gray-400'
                              }`}
                            >
                              <div className="flex items-center gap-2 text-[11px] font-semibold">
                                <span className="text-sm">
                                  {isSelected ? '☑' : '☐'}
                                </span>
                                <span>{parsed.text}</span>
                                {isCorrect && isSelected && (
                                  <span className="ml-auto text-[9px] font-bold bg-emerald-200 text-emerald-800 px-1.5 py-0.5 rounded">
                                    Correct & Selected
                                  </span>
                                )}
                                {isCorrect && !isSelected && (
                                  <span className="ml-auto text-[9px] font-medium bg-green-150 text-green-700 px-1.5 py-0.5 rounded">
                                    Correct (Not Selected)
                                  </span>
                                )}
                                {!isCorrect && isSelected && (
                                  <span className="ml-auto text-[9px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded">
                                    Selected Wrong
                                  </span>
                                )}
                              </div>
                              {parsed.image_url && (
                                <div style={{ paddingLeft: '18px' }} className="mt-1">
                                  <img src={parsed.image_url} alt={`Option ${i+1}`} className="max-w-full md:max-w-xl h-auto rounded border bg-white p-1 object-contain block" />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 bg-gray-50 p-2.5 border border-gray-200 rounded">
                    <div>
                      <span className="text-gray-550 block text-[9px] uppercase font-bold tracking-wide">Candidate Response:</span>
                      <span className={`font-bold ${hasAnswered ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                        {formatResponse(studentAnswer, q.options)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-550 block text-[9px] uppercase font-bold tracking-wide">Provisional Answer Key:</span>
                      <span className="text-green-700 font-bold">
                        {formatKey(q.correct_answer, q.options)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Digital Signature */}
        <div className="flex justify-end mt-12 mb-4">
          <div className="text-center">
            <div className="w-32 border-b-2 border-gray-400 mb-2 border-dashed"></div>
            <p className="font-bold text-xs text-gray-800">Senior Director, HRTA</p>
            <p className="text-[10px] text-gray-500 mt-1">System Generated - {new Date().toLocaleDateString()}</p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default AdminScorecard;
