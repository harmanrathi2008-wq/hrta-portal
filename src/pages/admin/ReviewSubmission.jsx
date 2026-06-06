import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

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

const formatResponse = (ans) => {
  if (!ans) return 'Not Attempted';
  if (Array.isArray(ans)) {
    return ans.map(item => parseOption(item).text).join(', ');
  }
  return parseOption(ans).text;
};

const formatKey = (keyStr) => {
  if (!keyStr) return 'N/A';
  try {
    const parsed = JSON.parse(keyStr);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map(item => parseOption(item).text).join(', ');
  } catch (e) {
    return parseOption(keyStr).text;
  }
};

const ReviewSubmission = () => {
  const { submissionId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState('');
  
  const [submission, setSubmission] = useState(null);
  const [student, setStudent] = useState(null);
  const [exam, setExam] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [attemptNumber, setAttemptNumber] = useState(1);
  
  // Track manual overrides: { questionId: numericMark }
  const [markOverrides, setMarkOverrides] = useState({});

  useEffect(() => {
    const fetchSubmissionData = async () => {
      try {
        const role = sessionStorage.getItem('role');
        if (role !== 'super_admin') {
          navigate('/');
          return;
        }

        // 1. Fetch Submission
        const { data: subData, error: subErr } = await supabase
          .from('exam_results')
          .select('*')
          .eq('id', submissionId)
          .single();

        if (subErr) throw subErr;

        // Fetch all attempts for attempt number
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

        // 2. Fetch related entities concurrently
        const [studentRes, examRes, questionsRes] = await Promise.all([
          supabase.from('students').select('*').eq('id', subData.student_id).single(),
          supabase.from('exams').select('*').eq('id', subData.exam_id).single(),
          supabase.from('questions').select('*').eq('exam_id', subData.exam_id).order('order_index', { ascending: true })
        ]);

        if (studentRes.error) throw studentRes.error;
        if (examRes.error) throw examRes.error;
        if (questionsRes.error) throw questionsRes.error;

        setSubmission(subData);
        setStudent(studentRes.data);
        setExam(examRes.data);
        setQuestions(questionsRes.data);
        
        // Initialize existing overrides if any
        if (subData.marks_adjustments) {
          setMarkOverrides(subData.marks_adjustments);
        }

      } catch (err) {
        console.error("Error fetching submission:", err);
        setError("Failed to load submission data.");
      } finally {
        setLoading(false);
      }
    };

    fetchSubmissionData();
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

  const calculateAutoMark = (question) => {
    const studentAnswer = submission?.answers?.[question.id];
    
    // Unattempted
    if (
      studentAnswer === undefined || 
      studentAnswer === null || 
      studentAnswer === '' || 
      (Array.isArray(studentAnswer) && studentAnswer.length === 0)
    ) {
      return 0;
    }

    const qType = question.question_type || question.type;
    const posMarks = parseFloat(question.positive_marks) || parseFloat(exam?.correct_marks) || 4;
    const negMarks = parseFloat(question.negative_marks) || parseFloat(exam?.negative_marks) || 0;
    const policy = question.scoring_policy || 'exact_match';

    // Parse correct answers
    let correctList = [];
    try {
      correctList = JSON.parse(question.correct_answer);
      if (!Array.isArray(correctList)) {
        correctList = [correctList];
      }
    } catch (e) {
      if (question.correct_answer) {
        correctList = [question.correct_answer];
      }
    }
    correctList = correctList.map(item => String(item).trim().toLowerCase());

    // Parse student answers
    let selectedList = [];
    if (Array.isArray(studentAnswer)) {
      selectedList = studentAnswer.map(item => String(item).trim().toLowerCase());
    } else {
      selectedList = [String(studentAnswer).trim().toLowerCase()];
    }

    // 1. Numerical evaluation (NAT Marking Scheme with Range Support)
    if (qType === 'numerical_integer' || qType === 'numerical_decimal') {
      const sNum = parseFloat(studentAnswer);
      const penalty = negMarks > 0 ? negMarks : 1;
      
      if (isNaN(sNum)) return -penalty;
      
      const parsedRange = parseNumericalRange(question.correct_answer);
      if (parsedRange) {
        const eps = 1e-9;
        return (sNum >= parsedRange.min - eps && sNum <= parsedRange.max + eps) ? posMarks : -penalty;
      } else {
        const cNum = parseFloat(question.correct_answer);
        if (!isNaN(cNum) && Math.abs(sNum - cNum) < 0.0101) {
          return posMarks;
        }
        return -penalty;
      }
    }

    // 2. Single Correct MCQ & True/False
    if (qType === 'mcq_single' || qType === 'true_false' || qType === 'single') {
      const isCorrect = correctList.includes(selectedList[0]);
      return isCorrect ? posMarks : -negMarks;
    }

    // 3. Multiple Correct MCQ (JEE Advanced Marking Scheme)
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

    // Fallback string matching
    const isMatch = String(studentAnswer).trim().toLowerCase() === String(question.correct_answer).trim().toLowerCase();
    return isMatch ? posMarks : -negMarks;
  };

  const handleOverrideChange = (qId, value) => {
    setMarkOverrides(prev => ({
      ...prev,
      [qId]: value === '' ? undefined : parseFloat(value) // allow clearing the override
    }));
  };

  // Shared function to calculate and save result
  const calculateAndSave = async (newStatus) => {
    let totalScore = 0;
    let totalMarks = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unattemptedCount = 0;

    questions.forEach(q => {
      if (q.status !== 'dropped') {
        totalMarks += (parseFloat(q.positive_marks) || parseFloat(exam.correct_marks) || 4);
      }
      const studentAnswer = submission?.answers?.[q.id];
      const autoMark = calculateAutoMark(q);
      const finalMark = markOverrides[q.id] !== undefined ? parseFloat(markOverrides[q.id]) : autoMark;
      totalScore += finalMark;
      if (studentAnswer === undefined || studentAnswer === null || studentAnswer === '') {
        unattemptedCount++;
      } else if (finalMark > 0) {
        correctCount++;
      } else {
        wrongCount++;
      }
    });

    const percentage = totalMarks > 0 ? Math.round((totalScore / totalMarks) * 100) : 0;

    const payload = {
      status: newStatus,
      total_score: totalScore,
      total_marks: totalMarks,
      percentage,
      correct_count: correctCount,
      wrong_count: wrongCount,
      unattempted_count: unattemptedCount,
      marks_adjustments: markOverrides,
    };
    if (newStatus === 'published') {
      payload.published_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('exam_results')
      .update(payload)
      .eq('id', submissionId);

    if (updateError) throw updateError;
  };

  const handlePublish = async () => {
    if (!window.confirm("Publish this result? The student will immediately see their score on their dashboard.")) return;
    setPublishing(true);
    try {
      await calculateAndSave('published');
      alert('✅ Result Published! Student can now see their scorecard.');
      navigate('/admin/results');
    } catch (err) {
      console.error('Publish Error:', err);
      alert('Failed to publish result: ' + err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!window.confirm("Unpublish this result? The student will NO LONGER see their scorecard until you republish.")) return;
    setUnpublishing(true);
    try {
      const { error } = await supabase
        .from('exam_results')
        .update({ status: 'reviewed', published_at: null })
        .eq('id', submissionId);
      if (error) throw error;
      alert('Result unpublished. Student can no longer see this result.');
      navigate('/admin/results');
    } catch (err) {
      console.error('Unpublish Error:', err);
      alert('Failed to unpublish: ' + err.message);
    } finally {
      setUnpublishing(false);
    }
  };

  const handleRepublish = async () => {
    if (!window.confirm("Save updated marks and Republish? Changes will go LIVE immediately on the student's dashboard.")) return;
    setPublishing(true);
    try {
      await calculateAndSave('published');
      setEditMode(false);
      // Refresh submission data
      const { data } = await supabase.from('exam_results').select('*').eq('id', submissionId).single();
      if (data) setSubmission(data);
      alert('✅ Marks updated and Result Republished! Changes are now live on student dashboard.');
    } catch (err) {
      console.error('Republish Error:', err);
      alert('Failed to republish: ' + err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleResetAttempt = async () => {
    const studentName = student?.full_name || 'Student';
    const examTitle = exam?.title || 'Exam';
    
    if (!window.confirm(`Are you sure you want to RESET the attempt for ${studentName} on "${examTitle}"?\n\nThis will delete their exam submission permanently and let them take the test again.`)) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('exam_results')
        .delete()
        .eq('id', submissionId);
        
      if (error) throw error;
      alert("Attempt reset successfully. Candidate can now retake this exam.");
      navigate('/admin/dashboard');
    } catch (err) {
      console.error(err);
      alert("Failed to reset attempt: " + err.message);
    }
  };

  const handleToggleAccess = async () => {
    const studentName = student?.full_name || 'Student';
    const examTitle = exam?.title || 'Exam';
    const isBlocking = submission?.status !== 'blocked';
    
    const confirmMessage = isBlocking
      ? `Are you sure you want to REVOKE access for ${studentName} on "${examTitle}"?\n\nThey will not be able to view their scorecard or attempt it again.`
      : `Are you sure you want to RESTORE access for ${studentName} on "${examTitle}"?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const newStatus = isBlocking ? 'blocked' : 'submitted';
      const { error } = await supabase
        .from('exam_results')
        .update({ status: newStatus })
        .eq('id', submissionId);

      if (error) throw error;
      alert(isBlocking ? "Access revoked successfully." : "Access restored successfully.");
      navigate('/admin/dashboard');
    } catch (err) {
      console.error(err);
      alert("Failed to update access status: " + err.message);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-lg font-bold text-[#005fa7]">Loading Submission Data...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-600 font-bold">{error}</div>;
  }

  // Calculate live stats for the header
  let liveTotalScore = 0;
  questions.forEach(q => {
    const autoMark = calculateAutoMark(q);
    const finalMark = markOverrides[q.id] !== undefined ? markOverrides[q.id] : autoMark;
    liveTotalScore += finalMark;
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      
      {/* Header & Back Button */}
      <div className="max-w-6xl mx-auto mb-6 flex justify-between items-center">
        <div>
          <Link to="/admin/dashboard" className="text-[#005fa7] hover:underline mb-2 inline-block font-semibold">
            &larr; Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-gray-800">Review Submission</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleResetAttempt}
            className="px-5 py-3 rounded font-bold text-white shadow-md bg-red-600 hover:bg-red-700 transition-colors cursor-pointer text-sm"
          >
            Reset Attempt
          </button>
          
          {submission.status === 'blocked' ? (
            <button
              onClick={handleToggleAccess}
              className="px-5 py-3 rounded font-bold text-white shadow-md bg-green-600 hover:bg-green-700 transition-colors cursor-pointer text-sm"
            >
              Restore Access
            </button>
          ) : (
            <button
              onClick={handleToggleAccess}
              className="px-5 py-3 rounded font-bold text-white shadow-md bg-amber-500 hover:bg-amber-600 transition-colors cursor-pointer text-sm"
            >
              Revoke Access
            </button>
          )}

          {/* ===== PUBLISHED STATE BUTTONS ===== */}
          {submission.status === 'published' && (
            <>
              <Link
                to={`/admin/results/${submissionId}/scorecard`}
                className="px-5 py-3 rounded font-bold text-white shadow-md bg-emerald-600 hover:bg-emerald-700 transition-colors text-sm flex items-center justify-center cursor-pointer"
              >
                View Scorecard
              </Link>

              {!editMode ? (
                <button
                  onClick={() => setEditMode(true)}
                  className="px-5 py-3 rounded font-bold text-white shadow-md bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer text-sm"
                >
                  ✏️ Edit Marks
                </button>
              ) : (
                <>
                  <button
                    onClick={handleRepublish}
                    disabled={publishing}
                    className="px-5 py-3 rounded font-bold text-white shadow-md bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer text-sm disabled:opacity-50"
                  >
                    {publishing ? 'Republishing...' : '🚀 Save & Republish'}
                  </button>
                  <button
                    onClick={() => { setEditMode(false); setMarkOverrides(submission.marks_adjustments || {}); }}
                    className="px-5 py-3 rounded font-bold text-gray-700 shadow-md bg-gray-200 hover:bg-gray-300 transition-colors cursor-pointer text-sm"
                  >
                    Cancel Edit
                  </button>
                </>
              )}

              <button
                onClick={handleUnpublish}
                disabled={unpublishing}
                className="px-5 py-3 rounded font-bold text-white shadow-md bg-orange-500 hover:bg-orange-600 transition-colors cursor-pointer text-sm disabled:opacity-50"
              >
                {unpublishing ? 'Unpublishing...' : '🔒 Unpublish'}
              </button>
            </>
          )}

          {/* ===== NOT YET PUBLISHED BUTTONS ===== */}
          {submission.status !== 'published' && submission.status !== 'blocked' && (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-6 py-3 rounded font-bold text-white shadow-md bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer text-sm disabled:opacity-50"
            >
              {publishing ? 'Publishing...' : '📢 Publish Result'}
            </button>
          )}
        </div>
      </div>

      {/* Status Banner */}
      {submission.status === 'published' && (
        <div className={`max-w-6xl mx-auto mb-4 px-5 py-3 rounded-lg font-bold text-sm flex items-center gap-3 ${
          editMode 
            ? 'bg-indigo-50 border border-indigo-300 text-indigo-800'
            : 'bg-green-50 border border-green-300 text-green-800'
        }`}>
          {editMode ? (
            <><span className="text-lg">✏️</span> <span>EDIT MODE — Modify marks below then click <strong>Save & Republish</strong> to push changes live to student dashboard.</span></>
          ) : (
            <><span className="text-lg">✅</span> <span>This result is <strong>PUBLISHED</strong> and visible on the student's dashboard. Click <strong>Edit Marks</strong> to change marks and republish.</span></>
          )}
        </div>
      )}
      {submission.status === 'reviewed' && (
        <div className="max-w-6xl mx-auto mb-4 px-5 py-3 rounded-lg font-bold text-sm flex items-center gap-3 bg-yellow-50 border border-yellow-300 text-yellow-800">
          <span className="text-lg">🔒</span> <span>This result is <strong>UNPUBLISHED</strong>. Student cannot see their result. Click <strong>Publish Result</strong> to make it visible.</span>
        </div>
      )}

      {/* Meta Info Cards */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-blue-500">
          <p className="text-sm text-gray-500 font-semibold uppercase">Candidate Details</p>
          <p className="font-bold text-lg text-gray-800">{student?.full_name}</p>
          <p className="text-sm text-gray-600">{student?.application_id} | {student?.email}</p>
        </div>
        
        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-yellow-500">
          <p className="text-sm text-gray-500 font-semibold uppercase">Exam Details</p>
          <div className="flex justify-between items-start gap-1">
            <p className="font-bold text-lg text-gray-800">{exam?.title}</p>
            <span className="bg-cyan-100 text-cyan-800 text-[10px] px-1.5 py-0.5 rounded font-extrabold uppercase shrink-0">
              Attempt #{attemptNumber}
            </span>
          </div>
          <p className="text-sm text-gray-650 mt-1">Submitted: {new Date(submission?.submitted_at).toLocaleString()}</p>
        </div>

        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 border-l-4 border-l-green-500">
          <p className="text-sm text-gray-500 font-semibold uppercase">Live Score Preview</p>
          <p className="font-bold text-3xl text-gray-800">{liveTotalScore}</p>
          <p className="text-sm text-gray-600">With manual overrides applied</p>
        </div>
      </div>

      {/* Question Review List */}
      <div className="max-w-6xl mx-auto space-y-6">
        <h2 className="text-xl font-bold text-gray-800 border-b pb-2">Question-by-Question Breakdown</h2>
        
        {questions.map((q, index) => {
          const studentAnswer = submission?.answers?.[q.id];
          const hasAnswered = studentAnswer !== undefined && studentAnswer !== '';
          const autoMark = calculateAutoMark(q);
          const hasOverride = markOverrides[q.id] !== undefined;
          const currentMark = hasOverride ? markOverrides[q.id] : autoMark;

          return (
            <div key={q.id} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 relative overflow-hidden">
              
              {/* Question Status Indicator Strip */}
              <div className={`absolute left-0 top-0 bottom-0 w-2 ${
                !hasAnswered ? 'bg-gray-300' : currentMark > 0 ? 'bg-green-500' : 'bg-red-500'
              }`}></div>

              <div className="pl-4">
                <div className="flex justify-between items-start mb-4">
                  <div className="font-bold text-lg text-[#005fa7]">Question {index + 1}</div>
                  <div className="text-sm font-semibold text-gray-500 bg-gray-100 px-3 py-1 rounded">
                    Type: {q.question_type} | Max Marks: {q.positive_marks || exam.correct_marks}
                  </div>
                </div>

                <div className="text-gray-800 font-medium mb-4 whitespace-pre-wrap">
                  {q.question_text}
                </div>
                
                {q.image_url && (
                  <img src={q.image_url} alt="Question Graphic" className="max-w-md h-auto mb-4 border rounded" />
                )}

                {q.options && Array.isArray(q.options) && (q.question_type === 'subjective' || q.question_type === 'mcq_single' || q.question_type === 'mcq_multiple') && (
                  <div className="mb-4 space-y-2">
                    <span className="text-gray-550 block text-[9px] uppercase font-bold tracking-wide">Options & Selected Choices:</span>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {q.options.map((opt, i) => {
                        const parsed = parseOption(opt);
                        const isSelected = hasAnswered && (Array.isArray(studentAnswer) ? studentAnswer.includes(opt) : studentAnswer === opt);
                        
                        let correctList = [];
                        try {
                          correctList = JSON.parse(q.correct_answer);
                          if (!Array.isArray(correctList)) correctList = [correctList];
                        } catch (e) {
                          if (q.correct_answer) correctList = [q.correct_answer];
                        }
                        const isCorrect = correctList.includes(opt);

                        return (
                          <div 
                            key={i} 
                            className={`p-3 rounded border flex flex-col gap-2 ${
                              isCorrect 
                                ? 'bg-green-50 border-green-300 text-green-800' 
                                : isSelected 
                                ? 'bg-red-50 border-red-200 text-red-800' 
                                : 'bg-gray-50 border-gray-200 text-gray-700'
                            }`}
                          >
                            <div className="flex items-center gap-2 text-[11px] font-semibold font-sans">
                              <span className="text-sm font-sans">
                                {isSelected ? '☑' : '☐'}
                              </span>
                              <span>{parsed.text}</span>
                              {isCorrect && <span className="ml-auto text-[9px] font-bold bg-green-200 text-green-800 px-1.5 py-0.5 rounded font-sans">Correct Option</span>}
                              {!isCorrect && isSelected && <span className="ml-auto text-[9px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded font-sans">Selected Wrong</span>}
                            </div>
                            {parsed.image_url && (
                              <div style={{ paddingLeft: '18px' }} className="mt-1">
                                <img src={parsed.image_url} alt={`Option ${i+1}`} className="max-h-28 object-contain rounded border bg-white p-0.5" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-4 rounded border border-gray-200 mb-4">
                  <div>
                    <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Student's Answer</span>
                    <span className={`font-mono text-base font-bold ${!hasAnswered ? 'text-gray-400 italic' : 'text-gray-800'}`}>
                      {formatResponse(studentAnswer)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Provisional Key</span>
                    <span className="font-mono text-base font-bold text-green-700">
                      {formatKey(q.correct_answer)}
                    </span>
                  </div>
                </div>

                {/* Marking Override Engine — only editable when not published OR in edit mode */}
                <div className={`flex items-center justify-between p-4 rounded border ${
                  editMode || submission.status !== 'published'
                    ? 'bg-blue-50 border-blue-200'
                    : 'bg-gray-50 border-gray-200'
                }`}>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-blue-900">Auto-Calculated Marks: {autoMark}</span>
                    {hasOverride && <span className="text-xs text-orange-600 font-bold mt-1">⚠️ Manual Override Active</span>}
                    {submission.status === 'published' && !editMode && (
                      <span className="text-xs text-gray-400 font-semibold mt-1">Click "Edit Marks" to change</span>
                    )}
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <label className="text-sm font-bold text-gray-700">Final Awarded Marks:</label>
                    <input 
                      type="number"
                      step="any"
                      value={markOverrides[q.id] !== undefined ? markOverrides[q.id] : ''}
                      onChange={(e) => handleOverrideChange(q.id, e.target.value)}
                      placeholder={autoMark.toString()}
                      disabled={submission.status === 'published' && !editMode}
                      className={`w-24 px-3 py-2 border rounded font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        submission.status === 'published' && !editMode
                          ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                          : hasOverride
                          ? 'bg-orange-50 border-orange-300 text-orange-700'
                          : 'bg-white border-gray-300'
                      }`}
                    />
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReviewSubmission;
