import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const parseOption = (opt) => {
  if (opt === null || opt === undefined) return { text: '', image_url: '', image_public_id: '' };
  if (typeof opt !== 'string') {
    return { text: String(opt), image_url: '', image_public_id: '' };
  }
  const trimmed = opt.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        text: parsed.text !== undefined && parsed.text !== null ? String(parsed.text) : '',
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

const formatTimeSpent = (seconds) => {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '0s';
  const sec = parseInt(seconds, 10);
  if (sec < 60) return `${sec}s`;
  const mins = Math.floor(sec / 60);
  const remainingSecs = sec % 60;
  return `${mins}m ${remainingSecs}s`;
};

const formatResponse = (ans, options, questionType) => {
  // Handle numerical types first — a student answer of 0 is valid, not "Not Attempted"
  const isNumerical = questionType === 'numerical_integer' || questionType === 'numerical_decimal';
  if (isNumerical) {
    if (ans === null || ans === undefined || ans === '') return 'Not Attempted';
    return String(ans);
  }

  if (!ans) return 'Not Attempted';

  const list = Array.isArray(ans) ? ans : [ans];
  
  if (options && Array.isArray(options) && options.length > 0) {
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

const formatKey = (keyStr, options, questionType) => {
  // Handle numerical types first — they store plain values, not JSON-wrapped option references
  const isNumerical = questionType === 'numerical_integer' || questionType === 'numerical_decimal';
  if (isNumerical) {
    if (keyStr === null || keyStr === undefined) return 'N/A';
    const str = String(keyStr).trim();
    return str.length > 0 ? str : 'N/A';
  }

  if (!keyStr) return 'N/A';

  let list = [];
  try {
    const parsed = JSON.parse(keyStr);
    list = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    list = [keyStr];
  }

  if (options && Array.isArray(options) && options.length > 0) {
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

const StudentResults = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState(null);
  const [results, setResults] = useState([]);
  const [selectedResult, setSelectedResult] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [subjectStats, setSubjectStats] = useState({});
  const [isBlocked, setIsBlocked] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const calculateStats = (qList, resultObj) => {
    const stats = {};
    const answers = resultObj.answers || {};
    const timeSpentObj = resultObj.question_statuses || {};

    qList.forEach(q => {
      // Group subjects (Physics, Chemistry, Mathematics, Other)
      const rawTopic = q.topic || resultObj.exams?.subject || 'Other';
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

      const posMarks = q.positive_marks !== null && q.positive_marks !== undefined && q.positive_marks !== '' 
        ? parseFloat(q.positive_marks) 
        : (resultObj.exams?.correct_marks !== null && resultObj.exams?.correct_marks !== undefined && resultObj.exams?.correct_marks !== '' 
          ? parseFloat(resultObj.exams.correct_marks) 
          : 4);
          
      const negMarks = q.negative_marks !== null && q.negative_marks !== undefined && q.negative_marks !== '' 
        ? parseFloat(q.negative_marks) 
        : (resultObj.exams?.negative_marks !== null && resultObj.exams?.negative_marks !== undefined && resultObj.exams?.negative_marks !== '' 
          ? parseFloat(resultObj.exams.negative_marks) 
          : 0);
      stats[subject].total_marks += posMarks;

      // Sum time spent
      const timeSecs = parseInt(timeSpentObj[q.id]) || 0;
      stats[subject].time_spent += timeSecs;

      if (!hasAnswered) {
        stats[subject].unattempted++;
      } else {
        const qType = q.question_type || q.type;

        let correctList = [];
        try {
          correctList = JSON.parse(q.correct_answer);
          if (!Array.isArray(correctList)) correctList = [correctList];
        } catch (e) {
          if (q.correct_answer) correctList = [q.correct_answer];
        }
        correctList = correctList.map(item => normalizeOptionForComparison(item));

        let selectedList = [];
        if (Array.isArray(studentAnswer)) {
          selectedList = studentAnswer.map(item => normalizeOptionForComparison(item));
        } else {
          selectedList = [normalizeOptionForComparison(studentAnswer)];
        }

        if (qType === "numerical_integer" || qType === "numerical_decimal") {
          const sNum = parseFloat(studentAnswer);
          const penalty = negMarks > 0 ? negMarks : 1;
          
          if (isNaN(sNum)) {
            stats[subject].incorrect++;
            stats[subject].gained_marks -= penalty;
          } else {
            const parsedRange = parseNumericalRange(q.correct_answer);
            if (parsedRange) {
              const eps = 1e-9;
              if (sNum >= parsedRange.min - eps && sNum <= parsedRange.max + eps) {
                stats[subject].correct++;
                stats[subject].gained_marks += posMarks;
              } else {
                stats[subject].incorrect++;
                stats[subject].gained_marks -= penalty;
              }
            } else {
              const cNum = parseFloat(q.correct_answer);
              if (!isNaN(cNum) && Math.abs(sNum - cNum) < 0.0101) {
                stats[subject].correct++;
                stats[subject].gained_marks += posMarks;
              } else {
                stats[subject].incorrect++;
                stats[subject].gained_marks -= penalty;
              }
            }
          }
        } else if (qType === "mcq_single" || qType === "true_false" || qType === "single") {
          if (correctList.includes(selectedList[0])) {
            stats[subject].correct++;
            stats[subject].gained_marks += posMarks;
          } else {
            stats[subject].incorrect++;
            stats[subject].gained_marks -= negMarks;
          }
        } else if (qType === "mcq_multiple" || qType === "multiple" || qType === "subjective") {
          const hasIncorrect = selectedList.some(item => !correctList.includes(item));
          if (hasIncorrect) {
            stats[subject].incorrect++;
            const penalty = negMarks > 0 ? negMarks : 2;
            stats[subject].gained_marks -= penalty;
          } else {
            const numSel = selectedList.length;
            const numCor = correctList.length;

            if (numSel === numCor) {
              stats[subject].correct++;
              stats[subject].gained_marks += posMarks;
            } else if (numSel < numCor && numSel > 0) {
              stats[subject].partial++;
              let partialScore = 0;
              if (numCor === 2) {
                if (numSel === 1) partialScore = 2;
              } else if (numCor === 3) {
                if (numSel === 1) partialScore = 1;
                if (numSel === 2) partialScore = 3;
              } else if (numCor === 4) {
                if (numSel === 1) partialScore = 1;
                if (numSel === 2) partialScore = 2;
                if (numSel === 3) partialScore = 3;
              } else {
                partialScore = numSel;
              }
              stats[subject].gained_marks += partialScore;
            } else {
              stats[subject].unattempted++;
            }
          }
        } else {
          if (String(studentAnswer).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase()) {
            stats[subject].correct++;
            stats[subject].gained_marks += posMarks;
          } else {
            stats[subject].incorrect++;
            stats[subject].gained_marks -= negMarks;
          }
        }
      }
    });

    setSubjectStats(stats);
  };

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const queryParams = new URLSearchParams(window.location.search);
        const resultId = queryParams.get('resultId');
        const token = queryParams.get('token');

        if (!resultId || !token) {
          setIsBlocked(true);
          setErrorMessage('Access Denied: Scorecards can only be accessed using the unique link sent to your registered email address.');
          setLoading(false);
          return;
        }

        const apiBaseUrl = import.meta.env.VITE_API_URL || 'https://hrta-portal.onrender.com';
        const response = await fetch(`${apiBaseUrl}/api/verify-scorecard-token?resultId=${resultId}&token=${token}`);
        
        if (!response.ok) {
          const errData = await response.json();
          setIsBlocked(true);
          setErrorMessage(errData.error || 'Invalid or expired secure scorecard token.');
          setLoading(false);
          return;
        }

        const data = await response.json();
        setStudent(data.result.students);
        setResults([data.result]);
        setQuestions(data.questions);
        setSelectedResult(data.result);
        
        // Calculate subject stats
        calculateStats(data.questions, data.result);

      } catch (err) {
        console.error('Error fetching scorecard:', err);
        setIsBlocked(true);
        setErrorMessage('Failed to load scorecard. Please check your network connection.');
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, []);

  useEffect(() => {
    // No-op - calculation is handled directly upon verification endpoint fetch
  }, [selectedResult]);

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

  const calculateAutoMarkForQuestion = (q, studentAnswer, posMarks, negMarks) => {
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
      const penalty = negMarks;
      
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
        const penalty = negMarks;
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

  const fetchQuestionsAndCalculateStats = async () => {
    try {
      const { data: qData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .eq('exam_id', selectedResult.exam_id)
        .order('order_index', { ascending: true });

      if (qError) throw qError;
      
      const qList = qData || [];
      setQuestions(qList);

      const stats = {};
      const answers = selectedResult.answers || {};
      const timeSpentObj = selectedResult.question_statuses || {};

      qList.forEach(q => {
        // Group subjects (Physics, Chemistry, Mathematics, Other)
        const rawTopic = q.topic || selectedResult.exams?.subject || 'Other';
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

        const posMarks = q.positive_marks !== null && q.positive_marks !== undefined && q.positive_marks !== '' 
          ? parseFloat(q.positive_marks) 
          : (selectedResult.exams?.correct_marks !== null && selectedResult.exams?.correct_marks !== undefined && selectedResult.exams?.correct_marks !== '' 
            ? parseFloat(selectedResult.exams.correct_marks) 
            : 4);
            
        const negMarks = q.negative_marks !== null && q.negative_marks !== undefined && q.negative_marks !== '' 
          ? parseFloat(q.negative_marks) 
          : (selectedResult.exams?.negative_marks !== null && selectedResult.exams?.negative_marks !== undefined && selectedResult.exams?.negative_marks !== '' 
            ? parseFloat(selectedResult.exams.negative_marks) 
            : 0);
        stats[subject].total_marks += posMarks;

        // Sum time spent
        const timeSecs = parseInt(timeSpentObj[q.id]) || 0;
        stats[subject].time_spent += timeSecs;

        if (!hasAnswered) {
          stats[subject].unattempted++;
        } else {
          const qType = q.question_type || q.type;
          const policy = q.scoring_policy || "exact_match";

          let correctList = [];
          try {
            correctList = JSON.parse(q.correct_answer);
            if (!Array.isArray(correctList)) correctList = [correctList];
          } catch (e) {
            if (q.correct_answer) correctList = [q.correct_answer];
          }
          correctList = correctList.map(item => normalizeOptionForComparison(item));

          let selectedList = [];
          if (Array.isArray(studentAnswer)) {
            selectedList = studentAnswer.map(item => normalizeOptionForComparison(item));
          } else {
            selectedList = [normalizeOptionForComparison(studentAnswer)];
          }

          if (qType === "numerical_integer" || qType === "numerical_decimal") {
            const sNum = parseFloat(studentAnswer);
            const penalty = negMarks > 0 ? negMarks : 1;
            
            if (isNaN(sNum)) {
              stats[subject].incorrect++;
              stats[subject].gained_marks -= penalty;
            } else {
              const parsedRange = parseNumericalRange(q.correct_answer);
              if (parsedRange) {
                const eps = 1e-9;
                if (sNum >= parsedRange.min - eps && sNum <= parsedRange.max + eps) {
                  stats[subject].correct++;
                  stats[subject].gained_marks += posMarks;
                } else {
                  stats[subject].incorrect++;
                  stats[subject].gained_marks -= penalty;
                }
              } else {
                const cNum = parseFloat(q.correct_answer);
                if (!isNaN(cNum) && Math.abs(sNum - cNum) < 0.0101) {
                  stats[subject].correct++;
                  stats[subject].gained_marks += posMarks;
                } else {
                  stats[subject].incorrect++;
                  stats[subject].gained_marks -= penalty;
                }
              }
            }
          } else if (qType === "mcq_single" || qType === "true_false" || qType === "single") {
            if (correctList.includes(selectedList[0])) {
              stats[subject].correct++;
              stats[subject].gained_marks += posMarks;
            } else {
              stats[subject].incorrect++;
              stats[subject].gained_marks -= negMarks;
            }
          } else if (qType === "mcq_multiple" || qType === "multiple" || qType === "subjective") {
            const hasIncorrect = selectedList.some(item => !correctList.includes(item));
            if (hasIncorrect) {
              stats[subject].incorrect++;
              const penalty = negMarks > 0 ? negMarks : 2;
              stats[subject].gained_marks -= penalty;
            } else {
              const numSel = selectedList.length;
              const numCor = correctList.length;

              if (numSel === numCor) {
                stats[subject].correct++;
                stats[subject].gained_marks += posMarks;
              } else if (numSel < numCor && numSel > 0) {
                stats[subject].partial++;
                let partialScore = 0;
                if (numCor === 2) {
                  if (numSel === 1) partialScore = 2;
                } else if (numCor === 3) {
                  if (numSel === 1) partialScore = 1;
                  if (numSel === 2) partialScore = 3;
                } else if (numCor === 4) {
                  if (numSel === 1) partialScore = 1;
                  if (numSel === 2) partialScore = 2;
                  if (numSel === 3) partialScore = 3;
                } else {
                  partialScore = numSel;
                }
                stats[subject].gained_marks += partialScore;
              } else {
                stats[subject].unattempted++;
              }
            }
          } else {
            if (String(studentAnswer).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase()) {
              stats[subject].correct++;
              stats[subject].gained_marks += posMarks;
            } else {
              stats[subject].incorrect++;
              stats[subject].gained_marks -= negMarks;
            }
          }
        }
      });

      setSubjectStats(stats);

    } catch (err) {
      console.error("Error evaluating subject stats:", err);
    }
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
    return (
      <div className="min-h-screen bg-[#f1f4f9] flex items-center justify-center font-sans">
        <div className="text-[#1f497d] font-bold text-lg flex items-center">
          <svg className="animate-spin h-6 w-6 mr-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Generating Scorecards...
        </div>
      </div>
    );
  }

  if (isBlocked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-sans p-6 text-white relative overflow-hidden">
        {/* Dynamic Abstract Tech Grid Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-35"></div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="relative z-10 max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center shadow-2xl backdrop-blur-md">
          <div className="mx-auto w-20 h-20 bg-red-950/50 border border-red-500/30 rounded-2xl flex items-center justify-center mb-6">
            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <h2 className="text-2xl font-black tracking-tight text-white uppercase mb-3">
            Secure Scorecard Access Denied
          </h2>

          <p className="text-slate-400 font-semibold text-sm leading-relaxed mb-6">
            {errorMessage || 'For security and integrity reasons, candidate scorecards can only be accessed using the unique verification link sent to your registered email address.'}
          </p>

          <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-4 mb-6 text-left">
            <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 mb-1.5">
              💡 Instructions to Access:
            </h4>
            <p className="text-slate-400 text-xs leading-relaxed font-medium">
              Check your registered email inbox (or spam/promotions folder) for the official results publication email from <span className="text-white font-semibold">HRTA Results</span> and click the <span className="text-white font-semibold">"View Scorecard"</span> button.
            </p>
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 px-6 rounded-xl border border-slate-700 transition-colors uppercase text-xs tracking-wider"
          >
            Return to Portal Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f4f9] font-sans pb-12 print:bg-white print:pb-0">
      
      {/* Hide Sidebar/Nav areas on print via Tailwind print classes */}
      <div className="print:hidden bg-[#1f497d] text-white py-4 px-6 shadow-md border-b-4 border-yellow-500 mb-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wider">Candidate Scorecard</h1>
            <p className="text-sm font-medium opacity-90">Official verified examination results</p>
          </div>
          <button 
            onClick={handlePrint}
            disabled={!selectedResult}
            className="bg-white text-[#1f497d] hover:bg-gray-100 px-5 py-2 rounded font-bold shadow transition-colors flex items-center disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Download PDF
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-6 print:block print:p-0">
        
        {/* Right Column: Exact NTA Style Scorecard (Visible on Print) - Set to w-full to hide sidebar and use maximum space */}
        <div className="w-full">
          {!selectedResult ? (
            <div className="bg-white p-12 text-center text-gray-500 border border-gray-300 rounded shadow-sm print:hidden">
              Loading scorecard detail...
            </div>
          ) : (
            <div id="scorecard-print-area" className="bg-white border border-gray-300 rounded shadow-lg p-8 print:shadow-none print:border-none print:p-0">
              
              <style>{`
                @media print {
                  .print-no-break {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                  }
                }
              `}</style>

              {/* NTA Scorecard Header */}
              <div className="border-b-2 border-[#005fa7] pb-4 mb-6 text-center relative flex justify-center items-center">
                
                <div className="flex-1 px-4">
                  <h2 className="text-[#005fa7] text-2xl font-black uppercase tracking-wide">Harman Rathi Testing Agency</h2>
                  <p className="text-gray-700 font-bold text-sm mt-1 uppercase">Excellence in Assessment</p>
                  <p className="text-gray-800 font-bold text-lg mt-3 bg-gray-100 py-1 border border-gray-300 inline-block px-6 rounded-full">
                    {selectedResult.exams?.title} (Attempt #{selectedResult.attempt_number || 1}) - FINAL SCORECARD
                  </p>
                </div>
                
              </div>

              {/* Candidate Details Grid */}
              <div className="border border-gray-400 mb-8 rounded overflow-hidden text-sm">
                <table className="w-full text-left">
                  <tbody>
                    <tr className="border-b border-gray-300">
                      <td className="w-1/4 bg-gray-100 p-2 font-bold text-gray-700 border-r border-gray-300">Application Number :</td>
                      <td className="w-1/4 p-2 font-bold border-r border-gray-300">{student?.application_id}</td>
                      <td className="w-1/4 bg-gray-100 p-2 font-bold text-gray-700 border-r border-gray-300">Roll Number :</td>
                      <td className="w-1/4 p-2 font-bold">{student?.application_id?.replace('HRTA', 'RL') || ''}</td>
                    </tr>
                    <tr className="border-b border-gray-300">
                      <td className="bg-gray-100 p-2 font-bold text-gray-700 border-r border-gray-300">Candidate's Name :</td>
                      <td className="p-2 font-bold uppercase text-[#1f497d] border-r border-gray-300">{student?.full_name}</td>
                      <td className="bg-gray-100 p-2 font-bold text-gray-700 border-r border-gray-300">Date of Birth :</td>
                      <td className="p-2 font-bold">{student?.date_of_birth}</td>
                    </tr>
                    <tr className="border-b border-gray-300">
                      <td className="bg-gray-100 p-2 font-bold text-gray-700 border-r border-gray-300">Category :</td>
                      <td className="p-2 font-bold border-r border-gray-300">{student?.category || 'General'}</td>
                      <td className="bg-gray-100 p-2 font-bold text-gray-700 border-r border-gray-300">Gender :</td>
                      <td className="p-2 font-bold">Male</td> {/* Adjust if gender is added to DB */}
                    </tr>
                    <tr>
                      <td className="bg-gray-100 p-2 font-bold text-gray-700 border-r border-gray-300">Test Date & Time :</td>
                      <td className="p-2 font-bold border-r border-gray-300" colSpan="3">
                        {new Date(selectedResult.started_at).toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Subject Breakdown Details Section */}
              <div className="mb-8 select-none">
                <div className="bg-[#1f497d] text-white font-bold px-4 py-2 text-center uppercase tracking-wider mb-4 rounded-t">
                  Subject-wise Performance Breakdown
                </div>
                
                <div className="overflow-x-auto border border-gray-300 rounded mb-6">
                  <table className="w-full border-collapse text-xs text-center">
                    <thead>
                      <tr className="bg-gray-150 text-gray-800 border-b border-gray-300 font-bold">
                        <th className="p-3 text-left w-1/4">Subject</th>
                        <th className="p-3">Total Qs</th>
                        <th className="p-3 text-green-750">Correct</th>
                        <th className="p-3 text-red-650">Incorrect</th>
                        <th className="p-3 text-gray-500">Unattempted</th>
                        <th className="p-3 text-purple-750">Partial</th>
                        <th className="p-3 text-blue-600">Time Spent</th>
                        <th className="p-3 bg-gray-100 font-black">Marks Gained</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 font-semibold text-gray-700">
                      {Object.keys(subjectStats).length === 0 ? (
                        <tr><td colSpan="8" className="p-6 text-center italic text-gray-400">Loading subject stats...</td></tr>
                      ) : (
                        Object.keys(subjectStats).map(sub => {
                          const s = subjectStats[sub];
                          return (
                            <tr key={sub} className="hover:bg-gray-50 transition-colors">
                              <td className="p-3 text-left font-bold text-[#1f497d]">{sub}</td>
                              <td className="p-3">{s.correct + s.incorrect + s.unattempted + s.partial}</td>
                              <td className="p-3 text-green-600 font-bold">{s.correct}</td>
                              <td className="p-3 text-red-600 font-bold">{s.incorrect}</td>
                              <td className="p-3 text-gray-500">{s.unattempted}</td>
                              <td className="p-3 text-purple-600 font-bold">{s.partial}</td>
                              <td className="p-3 text-blue-600 font-bold font-mono">{formatSubjectTime(s.time_spent)}</td>
                              <td className="p-3 bg-gray-50 font-black text-sm text-gray-800">{s.gained_marks} / {s.total_marks}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Cosmic Wave Bar Chart (Hidden during Print) */}
                {Object.keys(subjectStats).length > 0 && (
                  <div className="bg-slate-950 border border-slate-800 p-6 rounded-xl shadow-inner mb-6 relative overflow-hidden print:hidden">
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:2rem_2rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-35"></div>
                    <div className="relative z-10">
                      <h4 className="text-white text-xs font-black uppercase tracking-wider mb-4 flex items-center gap-1.5">
                        🌌 Cosmic Score Profile (Subject Comparison)
                      </h4>
                      <div className="w-full h-72">
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
              </div>

              {/* Accuracy Analytics */}
              <div className="flex justify-between gap-4 mb-8 text-center text-sm">
                <div className="flex-1 bg-gray-50 border border-gray-300 p-4 rounded">
                  <p className="font-bold text-gray-500 uppercase text-xs mb-1">Correct Answers</p>
                  <p className="font-black text-2xl text-green-600">{selectedResult.correct_count}</p>
                </div>
                <div className="flex-1 bg-gray-50 border border-gray-300 p-4 rounded">
                  <p className="font-bold text-gray-500 uppercase text-xs mb-1">Incorrect Answers</p>
                  <p className="font-black text-2xl text-red-600">{selectedResult.wrong_count}</p>
                </div>
                <div className="flex-1 bg-gray-50 border border-gray-300 p-4 rounded">
                  <p className="font-bold text-gray-500 uppercase text-xs mb-1">Unattempted</p>
                  <p className="font-black text-2xl text-gray-600">{selectedResult.unattempted_count}</p>
                </div>
                <div className="flex-1 bg-gray-50 border border-gray-300 p-4 rounded">
                  <p className="font-bold text-gray-500 uppercase text-xs mb-1">Accuracy / Rank</p>
                  <p className="font-black text-2xl text-[#1f497d]">{selectedResult.percentage}% / AIR {selectedResult.rank || '-'}</p>
                </div>
              </div>

              {/* Disclaimer / Remarks */}
              <div className="border border-gray-400 p-4 bg-[#f8f9fa] text-xs text-gray-700 leading-relaxed text-justify mb-8 rounded">
                <p className="font-bold mb-2 underline">Note:</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>This score card indicates the candidate's performance in the Computer Based Test (CBT) conducted by HRTA.</li>
                  <li>The Total Marks and Subject-wise marks are calculated using the final normalized scoring logic. Final Answer keys are used for evaluation.</li>
                  <li>No grievance with regard to answer key(s) will be entertained after the publication of this scorecard.</li>
                  <li>In case of a tie in the total score, the ranking is resolved based on time taken to complete the examination.</li>
                </ol>
              </div>

              {/* Candidate Response Sheet & Marks Audit (TRANS-PARENCY SECTION) */}
              <div className="mt-8 border-t border-gray-300 pt-6">
                <div className="bg-[#1f497d] text-white font-bold px-4 py-2 text-center uppercase tracking-wider mb-4 rounded-t text-xs">
                  Candidate Response Sheet & Marks Audit
                </div>
                
                <div className="space-y-4 text-left">
                  {questions.map((q, idx) => {
                    const studentAnswer = selectedResult.answers?.[q.id];
                    const overrides = selectedResult.marks_adjustments || {};
                    
                    const posMarks = q.positive_marks !== null && q.positive_marks !== undefined && q.positive_marks !== '' 
                      ? parseFloat(q.positive_marks) 
                      : (selectedResult.exams?.correct_marks !== null && selectedResult.exams?.correct_marks !== undefined && selectedResult.exams?.correct_marks !== '' 
                        ? parseFloat(selectedResult.exams.correct_marks) 
                        : 4);
                        
                    const negMarks = q.negative_marks !== null && q.negative_marks !== undefined && q.negative_marks !== '' 
                      ? parseFloat(q.negative_marks) 
                      : (selectedResult.exams?.negative_marks !== null && selectedResult.exams?.negative_marks !== undefined && selectedResult.exams?.negative_marks !== '' 
                        ? parseFloat(selectedResult.exams.negative_marks) 
                        : 0);
                    
                    const autoMark = calculateAutoMarkForQuestion(q, studentAnswer, posMarks, negMarks);
                    const finalMark = overrides[q.id] !== undefined ? parseFloat(overrides[q.id]) : autoMark;
                    const hasAnswered = studentAnswer !== undefined && studentAnswer !== null && studentAnswer !== '';
                    const timeSpentSeconds = selectedResult?.question_statuses?.[q.id];

                    return (
                      <div key={q.id} className="border border-gray-300 rounded p-4 text-xs font-semibold hover:bg-gray-50 transition-colors print-no-break">
                        <div className="flex flex-wrap justify-between items-start md:items-center mb-2 border-b pb-1.5 gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-gray-750 font-black">Question {idx + 1}</span>
                            <span className="text-[9px] text-gray-500 font-bold bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                              {q.question_type}
                            </span>
                            <span className="text-[9px] text-gray-500 font-bold bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                              Marks: +{posMarks} / -{negMarks}
                            </span>
                            {timeSpentSeconds !== undefined && timeSpentSeconds !== null && (
                              <span className="text-[9px] text-gray-500 font-bold bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                                ⏱ Time Spent: {formatTimeSpent(timeSpentSeconds)}
                              </span>
                            )}
                          </div>
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
                            <span className="text-gray-550 block text-[9px] uppercase font-bold tracking-wide">Options & Selected Choices:</span>
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
                            <span className="text-gray-550 block text-[9px] uppercase font-bold tracking-wide">Your Response:</span>
                            <span className={`font-bold ${hasAnswered ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                              {formatResponse(studentAnswer, q.options, q.question_type || q.type)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-550 block text-[9px] uppercase font-bold tracking-wide">Provisional Answer Key:</span>
                            <span className="text-green-700 font-bold">
                              {formatKey(q.correct_answer, q.options, q.question_type || q.type)}
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
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentResults;
